// Moteur de règles : fonctions pures, sans DOM ni rendu.
// Utilisé par le lab (navigateur), le solveur (worker, Node) et le jeu Shallot.
// Moteur de règles partagé (navigateur + Node)
// Légende : # mur, . sol, O trou, E sortie, P joueur, S carré, R rond,
//           X carré sur la sortie, Q rond sur la sortie, B bloc cassant,
//           ^ v < > demi-carré (la pointe indique le seul sens dans lequel il avance)
//           / \ déflecteur (fixe, fait tourner les ronds de 90°), + interrupteur, D porte
//           C carré collant, G rond collant, M miroir (téléporteur), I bloc inamovible
//           = miroir de ligne, ! miroir de colonne, Z miroir à interrupteur, % interrupteur de miroir
//           T mur transparent (bloque tout, sauf le regard des miroirs)
const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
const TURN = { '/': { right: 'up', up: 'right', left: 'down', down: 'left' }, '\\': { right: 'down', down: 'right', left: 'up', up: 'left' } };
const ARROW = { up: '^', down: 'v', left: '<', right: '>' };
const isR = b => !!b && b[0] === 'R';
const sticky = b => !!b && b.endsWith('*');

function parseLevel(rows) {
  const st = { h: rows.length, w: Math.max(...rows.map(r => r.length)), walls: new Set(), holes: new Set(), blocks: new Map(), glue: new Set(), player: null, exit: null, defl: new Map(), switches: new Set(), doors: new Set(), open: false, facing: 'right', mirrors: false, plates: new Set(), pressed: new Set(), glass: new Set() };
  rows.forEach((row, r) => {
    for (let c = 0; c < st.w; c++) {
      const ch = row[c] || '#', k = r + ',' + c;
      if (ch === '#') st.walls.add(k);
      else if (ch === 'O') st.holes.add(k);
      else if (ch === 'E') st.exit = k;
      else if (ch === 'P') st.player = k;
      else if (ch === 'S') st.blocks.set(k, 'S');
      else if (ch === 'R') st.blocks.set(k, 'R');
      else if (ch === 'X') { st.exit = k; st.blocks.set(k, 'S'); }
      else if (ch === 'Q') { st.exit = k; st.blocks.set(k, 'R'); }
      else if (ch === 'B') st.blocks.set(k, 'B');
      else if (ch === 'C') st.blocks.set(k, 'S*');
      else if (ch === 'G') st.blocks.set(k, 'R*');
      else if (ch === 'M') { st.blocks.set(k, 'M'); st.mirrors = true; }
      else if (ch === 'I') st.blocks.set(k, 'I');
      else if (ch === '=') { st.blocks.set(k, 'Mh'); st.mirrors = true; }
      else if (ch === '!') { st.blocks.set(k, 'Mv'); st.mirrors = true; }
      else if (ch === 'Z') st.blocks.set(k, 'Mz');
      else if (ch === '%') st.plates.add(k);
      else if (ch === 'T') st.glass.add(k);
      else if (ch === '/' || ch === '\\') st.defl.set(k, ch);
      else if (ch === '+') st.switches.add(k);
      else if (ch === 'D') st.doors.add(k);
      else if ('^v<>'.includes(ch)) st.blocks.set(k, 'H' + ch);
    }
  });
  applyStick(st);
  st.open = computeOpen(st);
  st.pressed = pressedPlates(st);
  return st;
}

// Les portes sont ouvertes si tous les interrupteurs sont pressés (joueur ou bloc immobile),
// et une porte ne se referme jamais sur quelqu'un.
function computeOpen(s, ignore) {
  if (!s.doors.size) return false;
  const pressed = k => s.player === k || (s.blocks.has(k) && !(ignore && ignore.has(k)));
  if (s.switches.size && [...s.switches].every(pressed)) return true;
  return [...s.doors].some(pressed);
}

function cloneState(s) {
  return { ...s, holes: new Set(s.holes), blocks: new Map(s.blocks), glue: new Set(s.glue) };
}

const rcOf = k => k.split(',').map(Number);
// opaque : arrête le regard des miroirs ; blocked : arrête aussi le joueur et les blocs (murs transparents compris)
const opaque = (s, k) => { const [r, c] = rcOf(k); return s.walls.has(k) || s.defl.has(k) || (s.doors.has(k) && !s.open) || r < 0 || c < 0 || r >= s.h || c >= s.w; };
const blocked = (s, k) => { const [r, c] = rcOf(k); return s.glass.has(k) || s.walls.has(k) || s.defl.has(k) || (s.doors.has(k) && !s.open) || r < 0 || c < 0 || r >= s.h || c >= s.w; };
const add = (k, d) => { const [r, c] = rcOf(k); return (r + d[0]) + ',' + (c + d[1]); };
const edge = (a, b) => a < b ? a + '|' + b : b + '|' + a;
const NB = Object.values(DIRS);

