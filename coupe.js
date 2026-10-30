(function () {
  var elPhase = document.getElementById('phase'), elTitre = document.getElementById('titre'),
      elChampion = document.getElementById('champion'), elContenu = document.getElementById('contenu');

  function nom(d, id) { return id ? (d.pseudo[id] || '?') : '—'; }

  function afficherInscrits(d, coupe) {
    var liste = d.inscriptions.map(function (i) { return '<div class="row"><span class="grow">' + esc(nom(d, i.joueur_id)) + '</span></div>'; }).join('');
    elContenu.innerHTML = '<div class="panel"><div class="band blue"><span>INSCRITS</span><span>' + d.inscriptions.length + ' / ' + coupe.places + '</span></div><div class="pb">' +
      (liste || '<span class="muted">Personne n\'est encore inscrit.</span>') + '</div></div>';
  }

  function ligneMatch(d, c) {
    var m = c.matchs[0], score;
    if (!m) return '';
    if (m.statut === 'joue') score = '<span class="score-box">' + m.score1 + ' – ' + m.score2 + '</span>';
    else if (m.statut === 'forfait') score = '<span class="score-box">' + m.score1 + ' – ' + m.score2 + '</span> <span class="badge bad">forfait</span>';
    else if (m.statut === 'double_forfait') score = '<span class="badge bad">double forfait</span>';
    else score = '<span class="badge">à jouer</span>';
    return '<div class="row"><span class="grow" style="text-align:right;">' + esc(nom(d, c.j1_id)) + '</span>' + score + '<span class="grow">' + esc(nom(d, c.j2_id)) + '</span></div>';
  }

  function afficherPoules(d) {
    var groupes = {};
    d.inscriptions.forEach(function (i) {
      if (!i.groupe) return;
      (groupes[i.groupe] = groupes[i.groupe] || []).push({ id: i.joueur_id, pseudo: nom(d, i.joueur_id), rang_force: i.rang_force });
    });
    var html = '<div class="grid">';
    Object.keys(groupes).sort().forEach(function (g) {
      var cl = Moteur.classement(groupes[g], matchsDeGroupe(d.confrontations, g));
      var lignes = cl.map(function (x, k) {
        return '<tr class="' + (k < 2 ? 'q' : '') + '"><td>' + (k + 1) + '</td><td>' + esc(x.pseudo) + '</td><td>' + x.j + '</td><td>' + (x.diff > 0 ? '+' : '') + x.diff + '</td><td class="pts">' + x.pts + '</td></tr>';
      }).join('');
      var matchs = d.confrontations.filter(function (c) { return c.phase === 'poules' && c.groupe === g; }).map(function (c) { return ligneMatch(d, c); }).join('');
      html += '<div class="panel"><div class="band red"><span>GROUPE ' + esc(g) + '</span><span class="small">2 premiers qualifiés</span></div><div class="pb">' +
        '<table class="cl"><tr><th></th><th>Joueur</th><th>J</th><th>Diff</th><th>Pts</th></tr>' + lignes + '</table>' +
        '<div class="sep"></div>' + matchs + '</div></div>';
    });
    return html + '</div>';
  }

  function carteConfrontation(d, c) {
    var r = Moteur.resultatConfrontation(c, c.matchs);
    if (!c.j2_id) return '<div class="row win"><span class="grow"><b>' + esc(nom(d, c.j1_id)) + '</b></span><span class="badge">exempté</span></div>';
    var legs = c.matchs.map(function (m) {
      var lib = m.manche === 3 ? 'Appui' : (c.aller_retour ? (m.manche === 1 ? 'Aller' : 'Retour') : 'Match');
      var s = m.statut === 'joue' ? m.score1 + ' – ' + m.score2 : (m.statut === 'a_jouer' ? 'à jouer' : 'forfait');
      return '<span class="small muted">' + lib + ' : ' + s + '</span>';
    }).join(' &nbsp;·&nbsp; ');
    var cumul = (c.aller_retour && r.totaux && c.matchs.some(function (m) { return m.statut === 'joue'; }))
      ? '<span class="small muted"> &nbsp;·&nbsp; Cumul : ' + r.totaux.j1 + ' – ' + r.totaux.j2 + '</span>' : '';
    var n1 = esc(nom(d, c.j1_id)), n2 = esc(nom(d, c.j2_id));
    if (r.gagnant === c.j1_id) n1 = '<b>' + n1 + ' ✓</b>'; else if (r.gagnant === c.j2_id) n2 = '<b>' + n2 + ' ✓</b>';
    var note = r.annule ? ' <span class="badge bad">annulée</span>' : (r.raison === 'decision' ? ' <span class="badge">décision</span>' : (r.raison === 'appui' ? ' <span class="badge">match d\'appui</span>' : ''));
    return '<div class="row' + (r.gagnant ? ' win' : '') + '" style="display:block;"><div>' + n1 + ' <span class="muted">vs</span> ' + n2 + note + '</div><div style="margin-top:4px;">' + legs + cumul + '</div></div>';
  }

  function afficherKO(d) {
    var html = '';
    Moteur.ORDRE_KO.forEach(function (ph) {
      var confs = d.confrontations.filter(function (c) { return c.phase === ph; });
      if (!confs.length) return;
      html += '<div class="panel"><div class="band purple"><span>' + esc(Moteur.LIBELLES[ph].toUpperCase()) + '</span><span class="small">' + (ph === 'finale' ? 'un seul match' : 'aller-retour') + '</span></div><div class="pb">' +
        confs.map(function (c) { return carteConfrontation(d, c); }).join('') + '</div></div>';
    });
    return html;
  }

  async function charger() {
    try {
      var coupe = await derniereCoupe();
      if (!coupe) { elPhase.textContent = ''; elContenu.innerHTML = '<div class="notice">Aucune coupe pour le moment.</div>'; return; }
      var d = await chargerCoupe(coupe.id);
      elTitre.textContent = coupe.nom;
      elPhase.textContent = Moteur.LIBELLES[coupe.phase] || coupe.phase;
      elChampion.innerHTML = (coupe.phase === 'terminee' && coupe.champion_id)
        ? '<div class="banner">🏆 Champion : ' + esc(nom(d, coupe.champion_id)) + '</div>' : '';
      if (coupe.phase === 'inscriptions') return afficherInscrits(d, coupe);
      var html = '';
      if (d.confrontations.some(function (c) { return c.phase === 'poules'; })) html += afficherPoules(d);
      html += afficherKO(d);
      elContenu.innerHTML = html;
    } catch (e) {
      elContenu.innerHTML = '<div class="notice warn">' + esc(messageErreur(e)) + '</div>';
    }
  }
  charger();
  setInterval(charger, 60000);
})();
