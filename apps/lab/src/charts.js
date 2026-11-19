// Graphiques de l'onglet « Tableau » : SVG dessiné à la main, sans bibliothèque.
// Ils reçoivent les lignes déjà filtrées du tableau (mêmes filtres, mêmes chiffres).
// Formes : colonnes alignées (coups, choix forts, exploration), nuage de points (profil), barres classées (alertes).

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const html = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};
// Colonne : bout arrondi de 4px côté donnée, carré côté ligne de base
function column(g, x, w, y0, y1, cls) {
  const h = y0 - y1;
  if (h <= 0) return el('rect', { x, y: y0 - 1, width: w, height: 1, class: cls + ' zero' }, g);
  const r = Math.min(4, w / 2, h);
  return el('path', { d: `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`, class: cls }, g);
}
// Graduations rondes pour un maximum donné
function ticks(max) {
  if (max <= 4) return [...Array(max + 1).keys()];
  const step = [1, 2, 5, 10, 20, 25, 50].find(s => max / s <= 4) || Math.ceil(max / 4);
  // la dernière graduation couvre toujours le maximum
  const out = []; for (let v = 0; out.length === 0 || out[out.length - 1] < max; v += step) out.push(v);
  return out;
}

let tip = null;
function showTip(root, evt, lines) {
  if (!tip || !root.contains(tip)) tip = html('div', 'ch-tip', root);
  tip.replaceChildren();
  for (const [value, label, strong] of lines) {
    const row = html('div', strong ? 'ch-tip-head' : 'ch-tip-row', tip);
    if (value !== '') html('b', '', row, value);
    html('span', '', row, label);
  }
  tip.hidden = false;
  const box = root.getBoundingClientRect(), t = tip.getBoundingClientRect();
  let x = evt.clientX - box.left + 14, y = evt.clientY - box.top + 14;
  if (x + t.width > box.width) x = evt.clientX - box.left - t.width - 14;
  tip.style.left = Math.max(0, x) + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => { if (tip) tip.hidden = true; };

// Trois colonnes alignées : même axe des niveaux, une mesure par graphique, survol commun
function levelStrips(root, rows, onPick) {
  const card = html('div', 'ch-card ch-wide', root);
  html('h4', '', card, 'Courbe des niveaux');
  html('p', 'ch-sub', card, 'Un trait par niveau, dans l\'ordre du jeu. Survole un niveau pour ses chiffres, clique pour le jouer.');
  const W = Math.max(300, card.clientWidth - 2), padL = 34, padR = 8, n = rows.length;
  const slot = (W - padL - padR) / n, bw = Math.max(1, Math.min(24, slot * 0.72));
  const xOf = i => padL + i * slot + (slot - bw) / 2;
  const strips = [
    { key: 'len', title: 'Coups de la solution', h: 90 },
    { key: 'strong', title: 'Choix forts', h: 90, target: true },
    { key: 'explore', title: 'Exploration (gestes à défaire)', h: 90 },
  ];
  const groups = [];
  for (const st of strips) {
    const head = html('div', 'ch-strip-head', card);
    html('span', 'ch-strip-title', head, st.title);
    if (st.target) html('span', 'ch-note', head, 'trait gris : objectif de 2 (3 pour une finale)');
    if (st.target) {
      const lg = html('span', 'ch-legend', head);
      for (const [cls, label] of [['ok', 'objectif atteint'], ['low', 'sous l\'objectif'], ['disc', 'sans objectif (découverte, bases, remix)']]) {
        const it = html('span', 'ch-key', lg); html('i', 'sw ' + cls, it); html('span', '', it, label);
      }
    }
    const H = st.h, top = 8, base = H - 4;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'ch-svg', role: 'img', 'aria-label': st.title + ' par niveau (détail dans le tableau ci-dessous)' }, card);
    const max = Math.max(st.target ? 3 : 1, ...rows.map(r => r[st.key]));
    const tk = ticks(max), top2 = tk[tk.length - 1] || 1, yOf = v => base - (base - top) * v / top2;
    for (const v of tk) {
      el('line', { x1: padL, x2: W - padR, y1: yOf(v), y2: yOf(v), class: v ? 'ch-grid' : 'ch-base' }, svg);
      el('text', { x: padL - 6, y: yOf(v) + 3, class: 'ch-tick', 'text-anchor': 'end' }, svg).textContent = v;
    }
    // séparateurs de monde (ou de lot quand un seul monde est affiché)
    rows.forEach((r, i) => {
      if (i && r.group !== rows[i - 1].group) el('line', { x1: padL + i * slot, x2: padL + i * slot, y1: top - 4, y2: base, class: 'ch-sep' }, svg);
    });
    if (st.target) {
      el('line', { x1: padL, x2: W - padR, y1: yOf(2), y2: yOf(2), class: 'ch-target' }, svg);
    }
    const g = el('g', {}, svg), marks = [];
    rows.forEach((r, i) => {
      const cls = st.target ? (r.discovery ? 'ch-col disc' : r.few ? 'ch-col low' : 'ch-col ok') : 'ch-col';
      marks.push(column(g, xOf(i), bw, base, yOf(r[st.key]), cls));
    });
    groups.push({ svg, marks, yTop: top, base });
  }
  // noms des groupes sous le dernier graphique
  const lab = el('svg', { width: W, height: 16, class: 'ch-svg' }, card);
  let start = 0;
  rows.forEach((r, i) => {
    if (i === n - 1 || rows[i + 1].group !== r.group) {
      const x = padL + ((start + i + 1) / 2) * slot, room = (i + 1 - start) * slot;
      if (room > 26) el('text', { x, y: 11, class: 'ch-tick', 'text-anchor': 'middle' }, lab).textContent = room > 90 ? r.groupLabel : r.groupShort;
      start = i + 1;
    }
  });
  // survol commun : la cible est toute la colonne du niveau, dans les trois graphiques
  let cur = -1;
  const mark = i => { if (cur === i) return; if (cur >= 0) groups.forEach(gr => gr.marks[cur].classList.remove('hot')); cur = i; if (i >= 0) groups.forEach(gr => gr.marks[i].classList.add('hot')); };
  for (const gr of groups) {
    const hit = el('rect', { x: padL, y: 0, width: W - padL - padR, height: gr.base + 4, class: 'ch-hit' }, gr.svg);
    hit.addEventListener('pointermove', e => {
      const box = gr.svg.getBoundingClientRect(), i = Math.floor((e.clientX - box.left - padL) / slot);
      if (i < 0 || i >= n) { mark(-1); hideTip(); return; }
      mark(i); const r = rows[i];
      showTip(root, e, [['', (r.i + 1) + '. ' + r.name, true], [r.len, 'coups'], [r.strong, 'choix forts' + (r.few ? ' · sous l\'objectif' : '')], [r.weak, 'choix faibles'], [r.explore, 'gestes d\'exploration'], ['', r.L.lot + (r.L.stage ? ' · ' + r.L.stage : '')]]);
    });
    hit.addEventListener('pointerleave', () => { mark(-1); hideTip(); });
    hit.addEventListener('click', e => { const box = gr.svg.getBoundingClientRect(), i = Math.floor((e.clientX - box.left - padL) / slot); if (rows[i]) onPick(rows[i].i); });
  }
}