// ---- Blocs collés ----
function grouped(s, k) { return NB.some(d => s.glue.has(edge(k, add(k, d)))); }
function groupOf(s, k) {
  const seen = new Set([k]), q = [k];
  while (q.length) { const x = q.pop(); for (const d of NB) { const y = add(x, d); if (!seen.has(y) && s.glue.has(edge(x, y))) { seen.add(y); q.push(y); } } }
  return [...seen];
}
function removeBlock(s, k) {
  s.blocks.delete(k);
  for (const d of NB) s.glue.delete(edge(k, add(k, d)));
}
// Tout bloc collant en contact avec un autre bloc s'y colle (avec tous en même temps), puis n'est plus collant.
function applyStick(s) {
  const used = new Set();
  for (const [k, v] of s.blocks) {
    if (!sticky(v)) continue;
    for (const d of NB) {
      const n = add(k, d);
      if (s.blocks.has(n)) { s.glue.add(edge(k, n)); used.add(k); if (sticky(s.blocks.get(n))) used.add(n); }
    }
  }
  for (const k of used) s.blocks.set(k, s.blocks.get(k).slice(0, -1));
  return used.size > 0;
}
// Déplace un ensemble de blocs d'une case (translation)
function translate(s, keys, d) {
  const set = new Set(keys), kinds = keys.map(k => s.blocks.get(k));
  const edges = [...s.glue].filter(e => { const [a, b] = e.split('|'); return set.has(a) && set.has(b); });
  edges.forEach(e => s.glue.delete(e));
  keys.forEach(k => s.blocks.delete(k));
  keys.forEach((k, i) => s.blocks.set(add(k, d), kinds[i]));
  edges.forEach(e => { const [a, b] = e.split('|'); s.glue.add(edge(add(a, d), add(b, d))); });
  return keys.map(k => add(k, d));
}
// Un essieu : uniquement des ronds, alignés perpendiculairement au déplacement
function isAxle(s, g, dirName) {
  if (g.length < 2 || !g.every(k => isR(s.blocks.get(k)))) return false;
  const rc = g.map(rcOf), horiz = dirName === 'left' || dirName === 'right';
  return horiz ? rc.every(p => p[1] === rc[0][1]) : rc.every(p => p[0] === rc[0][0]);
}
function canPushGroup(s, g, dirName) {
  return g.every(k => { const b = s.blocks.get(k); return b !== 'I' && !(b[0] === 'H' && b[1] !== ARROW[dirName]); });
}
const chainEnd = (s, k, d) => { let e = k; while (isR(s.blocks.get(add(e, d))) && !grouped(s, add(e, d))) e = add(e, d); return e; };

// Fait rouler un essieu (groupe de ronds) : il passe au-dessus des trous, ne tombe que s'il est entièrement au-dessus du vide
function rollGroup(s, members, dirName, ev) {
  const d = DIRS[dirName];
  let mem = members.slice(), origin = new Map(mem.map(k => [k, k])), moved = false;
  const flush = () => {
    const moves = mem.filter(k => origin.get(k) !== k).map(k => ({ from: origin.get(k), to: k }));
    if (moves.length) ev.push({ type: 'multi', moves });
    origin = new Map(mem.map(k => [k, k]));
  };
  for (let guard = 0; guard < 400; guard++) {
    const set = new Set(mem), breaks = [], pends = [];
    let stop = false;
    for (const k of mem) {
      const nx = add(k, d); if (set.has(nx)) continue;
      const b = s.blocks.get(nx);
      if (b === 'B' && !grouped(s, nx)) { breaks.push(nx); stop = true; }
      else if (isR(b) && !grouped(s, nx)) { pends.push(nx); stop = true; }
      else if (blocked(s, nx) || b || s.player === nx) stop = true;
    }
    if (stop) {
      flush();
      for (const k of breaks) { removeBlock(s, k); ev.push({ type: 'break', at: k }); }
      let pm = false;
      for (const k of pends) if (s.blocks.has(k)) pm = roll(s, chainEnd(s, k, d), dirName, ev) || pm;
      return moved || breaks.length > 0 || pm;
    }
    const nm = translate(s, mem, d);
    nm.forEach((k, i) => origin.set(k, origin.get(mem[i])));
    mem.forEach((k, i) => { if (!nm.includes(k)) origin.delete(k); });
    mem = nm; moved = true;
    if (mem.every(k => s.holes.has(k))) {
      flush();
      for (const k of mem) { s.holes.delete(k); removeBlock(s, k); ev.push({ type: 'vanish', at: k }); }
      return true;
    }
    if (applyStick(s)) {
      const g = groupOf(s, mem[0]);
      if (isAxle(s, g, dirName)) { flush(); mem = g; origin = new Map(mem.map(k => [k, k])); continue; }
      flush(); return true;
    }
  }
  flush(); return moved;
}

