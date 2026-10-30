/* Dessine les cercles pointillés qui tournent. Aucune image : tout est en SVG. */
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'fond');
  svg.setAttribute('viewBox', '0 0 1000 1000');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.setAttribute('aria-hidden', 'true');

  var GROUPS = 8, groups = [], i;
  for (i = 0; i < GROUPS; i++) {
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'fg fg' + i);
    svg.appendChild(g);
    groups.push(g);
  }

  var patterns = ['2 9', '40 14', '3 7', '90 34', '1 6', '60 20 6 20', '12 12', '5 16'];
  var n = 0;
  for (var r = 30; r <= 640; r += 18) {          // 18 = écart entre cercles : plus petit = plus serré
    var c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', 500);
    c.setAttribute('cy', 500);
    c.setAttribute('r', r);
    c.setAttribute('stroke-width', n % 5 === 0 ? 2.4 : 1.2);
    c.setAttribute('stroke-opacity', (0.12 + (n % 4) * 0.045).toFixed(3));
    c.setAttribute('stroke-dasharray', patterns[n % patterns.length]);
    groups[n % GROUPS].appendChild(c);
    n++;
  }
  document.body.insertBefore(svg, document.body.firstChild);
})();
