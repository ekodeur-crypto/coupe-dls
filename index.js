(function () {
  var coupe = null, joueur = joueurLocal(), inscrit = false, nbInscrits = 0;
  var elNom = document.getElementById('coupeNom'), elPhase = document.getElementById('coupePhase'),
      elInfo = document.getElementById('coupeInfo'), elPanel = document.getElementById('actionPanel'),
      elAction = document.getElementById('action'), elChanger = document.getElementById('changer');

  function formatTexte(c) {
    if (c.etape_depart === 'poules') return "Poules de 4 : un match contre chaque adversaire, les 2 premiers se qualifient. Puis élimination directe en aller-retour (finale en un seul match).";
    return "Élimination directe en aller-retour (finale en un seul match).";
  }

  function messageFin(texte, ok) { return '<div class="msg ' + (ok ? 'ok' : 'err') + '">' + esc(texte) + '</div>'; }

  async function charger() {
    try {
      coupe = await derniereCoupe();
      if (!coupe) {
        elNom.textContent = 'Aucune coupe'; elPhase.textContent = '';
        elInfo.innerHTML = '<span class="muted">Aucune coupe n\'est ouverte pour le moment. Reviens bientôt.</span>';
        return;
      }
      var ins = await sb('inscriptions?coupe_id=eq.' + coupe.id + '&select=joueur_id');
      nbInscrits = ins.length;
      inscrit = !!joueur && ins.some(function (i) { return i.joueur_id === joueur.id; });
      afficher();
    } catch (e) {
      elNom.textContent = 'Erreur'; elInfo.innerHTML = messageFin(messageErreur(e), false);
    }
  }

  function afficher() {
    elNom.textContent = coupe.nom;
    elPhase.textContent = Moteur.LIBELLES[coupe.phase] || coupe.phase;
    var places = coupe.phase === 'inscriptions'
      ? '<div class="row"><span class="grow">Inscrits</span><b>' + nbInscrits + ' / ' + coupe.places + '</b></div>' : '';
    elInfo.innerHTML = '<p class="muted" style="margin:0 0 12px;font-size:14px;line-height:1.5;">' + esc(formatTexte(coupe)) + '</p>' + places;
    elChanger.style.display = joueur ? 'inline' : 'none';
    elPanel.style.display = 'block';

    if (coupe.phase === 'inscriptions') return afficherInscription();
    if (coupe.phase === 'terminee') {
      elAction.innerHTML = '<p style="margin:0 0 12px;">Cette coupe est terminée.</p><a class="btn block" href="coupe.html" style="display:block;text-align:center;text-decoration:none;">Voir le tableau final</a>';
      return;
    }
    var liens = '<div class="actions"><a class="btn" href="coupe.html" style="text-decoration:none;">Voir le tableau</a>' +
      (inscrit ? '<a class="btn sec" href="match.html" style="text-decoration:none;">Mon match</a>' : '') + '</div>';
    elAction.innerHTML = '<p style="margin:0 0 12px;">' + (inscrit ? 'Tu participes à cette coupe. Bonne chance !' : 'Les inscriptions sont fermées : la coupe est en cours.') + '</p>' + liens;
  }

  function afficherInscription() {
    if (inscrit) {
      elAction.innerHTML = '<p style="margin:0 0 12px;"><span class="badge ok">Inscrit</span> &nbsp;Tu es inscrit, <b>' + esc(joueur.pseudo) + '</b>. Les groupes seront tirés au lancement de la coupe.</p>' +
        '<div class="actions"><a class="btn" href="coupe.html" style="text-decoration:none;">Voir les inscrits</a><a class="btn sec" href="match.html" style="text-decoration:none;">Mon match</a></div>';
      return;
    }
    if (joueur) {
      elAction.innerHTML = '<p style="margin:0 0 12px;">Salut <b>' + esc(joueur.pseudo) + '</b> ! Veux-tu participer à cette coupe ?</p>' +
        '<button class="btn block" id="btnParticiper">Participer à la coupe</button><div id="msg"></div>';
      document.getElementById('btnParticiper').onclick = participer;
      return;
    }
    elAction.innerHTML =
      '<h2>Inscription</h2>' +
      '<form id="formIns">' +
      '<div class="field"><label for="pseudo">Ton pseudo</label><input id="pseudo" maxlength="20" placeholder="Ex : LionDeLome" required></div>' +
      '<div class="field"><label for="num">Ton numéro WhatsApp</label><input id="num" type="tel" placeholder="22890000000" required>' +
      '<div class="hint">Avec l\'indicatif de ton pays, sans le +. Seul ton adversaire verra ce numéro, pour fixer l\'heure du match.</div></div>' +
      '<button class="btn block" id="btnIns" type="submit">M\'inscrire à la coupe</button><div id="msg"></div></form>' +
      '<div class="sep"></div><a href="#" id="dejaInscrit" class="small">J\'ai déjà un compte (autre appareil)</a>';
    document.getElementById('formIns').onsubmit = inscrire;
    document.getElementById('dejaInscrit').onclick = function (e) { e.preventDefault(); afficherConnexion(); };
  }

  function afficherConnexion() {
    elAction.innerHTML =
      '<h2>Retrouver mon compte</h2>' +
      '<form id="formCo">' +
      '<div class="field"><label for="pseudo">Ton pseudo</label><input id="pseudo" required></div>' +
      '<div class="field"><label for="num">Ton numéro WhatsApp</label><input id="num" type="tel" required></div>' +
      '<button class="btn block" type="submit">Me connecter</button><div id="msg"></div></form>' +
      '<div class="sep"></div><a href="#" id="retour" class="small">← Retour à l\'inscription</a>';
    document.getElementById('formCo').onsubmit = connecter;
    document.getElementById('retour').onclick = function (e) { e.preventDefault(); afficherInscription(); };
  }

  function msg(texte, ok) { document.getElementById('msg').innerHTML = messageFin(texte, ok); }

  async function inscrire(e) {
    e.preventDefault();
    var btn = document.getElementById('btnIns'); btn.disabled = true; btn.textContent = 'Inscription…';
    try {
      var j = await rpc('inscrire_joueur', { p_pseudo: document.getElementById('pseudo').value, p_whatsapp: document.getElementById('num').value });
      sauverJoueur(j); joueur = j;
      await rpc('participer_coupe', { p_joueur: j.id, p_secret: j.secret, p_coupe: coupe.id });
      await charger();
    } catch (err) {
      var texte = messageErreur(err);
      if (joueur) {                       // compte créé, mais la coupe est pleine ou fermée : on montre l'état réel
        await charger();
        var m = document.getElementById('msg'); if (m) m.innerHTML = messageFin(texte, false);
      } else {
        msg(texte, false); btn.disabled = false; btn.textContent = "M'inscrire à la coupe";
      }
    }
  }

  async function connecter(e) {
    e.preventDefault();
    try {
      var j = await rpc('connexion_joueur', { p_pseudo: document.getElementById('pseudo').value, p_whatsapp: document.getElementById('num').value });
      sauverJoueur(j); joueur = j; await charger();
    } catch (err) { msg(messageErreur(err), false); }
  }

  async function participer() {
    var btn = document.getElementById('btnParticiper'); btn.disabled = true;
    try {
      await rpc('participer_coupe', { p_joueur: joueur.id, p_secret: joueur.secret, p_coupe: coupe.id });
      await charger();
    } catch (err) {
      btn.disabled = false;
      if (/ACCES_REFUSE/.test(err.message)) { oublierJoueur(); joueur = null; await charger(); return; }
      msg(messageErreur(err), false);
    }
  }

  elChanger.onclick = function (e) { e.preventDefault(); oublierJoueur(); joueur = null; inscrit = false; charger(); };
  charger();
})();