// Fait rouler le rond situé en pos. Ajoute les événements d'animation dans ev.
function roll(s, pos, d0, ev) {
  let cur = pos, d = d0, seg = pos;
  const kind = s.blocks.get(pos);
  const stopAt = () => {
    if (cur !== seg) ev.push({ type: 'move', from: seg, to: cur, kind: 'R' });
    if (cur !== pos) { s.blocks.delete(pos); s.blocks.set(cur, kind); }
    return cur !== pos;
  };
  // ce qui se trouve en k pour un rond qui arrive
  const hit = (k, dir) => {
    const bn = s.blocks.get(k);
    if (bn === 'B') { stopAt(); removeBlock(s, k); ev.push({ type: 'break', at: k }); return true; }
    if (isR(bn) && !grouped(s, k)) { const m = stopAt(); return roll(s, chainEnd(s, k, DIRS[dir]), dir, ev) || m; }
    return null;
  };
  // s'agrippe-t-il à un bloc sur le côté ?
  const grabs = (k, dir) => {
    const side = (dir === 'left' || dir === 'right') ? [DIRS.up, DIRS.down] : [DIRS.left, DIRS.right];
    return side.some(sd => { const n = add(k, sd), b = s.blocks.get(n); return b && n !== pos && (sticky(b) || sticky(kind)); });
  };
  for (let guard = 0; guard < 400; guard++) {
    const nx = add(cur, DIRS[d]);
    if (s.defl.has(nx)) {
      // Déflecteur : le rond tourne de 90° s'il peut ressortir, sinon il s'arrête devant
      const nd = TURN[s.defl.get(nx)][d], out = add(nx, DIRS[nd]);
      const r = hit(out, nd); if (r !== null) return r;
      const ob = s.blocks.get(out);
      if (s.holes.has(out) || s.defl.has(out) || (!blocked(s, out) && !ob && s.player !== out)) {
        ev.push({ type: 'move', from: seg, to: nx, kind: 'R', turn: true }); seg = nx;
        cur = nx; d = nd; continue;
      }
      return stopAt();
    }
    const r = hit(nx, d); if (r !== null) return r;
    if (blocked(s, nx) || s.blocks.has(nx) || s.player === nx) return stopAt();
    if (s.holes.has(nx)) {
      removeBlock(s, pos); s.holes.delete(nx);
      ev.push({ type: 'fill', from: seg, to: nx, kind: 'R' });
      return true;
    }
    cur = nx;
    if (grabs(cur, d)) {
      // le rond s'agrippe en plein trajet ; s'il forme un essieu, il continue avec lui
      stopAt(); applyStick(s);
      const g = groupOf(s, cur);
      if (isAxle(s, g, d)) rollGroup(s, g, d, ev);
      return true;
    }
  }
  return stopAt();
}

const pressedPlates = s => new Set([...s.plates].filter(k => s.player === k || s.blocks.has(k)));
function finish(s, ev, extra) {
  applyStick(s);
  if (s.plates.size) {
    // un interrupteur de miroir qui vient d'être pressé déclenche les miroirs à interrupteur
    const now = pressedPlates(s);
    if ([...now].some(k => !s.pressed.has(k))) {
      for (const [k, v] of [...s.blocks]) if (v === 'Mz' && s.blocks.get(k) === 'Mz') { const plan = zPlan(s, k); if (plan) execPlan(s, plan, ev, k); }
      applyStick(s);
    }
    s.pressed = pressedPlates(s);
  }
  s.open = computeOpen(s);
  return { state: s, events: ev, ...extra };
}

