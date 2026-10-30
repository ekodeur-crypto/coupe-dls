(function () {
  var joueur = joueurLocal(), coupe = null, d = null, infos = { declarations: [], plaintes: [] };
  var contacts = {};                       // contact adverse déjà demandé, par confrontation
  var elContenu = document.getElementById('contenu'), elTitre = document.getElementById('titre'), elSous = document.getElementById('sous');

  function nom(id) { return id ? (d.pseudo[id] || '?') : '—'; }
  function lienIndex(texte) { return '<a class="btn" href="index.html" style="text-decoration:none;display:inline-block;">' + texte + '</a>'; }
  function libelleConf(c) { return c.phase === 'poules' ? 'GROUPE ' + (c.groupe || '') : (Moteur.LIBELLES[c.phase] || c.phase).toUpperCase(); }
  function libelleManche(c, m) { return m.manche === 3 ? "Match d'appui" : (c.aller_retour ? (m.manche === 1 ? 'Match aller' : 'Match retour') : 'Match'); }
  function msgCarte(id, texte, ok) { var el = document.getElementById('msg-' + id); if (el) el.innerHTML = '<div class="msg ' + (ok ? 'ok' : 'err') + '">' + esc(texte) + '</div>'; }

  async function charger() {
    if (!joueur) {
      elContenu.innerHTML = '<div class="notice">Tu n\'es pas encore inscrit sur cet appareil.</div>' + lienIndex("M'inscrire / me connecter");
      return;
    }
    try {
      coupe = await derniereCoupe();
      if (!coupe) { elContenu.innerHTML = '<div class="notice">Aucune coupe pour le moment.</div>'; return; }
      d = await chargerCoupe(coupe.id);
      infos = await rpc('mes_infos', { p_joueur: joueur.id, p_secret: joueur.secret });
      afficher();
    } catch (e) {
      if (/ACCES_REFUSE/.test(e.message)) {
        oublierJoueur(); joueur = null;
        elContenu.innerHTML = '<div class="notice warn">Ton compte n\'est plus reconnu sur cet appareil.</div>' + lienIndex('Me reconnecter');
      } else elContenu.innerHTML = '<div class="notice warn">' + esc(messageErreur(e)) + '</div>';
    }
  }

  function afficher() {
    elTitre.textContent = 'Salut ' + joueur.pseudo;
    elSous.textContent = coupe.nom + ' — ' + (Moteur.LIBELLES[coupe.phase] || coupe.phase);
    var html = '';
    if (!d.inscriptions.some(function (i) { return i.joueur_id === joueur.id; })) {
      elContenu.innerHTML = '<div class="notice">Tu n\'es pas inscrit à cette coupe.</div>' + lienIndex('Voir les inscriptions');
      return;
    }
    if (coupe.phase === 'terminee') {
      html += coupe.champion_id === joueur.id ? '<div class="banner">🏆 Tu es le champion de la coupe !</div>' : '<div class="notice">La coupe est terminée.</div>';
    }
    if (coupe.phase === 'inscriptions') {
      elContenu.innerHTML = '<div class="notice">Tu es bien inscrit. La coupe n\'a pas encore commencé : ton groupe ou ton adversaire apparaîtra ici dès le tirage au sort.</div>';
      return;
    }
    var mes = d.confrontations.filter(function (c) { return c.j1_id === joueur.id || c.j2_id === joueur.id; });
    mes.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
    if (!mes.length) html += '<div class="notice">Tu n\'as pas de match pour l\'instant. Si tu es qualifié, ton prochain adversaire apparaîtra ici.</div>';
    mes.forEach(function (c) { html += carte(c); });
    elContenu.innerHTML = html;
  }

  function carte(c) {
    var r = Moteur.resultatConfrontation(c, c.matchs);
    var couleur = c.phase === 'poules' ? 'red' : 'purple';
    if (!c.j2_id) {
      return '<div class="panel"><div class="band ' + couleur + '"><span>' + esc(libelleConf(c)) + '</span></div><div class="pb">Tu es <b>exempté</b> sur ce tour : tu passes directement au suivant. 🎉</div></div>';
    }
    var moiEstJ1 = c.j1_id === joueur.id, opp = nom(moiEstJ1 ? c.j2_id : c.j1_id);
    var statut = '';
    if (c.phase !== 'poules') {
      if (r.annule) statut = '<span class="badge bad">annulée</span>';
      else if (r.termine) statut = r.gagnant === joueur.id ? '<span class="badge ok">qualifié</span>' : '<span class="badge bad">éliminé</span>';
    }
    var html = '<div class="panel"><div class="band ' + couleur + '"><span>' + esc(libelleConf(c)) + '</span><span>' + statut + '</span></div><div class="pb">';
    html += '<div class="actions" style="justify-content:space-between;"><span>Ton adversaire : <b>' + esc(opp) + '</b></span>' +
      '<button class="btn small" data-act="contact" data-conf="' + c.id + '">Contacter ' + esc(opp) + '</button></div>';
    html += '<div id="contact-' + c.id + '">' + (contacts[c.id] ? boiteContact(c, contacts[c.id]) : '') + '</div><div class="sep"></div>';

    var plainteOuverte = false;
    c.matchs.forEach(function (m) {
      var mien = moiEstJ1 ? m.score1 : m.score2, leur = moiEstJ1 ? m.score2 : m.score1;
      html += '<div style="margin-bottom:12px;"><div class="small muted" style="margin-bottom:6px;">' + libelleManche(c, m) + '</div>';
      if (m.statut === 'joue') html += '<div class="row"><span class="grow">Toi</span><span class="score-box">' + mien + ' – ' + leur + '</span><span class="grow" style="text-align:right;">' + esc(opp) + '</span></div>';
      else if (m.statut === 'forfait') html += '<div class="row"><span class="grow">Forfait</span><span class="score-box">' + mien + ' – ' + leur + '</span></div>';
      else if (m.statut === 'double_forfait') html += '<div class="row"><span class="badge bad">double forfait</span></div>';
      else html += formulaireScore(m, opp);
      if (infos.plaintes.some(function (p) { return p.match_id === m.id && p.statut === 'ouverte'; })) plainteOuverte = true;
      html += '</div>';
    });

    var premier = c.matchs.filter(function (m) { return m.statut === 'a_jouer'; })[0];
    if (premier) {
      html += '<div class="sep"></div>' + (plainteOuverte
        ? '<span class="badge warn">Plainte en cours de traitement par l\'admin</span>'
        : '<a href="#" class="small" data-act="ouvrirPlainte" data-conf="' + c.id + '">Signaler un problème (adversaire absent, score contesté…)</a>' +
          '<div id="plainte-' + c.id + '" style="display:none;margin-top:10px;">' +
          '<div class="field"><select id="type-' + c.id + '"><option value="absent">Mon adversaire ne répond pas</option><option value="score">Désaccord sur le score</option><option value="autre">Autre problème</option></select></div>' +
          '<div class="field"><textarea id="texte-' + c.id + '" maxlength="500" placeholder="Explique ce qui se passe (ce que tu as essayé, depuis quand…)"></textarea></div>' +
          '<button class="btn small" data-act="envoyerPlainte" data-conf="' + c.id + '" data-match="' + premier.id + '">Envoyer à l\'admin</button></div>');
    }
    return html + '<div id="msg-' + c.id + '"></div></div></div>';
  }

  function formulaireScore(m, opp) {
    var dec = infos.declarations.filter(function (x) { return x.match_id === m.id; })[0];
    var etat = dec ? '<div class="small" style="margin-bottom:6px;"><span class="badge ok">Score envoyé</span> &nbsp;Toi ' + dec.score_moi + ' – ' + dec.score_adv + ' ' + esc(opp) + ' · en attente de validation par l\'admin</div>'
      : '<div class="small muted" style="margin-bottom:6px;">Après le match, entre le score. L\'admin le validera.</div>';
    return etat + '<div class="actions"><span class="small">Toi</span><input class="score" id="moi-' + m.id + '" type="number" min="0" max="30" value="' + (dec ? dec.score_moi : '') + '">' +
      '<span>–</span><input class="score" id="adv-' + m.id + '" type="number" min="0" max="30" value="' + (dec ? dec.score_adv : '') + '"><span class="small">' + esc(opp) + '</span>' +
      '<button class="btn small" data-act="declarer" data-match="' + m.id + '">' + (dec ? 'Modifier' : 'Envoyer le score') + '</button></div>';
  }

  function boiteContact(c, ct) {
    var num = String(ct.whatsapp).replace(/\D/g, '');
    var texte = 'Salut ' + ct.pseudo + ", c'est " + joueur.pseudo + ". On fixe l'heure de notre match de la Coupe DLS (" + libelleConf(c) + ") ? Tu es dispo quand ?";
    return '<div class="contact"><div class="small muted">Discute avec ton adversaire via ce contact pour fixer l\'heure du match.</div>' +
      '<div class="num">+' + esc(num) + '</div>' +
      '<a class="btn small" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block;" href="https://wa.me/' + num + '?text=' + encodeURIComponent(texte) + '">Ouvrir WhatsApp</a></div>';
  }

  document.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    e.preventDefault();
    var act = b.dataset.act, conf = b.dataset.conf;
    try {
      if (act === 'contact') {
        contacts[conf] = await rpc('contact_adversaire', { p_joueur: joueur.id, p_secret: joueur.secret, p_confrontation: conf });
        var c = d.confrontations.filter(function (x) { return x.id === conf; })[0];
        document.getElementById('contact-' + conf).innerHTML = boiteContact(c, contacts[conf]);
      } else if (act === 'ouvrirPlainte') {
        var f = document.getElementById('plainte-' + conf); f.style.display = f.style.display === 'none' ? 'block' : 'none';
      } else if (act === 'declarer') {
        var id = b.dataset.match, moi = parseInt(document.getElementById('moi-' + id).value, 10), adv = parseInt(document.getElementById('adv-' + id).value, 10);
        var carteId = d.confrontations.filter(function (x) { return x.matchs.some(function (m) { return m.id === id; }); })[0].id;
        if (isNaN(moi) || isNaN(adv)) return msgCarte(carteId, 'Entre les deux scores.', false);
        await rpc('declarer_score', { p_joueur: joueur.id, p_secret: joueur.secret, p_match: id, p_moi: moi, p_adv: adv });
        infos = await rpc('mes_infos', { p_joueur: joueur.id, p_secret: joueur.secret });
        afficher(); msgCarte(carteId, 'Score envoyé. L\'admin va le valider.', true);
      } else if (act === 'envoyerPlainte') {
        var texte = document.getElementById('texte-' + conf).value, type = document.getElementById('type-' + conf).value;
        await rpc('signaler_probleme', { p_joueur: joueur.id, p_secret: joueur.secret, p_match: b.dataset.match, p_type: type, p_message: texte });
        infos = await rpc('mes_infos', { p_joueur: joueur.id, p_secret: joueur.secret });
        afficher(); msgCarte(conf, "Plainte envoyée. L'admin va te répondre.", true);
      }
    } catch (err) {
      var cid = conf || (d.confrontations.filter(function (x) { return x.matchs.some(function (m) { return m.id === b.dataset.match; }); })[0] || {}).id;
      if (cid) msgCarte(cid, messageErreur(err), false); else alert(messageErreur(err));
    }
  });

  charger();
})();
