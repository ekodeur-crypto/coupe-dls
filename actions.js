/* Opérations de l'admin sur la coupe. Nécessite config.js, moteur.js et commun.js. */
var Actions = (function () {

  function adm(token) { return function (path, opts) { opts = opts || {}; opts.token = token; return sb(path, opts); }; }

  async function creerCoupe(token, nom, etape, places) {
    var fixes = { quarts: 8, demis: 4, finale: 2 };
    var nb = etape === 'poules' ? places : fixes[etape];
    var r = await adm(token)('coupes', { method: 'POST', prefer: 'return=representation', body: { nom: nom, etape_depart: etape, places: nb } });
    return r[0];
  }

  /* Crée les confrontations et matchs d'un tour d'élimination directe, puis met la coupe à jour */
  async function creerTour(token, coupeId, tour) {
    var a = adm(token), confs = [], matchs = [];
    tour.byes.forEach(function (id) {
      confs.push({ id: Moteur.uuid(), coupe_id: coupeId, phase: tour.phase, groupe: null, j1_id: id, j2_id: null, vainqueur_id: id, statut: 'termine', aller_retour: false });
    });
    tour.paires.forEach(function (p) {
      var id = Moteur.uuid();
      confs.push({ id: id, coupe_id: coupeId, phase: tour.phase, groupe: null, j1_id: p[0], j2_id: p[1], vainqueur_id: null, statut: 'en_cours', aller_retour: tour.aller_retour });
      matchs.push({ confrontation_id: id, manche: 1, statut: 'a_jouer' });
      if (tour.aller_retour) matchs.push({ confrontation_id: id, manche: 2, statut: 'a_jouer' });
    });
    await a('confrontations', { method: 'POST', prefer: 'return=minimal', body: confs });
    if (matchs.length) await a('matchs', { method: 'POST', prefer: 'return=minimal', body: matchs });
    await a('coupes?id=eq.' + coupeId, { method: 'PATCH', prefer: 'return=minimal', body: { phase: tour.phase } });
  }

  /* Lance la coupe : tirage au sort selon l'étape de départ */
  async function lancerCoupe(token, coupe) {
    var a = adm(token);
    var ins = await a('inscriptions?coupe_id=eq.' + coupe.id + '&select=joueur_id');
    var ids = ins.map(function (r) { return r.joueur_id; });

    if (coupe.etape_depart === 'poules') {
      if (ids.length < 3) throw new Error('Il faut au moins 3 inscrits pour lancer des poules.');
      var groupes = Moteur.tirerGroupes(ids), lignes = [], confs = [], matchs = [];
      Object.keys(groupes).forEach(function (g) {
        groupes[g].forEach(function (id) { lignes.push({ coupe_id: coupe.id, joueur_id: id, groupe: g }); });
        Moteur.toutesLesPaires(groupes[g]).forEach(function (p) {
          var cid = Moteur.uuid();
          confs.push({ id: cid, coupe_id: coupe.id, phase: 'poules', groupe: g, j1_id: p[0], j2_id: p[1], vainqueur_id: null, statut: 'en_cours', aller_retour: false });
          matchs.push({ confrontation_id: cid, manche: 1, statut: 'a_jouer' });
        });
      });
      await a('inscriptions?on_conflict=coupe_id,joueur_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: lignes });
      await a('confrontations', { method: 'POST', prefer: 'return=minimal', body: confs });
      await a('matchs', { method: 'POST', prefer: 'return=minimal', body: matchs });
      await a('coupes?id=eq.' + coupe.id, { method: 'PATCH', prefer: 'return=minimal', body: { phase: 'poules' } });
      return 'Coupe lancée : ' + Object.keys(groupes).length + ' groupe(s), ' + confs.length + ' matchs.';
    }

    if (ids.length < 2) throw new Error('Il faut au moins 2 inscrits pour lancer la coupe.');
    var tour = Moteur.construireTourKO(Moteur.melanger(ids), null);
    await creerTour(token, coupe.id, tour);
    return 'Coupe lancée : ' + Moteur.LIBELLES[tour.phase] + ' (' + tour.paires.length + ' confrontation(s), ' + tour.byes.length + ' exempté(s)).';
  }

  async function validerMatch(token, matchId, s1, s2) {
    if (!(s1 >= 0) || !(s2 >= 0)) throw new Error('Scores invalides.');
    await adm(token)('matchs?id=eq.' + matchId, { method: 'PATCH', prefer: 'return=minimal', body: { score1: s1, score2: s2, statut: 'joue' } });
  }

  /* qui : 'j1' ou 'j2' = ce joueur est forfait ; 'double' = les deux sont absents */
  async function forfait(token, conf, match, qui) {
    var a = adm(token);
    if (conf.phase === 'poules') {
      var corps = qui === 'double' ? { score1: null, score2: null, statut: 'double_forfait' }
        : { score1: qui === 'j1' ? 0 : 3, score2: qui === 'j1' ? 3 : 0, statut: 'forfait' };
      await a('matchs?id=eq.' + match.id, { method: 'PATCH', prefer: 'return=minimal', body: corps });
      return;
    }
    await a('matchs?confrontation_id=eq.' + conf.id + '&statut=eq.a_jouer', { method: 'PATCH', prefer: 'return=minimal', body: { statut: qui === 'double' ? 'double_forfait' : 'forfait' } });
    var maj = qui === 'double' ? { statut: 'annule' } : { vainqueur_id: qui === 'j1' ? conf.j2_id : conf.j1_id, statut: 'termine' };
    await a('confrontations?id=eq.' + conf.id, { method: 'PATCH', prefer: 'return=minimal', body: maj });
  }

  async function ajouterAppui(token, confId) {
    await adm(token)('matchs', { method: 'POST', prefer: 'return=minimal', body: [{ confrontation_id: confId, manche: 3, statut: 'a_jouer' }] });
  }

  async function designerVainqueur(token, confId, joueurId) {
    await adm(token)('confrontations?id=eq.' + confId, { method: 'PATCH', prefer: 'return=minimal', body: { vainqueur_id: joueurId, statut: 'termine' } });
  }

  async function retirerInscrit(token, coupeId, joueurId) {
    await adm(token)('inscriptions?coupe_id=eq.' + coupeId + '&joueur_id=eq.' + joueurId, { method: 'DELETE', prefer: 'return=minimal' });
  }

  async function departager(token, coupeId, joueurId) {
    await adm(token)('inscriptions?coupe_id=eq.' + coupeId + '&joueur_id=eq.' + joueurId, { method: 'PATCH', prefer: 'return=minimal', body: { rang_force: 0 } });
  }

  async function traiterPlainte(token, id, note) {
    await adm(token)('plaintes?id=eq.' + id, { method: 'PATCH', prefer: 'return=minimal', body: { statut: 'traitee', note_admin: note || null } });
  }

  /* Poules terminées -> tour à élimination ; tour terminé -> tour suivant ou champion */
  async function passerPhaseSuivante(token, coupe) {
    var a = adm(token);
    var confs = await a('confrontations?coupe_id=eq.' + coupe.id + '&phase=eq.' + coupe.phase + '&select=*,matchs(*)');

    if (coupe.phase === 'poules') {
      var restants = confs.filter(function (c) { return c.matchs.some(function (m) { return !Moteur.matchValide(m); }); });
      if (restants.length) throw new Error(restants.length + ' match(s) de poule pas encore validé(s).');
      var r = await Promise.all([
        a('inscriptions?coupe_id=eq.' + coupe.id + '&select=joueur_id,groupe,rang_force'),
        a('joueurs?select=id,pseudo')
      ]);
      var pseudo = {}; r[1].forEach(function (j) { pseudo[j.id] = j.pseudo; });
      var groupes = {};
      r[0].forEach(function (i) { (groupes[i.groupe] = groupes[i.groupe] || []).push({ id: i.joueur_id, pseudo: pseudo[i.joueur_id] || '?', rang_force: i.rang_force }); });
      var gagnants = [], seconds = [], groupeDe = {}, egalites = [];
      Object.keys(groupes).sort().forEach(function (g) {
        var cl = Moteur.classement(groupes[g], matchsDeGroupe(confs, g));
        var eg = Moteur.egaliteFrontiere(cl, 2);
        if (eg) egalites.push({ groupe: g, joueurs: eg });
        gagnants.push(cl[0].id); seconds.push(cl[1].id);
        groupeDe[cl[0].id] = g; groupeDe[cl[1].id] = g;
      });
      if (egalites.length) {
        var e = new Error('Égalité parfaite à départager dans le groupe ' + egalites.map(function (x) { return x.groupe; }).join(', ') + '.');
        e.egalites = egalites; throw e;
      }
      var tour = Moteur.tirageApresPoules(gagnants, seconds, function (id) { return groupeDe[id]; });
      await creerTour(token, coupe.id, tour);
      return 'Phase suivante : ' + Moteur.LIBELLES[tour.phase] + '.';
    }

    var res = confs.map(function (c) { return Moteur.resultatConfrontation(c, c.matchs); });
    var attente = res.filter(function (x) { return !x.termine; });
    if (attente.length) throw new Error(attente.length + ' confrontation(s) pas encore terminée(s).');
    var vainqueurs = res.filter(function (x) { return x.gagnant; }).map(function (x) { return x.gagnant; });
    if (vainqueurs.length <= 1 || coupe.phase === 'finale') {
      await a('coupes?id=eq.' + coupe.id, { method: 'PATCH', prefer: 'return=minimal', body: { phase: 'terminee', champion_id: vainqueurs[0] || null } });
      return vainqueurs.length ? 'Coupe terminée : le champion est connu !' : 'Coupe terminée (aucun vainqueur).';
    }
    var suivant = Moteur.construireTourKO(Moteur.melanger(vainqueurs), null);
    await creerTour(token, coupe.id, suivant);
    return 'Phase suivante : ' + Moteur.LIBELLES[suivant.phase] + '.';
  }

  return { creerCoupe: creerCoupe, lancerCoupe: lancerCoupe, validerMatch: validerMatch, forfait: forfait,
    ajouterAppui: ajouterAppui, designerVainqueur: designerVainqueur, retirerInscrit: retirerInscrit,
    departager: departager, traiterPlainte: traiterPlainte, passerPhaseSuivante: passerPhaseSuivante };
})();
if (typeof module !== 'undefined') module.exports = Actions;