// Applique un déplacement. Renvoie { state, events } ou null si rien ne bouge.
function step(s0, dirName) {
  const d = DIRS[dirName], s = cloneState(s0), ev = [];
  s.facing = dirName;
  const n = add(s.player, d);
  if (blocked(s, n) || (s.holes.has(n) && !s.blocks.has(n))) return null;
  const b = s.blocks.get(n);
  if (b && s.holes.has(n)) return null; // le joueur ne peut pas suivre un bloc suspendu au-dessus du vide
  if (!b) { ev.push({ type: 'player', from: s.player, to: n }); s.player = n; return finish(s, ev); }
  const m = add(n, d);
  if (grouped(s, n)) {
    // Groupe collé : se comporte comme un carré, sauf l'essieu poussé dans la largeur
    const g = groupOf(s, n), set = new Set(g);
    if (!canPushGroup(s, g, dirName)) return null;
    if (isAxle(s, g, dirName)) {
      // Si l'essieu part, le joueur arrive sur sa case : c'est cette case d'arrivée qui peut arrêter un rond.
      // S'il ne bouge pas (pendule), le joueur reste où il est.
      const p0 = s.player, save = cloneState(s);
      s.player = n; s.open = computeOpen(s, set);
      if (rollGroup(s, g, dirName, ev) && !s.blocks.has(n)) { s.player = p0; ev.unshift({ type: 'player', from: p0, to: n }); s.player = n; return finish(s, ev); }
      const s2 = save, ev2 = [];
      s2.player = n; s2.open = computeOpen(s2, set); s2.player = p0;
      if (!rollGroup(s2, g, dirName, ev2)) return null;
      if (s2.blocks.has(n)) return finish(s2, ev2, { bump: n }); // l'essieu n'a pas bougé (pendule)
      return null;
    }
    for (const k of g) { const nx = add(k, d); if (set.has(nx)) continue; if (blocked(s, nx) || s.blocks.has(nx) || s.player === nx) return null; }
    const nm = translate(s, g, d);
    ev.push({ type: 'player', from: s.player, to: n }); s.player = n;
    ev.push({ type: 'multi', moves: g.map((k, i) => ({ from: k, to: nm[i] })) });
    if (nm.every(k => s.holes.has(k))) for (const k of nm) { s.holes.delete(k); removeBlock(s, k); ev.push({ type: 'vanish', at: k }); }
    return finish(s, ev);
  }
  if (!isR(b)) {
    if (b === 'I') return null;
    if (s.defl.has(m)) return null;
    // Carré, cassant, miroir ou demi-carré : avance d'une case
    if (b[0] === 'H' && b[1] !== ARROW[dirName]) return null; // demi-carré poussé hors de sa face plate
    if (blocked(s, m) || s.blocks.has(m)) return null;
    s.blocks.delete(n);
    if (s.holes.has(m)) { s.holes.delete(m); ev.push({ type: 'fill', from: n, to: m, kind: b }); }
    else { s.blocks.set(m, b); ev.push({ type: 'move', from: n, to: m, kind: b }); }
    ev.unshift({ type: 'player', from: s.player, to: n }); s.player = n;
    return finish(s, ev);
  }
  // Rond
  const bm = s.blocks.get(m);
  if (bm === 'B' && !grouped(s, m)) {
    // Rond poussé collé à un cassant : le choc le brise, le joueur ne bouge pas
    removeBlock(s, m); ev.push({ type: 'break', at: m });
    return finish(s, ev, { bump: n });
  }
  if (isR(bm)) {
    // Le rond poussé touche un autre rond : pendule, le joueur ne bouge pas
    if (grouped(s, m)) return null;
    if (!roll(s, chainEnd(s, m, d), dirName, ev)) return null;
    return finish(s, ev, { bump: n });
  }
  // la porte réagit tout de suite : le joueur a quitté sa case, le rond poussé ne presse plus rien.
  // Pendant que le rond roule, le joueur est déjà sur sa case d'arrivée : c'est elle qui peut arrêter un rond qui revient.
  const p0 = s.player; s.player = n; s.open = computeOpen(s, new Set([n]));
  if (!roll(s, n, dirName, ev)) return null;
  ev.unshift({ type: 'player', from: p0, to: n });
  return finish(s, ev);
}

