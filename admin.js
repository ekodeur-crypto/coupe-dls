(function () {
  var coupes = [], coupe = null, d = null, joueursAdmin = [], declarations = [], plaintes = [];
  var elLogin = document.getElementById('login'), elApp = document.getElementById('app'), elFlash = document.getElementById('flash'), elDeco = document.getElementById('deco');
  var TYPES = { absent: 'Adversaire absent', score: 'Désaccord de score', autre: 'Autre' };

  /* ---------- connexion ---------- */
  function lireSession() { try { return JSON.parse(sessionStorage.getItem('dls_admin') || 'null'); } catch (e) { return null; } }
  async function authentifier(grant, corps) {
    var res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=' + grant, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY }, body: JSON.stringify(corps)
    });
    var j = await res.json();
    if (!res.ok) throw new Error(j.error_description || j.msg || j.message || 'Connexion refusée');
    return { access_token: j.access_token, refresh_token: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email: (j.user && j.user.email) || '' };
  }
  async function jeton() {
    var s = lireSession();
    if (!s) throw new Error('SESSION_EXPIREE');
    if (s.exp - Date.now() < 60000) {
      try { var n = await authentifier('refresh_token', { refresh_token: s.refresh_token }); n.email = n.email || s.email; s = n; sessionStorage.setItem('dls_admin', JSON.stringify(s)); }
      catch (e) { throw new Error('SESSION_EXPIREE'); }
    }
    return s.access_token;
  }
  function deconnexion() {
    sessionStorage.removeItem('dls_admin'); elApp.style.display = 'none'; elLogin.style.display = 'block'; elDeco.style.display = 'none';
  }
  document.getElementById('formLogin').onsubmit = async function (e) {
    e.preventDefault();
    var m = document.getElementById('loginMsg'); m.innerHTML = '';
    try {
      var s = await authentifier('password', { email: document.getElementById('email').value.trim(), password: document.getElementById('mdp').value });
      sessionStorage.setItem('dls_admin', JSON.stringify(s));
      await demarrer();
    } catch (err) { m.innerHTML = '<div class="msg err">' + esc(messageErreur(err)) + '</div>'; }
  };
  elDeco.onclick = function (e) { e.preventDefault(); deconnexion(); };

  function flash(texte, ok) { elFlash.innerHTML = texte ? '<div class="notice ' + (ok ? '' : 'warn') + '" style="background:var(--panel);">' + esc(texte) + '</div>' : ''; }

  async function agir(fn, texteOk) {
    flash('');
    try {
      var t = await jeton(), r = await fn(t);
      await charger();
      flash(typeof r === 'string' ? r : texteOk, true);
    } catch (e) {
      if (e.message === 'SESSION_EXPIREE') { deconnexion(); document.getElementById('loginMsg').innerHTML = '<div class="msg err">Session expirée, reconnecte-toi.</div>'; return; }
      flash(messageErreur(e), false);
      try { await charger(); } catch (x) { /* on garde l'affichage actuel */ }
    }
  }

  /* ---------- chargement ---------- */
  async function charger() {
    var t = await jeton();
    coupes = await sb('coupes?select=*&order=created_at.desc', { token: t });
    var id = coupe && coupe.id;
    coupe = coupes.filter(function (c) { return c.id === id; })[0] || coupes[0] || null;
    joueursAdmin = await rpc('admin_joueurs', {}, t);
    if (coupe) {
      d = await chargerCoupe(coupe.id);
      declarations = await sb('declarations?select=*', { token: t });
      plaintes = await sb('plaintes?select=*&order=created_at.desc', { token: t });
    } else { d = null; declarations = []; plaintes = []; }
    rendre();
  }

  async function demarrer() {
    try {
      await charger();
      elLogin.style.display = 'none'; elApp.style.display = 'block'; elDeco.style.display = 'inline-block';
    } catch (e) {
      sessionStorage.removeItem('dls_admin');
      document.getElementById('loginMsg').innerHTML = '<div class="msg err">' + esc(messageErreur(e)) + '</div>';
    }
  }

  /* ---------- affichage ---------- */
  function nom(id) { return id ? ((d && d.pseudo[id]) || '?') : '—'; }
  function libelleConf(c) { return c.phase === 'poules' ? 'Groupe ' + c.groupe : Moteur.LIBELLES[c.phase]; }
  function libelleManche(c, m) { return m.manche === 3 ? "Match d'appui" : (c.aller_retour ? (m.manche === 1 ? 'Aller' : 'Retour') : 'Match'); }
  function whatsappDe(id) { var j = joueursAdmin.filter(function (x) { return x.id === id; })[0]; return j ? j.whatsapp : ''; }

  function panneauCreation() {
    return '<div class="panel"><div class="band yellow"><span>NOUVELLE COUPE</span></div><div class="pb">' +
      '<div class="grid">' +
      '<div class="field"><label for="cNom">Nom de la coupe</label><input id="cNom" value="Coupe DLS — Saison 01"></div>' +
      '<div class="field"><label for="cEtape">Étape de départ</label><select id="cEtape">' +
      '<option value="poules">Phase de poules (puis élimination)</option><option value="quarts">Quarts de finale (8 joueurs)</option>' +
      '<option value="demis">Demi-finales (4 joueurs)</option><option value="finale">Finale (2 joueurs)</option></select></div>' +
      '<div class="field" id="cPlacesBox"><label for="cPlaces">Nombre de places</label><input id="cPlaces" type="number" min="3" max="128" value="16"></div>' +
      '</div><button class="btn" data-act="creer">Créer la coupe</button></div></div>';
  }

  function panneauCoupe() {
    var nbInscrits = d.inscriptions.length, html = '<div class="panel"><div class="band blue"><span>COUPE EN COURS</span><span>' + esc(Moteur.LIBELLES[coupe.phase] || coupe.phase) + '</span></div><div class="pb">';
    if (coupes.length > 1) {
      html += '<div class="field"><label for="selCoupe">Coupe affichée</label><select id="selCoupe">' +
        coupes.map(function (c) { return '<option value="' + c.id + '"' + (c.id === coupe.id ? ' selected' : '') + '>' + esc(c.nom) + '</option>'; }).join('') + '</select></div>';
    }
    html += '<div class="row"><span class="grow"><b>' + esc(coupe.nom) + '</b></span><span class="badge">départ : ' + esc(coupe.etape_depart) + '</span></div>';
    html += '<div class="row"><span class="grow">Inscrits</span><b>' + nbInscrits + ' / ' + coupe.places + '</b></div>';

    if (coupe.phase === 'inscriptions') {
      html += '<div class="sep"></div><div class="small muted" style="margin-bottom:8px;">Tu peux lancer la coupe même si elle n\'est pas pleine. Après le lancement, plus personne ne peut s\'inscrire.</div>';
      html += d.inscriptions.map(function (i) {
        return '<div class="row"><span class="grow">' + esc(nom(i.joueur_id)) + '</span><span class="small muted">+' + esc(whatsappDe(i.joueur_id)) + '</span>' +
          '<button class="btn danger small" data-act="retirer" data-joueur="' + i.joueur_id + '">Retirer</button></div>';
      }).join('');
      html += '<div class="sep"></div><button class="btn good" data-act="lancer"' + (nbInscrits < 2 ? ' disabled' : '') + '>Lancer la coupe (tirage au sort)</button>';
    } else if (coupe.phase === 'terminee') {
      html += '<div class="banner" style="margin-top:10px;">🏆 Champion : ' + esc(nom(coupe.champion_id)) + '</div>';
    } else {
      html += '<div class="row"><span class="grow">Éléments à traiter</span><b>' + elementsATraiter() + '</b></div>';
      html += '<div class="sep"></div><button class="btn good" data-act="suivante">Passer à la phase suivante</button>' +
        '<div class="small muted" style="margin-top:6px;">Disponible quand tous les matchs du tour sont validés.</div>';
    }
    return html + '</div></div>';
  }

  function confsCourantes() { return d.confrontations.filter(function (c) { return c.phase === coupe.phase; }); }
  function elementsATraiter() {
    var n = 0;
    confsCourantes().forEach(function (c) {
      if (!c.j2_id) return;
      n += c.matchs.filter(function (m) { return m.statut === 'a_jouer'; }).length;
      if (Moteur.resultatConfrontation(c, c.matchs).egalite) n++;
    });
    return n;
  }

  function declarationsDuMatch(c, m) {
    return declarations.filter(function (x) { return x.match_id === m.id; }).map(function (x) {
      var estJ1 = x.joueur_id === c.j1_id;
      return { joueur: x.joueur_id, s1: estJ1 ? x.score_moi : x.score_adv, s2: estJ1 ? x.score_adv : x.score_moi };
    });
  }

  function blocMatch(c, m) {
    var decs = declarationsDuMatch(c, m), etat, pre1 = '', pre2 = '';
    if (decs.length === 2) {
      var ok = decs[0].s1 === decs[1].s1 && decs[0].s2 === decs[1].s2;
      etat = ok ? '<span class="badge ok">Déclarations concordantes</span>' : '<span class="badge bad">Désaccord</span>';
      if (ok) { pre1 = decs[0].s1; pre2 = decs[0].s2; }
    } else if (decs.length === 1) { etat = '<span class="badge warn">1 seule déclaration</span>'; pre1 = decs[0].s1; pre2 = decs[0].s2; }
    else etat = '<span class="badge">Aucune déclaration</span>';
    var detail = decs.map(function (x) { return esc(nom(x.joueur)) + ' : ' + x.s1 + '–' + x.s2; }).join(' &nbsp;·&nbsp; ');
    return '<div style="margin:8px 0 14px;"><div class="small muted" style="margin-bottom:6px;">' + libelleManche(c, m) + ' &nbsp;' + etat + (detail ? ' &nbsp;' + detail : '') + '</div>' +
      '<div class="actions"><span class="small">' + esc(nom(c.j1_id)) + '</span><input class="score" id="s1-' + m.id + '" type="number" min="0" value="' + pre1 + '">' +
      '<span>–</span><input class="score" id="s2-' + m.id + '" type="number" min="0" value="' + pre2 + '"><span class="small">' + esc(nom(c.j2_id)) + '</span>' +
      '<button class="btn small good" data-act="valider" data-match="' + m.id + '">Valider</button></div>' +
      '<div class="actions" style="margin-top:6px;"><button class="btn small danger" data-act="forfait" data-qui="j1" data-conf="' + c.id + '" data-match="' + m.id + '">Forfait ' + esc(nom(c.j1_id)) + '</button>' +
      '<button class="btn small danger" data-act="forfait" data-qui="j2" data-conf="' + c.id + '" data-match="' + m.id + '">Forfait ' + esc(nom(c.j2_id)) + '</button>' +
      '<button class="btn small danger" data-act="forfait" data-qui="double" data-conf="' + c.id + '" data-match="' + m.id + '">Double forfait</button></div></div>';
  }

  function panneauAValider() {
    var html = '', n = 0;
    confsCourantes().forEach(function (c) {
      if (!c.j2_id) return;
      var attente = c.matchs.filter(function (m) { return m.statut === 'a_jouer'; });
      var r = Moteur.resultatConfrontation(c, c.matchs);
      if (!attente.length && !r.egalite) return;
      n++;
      html += '<div class="panel"><div class="band ' + (c.phase === 'poules' ? 'red' : 'purple') + '"><span>' + esc(libelleConf(c).toUpperCase()) + '</span><span>' + esc(nom(c.j1_id)) + ' vs ' + esc(nom(c.j2_id)) + '</span></div><div class="pb">';
      html += attente.map(function (m) { return blocMatch(c, m); }).join('');
      if (r.egalite) {
        var aAppui = c.matchs.some(function (m) { return m.manche === 3; });
        html += '<div class="notice warn">Égalité au cumul (' + r.totaux.j1 + '–' + r.totaux.j2 + '). Départage : tirs au but dans le jeu, ou match d\'appui.</div><div class="actions">' +
          (aAppui ? '' : '<button class="btn small" data-act="appui" data-conf="' + c.id + '">Organiser un match d\'appui</button>') +
          '<button class="btn small good" data-act="vainqueur" data-conf="' + c.id + '" data-joueur="' + c.j1_id + '">Vainqueur : ' + esc(nom(c.j1_id)) + '</button>' +
          '<button class="btn small good" data-act="vainqueur" data-conf="' + c.id + '" data-joueur="' + c.j2_id + '">Vainqueur : ' + esc(nom(c.j2_id)) + '</button></div>';
      }
      html += '</div></div>';
    });
    return '<h2 style="margin-top:6px;">À valider (' + n + ')</h2>' + (html || '<div class="notice">Rien à valider pour l\'instant.</div>');
  }

  function egalitesPoules() {
    if (coupe.phase !== 'poules') return [];
    var confs = confsCourantes();
    if (confs.some(function (c) { return c.matchs.some(function (m) { return !Moteur.matchValide(m); }); })) return [];
    var groupes = {}, res = [];
    d.inscriptions.forEach(function (i) { if (i.groupe) (groupes[i.groupe] = groupes[i.groupe] || []).push({ id: i.joueur_id, pseudo: nom(i.joueur_id), rang_force: i.rang_force }); });
    Object.keys(groupes).sort().forEach(function (g) {
      var eg = Moteur.egaliteFrontiere(Moteur.classement(groupes[g], matchsDeGroupe(d.confrontations, g)), 2);
      if (eg) res.push({ groupe: g, joueurs: eg });
    });
    return res;
  }

  function panneauEgalites() {
    var eg = egalitesPoules();
    if (!eg.length) return '';
    return '<div class="panel"><div class="band yellow"><span>ÉGALITÉ À DÉPARTAGER</span></div><div class="pb">' +
      eg.map(function (e) {
        return '<div class="notice warn">Groupe ' + esc(e.groupe) + ' : égalité parfaite pour la 2e place qualificative. Choisis qui passe.</div><div class="actions">' +
          e.joueurs.map(function (j) { return '<button class="btn small good" data-act="departager" data-joueur="' + j.id + '">Qualifier ' + esc(j.pseudo) + '</button>'; }).join('') + '</div>';
      }).join('') + '</div></div>';
  }

  function panneauPlaintes() {
    var ouvertes = plaintes.filter(function (p) { return p.statut === 'ouverte'; });
    var html = '<h2 style="margin-top:6px;">Plaintes (' + ouvertes.length + ')</h2>';
    if (!ouvertes.length) return html + '<div class="notice">Aucune plainte en cours.</div>';
    ouvertes.forEach(function (p) {
      var conf = d.confrontations.filter(function (c) { return c.matchs.some(function (m) { return m.id === p.match_id; }); })[0];
      var contexte = conf ? esc(libelleConf(conf)) + ' : ' + esc(nom(conf.j1_id)) + ' vs ' + esc(nom(conf.j2_id)) : 'match inconnu';
      var adv = conf ? (conf.j1_id === p.joueur_id ? conf.j2_id : conf.j1_id) : null;
      html += '<div class="panel"><div class="band yellow"><span>' + esc(TYPES[p.type] || p.type).toUpperCase() + '</span><span class="small">' + new Date(p.created_at).toLocaleString('fr-FR') + '</span></div><div class="pb">' +
        '<div class="small muted">' + contexte + '</div>' +
        '<p style="margin:8px 0;"><b>' + esc(nom(p.joueur_id)) + '</b> : ' + esc(p.message) + '</p>' +
        (adv ? '<div class="small muted" style="margin-bottom:8px;">WhatsApp de l\'adversaire ' + esc(nom(adv)) + ' : +' + esc(whatsappDe(adv)) + ' · du plaignant : +' + esc(whatsappDe(p.joueur_id)) + '</div>' : '') +
        '<div class="field"><input id="note-' + p.id + '" placeholder="Note (facultatif) : décision prise…"></div>' +
        '<button class="btn small good" data-act="plainte" data-id="' + p.id + '">Marquer comme traitée</button></div></div>';
    });
    return html + '<div class="small muted">Pour sanctionner : utilise les boutons Forfait dans « À valider ».</div>';
  }

  function rendre() {
    var html = panneauCreation();
    if (coupe) {
      html += panneauCoupe();
      if (coupe.phase !== 'inscriptions' && coupe.phase !== 'terminee') html += panneauEgalites() + panneauAValider();
      html += panneauPlaintes();
    }
    elApp.innerHTML = html;
    var et = document.getElementById('cEtape');
    if (et) et.onchange = function () { document.getElementById('cPlacesBox').style.display = et.value === 'poules' ? '' : 'none'; };
    var sel = document.getElementById('selCoupe');
    if (sel) sel.onchange = function () { coupe = coupes.filter(function (c) { return c.id === sel.value; })[0]; charger(); };
  }

  /* ---------- actions ---------- */
  function lire(id) { return parseInt(document.getElementById(id).value, 10); }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    e.preventDefault();
    var a = b.dataset.act;
    if (a === 'creer') {
      var nomCoupe = document.getElementById('cNom').value.trim();
      if (nomCoupe.length < 3) return flash('Donne un nom à la coupe.', false);
      agir(function (t) { return Actions.creerCoupe(t, nomCoupe, document.getElementById('cEtape').value, lire('cPlaces') || 16).then(function (c) { coupe = c; return 'Coupe créée : les joueurs peuvent s\'inscrire.'; }); });
    } else if (a === 'retirer') {
      if (!confirm('Retirer ce joueur de la coupe ?')) return;
      agir(function (t) { return Actions.retirerInscrit(t, coupe.id, b.dataset.joueur); }, 'Joueur retiré.');
    } else if (a === 'lancer') {
      if (!confirm('Lancer la coupe maintenant ? Le tirage au sort est définitif et les inscriptions seront fermées.')) return;
      agir(function (t) { return Actions.lancerCoupe(t, coupe); });
    } else if (a === 'valider') {
      var id = b.dataset.match, s1 = lire('s1-' + id), s2 = lire('s2-' + id);
      if (isNaN(s1) || isNaN(s2)) return flash('Entre les deux scores.', false);
      agir(function (t) { return Actions.validerMatch(t, id, s1, s2); }, 'Score validé.');
    } else if (a === 'forfait') {
      var conf = d.confrontations.filter(function (c) { return c.id === b.dataset.conf; })[0];
      var match = conf.matchs.filter(function (m) { return m.id === b.dataset.match; })[0];
      if (!confirm(b.dataset.qui === 'double' ? 'Déclarer un double forfait ?' : 'Confirmer ce forfait ?')) return;
      agir(function (t) { return Actions.forfait(t, conf, match, b.dataset.qui); }, 'Forfait enregistré.');
    } else if (a === 'appui') {
      agir(function (t) { return Actions.ajouterAppui(t, b.dataset.conf); }, "Match d'appui créé : les joueurs peuvent le jouer.");
    } else if (a === 'vainqueur') {
      if (!confirm('Désigner ' + b.textContent.replace('Vainqueur : ', '') + ' comme vainqueur de la confrontation ?')) return;
      agir(function (t) { return Actions.designerVainqueur(t, b.dataset.conf, b.dataset.joueur); }, 'Vainqueur enregistré.');
    } else if (a === 'departager') {
      agir(function (t) { return Actions.departager(t, coupe.id, b.dataset.joueur); }, 'Égalité départagée.');
    } else if (a === 'suivante') {
      if (!confirm('Passer à la phase suivante ? Les résultats du tour seront figés.')) return;
      agir(function (t) { return Actions.passerPhaseSuivante(t, coupe); });
    } else if (a === 'plainte') {
      var note = document.getElementById('note-' + b.dataset.id).value.trim();
      agir(function (t) { return Actions.traiterPlainte(t, b.dataset.id, note); }, 'Plainte traitée.');
    }
  });

  if (lireSession()) demarrer();
})();