// Profil : choix forts en fonction de l'exploration ; une bulle grossit quand plusieurs niveaux se superposent
function profile(root, rows, onPick) {
  const card = html('div', 'ch-card', root);
  html('h4', '', card, 'Choix et exploration');
  html('p', 'ch-sub', card, 'Chaque bulle est un ou plusieurs niveaux. En bas à gauche : ni choix ni exploration.');
  const W = Math.max(260, card.clientWidth - 2), H = 230, padL = 46, padR = 14, padT = 14, padB = 30, inset = 14; // inset : les bulles à zéro ne couvrent pas l'axe
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'ch-svg', role: 'img', 'aria-label': 'Choix forts en fonction de l\'exploration, un point par niveau' }, card);
  const mx = Math.max(4, ...rows.map(r => r.explore)), my = Math.max(3, ...rows.map(r => r.strong));
  const tx = ticks(mx), ty = ticks(my), X = tx[tx.length - 1], Y = ty[ty.length - 1];
  const xOf = v => padL + inset + (W - padL - padR - inset) * v / X, yOf = v => H - padB - inset - (H - padB - padT - inset) * v / Y;
  for (const v of ty) { el('line', { x1: padL, x2: W - padR, y1: yOf(v), y2: yOf(v), class: v ? 'ch-grid' : 'ch-base' }, svg); el('text', { x: padL - 6, y: yOf(v) + 3, class: 'ch-tick', 'text-anchor': 'end' }, svg).textContent = v; }
  for (const v of tx) el('text', { x: xOf(v), y: H - padB + 13, class: 'ch-tick', 'text-anchor': 'middle' }, svg).textContent = v;
  el('text', { x: (padL + W - padR) / 2, y: H - 4, class: 'ch-axis', 'text-anchor': 'middle' }, svg).textContent = 'gestes d\'exploration';
  el('text', { x: 11, y: (padT + H - padB) / 2, class: 'ch-axis', 'text-anchor': 'middle', transform: `rotate(-90 11 ${(padT + H - padB) / 2})` }, svg).textContent = 'choix forts';
  el('line', { x1: padL, x2: W - padR, y1: yOf(2), y2: yOf(2), class: 'ch-target' }, svg);
  const pts = new Map();
  for (const r of rows) { const k = r.explore + ',' + r.strong; if (!pts.has(k)) pts.set(k, []); pts.get(k).push(r); }
  for (const [k, list] of [...pts].sort((a, b) => b[1].length - a[1].length)) {
    const [ex, s] = k.split(',').map(Number), rad = 4 + 3 * Math.sqrt(list.length - 1);
    const g = el('g', { class: 'ch-dot', tabindex: 0 }, svg);
    el('circle', { cx: xOf(ex), cy: yOf(s), r: Math.max(12, rad + 6), class: 'ch-hit' }, g);
    el('circle', { cx: xOf(ex), cy: yOf(s), r: rad, class: 'ch-pt' }, g);
    if (list.length > 1 && rad >= 9) el('text', { x: xOf(ex), y: yOf(s) + 3, class: 'ch-in', 'text-anchor': 'middle' }, g).textContent = list.length;
    const lines = () => [['', list.length > 1 ? list.length + ' niveaux' : (list[0].i + 1) + '. ' + list[0].name, true], [s, 'choix forts'], [ex, 'gestes d\'exploration'],
      ...list.slice(0, list.length > 1 ? 6 : 0).map(r => ['', (r.i + 1) + '. ' + r.name]), ...(list.length > 6 ? [['', '… et ' + (list.length - 6) + ' autres']] : [])];
    g.addEventListener('pointermove', e => showTip(root, e, lines()));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('focus', () => { const b = g.getBoundingClientRect(); showTip(root, { clientX: b.right, clientY: b.top }, lines()); });
    g.addEventListener('blur', hideTip);
    if (list.length === 1) g.addEventListener('click', () => onPick(list[0].i));
  }
}

