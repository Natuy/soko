// Outils d'analyse de niveau : solveur, métriques de choix, ajustement automatique.
import { parseLevel, step, teleport, actionDir, isWin, stateKey } from './engine.js';
const AN = (function () {
  const DIRS4 = ['up', 'down', 'left', 'right'];
  const LETTER = { up: 'U', down: 'D', left: 'L', right: 'R' };
  const BLOCKCH = new Set(['S', 'R', 'B', 'C', 'G', 'M', 'I', '=', '!', 'Z', '^', 'v', '<', '>']);
  const REPL = [['R', 'S'], ['S', 'R'], ['B', 'S'], ['C', 'S'], ['G', 'R'], ['/', '#'], ['\\', '#'], ['+', '.'], ['D', '#'], ['M', '#'], ['=', 'M'], ['!', 'M'], ['Z', '#'], ['T', '#'], ['I', 'S'], ['%', '.'], ['^', 'S'], ['v', 'S'], ['<', 'S'], ['>', 'S']];
  const NAMES = { S: 'carré', R: 'rond', B: 'cassant', C: 'carré collant', G: 'rond collant', M: 'miroir', I: 'inamovible', '=': 'miroir de ligne', '!': 'miroir de colonne', Z: 'miroir à interrupteur', '^': 'demi-carré', v: 'demi-carré', '<': 'demi-carré', '>': 'demi-carré', '/': 'déflecteur', '\\': 'déflecteur', '+': 'interrupteur', D: 'porte', T: 'vitre', '%': 'interrupteur de miroir' };

  function succ(s) {
    const out = [];
    for (const d of DIRS4) { const r = step(s, d); if (r) out.push([r, LETTER[d], d]); }
    if (s.mirrors) { const ad = actionDir(s); const r = ad && teleport(s, ad); if (r) out.push([r, '*', null]); }
    return out;
  }
  function checkMap(map) {
    const errs = [];
    const w = new Set(map.map(r => r.length)); if (w.size > 1) errs.push('Toutes les lignes doivent avoir la même longueur.');
    const all = map.join('');
    const np = (all.match(/P/g) || []).length, ne = (all.match(/[EXQ]/g) || []).length;
    if (np !== 1) errs.push('Il faut exactement un joueur (P), il y en a ' + np + '.');
    if (ne !== 1) errs.push('Il faut exactement une sortie (E), il y en a ' + ne + '.');
    return errs;
  }
  // Exploration complète de l'espace d'états
  function explore(map, cap, tick) {
    let s0; try { s0 = parseLevel(map); } catch (e) { return { error: String(e) }; }
    if (!s0.player || !s0.exit) return { error: 'joueur ou sortie manquant' };
    const id = new Map([[stateKey(s0), 0]]), st = [s0], adj = [[]], par = [-1], mv = [''];
    const wins = [];
    for (let i = 0; i < st.length; i++) {
      if (tick && (i & 4095) === 0) tick(i);
      const s = st[i]; if (isWin(s)) { wins.push(i); continue; }
      for (const [r, c] of succ(s)) {
        const k = stateKey(r.state); let j = id.get(k);
        if (j === undefined) { j = st.length; id.set(k, j); st.push(r.state); adj.push([]); par.push(i); mv.push(c); if (st.length > cap) return { over: true, total: st.length }; }
        adj[i].push(j);
      }
    }
    if (!wins.length) return { unsolvable: true, total: st.length };
    const rev = st.map(() => []); adj.forEach((a, i) => a.forEach(j => rev[j].push(i)));
    const good = new Set(wins), q = [...wins];
    while (q.length) { const j = q.pop(); for (const i of rev[j]) if (!good.has(i)) { good.add(i); q.push(i); } }
    let w = Math.min(...wins), path = [], sol = ''; while (w > 0) { path.unshift(w); sol = mv[w] + sol; w = par[w]; }
    return { st, adj, good, path, sol, len: path.length, total: st.length, dead: st.length - good.size };
  }
  // Solveur seul : BFS jusqu'à la première victoire (plus rapide que l'exploration complète)
  function solve(map, cap, tick) {
    let s0; try { s0 = parseLevel(map); } catch (e) { return { error: String(e) }; }
    if (!s0.player || !s0.exit) return { error: 'joueur ou sortie manquant' };
    if (isWin(s0)) return { sol: '', states: 1 };
    const seen = new Map([[stateKey(s0), null]]); const q = [[s0, stateKey(s0)]];
    for (let h = 0; h < q.length; h++) {
      if (tick && (h & 4095) === 0) tick(h);
      const [s, k] = q[h];
      for (const [r, c] of succ(s)) {
        const nk = stateKey(r.state); if (seen.has(nk)) continue;
        seen.set(nk, [k, c]);
        if (isWin(r.state)) { let sol = '', x = nk; while (seen.get(x)) { const [p, m] = seen.get(x); sol = m + sol; x = p; } return { sol, states: seen.size }; }
        if (seen.size > cap) return { over: true, states: seen.size };
        q.push([r.state, nk]);
      }
    }
    return { unsolvable: true, states: seen.size };
  }
  const adjCell = (a, b) => { const [r1, c1] = a.split(',').map(Number), [r2, c2] = b.split(',').map(Number); return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1; };
  const bk = s => stateKey(Object.assign({}, s, { player: '' }));
  // Le long de la solution la plus courte : à chaque configuration de blocs, combien de gestes possibles
  // (pousser un bloc, se téléporter ; marcher ne compte pas) et combien mènent encore à la victoire.
  // Un geste qu'on peut défaire (revenir ensuite à la même disposition, joueur compris dans la même zone)
  // n'est pas un choix : c'est de l'exploration. Seuls les gestes irréversibles sont comptés.
  // Chaque entrée vaut [gestes irréversibles, dont gagnants, indice du coup de la solution, gestes possibles au total].
  function choices(ex) {
    const { st, adj, good, path } = ex; const dec = []; const seen = new Set();
    if (!ex.rev) { ex.rev = st.map(() => []); adj.forEach((a, i) => a.forEach(j => ex.rev[j].push(i))); }
    const starts = [0, ...path.slice(0, -1)];
    for (let j = 0; j < starts.length; j++) {
      const i = starts[j];
      const key = bk(st[i]); if (seen.has(key)) continue; seen.add(key);
      const zone = new Set([i]), q = [i], opts = new Map();
      while (q.length) {
        const a = q.pop(); const ka = bk(st[a]);
        for (const b of adj[a]) {
          const kb = bk(st[b]); const walk = kb === ka && adjCell(st[a].player, st[b].player);
          if (walk) { if (!zone.has(b)) { zone.add(b); q.push(b); } }
          else { const k2 = kb === ka ? 'tp' + stateKey(st[b]) : kb; const o = opts.get(k2) || { win: false, states: [] }; o.win = o.win || good.has(b); o.states.push(b); opts.set(k2, o); }
        }
      }
      // états d'où l'on peut revenir dans la zone de départ
      const back = new Set(zone), q2 = [...zone];
      while (q2.length) { const x = q2.pop(); for (const y of ex.rev[x]) if (!back.has(y)) { back.add(y); q2.push(y); } }
      const firm = [...opts.values()].filter(o => o.states.every(b => !back.has(b)));
      dec.push([firm.length, firm.filter(o => o.win).length, j, opts.size]);
    }
    return dec;
  }
  const setCell = (m, r, c, ch) => { m = m.slice(); m[r] = m[r].slice(0, c) + ch + m[r].slice(c + 1); return m; };
  const solvable = (m, cap) => { const r = solve(m, cap || 60000); return !!r.sol || r.sol === ''; };
  function evaluate(map, opts) {
    opts = opts || {}; const cap = opts.cap || 250000, post = opts.progress || (() => {});
    const errs = checkMap(map); if (errs.length) return { errors: errs };
    post('Exploration des états…');
    const ex = explore(map, cap, i => post('Exploration : ' + i + ' états'));
    if (ex.error) return { errors: [ex.error] };
    if (ex.over) return { over: true, total: ex.total };
    if (ex.unsolvable) return { unsolvable: true, total: ex.total };
    const dec = choices(ex);
    const strong = dec.filter(([o, v]) => o >= 3 && v < o).length, weak = dec.filter(([o, v]) => o >= 2 && v < o).length;
    const useless = []; let n = 0;
    const blocks = []; map.forEach((row, r) => [...row].forEach((ch, c) => { if (BLOCKCH.has(ch)) blocks.push([r, c, ch]); }));
    for (const [r, c, ch] of blocks) { post('Utilité des blocs : ' + (++n) + ' / ' + blocks.length); if (solvable(setCell(map, r, c, '.'), 80000)) useless.push({ r, c, ch, name: NAMES[ch] }); }
    const notEss = [];
    for (const [a, b] of REPL) {
      if (!map.some(r => r.includes(a))) continue;
      post('Mécaniques indispensables : ' + NAMES[a]);
      if (solvable(map.map(r => r.split(a).join(b)), 80000)) notEss.push({ from: a, to: b, name: NAMES[a], toName: b === '#' ? 'mur' : b === '.' ? 'sol' : NAMES[b] });
    }
    post('Zones superflues…');
    const sup = superfluous(map, { strong, weak, total: ex.total, st: ex.st, path: ex.path }, post);
    return { sol: ex.sol, len: ex.sol.length, total: ex.total, dead: ex.dead, dec, strong, weak, useless, notEss, zones: sup.zones, minorCells: sup.minor, trimmed: sup.trimmed };
  }

  // Zones superflues : cases (sol ou trou) qu'on peut murer sans rendre le niveau impossible ni perdre de choix.
  // Les cases parcourues par la solution la plus courte sont exclues. On les regroupe en zones ; seules les impasses (zone reliée au reste par un seul côté) sont signalées.
  function superfluous(map, base, post) {
    const H = map.length, W = map[0].length, cand = [];
    const open = (m, r, c) => r >= 0 && c >= 0 && r < H && c < W && m[r][c] !== '#' && m[r][c] !== 'T';
    const nOpen = (m, r, c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => open(m, r + a, c + b)).length;
    // les cases parcourues par la solution la plus courte (joueur ou bloc) font partie du chemin prévu : jamais candidates
    const used = new Set(); for (const i of [0, ...(base.path || [])]) { const st = base.st[i]; used.add(st.player); for (const k of st.blocks.keys()) used.add(k); }
    for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) if ((map[r][c] === '.' || map[r][c] === 'O') && !used.has(r + ',' + c)) cand.push([r, c]);
    const keeps = m => { const ex = explore(m, Math.max(60000, base.total * 2)); if (!ex || ex.error || ex.over || ex.unsolvable) return false; const d = choices(ex); return d.filter(([o, v]) => o >= 3 && v < o).length >= base.strong && d.filter(([o, v]) => o >= 2 && v < o).length >= base.weak; };
    // les impasses d'abord, pour remonter les couloirs depuis leur bout
    cand.sort((a, b) => nOpen(map, ...a) - nOpen(map, ...b));
    let m = map; const removed = []; let n = 0; let changed = true;
    while (changed) {
      changed = false;
      for (const [r, c] of cand) {
        if (m[r][c] === '#') continue;
        if (post) post('Zones superflues : ' + (++n) + ' essais');
        const m2 = setCell(m, r, c, '#');
        if (keeps(m2)) { m = m2; removed.push([r, c]); changed = true; }
      }
    }
    const key = (r, c) => r + ',' + c, set = new Set(removed.map(([r, c]) => key(r, c))), seen = new Set(), zones = [];
    for (const [r, c] of removed) {
      if (seen.has(key(r, c))) continue;
      const z = [], q = [[r, c]]; seen.add(key(r, c));
      while (q.length) { const [a, b] = q.pop(); z.push({ r: a, c: b }); for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = key(a + dr, b + dc); if (set.has(k) && !seen.has(k)) { seen.add(k); q.push([a + dr, b + dc]); } } }
      let links = 0; for (const p of z) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (open(map, p.r + dr, p.c + dc) && !set.has(key(p.r + dr, p.c + dc))) links++;
      const deadEnd = links <= 1 || z.some(p => nOpen(map, p.r, p.c) <= 1);
      zones.push({ cells: z, deadEnd, flagged: deadEnd });
    }
    return { zones: zones.filter(z => z.flagged), minor: zones.filter(z => !z.flagged).reduce((a, z) => a + z.cells.length, 0), trimmed: m };
  }

  // ---------- Ajustement automatique (recuit simulé) ----------
  function signature(ex) {
    const sig = new Set(); const { st, path } = ex; let prev = st[0];
    for (const i of path) {
      const s = st[i], key = stateKey(s);
      for (const d of DIRS4) {
        const r = step(prev, d);
        if (r && stateKey(r.state) === key) { r.events.forEach(e => { sig.add(e.type + (e.kind ? ':' + e.kind[0] : '')); if (e.turn) sig.add('turn'); }); if (r.bump) sig.add('pendule'); break; }
      }
      if (prev.mirrors) { const ad = actionDir(prev); const r = ad && teleport(prev, ad); if (r && stateKey(r.state) === key) sig.add('tp-action'); }
      prev = s;
    }
    sig.delete('player'); return sig;
  }
  function optimize(orig, o, report) {
    const target = o.target || 2, maxDiff = o.maxDiff || 7, seconds = o.seconds || 30, diffW = o.diffW == null ? 0.9 : o.diffW;
    const H = orig.length, W = orig[0].length, rnd = k => Math.floor(Math.random() * k);
    const PROTECT = new Set();
    orig.forEach((row, r) => [...row].forEach((ch, c) => { if ('MZ=!ITD+%/\\E'.includes(ch)) for (const [dr, dc] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) PROTECT.add((r + dr) + ',' + (c + dc)); }));
    const EXEMPT = new Set();
    orig.forEach((row, r) => [...row].forEach((ch, c) => { if ('MZ=!I^v<>'.includes(ch) && solvable(setCell(orig, r, c, '.'))) EXEMPT.add(r + ',' + c + ch); }));
    const ess = REPL.filter(([a, b]) => orig.some(r => r.includes(a)) && !solvable(orig.map(r => r.split(a).join(b))));
    const pieces = [...new Set(orig.join('').split('').filter(ch => 'SRBCG^v<>'.includes(ch)))];
    function evalm(m) {
      const ex = explore(m, 25000); if (!ex || ex.error || ex.over || ex.unsolvable) return null;
      const dec = choices(ex);
      const strong = dec.filter(([a, v]) => a >= 3 && v < a).length, weak = dec.filter(([a, v]) => a >= 2 && v < a).length;
      let diff = 0; m.forEach((row, r) => [...row].forEach((ch, c) => { if (orig[r][c] !== ch) diff++; }));
      if (diff > maxDiff) return null;
      const score = 4 * Math.min(strong, target + 1) + 1.5 * Math.min(weak, 6) + 0.3 * Math.min(dec.length, 10) - diffW * diff - Math.max(0, ex.len - 40) * 0.5;
      return { score, strong, weak, len: ex.len, diff, sol: ex.sol, sig: signature(ex) };
    }
    const allUseful = m => { for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (BLOCKCH.has(m[r][c]) && !EXEMPT.has(r + ',' + c + m[r][c]) && solvable(setCell(m, r, c, '.'))) return false; return true; };
    const e0 = evalm(orig); if (!e0) return { error: 'Le niveau de départ doit être résoluble (et pas trop grand pour l\'ajustement).' };
    const sig0 = e0.sig;
    const ok = (m, ev) => [...sig0].every(x => ev.sig.has(x)) && ess.every(([a, b]) => !solvable(m.map(r => r.split(a).join(b)))) && allUseful(m);
    function mutate(m) {
      for (let tries = 0; tries < 50; tries++) {
        const r = 1 + rnd(H - 2), c = 1 + rnd(W - 2), ch = m[r][c], k = rnd(7);
        if (PROTECT.has(r + ',' + c)) continue;
        if (k === 0 && (ch === '#' || ch === '.')) return setCell(m, r, c, ch === '#' ? '.' : '#');
        if (k === 1 && ch === '.') return setCell(m, r, c, 'O');
        if (k === 2 && ch === 'O') return setCell(m, r, c, '.');
        if (k === 3 && ch === '.' && pieces.length) return setCell(m, r, c, pieces[rnd(pieces.length)]);
        const fixed = 'MZ=!ICG'.includes(ch);
        if (k === 4 && BLOCKCH.has(ch) && !fixed) return setCell(m, r, c, '.');
        if (k === 2 && ch === '.' && pieces.length && Math.random() < 0.5) {
          const r2 = 1 + rnd(H - 2), c2 = 1 + rnd(W - 2);
          if (m[r2][c2] === '.' && !PROTECT.has(r2 + ',' + c2) && (r2 !== r || c2 !== c)) return setCell(setCell(m, r, c, pieces[rnd(pieces.length)]), r2, c2, 'O');
        }
        if ((k === 5 || k === 6) && ((BLOCKCH.has(ch) && !fixed) || ch === 'P' || ch === 'O')) {
          const d = [[0, 1], [0, -1], [1, 0], [-1, 0]][rnd(4)], r2 = r + d[0], c2 = c + d[1];
          if (r2 > 0 && c2 > 0 && r2 < H - 1 && c2 < W - 1 && m[r2][c2] === '.' && !PROTECT.has(r2 + ',' + c2)) return setCell(setCell(m, r, c, '.'), r2, c2, ch);
        }
      }
      return m;
    }
    const valid0 = ok(orig, e0);
    let best = Object.assign({ map: orig, valid: valid0 }, e0); if (!valid0) best.score -= 100;
    let cur = best; const t0 = Date.now(); let temp = 2, it = 0, lastRep = 0;
    const strip = b => ({ map: b.map, score: b.score, strong: b.strong, weak: b.weak, len: b.len, diff: b.diff, sol: b.sol, valid: b.valid });
    const start = strip(best);
    while ((Date.now() - t0) / 1000 < seconds) {
      it++;
      let m = mutate(cur.map); if (Math.random() < 0.4) m = mutate(m);
      const ev = evalm(m);
      if (ev && ev.score > cur.score - temp * Math.random() && ok(m, ev)) {
        cur = Object.assign({ map: m, valid: true }, ev);
        if (ev.score > best.score) best = cur;
      }
      temp = Math.max(0.2, temp * 0.999);
      if (report && Date.now() - lastRep > 700) { lastRep = Date.now(); report({ it, elapsed: (Date.now() - t0) / 1000, best: strip(best), start }); }
      if (best.strong >= target + 1 && best.diff <= 4) break;
    }
    return { start, best: strip(best), it, essentials: ess.map(([a]) => NAMES[a]) };
  }
  return { solve, evaluate, optimize, checkMap, NAMES, superfluous };
})();

export default AN;
export const { solve, evaluate, optimize, checkMap, NAMES, superfluous } = AN;
