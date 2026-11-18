// Onglet « Niveaux » : ranger les niveaux dans les mondes, éditer leurs textes et leur plan,
// puis enregistrer chaque monde au format de levels/monde-N.json.
// On travaille sur un brouillon gardé dans le navigateur ; les fichiers du dépôt ne changent
// qu'au moment où l'on clique sur « Écrire » (serveur de dev) ou quand on remplace le fichier téléchargé.
import { WORLDS, checkMap, replay } from '../../../packages/core/src/index.js';

const KEY = 'pz-lib';
const STAGES = ['', 'Découverte', 'Approfondissement', 'Twist'];
const DEV = !!(import.meta.env && import.meta.env.DEV);

// Même ordre de clés que les fichiers du dépôt, pour des diffs propres.
const clean = l => {
  const o = { lot: l.lot || '', stage: l.stage || '', name: l.name, map: l.map.slice(), teach: Array.isArray(l.teach) ? l.teach.slice() : [], hint: l.hint || '' };
  if (typeof l.solution === 'string') o.solution = l.solution;
  return o;
};
const cleanWorld = w => ({ world: w.world, levels: w.levels.map(clean) });
const fileOf = wi => 'monde-' + (wi + 1) + '.json';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const repo = WORLDS.map(cleanWorld);
let lib = null;
try {
  const s = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (Array.isArray(s) && s.every(w => w && typeof w.world === 'string' && Array.isArray(w.levels))) lib = s.map(cleanWorld);
} catch (e) {}
if (!lib) lib = repo.map(cleanWorld);

function persist() { try { localStorage.setItem(KEY, JSON.stringify(lib)); } catch (e) {} }
const modified = wi => wi >= repo.length || JSON.stringify(lib[wi]) !== JSON.stringify(repo[wi]);

// Noms déjà pris par un niveau rangé dans un monde (brouillon ou dépôt) : ils doivent rester uniques.
export function takenNames() {
  return new Set([...lib, ...repo].flatMap(w => w.levels.map(l => l.name.toLowerCase())));
}

// État d'un niveau : erreurs de plan, solution présente et toujours gagnante
function status(l) {
  const errs = checkMap(l.map);
  if (errs.length) return { cls: 'bad', txt: '⚠ plan invalide', long: errs.join(' · ') };
  if (l.solution === undefined) return { cls: 'todo', txt: '○ à résoudre', long: 'Pas de solution enregistrée : « Calculer les solutions » ou bun run levels:solve.' };
  let r; try { r = replay(l.map, l.solution); } catch (e) { r = { won: false }; }
  if (!r.won) return { cls: 'bad', txt: '⚠ solution fausse', long: 'La solution enregistrée ne gagne plus : recalcule-la.' };
  return { cls: 'ok', txt: '✓ ' + l.solution.length, long: 'Solution en ' + l.solution.length + ' coups.' };
}