// Alertes : nombre de niveaux par type, barres horizontales classées
function alertBars(root, rows) {
  const card = html('div', 'ch-card', root);
  html('h4', '', card, 'Alertes');
  const counts = new Map();
  for (const r of rows) for (const t of new Set(r.alerts.map(a => a.kind))) counts.set(t, (counts.get(t) || 0) + 1);
  const list = [...counts].sort((a, b) => b[1] - a[1]);
  if (!list.length) { html('p', 'ch-sub', card, 'Aucune alerte dans cette sélection.'); return; }
  html('p', 'ch-sub', card, 'Nombre de niveaux touchés, sur ' + rows.length + '.');
  const W = Math.max(260, card.clientWidth - 2), rowH = 26, labW = Math.min(170, W * 0.45), H = list.length * rowH + 4;
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'ch-svg', role: 'img', 'aria-label': 'Nombre de niveaux par type d\'alerte' }, card);
  const max = list[0][1], xOf = v => labW + (W - labW - 34) * v / max;
  list.forEach(([name, v], i) => {
    const y = i * rowH + 4, bh = Math.min(16, rowH - 8);
    el('text', { x: labW - 8, y: y + bh / 2 + 4, class: 'ch-label', 'text-anchor': 'end' }, svg).textContent = name;
    const w = xOf(v) - labW, r = Math.min(4, w);
    el('path', { d: `M${labW},${y}H${labW + w - r}Q${labW + w},${y} ${labW + w},${y + r}V${y + bh - r}Q${labW + w},${y + bh} ${labW + w - r},${y + bh}H${labW}Z`, class: 'ch-col' }, svg);
    el('text', { x: labW + w + 6, y: y + bh / 2 + 4, class: 'ch-label' }, svg).textContent = v;
  });
}

// Chiffres clés de la sélection
function kpis(root, rows, scope) {
  const row = html('div', 'ch-kpis', root);
  const tile = (value, label, title) => { const t = html('div', 'ch-kpi', row); html('b', '', t, value); html('span', '', t, label); if (title) t.title = title; };
  const noExp = rows.filter(r => !r.explore).length, low = rows.filter(r => r.few).length, withAl = rows.filter(r => r.alerts.length).length;
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  tile(rows.length + ' / ' + scope, 'niveaux évalués');
  tile(withAl, 'avec alertes');
  tile(low, 'sous l\'objectif de choix', 'moins de 2 choix forts (3 pour une finale), hors découverte');
  tile(noExp, 'sans exploration', 'aucun geste à essayer puis défaire le long de la solution');
  tile(med(rows.map(r => r.explore)), 'exploration médiane');
}

export function renderCharts(root, rows, scope, onPick) {
  root.replaceChildren(); tip = null;
  if (!rows.length) { html('p', 'ch-sub', root, 'Évalue les niveaux (bouton ci-dessus) pour afficher les graphiques.'); return; }
  kpis(root, rows, scope);
  levelStrips(root, rows, onPick);
  const two = html('div', 'ch-two', root);
  profile(two, rows, onPick);
  alertBars(two, rows);
}
