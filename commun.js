/* Outils partagés par toutes les pages. Nécessite config.js (et moteur.js pour les libellés) chargés avant. */

/* Appel à Supabase. opts : method, body, prefer, token (jeton admin) */
async function sb(path, opts) {
  opts = opts || {};
  var token = opts.token || SUPABASE_ANON_KEY;
  var headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + token };
  if (opts.prefer) headers['Prefer'] = opts.prefer;
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  var txt = await res.text();
  if (!res.ok) { var e = new Error(res.status + ' — ' + txt); e.status = res.status; throw e; }
  return txt ? JSON.parse(txt) : null;
}
function rpc(nom, args, token) { return sb('rpc/' + nom, { method: 'POST', body: args || {}, token: token }); }

/* Messages d'erreur lisibles */
var ERREURS = {
  PSEUDO_INVALIDE: 'Le pseudo doit faire entre 3 et 20 caractères.',
  NUMERO_INVALIDE: "Numéro invalide. Ajoute l'indicatif de ton pays, ex : 22890000000.",
  PSEUDO_PRIS: 'Ce pseudo est déjà pris. Choisis-en un autre.',
  IDENTIFIANTS_INCORRECTS: 'Pseudo ou numéro incorrect.',
  ACCES_REFUSE: 'Accès refusé. Reconnecte-toi depuis la page d\'accueil.',
  COUPE_INTROUVABLE: 'Coupe introuvable.',
  INSCRIPTIONS_FERMEES: 'Les inscriptions sont fermées.',
  COUPE_PLEINE: 'La coupe est complète.',
  INTERDIT: 'Tu ne fais pas partie de ce match.',
  PAS_ADVERSAIRE: "Tu n'as pas d'adversaire sur ce tour.",
  MATCH_CLOS: 'Ce match est déjà clôturé.',
  SCORE_INVALIDE: 'Score invalide (0 à 30).',
  TYPE_INVALIDE: 'Type de problème invalide.',
  MESSAGE_INVALIDE: 'Décris le problème en 3 à 500 caractères.',
  TROP_DE_PLAINTES: 'Tu as déjà 5 plaintes en cours. Attends que l\'admin les traite.',
  ACCES_ADMIN: "Ce compte n'est pas administrateur (voir schema.sql, ligne de l'e-mail admin)."
};
function messageErreur(e) {
  var m = (e && e.message) || String(e || '');
  var corps = m.replace(/^\d+ — /, '');
  try { var j = JSON.parse(corps); if (j.message) return ERREURS[j.message] || j.message; } catch (x) { /* pas du JSON */ }
  return ERREURS[corps] || m || 'Erreur inconnue.';
}

/* Joueur enregistré sur cet appareil */
function joueurLocal() { try { return JSON.parse(localStorage.getItem('dls_joueur') || 'null'); } catch (e) { return null; } }
function sauverJoueur(j) { localStorage.setItem('dls_joueur', JSON.stringify(j)); }
function oublierJoueur() { localStorage.removeItem('dls_joueur'); }

/* Protège contre l'injection de code dans les pseudos */
function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* Coupe la plus récente */
async function derniereCoupe() {
  var r = await sb('coupes?select=*&order=created_at.desc&limit=1');
  return r[0] || null;
}

/* Données publiques d'une coupe */
async function chargerCoupe(coupeId) {
  var r = await Promise.all([
    sb('inscriptions?coupe_id=eq.' + coupeId + '&select=joueur_id,groupe,rang_force&order=created_at'),
    sb('joueurs?select=id,pseudo'),
    sb('confrontations?coupe_id=eq.' + coupeId + '&select=*,matchs(*)&order=created_at')
  ]);
  var pseudo = {};
  r[1].forEach(function (j) { pseudo[j.id] = j.pseudo; });
  r[2].forEach(function (c) { c.matchs.sort(function (a, b) { return a.manche - b.manche; }); });
  return { inscriptions: r[0], pseudo: pseudo, confrontations: r[2] };
}

/* Matchs de poule d'un groupe, au format attendu par Moteur.classement */
function matchsDeGroupe(confrontations, groupe) {
  return confrontations.filter(function (c) { return c.phase === 'poules' && c.groupe === groupe && c.matchs[0]; })
    .map(function (c) { var m = c.matchs[0]; return { j1: c.j1_id, j2: c.j2_id, s1: m.score1, s2: m.score2, statut: m.statut }; });
}