// Téléportation par le miroir : tout ce qui est entre le joueur et le miroir (joueur compris)
// passe de l'autre côté, à la même distance. Échoue si une case d'arrivée est interdite.
function teleportPlan(s, dirName) {
  const d = DIRS[dirName], beam = [];
  let k = s.player;
  for (;;) {
    k = add(k, d);
    if (opaque(s, k)) return null;
    const b = s.blocks.get(k);
    if (mirrorFor(b, dirName)) break;
    if (b) beam.push(k);
  }
  const [mr, mc] = rcOf(k), moving = new Set([s.player, ...beam]);
  const plan = [];
  for (const e of [s.player, ...beam]) {
    const [r, c] = rcOf(e), to = (2 * mr - r) + ',' + (2 * mc - c);
    if (blocked(s, to) || (s.blocks.has(to) && !moving.has(to))) return null;
    if (e === s.player && s.holes.has(to) && !s.blocks.has(to)) return null;
    plan.push({ from: e, to, player: e === s.player });
  }
  return { mirror: k, plan };
}
// Directions où un miroir est aligné avec le joueur, sans mur entre les deux
function mirrorDirs(s) {
  return Object.keys(DIRS).filter(dn => {
    let k = s.player;
    for (;;) { k = add(k, DIRS[dn]); if (opaque(s, k)) return false; if (mirrorFor(s.blocks.get(k), dn)) return true; }
  });
}
// Bouton d'action : utilise le miroir aligné ; s'il y en a plusieurs, rien ne se passe
function actionDir(s) { const d = mirrorDirs(s); return d.length === 1 ? d[0] : null; }
// Un miroir fonctionne-t-il dans cette direction ? (miroir de ligne : horizontal, de colonne : vertical)
function mirrorFor(b, dn) {
  const h = dn === 'left' || dn === 'right';
  return b === 'M' || (b === 'Mh' && h) || (b === 'Mv' && !h);
}
// Miroir à interrupteur : tout ce qui est dans sa ligne et sa colonne (sans mur entre) passe de l'autre côté
function zPlan(s, z) {
  const [mr, mc] = rcOf(z), ents = [];
  for (const d of NB) {
    let k = z;
    for (;;) { k = add(k, d); if (opaque(s, k)) break; if (s.player === k || s.blocks.has(k)) ents.push(k); }
  }
  if (!ents.length) return null;
  const moving = new Set(ents), plan = [];
  for (const e of ents) {
    const [r, c] = rcOf(e), to = (2 * mr - r) + ',' + (2 * mc - c), isP = e === s.player;
    if (blocked(s, to) || (s.blocks.has(to) && !moving.has(to)) || (s.player === to && !moving.has(to))) return null;
    if (isP && s.holes.has(to) && !s.blocks.has(to)) return null;
    plan.push({ from: e, to, player: isP });
  }
  return plan;
}
function execPlan(s, plan, ev, mirror) {
  const map = new Map(plan.map(p => [p.from, p.to]));
  const kinds = new Map(plan.filter(p => !p.player).map(p => [p.from, s.blocks.get(p.from)]));
  const keep = [];
  for (const e of [...s.glue]) {
    const [a, b] = e.split('|');
    if (map.has(a) || map.has(b)) { s.glue.delete(e); if (map.has(a) && map.has(b)) keep.push(edge(map.get(a), map.get(b))); }
  }
  for (const k of kinds.keys()) s.blocks.delete(k);
  const moves = [];
  for (const p of plan) {
    if (p.player) { s.player = p.to; moves.push(p); continue; }
    if (s.holes.has(p.to)) { s.holes.delete(p.to); moves.push({ ...p, fill: true }); }
    else { s.blocks.set(p.to, kinds.get(p.from)); moves.push(p); }
  }
  keep.forEach(e => { const [a, b] = e.split('|'); if (s.blocks.has(a) && s.blocks.has(b)) s.glue.add(e); });
  ev.push({ type: 'tp', moves, mirror });
}
function teleport(s0, dirName) {
  const tp = teleportPlan(s0, dirName); if (!tp) return null;
  const s = cloneState(s0), ev = [], { plan } = tp;
  s.facing = dirName;
  execPlan(s, plan, ev, tp.mirror);
  return finish(s, ev);
}
const isWin = s => s.player === s.exit;

function stateKey(s) {
  return s.player + '|' + [...s.blocks].map(([k, v]) => v + k).sort().join(';') + '|' + [...s.holes].sort().join(';') + '|' + [...s.glue].sort().join(';') ;
}


export {
  DIRS,
  TURN,
  ARROW,
  isR,
  sticky,
  parseLevel,
  computeOpen,
  cloneState,
  rcOf,
  opaque,
  blocked,
  add,
  edge,
  NB,
  grouped,
  groupOf,
  removeBlock,
  applyStick,
  translate,
  isAxle,
  canPushGroup,
  chainEnd,
  rollGroup,
  roll,
  pressedPlates,
  finish,
  step,
  teleportPlan,
  mirrorDirs,
  actionDir,
  mirrorFor,
  zPlan,
  execPlan,
  teleport,
  isWin,
  stateKey,
};
