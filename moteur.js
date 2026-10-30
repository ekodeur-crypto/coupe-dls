/* Moteur de la coupe : tirage, classement, élimination directe. Aucune dépendance. */
var Moteur = (function () {

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function melanger(arr) {
    var a = arr.slice(), i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- POULES ---------- */
  function nombreGroupes(n) { return Math.max(1, Math.round(n / 4)); }

  // ids -> { A:[...], B:[...] }  (groupes équilibrés de 3 à 5 joueurs)
  function tirerGroupes(ids) {
    var m = melanger(ids), nb = nombreGroupes(m.length), res = {}, i;
    for (i = 0; i < nb; i++) res[String.fromCharCode(65 + i)] = [];
    m.forEach(function (id, k) { res[String.fromCharCode(65 + (k % nb))].push(id); });
    return res;
  }

  function toutesLesPaires(ids) {
    var p = [], i, j;
    for (i = 0; i < ids.length; i++) for (j = i + 1; j < ids.length; j++) p.push([ids[i], ids[j]]);
    return p;
  }

  function matchValide(m) { return m.statut === 'joue' || m.statut === 'forfait' || m.statut === 'double_forfait'; }

  /* joueurs : [{id, pseudo, rang_force}], matchs : [{j1,j2,s1,s2,statut}] */
  function classement(joueurs, matchs) {
    var st = {};
    joueurs.forEach(function (j) {
      st[j.id] = { id: j.id, pseudo: j.pseudo, rf: (j.rang_force === 0 ? 0 : 1), pts: 0, j: 0, g: 0, n: 0, p: 0, bp: 0, bc: 0, diff: 0 };
    });
    matchs.forEach(function (m) {
      if (!matchValide(m) || !st[m.j1] || !st[m.j2]) return;
      var a = st[m.j1], b = st[m.j2];
      a.j++; b.j++;
      if (m.statut === 'double_forfait') return;
      a.bp += m.s1; a.bc += m.s2; b.bp += m.s2; b.bc += m.s1;
      if (m.s1 > m.s2) { a.g++; a.pts += 3; b.p++; }
      else if (m.s1 < m.s2) { b.g++; b.pts += 3; a.p++; }
      else { a.n++; b.n++; a.pts++; b.pts++; }
    });
    var arr = Object.keys(st).map(function (k) { st[k].diff = st[k].bp - st[k].bc; return st[k]; });

    // 1) points puis différence de buts
    arr.sort(function (a, b) { return (b.pts - a.pts) || (b.diff - a.diff) || a.pseudo.localeCompare(b.pseudo); });
    // 2) à égalité : mini-classement entre les joueurs à égalité (confrontations directes), puis buts marqués,
    //    puis choix de l'admin (rang_force), puis ordre alphabétique
    var res = [], i = 0, j;
    while (i < arr.length) {
      j = i;
      while (j < arr.length && arr[j].pts === arr[i].pts && arr[j].diff === arr[i].diff) j++;
      var run = arr.slice(i, j);
      run.forEach(function (x) { x.mini = 0; });
      if (run.length > 1) {
        var ids = run.map(function (x) { return x.id; });
        matchs.forEach(function (m) {
          if (!matchValide(m) || m.statut === 'double_forfait') return;
          if (ids.indexOf(m.j1) < 0 || ids.indexOf(m.j2) < 0) return;
          var a = st[m.j1], b = st[m.j2];
          if (m.s1 > m.s2) a.mini += 3; else if (m.s1 < m.s2) b.mini += 3; else { a.mini++; b.mini++; }
        });
        run.sort(function (a, b) { return (b.mini - a.mini) || (b.bp - a.bp) || (a.rf - b.rf) || a.pseudo.localeCompare(b.pseudo); });
      }
      res = res.concat(run);
      i = j;
    }
    arr = res;
    arr.egalite = function (x, y) {
      var a = arr[x], b = arr[y];
      return !!(a && b && a.pts === b.pts && a.diff === b.diff && a.mini === b.mini && a.bp === b.bp && a.rf === b.rf);
    };
    return arr;
  }

  // Y a-t-il une égalité parfaite entre le dernier qualifié et le premier éliminé ?
  function egaliteFrontiere(cl, nbQualifies) {
    if (cl.length <= nbQualifies) return null;
    if (!cl.egalite(nbQualifies - 1, nbQualifies)) return null;
    var ref = nbQualifies - 1, res = [];
    cl.forEach(function (x, i) { if (cl.egalite(ref, i)) res.push(x); });
    return res;
  }

  /* ---------- ÉLIMINATION DIRECTE ---------- */
  function puissance2Sup(n) { var p = 1; while (p < n) p *= 2; return p; }

  function libelleTour(P) {
    return { 2: 'finale', 4: 'demis', 8: 'quarts', 16: '8es', 32: '16es', 64: '32es' }[P] || ('tour' + P);
  }

  function pairesSansMemeGroupe(joueurs, groupeDe) {
    var meilleur = null, t, m, i, ok;
    for (t = 0; t < 300; t++) {
      m = melanger(joueurs); ok = true;
      for (i = 0; i < m.length; i += 2) {
        var ga = groupeDe ? groupeDe(m[i]) : null, gb = groupeDe ? groupeDe(m[i + 1]) : null;
        if (ga && ga === gb) { ok = false; break; }
      }
      if (!meilleur) meilleur = m;
      if (ok) { meilleur = m; break; }
    }
    var paires = [];
    for (i = 0; i < meilleur.length; i += 2) paires.push([meilleur[i], meilleur[i + 1]]);
    return paires;
  }

  // seeds : ids classés par priorité (les premiers reçoivent les exemptions)
  function construireTourKO(seeds, groupeDe) {
    var N = seeds.length;
    if (N < 2) return null;
    var P = puissance2Sup(N);
    var nbMatchs = (P === N) ? N / 2 : N - P / 2;
    var nbExempts = N - 2 * nbMatchs;
    return {
      phase: libelleTour(P),
      aller_retour: P > 2,
      byes: seeds.slice(0, nbExempts),
      paires: pairesSansMemeGroupe(seeds.slice(nbExempts), groupeDe)
    };
  }

  // après les poules : vainqueurs de groupe contre deuxièmes d'un autre groupe
  function tirageApresPoules(vainqueurs, seconds, groupeDe) {
    var N = vainqueurs.length + seconds.length;
    if (N >= 2 && (N & (N - 1)) === 0 && vainqueurs.length === seconds.length) {
      var meilleur = null, t, s, i, ok;
      for (t = 0; t < 300; t++) {
        s = melanger(seconds); ok = true;
        for (i = 0; i < vainqueurs.length; i++) if (groupeDe(vainqueurs[i]) === groupeDe(s[i])) { ok = false; break; }
        if (!meilleur) meilleur = s;
        if (ok) { meilleur = s; break; }
      }
      return {
        phase: libelleTour(N), aller_retour: N > 2, byes: [],
        paires: vainqueurs.map(function (v, k) { return [v, meilleur[k]]; })
      };
    }
    return construireTourKO(melanger(vainqueurs).concat(melanger(seconds)), groupeDe);
  }

  /* conf : {j1_id,j2_id,vainqueur_id,statut}, legs : [{manche,score1,score2,statut}] */
  function resultatConfrontation(conf, legs) {
    var t = { j1: 0, j2: 0 };
    if (conf.statut === 'annule') return { termine: true, annule: true, gagnant: null, raison: 'annule', totaux: t };
    if (!conf.j2_id) return { termine: true, gagnant: conf.j1_id, raison: 'exempt', totaux: t };
    var principaux = legs.filter(function (l) { return l.manche <= 2; });
    var appui = legs.filter(function (l) { return l.manche === 3; })[0];
    principaux.forEach(function (l) { if (l.statut === 'joue') { t.j1 += l.score1; t.j2 += l.score2; } });
    if (conf.vainqueur_id) return { termine: true, gagnant: conf.vainqueur_id, raison: 'decision', totaux: t };
    var tousJoues = principaux.length > 0 && principaux.every(function (l) { return l.statut === 'joue'; });
    if (!tousJoues) return { termine: false, gagnant: null, raison: null, totaux: t };
    if (t.j1 !== t.j2) return { termine: true, gagnant: t.j1 > t.j2 ? conf.j1_id : conf.j2_id, raison: 'cumul', totaux: t };
    if (appui && appui.statut === 'joue' && appui.score1 !== appui.score2)
      return { termine: true, gagnant: appui.score1 > appui.score2 ? conf.j1_id : conf.j2_id, raison: 'appui', totaux: t };
    return { termine: false, egalite: true, gagnant: null, raison: null, totaux: t };
  }

  var LIBELLES = {
    inscriptions: 'Inscriptions', poules: 'Phase de poules', '32es': '32es de finale', '16es': '16es de finale',
    '8es': '8es de finale', quarts: 'Quarts de finale', demis: 'Demi-finales', finale: 'Finale', terminee: 'Coupe terminée'
  };
  var ORDRE_KO = ['32es', '16es', '8es', 'quarts', 'demis', 'finale'];

  return {
    uuid: uuid, melanger: melanger, nombreGroupes: nombreGroupes, tirerGroupes: tirerGroupes,
    toutesLesPaires: toutesLesPaires, matchValide: matchValide, classement: classement, egaliteFrontiere: egaliteFrontiere,
    puissance2Sup: puissance2Sup, libelleTour: libelleTour, construireTourKO: construireTourKO,
    tirageApresPoules: tirageApresPoules, resultatConfrontation: resultatConfrontation,
    LIBELLES: LIBELLES, ORDRE_KO: ORDRE_KO
  };
})();
if (typeof module !== 'undefined') module.exports = Moteur;