export function initManage(ctx) {
  const { $, drawStatic, editMap, custom } = ctx;
  let sel = null; // { wi, li } du niveau déplié
  const msgs = {}; // message par monde
  let solving = null; // Worker en cours

  // message laissé avant un rechargement (le serveur de dev recharge la page quand un fichier de niveaux change)
  try { const f = sessionStorage.getItem('pz-lib-flash'); if (f) { $('lib-msg').textContent = f; sessionStorage.removeItem('pz-lib-flash'); } } catch (e) {}

  const changed = () => { persist(); render(); };
  const setMsg = (wi, t) => { msgs[wi] = t; const el = document.querySelector('[data-msg="' + wi + '"]'); if (el) el.textContent = t; };

  function render() {
    const root = $('lib-worlds'); root.innerHTML = '';
    lib.forEach((w, wi) => root.appendChild(worldCard(w, wi)));
    renderPool();
    const mod = lib.map((_, wi) => wi).filter(modified);
    $('lib-writeall').hidden = !DEV; $('lib-writeall').disabled = !mod.length;
    $('lib-writeall').textContent = 'Écrire les mondes modifiés' + (mod.length ? ' (' + mod.length + ')' : '');
    $('lib-reset').disabled = lib.length === repo.length && !mod.length;
    $('lib-devnote').hidden = DEV;
  }

  function worldCard(w, wi) {
    const card = document.createElement('div'); card.className = 'card lib-world';
    const isNew = wi >= repo.length;
    card.innerHTML =
      '<div class="lib-head"><input class="lib-wname" aria-label="Nom du monde" value="' + esc(w.world) + '">' +
      '<span class="lib-file">' + fileOf(wi) + '</span>' + (modified(wi) ? '<span class="lib-badge">' + (isNew ? 'nouveau' : 'modifié') + '</span>' : '') + '</div>' +
      '<ol class="lib-list"></ol>' +
      (w.levels.length ? '' : '<p class="ed-note">Aucun niveau : place-en un depuis « Mes niveaux » ou un autre monde.</p>') +
      '<div class="ed-bar">' +
      (DEV ? '<button class="ed-btn main" data-act="write">Écrire ' + fileOf(wi) + '</button>' : '') +
      '<button class="ed-btn' + (DEV ? '' : ' main') + '" data-act="dl">Télécharger</button>' +
      '<button class="ed-btn" data-act="copy">Copier le JSON</button>' +
      '<button class="ed-btn" data-act="solve">Calculer les solutions</button>' +
      (modified(wi) && !isNew ? '<button class="ed-btn" data-act="revert">Annuler les modifications</button>' : '') +
      (isNew && wi === lib.length - 1 && !w.levels.length ? '<button class="ed-btn" data-act="delw">Supprimer le monde</button>' : '') +
      '</div><p class="ed-status" data-msg="' + wi + '">' + esc(msgs[wi] || '') + '</p>';
    card.querySelector('.lib-wname').onchange = e => {
      const v = e.target.value.trim(); if (!v) { e.target.value = w.world; return; }
      w.world = v; changed();
    };
    const list = card.querySelector('.lib-list');
    w.levels.forEach((l, li) => list.appendChild(levelRow(l, wi, li)));
    card.querySelectorAll('[data-act]').forEach(b => b.onclick = () => worldAction(b.dataset.act, wi, b));
    return card;
  }

  function levelRow(l, wi, li) {
    const w = lib[wi], st = status(l), open = sel && sel.wi === wi && sel.li === li;
    const row = document.createElement('li'); row.className = 'lib-row' + (open ? ' on' : '');
    row.innerHTML =
      '<div class="lib-line"><button class="lib-open" aria-expanded="' + open + '"><span class="lib-num">' + (li + 1) + '</span>' +
      '<span class="lib-info"><b>' + esc(l.name) + '</b><span>' + esc([l.lot, l.stage].filter(Boolean).join(' · ') || 'sans lot') + '</span></span>' +
      '<span class="lib-st ' + st.cls + '" title="' + esc(st.long) + '">' + st.txt + '</span></button>' +
      '<button class="lib-mv" data-mv="-1" title="Monter" aria-label="Monter"' + (li === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button class="lib-mv" data-mv="1" title="Descendre" aria-label="Descendre"' + (li === w.levels.length - 1 ? ' disabled' : '') + '>↓</button></div>';
    row.querySelector('.lib-open').onclick = () => { sel = open ? null : { wi, li }; render(); };
    row.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
      const j = li + +b.dataset.mv; [w.levels[li], w.levels[j]] = [w.levels[j], w.levels[li]];
      if (sel && sel.wi === wi && (sel.li === li || sel.li === j)) sel.li = sel.li === li ? j : li;
      changed();
    });
    if (open) row.appendChild(detail(l, wi, li, st));
    return row;
  }

  function detail(l, wi, li, st) {
    const w = lib[wi], d = document.createElement('div'); d.className = 'lib-detail';
    const lots = [...new Set(w.levels.map(x => x.lot).filter(Boolean))];
    const inRepo = repo.some(rw => rw.levels.some(x => x.name === l.name));
    d.innerHTML =
      '<div class="lib-prev"><div class="board"></div></div>' +
      '<label>Nom<input data-f="name" value="' + esc(l.name) + '" maxlength="60"></label>' +
      '<div class="lib-2"><label>Lot<input data-f="lot" value="' + esc(l.lot) + '" list="lib-lots-' + wi + '"></label>' +
      '<label>Étape<select data-f="stage">' + STAGES.map(s => '<option value="' + s + '"' + (s === l.stage ? ' selected' : '') + '>' + (s || '—') + '</option>').join('') + '</select></label></div>' +
      '<datalist id="lib-lots-' + wi + '">' + lots.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
      '<label>Ce que le niveau enseigne <small>(un paragraphe par ligne)</small><textarea data-f="teach" rows="3">' + esc(l.teach.join('\n')) + '</textarea></label>' +
      '<label>Indice<textarea data-f="hint" rows="2">' + esc(l.hint) + '</textarea></label>' +
      '<p class="ed-note lib-stl ' + st.cls + '">' + esc(st.long) + '</p>' +
      '<p class="ed-status lib-err"></p>' +
      '<div class="ed-bar"><button class="ed-btn main" data-a="edit">Éditer le plan</button>' +
      '<select data-a="dest" aria-label="Monde de destination">' + lib.map((x, i) => '<option value="' + i + '"' + (i === wi ? ' selected' : '') + '>' + esc(x.world) + '</option>').join('') + '</select>' +
      '<button class="ed-btn" data-a="move">Déplacer</button>' +
      '<button class="ed-btn" data-a="out" title="Le niveau retourne dans « Mes niveaux » (éditeur)">Retirer du monde</button></div>';
    drawStatic(d.querySelector('.board'), l.map, Math.max(10, Math.min(24, Math.floor(260 / Math.max(...l.map.map(r => r.length))))));
    const err = t => { d.querySelector('.lib-err').textContent = t; };
    d.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => {
      const f = inp.dataset.f, v = inp.value;
      if (f === 'name') {
        const n = v.trim().replace(/\s+/g, ' ');
        if (!n) { inp.value = l.name; return; }
        const clash = lib.some(x => x.levels.some(y => y !== l && y.name.toLowerCase() === n.toLowerCase()));
        if (clash) { inp.value = l.name; err('« ' + n + ' » est déjà le nom d\'un autre niveau : les noms doivent rester uniques.'); return; }
        l.name = n;
        if (inRepo) setMsg(wi, 'Attention : renommer un niveau publié fait perdre la progression enregistrée des joueurs sur ce niveau.');
      } else if (f === 'teach') l.teach = v.split('\n').map(s => s.trim()).filter(Boolean);
      else if (f === 'hint') l.hint = v.trim();
      else l[f] = v.trim();
      changed();
    });
    d.querySelector('[data-a="edit"]').onclick = () => editMap(l.map, l.name + ' (' + w.world.split(' · ')[0] + ')', map => {
      const target = findLevel(l); if (!target) return 'Ce niveau n\'est plus dans un monde.';
      if (map.join('\n') !== target.map.join('\n')) { target.map = map.slice(); delete target.solution; }
      persist(); render(); return null;
    });
    d.querySelector('[data-a="move"]').onclick = () => {
      const to = +d.querySelector('[data-a="dest"]').value; if (to === wi) return;
      w.levels.splice(li, 1); lib[to].levels.push(l); sel = { wi: to, li: lib[to].levels.length - 1 };
      setMsg(to, '« ' + l.name + ' » ajouté à la fin de ce monde.'); changed();
    };
    d.querySelector('[data-a="out"]').onclick = () => {
      const pool = custom.get(); let name = l.name, n = 2;
      while (pool.some(c => c.name.toLowerCase() === name.toLowerCase())) name = l.name + ' (' + n++ + ')';
      pool.push({ name, map: l.map.slice(), savedAt: new Date().toISOString(), meta: { lot: l.lot, stage: l.stage, teach: l.teach, hint: l.hint } });
      custom.set(pool); w.levels.splice(li, 1); sel = null;
      setMsg(wi, '« ' + l.name + ' » retiré : il est dans « Mes niveaux ».'); changed();
    };
    return d;
  }

  // retrouve un niveau du brouillon par identité (il a pu bouger entre-temps)
  function findLevel(l) { for (const w of lib) for (const x of w.levels) if (x === l) return x; return null; }

  function renderPool() {
    const pool = custom.get(), box = $('lib-pool');
    if (!pool.length) { box.innerHTML = '<p class="ed-note">Aucun niveau en attente. Dessine un niveau dans l\'éditeur et enregistre-le dans « Mes niveaux » pour le placer ici.</p>'; return; }
    box.innerHTML = '';
    const taken = new Set(lib.flatMap(w => w.levels.map(l => l.name.toLowerCase())));
    [...pool].sort((a, b) => a.name.localeCompare(b.name, 'fr')).forEach(c => {
      const row = document.createElement('div'); row.className = 'lib-poolrow';
      const clash = taken.has(c.name.toLowerCase()), bad = checkMap(c.map).length > 0;
      row.innerHTML = '<div class="board"></div><div class="lib-info"><b>' + esc(c.name) + '</b><span>' +
        (clash ? '⚠ nom déjà utilisé dans un monde : renomme-le dans l\'éditeur' : bad ? '⚠ plan invalide : corrige-le dans l\'éditeur' : c.map[0].length + ' × ' + c.map.length) + '</span></div>' +
        '<select aria-label="Monde">' + lib.map((x, i) => '<option value="' + i + '">' + esc(x.world.split(' · ')[0]) + '</option>').join('') + '</select>' +
        '<button class="ed-btn"' + (clash ? ' disabled' : '') + '>Placer</button>';
      drawStatic(row.querySelector('.board'), c.map, Math.max(5, Math.min(9, Math.floor(80 / Math.max(...c.map.map(r => r.length))))));
      row.querySelector('select').value = String(lib.length - 1);
      row.querySelector('button').onclick = () => {
        const wi = +row.querySelector('select').value, m = c.meta || {};
        const lvl = clean({ name: c.name, map: c.map, lot: m.lot, stage: m.stage, teach: m.teach, hint: m.hint });
        lib[wi].levels.push(lvl);
        custom.set(custom.get().filter(x => x.name !== c.name));
        sel = { wi, li: lib[wi].levels.length - 1 };
        setMsg(wi, '« ' + c.name + ' » placé à la fin du monde. Renseigne son lot, son étape et ses textes.');
        changed();
      };
      box.appendChild(row);
    });
  }

  // Vérifie un monde avant de l'enregistrer ; renvoie les erreurs bloquantes et les avertissements
  function check(wi) {
    const errors = [], warns = [], w = lib[wi];
    const all = lib.flatMap(x => x.levels.map(l => l.name.toLowerCase()));
    for (const l of w.levels) {
      if (all.filter(n => n === l.name.toLowerCase()).length > 1) errors.push('« ' + l.name + ' » : nom en double.');
      const e = checkMap(l.map); if (e.length) errors.push('« ' + l.name + ' » : ' + e.join(', '));
      else if (l.solution === undefined) warns.push(l.name);
    }
    return { errors, warns };
  }
  const worldJson = wi => JSON.stringify(cleanWorld(lib[wi]), null, 2) + '\n';

  async function write(wis) {
    for (const wi of wis) { const c = check(wi); if (c.errors.length) { setMsg(wi, '✗ Pas écrit : ' + c.errors.join(' ')); return false; } }
    const missing = wis.flatMap(wi => check(wi).warns);
    const flash = wis.map(fileOf).join(', ') + ' écrit' + (wis.length > 1 ? 's' : '') + ' dans levels/. Lance maintenant « bun run levels:solve » puis « bun run test »' +
      (missing.length ? ' (' + missing.length + ' niveau' + (missing.length > 1 ? 'x' : '') + ' sans solution).' : '.');
    try { sessionStorage.setItem('pz-lib-flash', flash); } catch (e) {}
    const notImported = [];
    for (const wi of wis) {
      let r;
      try { r = await fetch('/__niveaux', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: fileOf(wi), data: cleanWorld(lib[wi]) }) }).then(x => x.json()); }
      catch (e) { r = { error: 'serveur injoignable' }; }
      if (!r.ok) { try { sessionStorage.removeItem('pz-lib-flash'); } catch (e) {} setMsg(wi, '✗ Écriture impossible : ' + (r.error || 'erreur inconnue')); return false; }
      if (!r.imported) notImported.push(fileOf(wi));
      setMsg(wi, '✓ ' + fileOf(wi) + ' écrit.');
    }
    const extra = notImported.length ? ' Ajoute aussi l\'import de ' + notImported.join(', ') + ' dans packages/core/src/levels.js.' : '';
    try { sessionStorage.setItem('pz-lib-flash', flash + extra); } catch (e) {}
    $('lib-msg').textContent = flash + extra;
    return true;
  }

  function solveMap(map) {
    return new Promise(resolve => {
      let w; try { w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch (e) { resolve({ errors: ['Tâche de fond indisponible.'] }); return; }
      solving = w;
      w.onmessage = e => { if (e.data.type === 'done') { w.terminate(); solving = null; resolve(e.data.r); } };
      w.onerror = () => { w.terminate(); solving = null; resolve({ errors: ['Erreur pendant le calcul.'] }); };
      w.postMessage({ cmd: 'solve', map, opts: { cap: 3000000 } }); // même limite que scripts/solve-levels.mjs
    });
  }

  async function worldAction(act, wi, btn) {
    const w = lib[wi];
    if (act === 'write') { btn.disabled = true; await write([wi]); btn.disabled = false; }
    if (act === 'dl') {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([worldJson(wi)], { type: 'application/json' }));
      a.download = fileOf(wi); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      const c = check(wi);
      setMsg(wi, (c.errors.length ? '⚠ ' + c.errors.join(' ') + ' ' : '') + 'Remplace levels/' + fileOf(wi) + ' par ce fichier, puis lance « bun run levels:solve » et « bun run test ».');
    }
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(worldJson(wi)); setMsg(wi, 'JSON de ' + fileOf(wi) + ' copié.'); }
      catch (e) { setMsg(wi, 'Copie impossible : utilise « Télécharger ».'); }
    }
    if (act === 'revert') {
      if (!confirm('Annuler toutes les modifications de « ' + w.world + ' » ? Ses niveaux d\'origine y reviennent (même s\'ils ont été déplacés), et ceux qui n\'en faisaient pas partie retournent dans « Mes niveaux ».')) return;
      const back = cleanWorld(repo[wi]), names = new Set(back.levels.map(l => l.name));
      // ses niveaux d'origine quittent les autres mondes (pas de doublon)
      lib.forEach((x, i) => { if (i !== wi) x.levels = x.levels.filter(l => !names.has(l.name)); });
      // ceux qui n'étaient pas dans le dépôt pour ce monde et ne sont nulle part ailleurs retournent dans « Mes niveaux »
      // ceux venus d'un autre monde du dépôt y retournent (à la fin)
      const homeless = w.levels.filter(l => {
        if (names.has(l.name)) return false;
        const from = repo.findIndex((rw, i) => i !== wi && rw.levels.some(x => x.name === l.name));
        if (from < 0 || from >= lib.length) return true;
        if (!lib[from].levels.some(x => x.name === l.name)) lib[from].levels.push(l);
        return false;
      });
      if (homeless.length) {
        const pool = custom.get();
        for (const l of homeless) if (!pool.some(c => c.name.toLowerCase() === l.name.toLowerCase())) pool.push({ name: l.name, map: l.map.slice(), savedAt: new Date().toISOString(), meta: { lot: l.lot, stage: l.stage, teach: l.teach, hint: l.hint } });
        custom.set(pool);
      }
      lib[wi] = back; sel = null; setMsg(wi, 'Monde remis comme dans le dépôt.'); changed();
    }
    if (act === 'delw') { lib.splice(wi, 1); sel = null; changed(); }
    if (act === 'solve') {
      if (solving) return;
      const todo = w.levels.filter(l => !checkMap(l.map).length && (l.solution === undefined || !replay(l.map, l.solution).won));
      if (!todo.length) { setMsg(wi, 'Toutes les solutions sont déjà là.'); return; }
      document.querySelectorAll('[data-act="solve"]').forEach(b => b.disabled = true);
      let ok = 0, fails = [];
      for (const [i, l] of todo.entries()) {
        setMsg(wi, 'Calcul ' + (i + 1) + '/' + todo.length + ' : « ' + l.name + ' »…');
        const map = l.map.slice(), r = await solveMap(map);
        if (typeof r.sol === 'string' && l.map.join('\n') === map.join('\n')) { l.solution = r.sol; ok++; persist(); }
        else fails.push(l.name + (r.unsolvable ? ' (impossible)' : r.over ? ' (trop d\'états)' : ''));
      }
      render();
      setMsg(wi, ok + ' solution' + (ok > 1 ? 's' : '') + ' calculée' + (ok > 1 ? 's' : '') + '.' + (fails.length ? ' ✗ ' + fails.join(', ') : ''));
    }
  }

  $('lib-newworld').onclick = () => {
    const n = lib.length + 1;
    lib.push({ world: 'Monde ' + n + ' · Nouveau monde', levels: [] });
    setMsg(lib.length - 1, 'Nouveau monde : il faudra ajouter l\'import de ' + fileOf(lib.length - 1) + ' dans packages/core/src/levels.js.');
    changed();
  };
  $('lib-reset').onclick = () => {
    if (!confirm('Abandonner tout le brouillon et revenir aux fichiers du dépôt ?')) return;
    lib = repo.map(cleanWorld); sel = null; for (const k in msgs) delete msgs[k]; changed();
  };
  $('lib-writeall').onclick = async () => {
    const wis = lib.map((_, wi) => wi).filter(modified); if (!wis.length) return;
    $('lib-writeall').disabled = true; await write(wis); render();
  };
  render();
  return { render };
}
