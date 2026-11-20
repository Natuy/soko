// Lab : jeu en version simple, mécaniques, principes et éditeur de niveaux.
// Les règles, le solveur et les niveaux viennent de packages/core : rien de tout ça n'est défini ici.
import { renderCharts } from './charts.js';
import { sticky, parseLevel, add, translate, step, teleportPlan, actionDir, teleport, isWin, applyMove, AN, LEVELS } from '../../../packages/core/src/index.js';

// Textes pédagogiques, rangés par nom de niveau (ils sont stockés avec chaque niveau dans /levels).
const TEXTS = Object.fromEntries(LEVELS.map(l => [l.name, { teach: l.teach, hint: l.hint }]));
const $ = id => document.getElementById(id);
let cur = 0, state, history, ents, idAt, nextId, solved = new Set(), busy = false, pending = [];
// progression enregistrée par nom de niveau, pour survivre aux ajouts et réorganisations
try { JSON.parse(localStorage.getItem('pz-solved-names') || '[]').forEach(n => solved.add(n)); } catch (e) {}
const isSolved = i => solved.has(LEVELS[i].name);

function tileSize(L) {
  const w = Math.max(...L.map.map(r => r.length)), h = L.map.length;
  // la place réelle de la colonne du plateau ; sur grand écran, le plateau peut occuper plus de hauteur
  const wide = window.innerWidth >= 960;
  // grand écran : la hauteur de la fenêtre moins l'en-tête de page et les contrôles, pour que tout tienne sans défiler
  const maxW = $('wrap').clientWidth || Math.min(window.innerWidth - 28, 612), maxH = Math.max(220, wide ? window.innerHeight - 420 : window.innerHeight * 0.48);
  return Math.floor(Math.min(maxW / w, maxH / h, wide ? 76 : 60));
}
const rc = k => k.split(',').map(Number);

// init : état de départ facultatif (la relecture se place ainsi au milieu d'une solution)
function build(init) {
  if (!rpKeep) rpEnd();
  const L = testLevel || LEVELS[cur];
  $('testbar').hidden = !testLevel;
  state = init || parseLevel(L.map); history = []; pending = [];
  ents = new Map(); idAt = new Map(); nextId = 0;
  const s0 = init ? parseLevel(L.map) : null, holes0 = s0 && s0.holes; // trous déjà comblés avant l'état de départ
  const T = tileSize(L), b = $('board');
  b.innerHTML = ''; b.style.setProperty('--t', T + 'px');
  b.classList.toggle('mir', state.mirrors); document.body.classList.toggle('mirmode', state.mirrors);
  b.style.width = state.w * T + 'px'; b.style.height = state.h * T + 'px';
  for (let r = 0; r < state.h; r++) for (let c = 0; c < state.w; c++) {
    const k = r + ',' + c, d = document.createElement('div');
    d.className = 'tile ' + (state.shattered.has(k) ? 'floor shattered' : state.glass.has(k) ? 'glass' : state.walls.has(k) ? 'wall' : state.holes.has(k) || (holes0 && holes0.has(k)) ? 'hole' + (state.holes.has(k) ? '' : ' filled') : state.defl.has(k) ? 'defl ' + (state.defl.get(k) === '/' ? 's' : 'b') : state.doors.has(k) ? 'door' : 'floor' + ((r + c) % 2 ? ' alt' : '') + (state.switches.has(k) ? ' switch' : '') + (state.plates.has(k) ? ' plate' : ''));
    d.dataset.k = k; d.style.left = c * T + 'px'; d.style.top = r * T + 'px';
    if (state.glass.has(k) || state.shattered.has(k)) d.dataset.glass = '1'; // vitre cassable : son aspect suit l'état
    b.appendChild(d);
  }
  const ex = document.createElement('div'); ex.className = 'exit-mark'; ex.id = 'exit';
  const [er, ec] = rc(state.exit); ex.style.left = ec * T + 'px'; ex.style.top = er * T + 'px'; b.appendChild(ex);
  for (const [k, v] of state.blocks) spawn(v, k, T);
  spawn('pl', state.player, T);
  const win = document.createElement('div'); win.className = 'win'; win.id = 'win';
  win.innerHTML = '<div>Sortie atteinte !<br><button id="nextbtn">Niveau suivant →</button></div>';
  b.appendChild(win);
  $('nextbtn').onclick = () => go(Math.min(cur + 1, LEVELS.length - 1));
  if (cur === LEVELS.length - 1) $('nextbtn').textContent = 'Recommencer';
  if (cur === LEVELS.length - 1) $('nextbtn').onclick = () => go(cur);
  if (testLevel) { $('nextbtn').textContent = '← Retour à l\'éditeur'; $('nextbtn').onclick = () => showTab('edit'); }
  $('lvname').textContent = testLevel ? L.name : (cur + 1) + '. ' + L.name;
  $('lvstage').textContent = testLevel ? 'Éditeur' : L.world.split(' · ')[0] + ' · ' + L.lot + (L.stage ? ' · ' + L.stage : '');
  const t = TEXTS[L.name] || { teach: ['Niveau en cours d\'édition : joue-le pour vérifier qu\'il fonctionne comme prévu.'], hint: 'Utilise le bouton « Résoudre » de l\'éditeur.' };
  $('teach').innerHTML = t.teach.map(p => '<p>' + p + '</p>').join('');
  $('hint').textContent = t.hint; $('hintbox').open = false;
  $('solbtn').hidden = !!testLevel || !L.solution;
  if (!testLevel) viewWorld = WORLDS.indexOf(L.world);
  renderLevels(); updateMeta();
  if (init && isWin(state)) $('win').classList.add('on');
}

function spawn(v, k, T) {
  const cls = v === 'pl' ? 'pl' : v[0] === 'S' ? 'sq' : v[0] === 'R' ? 'rd' : v === 'B' ? 'br' : v[0] === 'M' ? 'mi' : v === 'I' ? 'im' : 'hf';
  const id = nextId++, d = document.createElement('div');
  d.className = 'ent ' + cls; d.innerHTML = '<div class="body"></div>' + (cls === 'pl' ? '<div class="dir"><i></i></div>' : '');
  const [r, c] = rc(k); d.style.transform = `translate(${c * T}px, ${r * T}px)`; d.style.transitionDuration = '0s';
  if (cls === 'hf') d.firstChild.style.rotate = { '>': '0deg', 'v': '90deg', '<': '180deg', '^': '-90deg' }[v[1]];
  if (v === 'Mh' || v === 'Mv' || v === 'Mz') d.classList.add(v.toLowerCase());
  $('board').appendChild(d); ents.set(id, d);
  if (cls === 'pl') idAt.set('player', id); else idAt.set(k, id);
}

function place(el, k, dist) {
  const T = parseFloat($('board').style.getPropertyValue('--t'));
  const [r, c] = rc(k);
  el.style.transitionDuration = Math.min(0.06 + dist * 0.055, 0.45) + 's';
  el.style.transform = `translate(${c * T}px, ${r * T}px)`;
}
const dist = (a, b) => { const [r1, c1] = rc(a), [r2, c2] = rc(b); return Math.abs(r1 - r2) + Math.abs(c1 - c2); };

async function animate(events, bump) {
  busy = true; $('board').classList.add('anim'); clearGhosts();
  if (bump !== undefined) { const el = ents.get(idAt.get(bump)); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  for (const e of events) {
    if (e.type === 'player') { place(ents.get(idAt.get('player')), e.to, 1); continue; }
    if (e.type === 'break' && e.glass) { const t = document.querySelector(`#board .tile[data-k="${e.at}"]`); t.classList.add('shatter'); await wait(150); t.classList.remove('shatter'); syncGlass(); continue; }
    if (e.type === 'break') { const bid = idAt.get(e.at); idAt.delete(e.at); ents.get(bid).classList.add('broken'); await wait(120); continue; }
    if (e.type === 'vanish') { const vid = idAt.get(e.at); idAt.delete(e.at); ents.get(vid).classList.add('gone'); document.querySelector(`.tile[data-k="${e.at}"]`).classList.add('filled'); continue; }
    if (e.type === 'multi') {
      const items = e.moves.map(m => ({ id: idAt.get(m.from), ...m }));
      items.forEach(m => idAt.delete(m.from));
      const dd = Math.max(...items.map(m => dist(m.from, m.to)));
      items.forEach(m => { place(ents.get(m.id), m.to, dd); idAt.set(m.to, m.id); });
      if (dd > 1) await wait(Math.min(0.06 + dd * 0.055, 0.45) * 900); else await wait(90);
      continue;
    }
    if (e.type === 'tp') {
      const items = e.moves.map(m => ({ id: m.player ? idAt.get('player') : idAt.get(m.from), ...m }));
      items.forEach(m => { if (!m.player) idAt.delete(m.from); ents.get(m.id).classList.add('tpfade'); });
      await wait(170);
      const T = parseFloat($('board').style.getPropertyValue('--t'));
      items.forEach(m => {
        const el = ents.get(m.id), [r, c] = rc(m.to);
        el.style.transitionDuration = '0s'; el.style.transform = `translate(${c * T}px, ${r * T}px)`;
        if (m.player) return;
        if (m.fill) { el.classList.add('gone'); document.querySelector(`.tile[data-k="${m.to}"]`).classList.add('filled'); }
        else idAt.set(m.to, m.id);
      });
      void $('board').offsetWidth;
      items.forEach(m => ents.get(m.id).classList.remove('tpfade'));
      await wait(170);
      continue;
    }
    const id = idAt.get(e.from), el = ents.get(id), dd = dist(e.from, e.to);
    idAt.delete(e.from);
    place(el, e.to, dd);
    if (e.type === 'move') idAt.set(e.to, id);
    if (e.kind === 'R' && dd > 1 || e.type === 'fill') await wait(Math.min(0.06 + dd * 0.055, 0.45) * 1000 * 0.9);
    if (e.type === 'fill') { el.classList.add('gone'); document.querySelector(`.tile[data-k="${e.to}"]`).classList.add('filled'); }
  }
  $('board').classList.remove('anim');
  busy = false;
  if (pending.length) { const p = pending.shift(); setTimeout(p, 0); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

function snapshot() {
  return { state, idAt: new Map(idAt), filled: [...document.querySelectorAll('.tile.filled')].map(t => t.dataset.k) };
}

async function move(d, fromRp) {
  if (!fromRp && rp) rpEnd();
  if (busy) { if (pending.length < 4) pending.push(() => move(d)); return; } // appuis gardés pendant une animation
  if (isWin(state)) return;
  const r = step(state, d);
  if (!r) return;
  history.push(snapshot());
  state = r.state;
  await animate(r.events, r.bump);
  updateMeta();
  if (isWin(state)) {
    if (!testLevel) { solved.add(LEVELS[cur].name); try { localStorage.setItem('pz-solved-names', JSON.stringify([...solved])); } catch (e) {} }
    renderLevels(); setTimeout(() => $('win').classList.add('on'), 150);
  }
}

async function action(fromRp) {
  if (!fromRp && rp) rpEnd();
  if (busy) { if (pending.length < 4) pending.push(() => action()); return; }
  if (isWin(state) || !state.mirrors) return;
  const ad = actionDir(state), r = ad && teleport(state, ad);
  if (!r) { const el = ents.get(idAt.get('player')); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); return; }
  history.push(snapshot());
  state = r.state;
  await animate(r.events);
  updateMeta();
  if (isWin(state)) {
    if (!testLevel) { solved.add(LEVELS[cur].name); try { localStorage.setItem('pz-solved-names', JSON.stringify([...solved])); } catch (e) {} }
    renderLevels(); setTimeout(() => $('win').classList.add('on'), 150);
  }
}

function undo(fromRp) {
  if (busy || !history.length) return;
  if (!fromRp && rp) rpEnd();
  const s = history.pop();
  state = s.state; idAt = s.idAt;
  document.querySelectorAll('.tile.filled').forEach(t => { if (!s.filled.includes(t.dataset.k)) t.classList.remove('filled'); });
  const alive = new Set(idAt.values());
  for (const [id, el] of ents) {
    if (!alive.has(id)) { el.classList.add('gone'); continue; }
    el.classList.remove('gone', 'broken', 'tpfade');
  }
  for (const [k, id] of idAt) place(ents.get(id), k === 'player' ? state.player : k, 1);
  $('win').classList.remove('on'); updateMeta();
}

// Les vitres brisées deviennent du sol (et reviennent après une annulation)
function syncGlass() {
  document.querySelectorAll('#board .tile[data-glass]').forEach(t => {
    const intact = state.glass.has(t.dataset.k);
    t.classList.toggle('glass', intact); t.classList.toggle('floor', !intact); t.classList.toggle('shattered', !intact);
  });
}
function clearGhosts() { document.querySelectorAll('.ghost').forEach(g => g.remove()); }
function updateMeta() {
  const T = parseFloat($('board').style.getPropertyValue('--t')), b = $('board');
  for (const [k, id] of idAt) if (k !== 'player') { const el = ents.get(id); el.classList.toggle('sticky', (state.blocks.get(k) || '').endsWith('*')); el.classList.toggle('float', state.holes.has(k)); }
  b.querySelectorAll('.link').forEach(l => l.remove());
  for (const e of state.glue) {
    const [p, q] = e.split('|').map(rc), l = document.createElement('div'); l.className = 'link';
    if (p[0] === q[0]) { l.style.left = (Math.min(p[1], q[1]) * T + T / 2) + 'px'; l.style.top = (p[0] * T + T * 0.41) + 'px'; l.style.width = T + 'px'; l.style.height = (T * 0.18) + 'px'; }
    else { l.style.top = (Math.min(p[0], q[0]) * T + T / 2) + 'px'; l.style.left = (p[1] * T + T * 0.41) + 'px'; l.style.height = T + 'px'; l.style.width = (T * 0.18) + 'px'; }
    b.appendChild(l);
  }

  clearGhosts();
  if (state.mirrors && !isWin(state)) {
    const ad = actionDir(state), tp = ad && teleportPlan(state, ad);
    if (tp) for (const m of tp.plan) {
      const g = document.createElement('div'), [r, c] = rc(m.to);
      g.className = 'ghost' + (m.player ? '' : ' blk'); g.style.left = c * T + 'px'; g.style.top = r * T + 'px'; b.appendChild(g);
    }
  }
  $('moves').textContent = rp ? rp.i + ' / ' + rp.sol.length : history.length + ' coup' + (history.length > 1 ? 's' : '');
  $('exit').classList.toggle('covered', state.blocks.has(state.exit));
  syncGlass();
  document.querySelectorAll('.door').forEach(t => t.classList.toggle('open', state.open));
  document.querySelectorAll('.switch, .plate').forEach(t => t.classList.toggle('on', state.player === t.dataset.k || state.blocks.has(t.dataset.k)));
}


// Onglet « Mécaniques » : règle, ce que ça permet, niveaux
const SW = {
  carre: 'background:var(--square)', trou: 'background:var(--hole)', sortie: 'border:2px dashed var(--exit)',
  rond: 'background:var(--round);border-radius:50%', pendule: 'background:radial-gradient(circle at 30% 50%,var(--round) 0 28%,transparent 30%),radial-gradient(circle at 72% 50%,var(--round) 0 28%,transparent 30%)',
  defl: 'background:linear-gradient(135deg,transparent 40%,#6b5d50 40% 60%,transparent 60%)',
  inter: 'border:3px solid var(--sw);border-radius:50%', demi: 'background:linear-gradient(90deg,var(--half-d) 0 25%,var(--half) 25%);clip-path:polygon(0 0,52% 0,100% 50%,52% 100%,0 100%)',
  cassant: 'background:var(--glass)', colle: 'background:radial-gradient(circle at 35% 40%,#8cc63f 0 18%,transparent 20%),radial-gradient(circle at 70% 65%,#8cc63f 0 16%,transparent 18%),var(--square)',
  essieu: 'background:radial-gradient(circle at 50% 25%,var(--round) 0 22%,transparent 24%),radial-gradient(circle at 50% 75%,var(--round) 0 22%,transparent 24%),linear-gradient(90deg,transparent 42%,#7aa63a 42% 58%,transparent 58%)',
  miroir: 'background:linear-gradient(135deg,#f4f8fb,#a9b9c6 45%,#fff 55%,#8a9aa8);box-shadow:inset 0 0 0 2px #6d7d8a', inam: 'background:#555a62',
  mligne: 'background:linear-gradient(0deg,transparent 40%,#4d5b67 40% 60%,transparent 60%),linear-gradient(135deg,#f4f8fb,#a9b9c6 45%,#fff 55%,#8a9aa8);box-shadow:inset 0 0 0 2px #6d7d8a',
  vitre: 'background:linear-gradient(135deg,transparent 30%,#fff 31% 38%,transparent 39%),#cfe4ee;box-shadow:inset 0 0 0 2px rgba(80,150,190,.7)',
  mz: 'background:linear-gradient(135deg,#f4f8fb,#a9b9c6 45%,#fff 55%,#8a9aa8);box-shadow:inset 0 0 0 3px var(--sw)',
};
const MECHS = [
  { w: 0, name: 'Le carré', sw: 'carre',
    regle: ["Se pousse d'une case.", "On ne pousse qu'un seul bloc à la fois : deux blocs alignés se bloquent."],
    permet: ['Des obstacles à contourner ou à dégager.', 'Des blocages définitifs : un carré dans un coin, ou poussé sur la sortie contre un mur.', 'La butée : un bloc posé arrête un rond pile au bon endroit.'],
    levels: ['Pousser', 'Deux blocs, une rangée', 'La butée', 'Butée mobile', 'Convoi'] },
  { w: 0, name: 'Le trou', sw: 'trou',
    regle: ['Bloque le joueur.', 'Tout bloc qui y entre le comble : la case devient un sol normal.'],
    permet: ['Les blocs deviennent une ressource à compter.', "L'ordre compte : chaque trou comblé ouvre un passage, au joueur comme aux blocs suivants."],
    levels: ['Premier pont', 'Deux blocs, une rangée', 'Viser plus loin'] },
  { w: 0, name: 'La sortie', sw: 'sortie',
    regle: ['Atteindre la sortie termine le niveau.', "Elle reste visible même quand un bloc la recouvre."],
    permet: ['Des niveaux où la sortie est occupée au départ et doit être dégagée.', 'Un piège classique : pousser un bloc sur la sortie, contre un mur.'],
    levels: ['Pousser', 'Sortie occupée', 'Le verrou'] },
  { w: 0, name: 'Le rond', sw: 'rond',
    regle: ["Roule jusqu'au premier obstacle (mur, bloc, joueur) : le joueur peut servir de butée. C'est la case où le joueur arrive après son coup qui compte : en poussant un rond, il avance sur la case que le rond vient de quitter.", 'Tombe dans le premier trou de sa route.'],
    permet: ['Déplacer un bloc loin en un seul geste.', "Des puzzles de placement : un rond ne s'arrête jamais dans le vide, il faut des murs ou une butée.", "Remplir les trous dans l'ordre, du plus proche au plus loin."],
    levels: ['Ça roule', 'Le premier trou', 'Labyrinthe glissant', 'La butée', 'Butée mobile', 'Viser plus loin', 'Atelier'] },
  { w: 0, name: 'Le pendule', sw: 'pendule',
    regle: ["Un rond qui en frappe un autre s'arrête juste devant, et c'est le dernier rond de la file qui part.", 'Pousser un rond collé à un autre : le joueur ne bouge pas.'],
    permet: ["Déplacer un rond qu'on ne peut pas atteindre.", 'Placer précisément le rond qui frappe.', "Agir sans quitter sa case, par exemple en restant sur un interrupteur."],
    levels: ['Pendule', 'File de trois', 'Frapper pour placer', 'Sortie occupée', "Retour à l'envoyeur", 'Sans bouger'] },
  { w: 0, name: 'Le déflecteur', sw: 'defl',
    regle: ['Fixe : bloque le joueur et les blocs poussés.', "Un rond qui l'atteint tourne de 90° et continue. Si la sortie du virage est bloquée, il s'arrête devant.", "Le pendule traverse le virage."],
    permet: ['Envoyer un rond là où le joueur ne peut pas le pousser.', 'Des demi-tours et des tirs indirects, par exemple pour briser un cassant hors d\'atteinte.'],
    levels: ['Virage', 'Deux virages', "Retour à l'envoyeur", 'Pendule en virage', 'Coup de billard', 'Rond voyageur', 'Ricochet'] },
  { w: 0, name: 'Interrupteur et porte', sw: 'inter',
    regle: ['Les portes sont ouvertes tant que tous les interrupteurs sont pressés, par le joueur ou par un bloc arrêté dessus.', 'Un rond qui ne fait que passer ne compte pas.', "La porte se ferme dès que l'interrupteur est libéré, sauf si quelqu'un est dans l'encadrement."],
    permet: ["Le joueur ne peut pas presser et passer : il faut y laisser un bloc.", 'Une porte fermée bloque aussi le regard des miroirs : elle sert de volet.', "Arrêter un rond pile sur l'interrupteur grâce à une butée.", "Combiner avec le pendule pour agir sans quitter l'interrupteur."],
    levels: ['Interrupteur', "Le rond ne s'arrête pas", 'Sans bouger', 'Ricochet', "Décaler l'essieu", 'Essieu et interrupteur', 'Double reflet', 'Volet'] },
  { w: 1, name: 'Le demi-carré', sw: 'demi',
    regle: ["Ne se pousse que par sa face plate (le côté foncé) : il n'avance que dans le sens de sa pointe.", 'Peut boucher un trou.'],
    permet: ['Des choix irréversibles : impossible de le ramener.', 'Des pièges : mal poussé, il bouche un couloir pour toujours.', "Imposer une rangée ou une colonne, et une butée qu'on ne place que dans un sens."],
    levels: ['Face plate', 'Le mauvais demi', 'La rangée imposée', 'Trois sens', 'Butée à sens unique', 'Le choc suffit', 'Atelier'] },
  { w: 1, name: 'Le bloc cassant', sw: 'cassant',
    regle: ['Se pousse comme un carré et peut boucher un trou.', "Un rond qui le percute s'arrête devant et le brise, même collé à lui si on le pousse. Rien d'autre ne le casse.", "Cette propriété cassante n'est pas réservée à ce bloc : le mur transparent l'a aussi (monde 5)."],
    permet: ['Une butée à usage unique.', 'Un verrou impossible à déplacer sans tout bloquer, à briser de loin.', 'Libérer un bloc qui lui est collé.'],
    levels: ['Une seule fois', 'Le verrou', 'Coup de billard', 'Pont ou butée', 'Le choc suffit', 'Atelier', 'Détacher'] },
  { w: 2, name: 'Le bloc collant', sw: 'colle',
    regle: ["Carré ou rond, il se colle à tous les blocs qu'il touche au même moment (pas aux murs), puis perd sa colle.", "Un rond qui roule s'agrippe à un bloc collant qu'il frôle, et inversement.", "Un groupe se pousse comme un carré. Il passe au-dessus d'un trou et ne tombe que s'il est entièrement au-dessus du vide.", 'Le joueur ne peut pas pousser un bloc suspendu au-dessus du vide.'],
    permet: ['Pousser plusieurs blocs à la fois.', 'Faire traverser des trous à un bloc.', 'Une butée sur le côté du trajet d\'un rond.', 'Des pièges : collé, un bloc ne peut plus boucher un trou seul.'],
    levels: ['Ça colle', 'Ne pas toucher', 'Pont volant', 'Détacher', 'Butée sur le côté', 'Convoi', 'Séparer'] },
  { w: 2, name: "L'essieu", sw: 'essieu',
    regle: ['Des ronds collés côte à côte, poussés dans la largeur, roulent ensemble. Poussés dans la longueur, ils glissent d\'une case comme un carré.', "Il s'arrête dès qu'une bille rencontre un obstacle, et contre un déflecteur.", 'Il lance tous les ronds qu\'il frappe. Contre un rond et un carré, seul le rond part.'],
    permet: ['Faire franchir des trous à des ronds.', 'Placer finement un essieu avant de le lancer.', 'Former un essieu en plein trajet, en frôlant un rond collant.'],
    levels: ['Essieu', 'Dans la longueur', 'Au passage', "Décaler l'essieu", 'Essieu et interrupteur', 'Convoi'] },
  { w: 3, name: 'Le miroir', sw: 'miroir',
    regle: ["Un bloc poussable. Le bouton d'action téléporte par le miroir aligné avec le joueur (même ligne ou même colonne, sans mur entre les deux). Si plusieurs miroirs sont alignés, rien ne se passe.", "Le joueur et tous les blocs entre lui et le miroir passent de l'autre côté, chacun à la même distance.", "Si une case d'arrivée est interdite (mur, bloc, trou pour le joueur), rien ne part. Un bloc qui arrive sur un trou le bouche, et ses liens avec ce qui reste sont rompus."],
    permet: ['Franchir murs et trous.', "Régler le point d'arrivée en déplaçant le miroir.", 'Emporter des blocs de l\'autre côté, ou séparer un groupe collé.'],
    levels: ['Miroir', 'Régler la distance', 'Bagages', 'Rond voyageur', 'Inamovible', 'Séparer', 'Double reflet'] },
  { w: 3, name: 'Miroirs de ligne et de colonne', sw: 'mligne',
    regle: ["Le miroir de ligne (barre horizontale) ne fonctionne que dans sa ligne, le miroir de colonne (barre verticale) que dans sa colonne.", "Dans l'autre sens, c'est un bloc ordinaire : il part dans le faisceau d'un autre miroir.", "Comme pour le miroir simple, si le joueur est aligné avec plusieurs miroirs utilisables, rien ne se passe."],
    permet: ['Choisir exactement dans quel sens un miroir agit.', "Emporter un miroir de l'autre côté d'un mur pour s'en servir ensuite.", "Des croisements où deux miroirs s'annulent et où il faut en écarter un."],
    levels: ['Ligne ou colonne', 'Miroir en bagage', 'Croisement'] },
  { w: 3, name: 'Le mur transparent', sw: 'vitre',
    regle: ['Arrête le joueur et les blocs poussés, comme un mur.', "Ne bloque pas le regard des miroirs : le faisceau du bouton d'action et celui du miroir à interrupteur le traversent.", "Il est cassant, comme le bloc cassant : un rond qui le percute s'arrête devant et le brise. La case devient un sol libre. Rien d'autre ne le casse."],
    permet: ["Mettre un bloc ou un miroir hors d'atteinte, tout en le laissant visible.", 'Téléporter à travers une vitre ce que le joueur ne peut pas toucher.', "Des pièges : un miroir derrière une vitre rend une case ambiguë.", "Un passage qu'un rond peut ouvrir, et une butée à usage unique (monde 5)."],
    levels: ['Vitre', 'Prisonnier', 'Trop de reflets', 'Aller-retour', 'Deux pressions', 'Vitrine', 'Bris de verre', 'Deux usages', 'Place nette', 'Sous verre'] },
  { w: 3, name: 'Le bloc inamovible', sw: 'inam',
    regle: ['Ne se pousse dans aucune direction.', 'Seule la téléportation peut le déplacer.'],
    permet: ['Amener un bloc sur un interrupteur ou dans un trou sans jamais le pousser.'],
    levels: ['Inamovible', 'Prisonnier', 'Double reflet', 'Commande à distance', 'Sous verre'] },
  { w: 4, name: 'Miroir à interrupteur', sw: 'mz',
    regle: ["Il ne réagit pas au bouton d'action. Il se déclenche quand un interrupteur de miroir (losange) vient d'être pressé, par le joueur ou par un bloc arrêté dessus.", "Tout ce qui est dans sa ligne et sa colonne, sans mur entre les deux, passe de l'autre côté à la même distance, joueur compris. Si une case d'arrivée est interdite, rien ne part.", "Il se déclenche à chaque nouvelle pression : relâcher puis presser à nouveau renvoie tout de l'autre côté.", 'Une porte fermée arrête son regard, comme un mur.'],
    permet: ['Déplacer des blocs à distance, sans être dans le faisceau.', 'Un losange placé dans sa ligne : le bloc qui le presse part aussi.', "Une porte fermée lui cache ce qu'il y a derrière : ouvrir la porte change ce qu'il voit.", 'Téléporter le joueur sans bouton, au moment où un bloc se pose.', 'Placer un bloc inamovible ou atteindre des cases interdites aux poussées.'],
    levels: ['Reflet à distance', 'Seul un bloc arrêté', 'Devant le miroir', 'Échange', 'Aller-retour', 'Deux pressions', 'Commande à distance', 'Volet', 'Vitrine', 'Sous verre'] },
];
function renderMechs() {
  const root = $('mechs'); root.innerHTML = '';
  let w = -1;
  for (const m of MECHS) {
    if (m.w !== w) { w = m.w; const hd = document.createElement('div'); hd.className = 'mw'; hd.textContent = WORLDS_LIST()[w]; root.appendChild(hd); }
    const c = document.createElement('div'); c.className = 'card mech';
    c.innerHTML = `<h3><i class="sw" style="${SW[m.sw]}"></i>${m.name}</h3>
      <h4>Règle</h4><ul>${m.regle.map(x => '<li>' + x + '</li>').join('')}</ul>
      <h4>Ce que ça permet</h4><ul>${m.permet.map(x => '<li>' + x + '</li>').join('')}</ul>
      <h4>Niveaux</h4><div class="chips"></div>`;
    const ch = c.querySelector('.chips');
    for (const n of m.levels) {
      const i = LEVELS.findIndex(l => l.name === n); if (i < 0) continue;
      const b = document.createElement('button'); b.textContent = (i + 1) + '. ' + n;
      b.onclick = () => { showTab('play'); go(i); scrollTo(0, 0); };
      ch.appendChild(b);
    }
    root.appendChild(c);
  }
}
const WORLDS_LIST = () => [...new Set(LEVELS.map(l => l.world))];

const WORLDS = [...new Set(LEVELS.map(l => l.world))];
let viewWorld = 0, navOpen = window.innerWidth > 640;
function renderLevels() {
  const wEl = $('worlds'); wEl.innerHTML = '';
  WORLDS.forEach((w, wi) => {
    const idx = LEVELS.map((l, i) => l.world === w ? i : -1).filter(i => i >= 0);
    const b = document.createElement('button');
    b.className = (wi === viewWorld ? 'on ' : '') + (LEVELS[cur].world === w ? 'has' : '');
    b.innerHTML = '<b>' + (window.innerWidth < 420 ? 'M' : 'Monde ') + (wi + 1) + '</b><small>' + idx.filter(isSolved).length + ' / ' + idx.length + '</small>';
    b.title = w; b.onclick = () => { navOpen = wi === viewWorld ? !navOpen : true; viewWorld = wi; renderLevels(); };
    wEl.appendChild(b);
  });
  const lEl = $('lots'); lEl.classList.toggle('closed', !navOpen);
  lEl.innerHTML = '<div class="wname"><span>' + WORLDS[viewWorld].split(' · ')[1] + '</span><i>twist</i></div>';
  $('navtog').textContent = navOpen ? 'Masquer la liste ▴' : 'Afficher les niveaux du monde ' + (viewWorld + 1) + ' ▾';
  let row = null, lot = null;
  LEVELS.forEach((L, i) => {
    if (L.world !== WORLDS[viewWorld]) return;
    if (L.lot !== lot) { lot = L.lot; row = document.createElement('div'); row.className = 'lotrow'; row.innerHTML = '<span>' + lot + '</span><div class="chips"></div>'; lEl.appendChild(row); }
    const b = document.createElement('button'); b.textContent = i + 1;
    b.className = (i === cur ? 'cur ' : '') + (isSolved(i) ? 'done ' : '') + (L.stage === 'Twist' ? 'tw' : '');
    b.title = L.name + (L.stage ? ' (' + L.stage + ')' : ''); b.onclick = () => { if (window.innerWidth <= 640) navOpen = false; go(i); };
    row.lastChild.appendChild(b);
  });
  $('prev').disabled = cur === 0; $('next').disabled = cur === LEVELS.length - 1;
}

function go(i) { pending = []; testLevel = null; cur = i; try { location.hash = 'niveau-' + (i + 1); } catch (e) {} build(); }

document.querySelectorAll('.pad button').forEach(b => b.addEventListener('click', () => move(b.dataset.d)));
$('undo').onclick = () => undo(); $('reset').onclick = () => build(); $('act').onclick = () => action();
$('navtog').onclick = () => { navOpen = !navOpen; renderLevels(); };
$('prev').onclick = () => { if (cur > 0) go(cur - 1); };
$('next').onclick = () => { if (cur < LEVELS.length - 1) go(cur + 1); };
addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if (!$('tab-edit').hidden) { edKey(e); return; }
  if ($('tab-play').hidden) return;
  if (rp && rpKey(e)) return;
  if (e.key === 'u' || (e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'Backspace') { e.preventDefault(); undo(); return; }
  const m = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', z: 'up', q: 'left' }[e.key];
  if (m) { e.preventDefault(); move(m); }
  else if (e.key === ' ' || e.key === 'e' || e.key === 'Enter') { e.preventDefault(); action(); }
  else if (e.key === 'r') build();
  else if (e.key === 'n' || e.key === ']' || e.key === 'PageDown') { if (cur < LEVELS.length - 1) go(cur + 1); }
  else if (e.key === 'p' || e.key === '[' || e.key === 'PageUp') { if (cur > 0) go(cur - 1); }
});
let t0 = null;
$('wrap').addEventListener('pointerdown', e => { t0 = [e.clientX, e.clientY]; });
$('wrap').addEventListener('pointerup', e => {
  if (!t0) return; const dx = e.clientX - t0[0], dy = e.clientY - t0[1]; t0 = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
  move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});
// Redimensionnement : on redessine le plan de l'éditeur, et le plateau s'il n'a pas encore été joué
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!history.length && !rp) build(); if (!$('tab-edit').hidden) edRender(true); if (!$('tab-table').hidden) tblRender(); }, 200); });
function showTab(name) {
  for (const n of ['play', 'mech', 'princ', 'ideas', 'edit', 'table']) { $('tab-' + n).hidden = n !== name; $('tb-' + n).classList.toggle('on', n === name); }
  if (name !== 'play' && rp) { rp.playing = false; rpUI(); }
  if (name === 'edit') { edRender(true); if (!testLevel) $('ed-load').value = cur; }
  if (name === 'table') tblRender();
  try { location.hash = name === 'table' ? 'tableau' : name === 'ideas' ? 'idees' : name === 'mech' ? 'mecaniques' : name === 'princ' ? 'principes' : name === 'edit' ? 'editeur' : testLevel ? 'editeur-test' : 'niveau-' + (cur + 1); } catch (e) {}
}
$('tb-ideas').onclick = () => showTab('ideas');
$('tb-mech').onclick = () => showTab('mech');
$('tb-princ').onclick = () => showTab('princ');
$('tb-edit').onclick = () => showTab('edit');
$('tb-table').onclick = () => showTab('table');
$('tb-play').onclick = () => { showTab('play'); if (!history.length) build(); };
// Onglet « Éditeur » : dessiner un niveau, le tester, le résoudre, l'évaluer et l'ajuster automatiquement
const ED_TOOLS = [
  ['Base', [['#', 'Mur'], ['.', 'Sol'], ['O', 'Trou'], ['E', 'Sortie'], ['P', 'Joueur']]],
  ['Monde 1', [['S', 'Carré'], ['R', 'Rond'], ['/', 'Déflecteur /'], ['\\', 'Déflecteur \\'], ['+', 'Interrupteur'], ['D', 'Porte']]],
  ['Monde 2', [['^', 'Demi-carré ↑'], ['>', 'Demi-carré →'], ['v', 'Demi-carré ↓'], ['<', 'Demi-carré ←'], ['B', 'Bloc cassant']]],
  ['Monde 3', [['C', 'Carré collant'], ['G', 'Rond collant']]],
  ['Monde 4', [['M', 'Miroir'], ['=', 'Miroir de ligne'], ['!', 'Miroir de colonne'], ['I', 'Bloc inamovible'], ['T', 'Mur transparent']]],
  ['Monde 5', [['Z', 'Miroir à interrupteur'], ['%', 'Interrupteur de miroir']]],
];
let edMap = null, edTool = '#', edMarks = [], edWorker = null, edBusy = null, edLast = null, testLevel = null;
// historique du plan : chaque entrée est un plan complet (tableau de lignes) ; un glisser compte pour un seul geste
let edPast = [], edFuture = [], edStroke = null;
try { const s = JSON.parse(localStorage.getItem('pz-editor') || 'null'); if (s && Array.isArray(s.map)) edMap = s.map; } catch (e) {}
if (!edMap || !edMap.length) edMap = ['#########', '#.......#', '#P.S..OE#', '#.......#', '#########'];

// Dessin statique d'un plan (mêmes visuels que le jeu)
function drawStatic(el, map, T, marks) {
  let s; try { s = parseLevel(map); } catch (e) { el.innerHTML = ''; return; }
  const W = Math.max(...map.map(r => r.length)), H = map.length;
  el.innerHTML = ''; el.style.setProperty('--t', T + 'px'); el.style.width = W * T + 'px'; el.style.height = H * T + 'px';
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const k = r + ',' + c, d = document.createElement('div');
    d.className = 'tile ' + (s.glass.has(k) ? 'glass' : s.walls.has(k) || map[r][c] === undefined ? 'wall' : s.holes.has(k) ? 'hole' : s.defl.has(k) ? 'defl ' + (s.defl.get(k) === '/' ? 's' : 'b') : s.doors.has(k) ? 'door' + (s.open ? ' open' : '') : 'floor' + ((r + c) % 2 ? ' alt' : '') + (s.switches.has(k) ? ' switch' : '') + (s.plates.has(k) ? ' plate' : ''));
    d.style.left = c * T + 'px'; d.style.top = r * T + 'px'; el.appendChild(d);
  }
  if (s.exit) { const ex = document.createElement('div'); ex.className = 'exit-mark' + (s.blocks.has(s.exit) ? ' covered' : ''); const [r, c] = rc(s.exit); ex.style.left = c * T + 'px'; ex.style.top = r * T + 'px'; el.appendChild(ex); }
  const ent = (v, k) => {
    const cls = v === 'pl' ? 'pl' : v[0] === 'S' ? 'sq' : v[0] === 'R' ? 'rd' : v === 'B' ? 'br' : v[0] === 'M' ? 'mi' : v === 'I' ? 'im' : 'hf';
    const d = document.createElement('div'); d.className = 'ent ' + cls; d.innerHTML = '<div class="body"></div>';
    const [r, c] = rc(k); d.style.transform = `translate(${c * T}px, ${r * T}px)`; d.style.transitionDuration = '0s';
    if (cls === 'hf') d.firstChild.style.rotate = { '>': '0deg', 'v': '90deg', '<': '180deg', '^': '-90deg' }[v[1]];
    if (v === 'Mh' || v === 'Mv' || v === 'Mz') d.classList.add(v.toLowerCase());
    if (v.endsWith('*')) d.classList.add('sticky');
    if (s.holes.has(k)) d.classList.add('float');
    el.appendChild(d);
  };
  for (const [k, v] of s.blocks) ent(v, k);
  if (s.player) ent('pl', s.player);
  for (const e of s.glue) {
    const [p, q] = e.split('|').map(rc), l = document.createElement('div'); l.className = 'link';
    if (p[0] === q[0]) { l.style.left = (Math.min(p[1], q[1]) * T + T / 2) + 'px'; l.style.top = (p[0] * T + T * 0.41) + 'px'; l.style.width = T + 'px'; l.style.height = (T * 0.18) + 'px'; }
    else { l.style.top = (Math.min(p[0], q[0]) * T + T / 2) + 'px'; l.style.left = (p[1] * T + T * 0.41) + 'px'; l.style.height = T + 'px'; l.style.width = (T * 0.18) + 'px'; }
    el.appendChild(l);
  }
  for (const m of marks || []) { const d = document.createElement('div'); d.className = 'ed-mark' + (m.cls ? ' ' + m.cls : ''); d.title = m.title || ''; d.style.left = m.c * T + 'px'; d.style.top = m.r * T + 'px'; el.appendChild(d); }
}

const edT = () => {
  const W = edMap[0].length, H = edMap.length, wide = window.innerWidth >= 960;
  const maxW = $('ed-board').parentElement.clientWidth || Math.min(window.innerWidth - 28, 612);
  return Math.floor(Math.min(maxW / W, Math.max(260, window.innerHeight * (wide ? 0.6 : 0.55)) / H, wide ? 58 : 46));
};
function edSave() { try { localStorage.setItem('pz-editor', JSON.stringify({ map: edMap })); } catch (e) {} }
function edRender(keepResults) {
  drawStatic($('ed-board'), edMap, edT(), edMarks);
  $('ed-text').value = edMap.join('\n');
  $('ed-size').textContent = edMap[0].length + ' × ' + edMap.length;
  const errs = AN.checkMap(edMap);
  $('ed-errors').innerHTML = errs.map(e => '<p>⚠ ' + e + '</p>').join('');
  $('ed-errors').hidden = !errs.length;
  if (!keepResults) { edMarks = []; }
  edSave();
}
function edChanged() { edMarks = []; $('ed-board').querySelectorAll('.ed-mark').forEach(m => m.remove()); edRender(true); $('ed-results').classList.add('stale'); edHistUI(); liveSchedule(); }
// Remplace le plan en gardant l'ancien dans l'historique
function edSet(m) { if (m.join('\n') === edMap.join('\n')) return; edPush(edMap); edMap = m; edChanged(); }
function edPush(prev) { edPast.push(prev); if (edPast.length > 300) edPast.shift(); edFuture = []; }
function edUndo() { if (!edPast.length) return; edFuture.push(edMap); edMap = edPast.pop(); edChanged(); }
function edRedo() { if (!edFuture.length) return; edPast.push(edMap); edMap = edFuture.pop(); edChanged(); }
function edHistUI() { $('ed-undo').disabled = !edPast.length; $('ed-redo').disabled = !edFuture.length; }
function edKey(e) {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); if (e.shiftKey) edRedo(); else edUndo(); }
  else if (k === 'y') { e.preventDefault(); edRedo(); }
}

// Analyse en direct : le solveur tourne en tâche de fond peu après chaque modification du plan.
// Une modification annule le calcul en cours ; la recherche est plafonnée pour rester rapide.
const LIVE_CAP = 300000;
let liveW = null, liveT = null, liveLast = null, liveSeq = 0;
function liveSchedule() {
  clearTimeout(liveT); if (liveW) { liveW.terminate(); liveW = null; }
  const seq = ++liveSeq;
  if (AN.checkMap(edMap).length) { $('ed-live').innerHTML = ''; return; }
  liveShow('wait', 'Analyse…');
  liveT = setTimeout(() => liveRun(seq), 350);
}
function liveRun(seq) {
  const map = edMap.slice();
  const done = r => { if (seq !== liveSeq) return; liveW = null; liveResult(map, r); };
  let w = null;
  try { w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch (e) { w = null; }
  if (!w) { setTimeout(() => done(AN.solve(map, 40000)), 0); return; } // repli plus modeste sans tâche de fond
  liveW = w;
  w.onmessage = e => { if (e.data.type === 'done') { w.terminate(); done(e.data.r); } };
  w.onerror = () => { w.terminate(); done({ error: 'Erreur pendant le calcul.' }); };
  w.postMessage({ cmd: 'solve', map, opts: { cap: LIVE_CAP } });
}
function liveShow(cls, html) { const el = $('ed-live'); el.className = 'ed-live ' + cls; el.innerHTML = html; }
function liveResult(map, r) {
  if (r.error || r.errors) return liveShow('ko', '<span class="badge">⚠ ' + (r.error || r.errors.join(' ')) + '</span>');
  if (r.unsolvable) { liveLast = null; return liveShow('ko', '<span class="badge">✗ Impossible</span><span>aucune suite de coups ne mène à la sortie.</span>'); }
  if (r.over) { liveLast = null; return liveShow('big', '<span class="badge">? Trop d\'états</span><span>plus de ' + LIVE_CAP + ' : utilise « Résoudre ».</span>'); }
  const n = r.sol.length, before = liveLast; liveLast = n;
  const delta = before !== null && before !== n ? ' <span>(avant : ' + before + ')</span>' : '';
  liveShow('ok', '<span class="badge">✓ ' + (n ? 'Résoluble en ' + n + ' coup' + (n > 1 ? 's' : '') : 'Déjà gagné') + '</span>' + delta + (n ? '<button class="ed-btn" id="ed-livesol">▶ Voir</button>' : ''));
  if (n) $('ed-livesol').onclick = () => edReplay(map, r.sol);
}
const setCh = (m, r, c, ch) => { m = m.slice(); m[r] = m[r].slice(0, c) + ch + m[r].slice(c + 1); return m; };
function edPaint(r, c) {
  let m = edMap; const cur = m[r][c], t = edTool;
  if (cur === t) return;
  if (t === 'P') { if ('EXQ'.includes(cur)) return; m = m.map(row => row.replace('P', '.')); m = setCh(m, r, c, 'P'); }
  else if (t === 'E') { m = m.map(row => row.replace('E', '.').replace('X', 'S').replace('Q', 'R')); const c2 = m[r][c]; m = setCh(m, r, c, c2 === 'S' ? 'X' : c2 === 'R' ? 'Q' : 'E'); }
  else if ((t === 'S' || t === 'R') && 'EXQ'.includes(cur)) m = setCh(m, r, c, t === 'S' ? 'X' : 'Q');
  else m = setCh(m, r, c, t);
  if (m.join('') === edMap.join('')) return;
  if (!edStroke) edPush(edMap); // hors glisser (ne devrait pas arriver) : un geste par case
  edMap = m; edChanged();
}
function edCell(e) {
  const b = $('ed-board').getBoundingClientRect(), T = parseFloat($('ed-board').style.getPropertyValue('--t')) || edT();
  const c = Math.floor((e.clientX - b.left) / T), r = Math.floor((e.clientY - b.top) / T);
  return r >= 0 && c >= 0 && r < edMap.length && c < edMap[0].length ? [r, c] : null;
}
function edResize(kind) {
  const W = edMap[0].length, H = edMap.length; let m = edMap.slice();
  if (kind === '+c') m = m.map((row, r) => row.slice(0, -1) + (r === 0 || r === H - 1 ? '#' : '.') + row.slice(-1));
  if (kind === '-c' && W > 3) m = m.map(row => row.slice(0, -2) + row.slice(-1));
  if (kind === '+r') m.splice(H - 1, 0, '#' + '.'.repeat(W - 2) + '#');
  if (kind === '-r' && H > 3) m.splice(H - 2, 1);
  edSet(m);
}

// Exécution des analyses dans un Web Worker (repli sur le fil principal si le navigateur le refuse)
function edRun(cmd, opts, onProgress) {
  return new Promise(resolve => {
    edStop(); const map = edMap.slice(); edBusy = cmd; edUI();
    let w = null;
    try { w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch (e) { w = null; }
    const fallback = () => {
      edWorker = null; $('ed-status').textContent = 'Calcul en cours (sans tâche de fond, la page peut se figer)…';
      setTimeout(() => {
        let r; try { r = cmd === 'solve' ? AN.solve(map, 600000) : cmd === 'eval' ? AN.evaluate(map, {}) : AN.optimize(map, opts); } catch (err) { r = { errors: [String(err.message || err)] }; }
        edBusy = null; edUI(); resolve(r);
      }, 30);
    };
    if (!w) return fallback();
    edWorker = w; let started = false;
    w.onmessage = e => {
      started = true; const d = e.data;
      if (d.type === 'progress') $('ed-status').textContent = d.msg;
      if (d.type === 'opt' && onProgress) onProgress(d.p);
      if (d.type === 'done') { w.terminate(); edWorker = null; edBusy = null; edUI(); resolve(d.r); }
    };
    w.onerror = () => { w.terminate(); if (!started) fallback(); else { edWorker = null; edBusy = null; edUI(); resolve({ errors: ['Erreur pendant le calcul.'] }); } };
    w.postMessage({ cmd, map, opts });
  });
}
function edStop() { if (edWorker) { edWorker.terminate(); edWorker = null; } if (edBusy) { edBusy = null; edUI(); $('ed-status').textContent = 'Calcul arrêté.'; } }
function edUI() {
  ['ed-solve', 'ed-eval', 'ed-opt'].forEach(id => $(id).disabled = !!edBusy);
  $('ed-stop').hidden = !edBusy;
  if (!edBusy && /…$/.test($('ed-status').textContent)) $('ed-status').textContent = '';
}
const solHtml = sol => '<code class="ed-sol">' + (sol.replace(/\*/g, '✦') || '(déjà gagné)') + '</code>';
const ARROWS = { U: '↑', D: '↓', L: '←', R: '→', '*': '✦' };
function edShowFail(r) {
  if (r.errors) return '<p>⚠ ' + r.errors.join('<br>⚠ ') + '</p>';
  if (r.unsolvable) return '<p><b>Impossible</b> : aucune suite de coups ne mène à la sortie (' + (r.total || r.states) + ' états explorés).</p>';
  if (r.over) return '<p><b>Trop grand</b> : plus de ' + (r.total || r.states) + ' états, la recherche s\'est arrêtée.</p>';
  return null;
}
async function edSolve() {
  $('ed-status').textContent = 'Recherche de la solution…';
  const r = await edRun('solve'); const box = $('ed-results'); box.classList.remove('stale');
  const f = edShowFail(r);
  if (f) { box.innerHTML = '<h3>Solveur</h3>' + f; return; }
  edLast = { sol: r.sol, map: edMap.slice() };
  box.innerHTML = '<h3>Solveur</h3><p>Solution la plus courte : <b>' + r.sol.length + ' coups</b> (' + r.states + ' états visités).</p><p>' + solHtml([...r.sol].map(ch => ARROWS[ch]).join('')) + '</p><p><button class="ed-btn" id="ed-replay">▶ Voir la solution</button></p>';
  $('ed-replay').onclick = () => edReplay(edLast.map, edLast.sol);
}
async function edEval() {
  $('ed-status').textContent = 'Évaluation…';
  const r = await edRun('eval'); const box = $('ed-results'); box.classList.remove('stale');
  const f = edShowFail(r);
  if (f) { box.innerHTML = '<h3>Évaluation</h3>' + f; return; }
  edLast = { sol: r.sol, map: edMap.slice() };
  evalCache.set(mapKey(edMap), r);
  const pct = Math.round(100 * r.dead / r.total);
  const chips = r.dec.map(([o, v, , all]) => '<span class="ed-dec ' + (o >= 3 && v < o ? 'fort' : o >= 2 && v < o ? 'faible' : '') + '" title="' + o + ' gestes irréversibles (sur ' + all + ' possibles), ' + v + ' encore gagnants">' + v + '/' + o + '</span>').join('');
  const ok = r.strong >= 2;
  edMarks = r.useless.map(u => ({ r: u.r, c: u.c, title: 'Bloc inutile' })).concat((r.decoys || []).map(u => ({ r: u.r, c: u.c, title: 'Leurre', cls: 'decoy' }))).concat(r.zones.flatMap(z => z.cells.map(p => ({ r: p.r, c: p.c, title: 'Impasse superflue', cls: 'zone' }))));
  drawStatic($('ed-board'), edMap, edT(), edMarks);
  box.innerHTML = '<h3>Évaluation</h3>' +
    '<div class="ed-kpis"><div><b>' + r.len + '</b><span>coups</span></div><div class="' + (ok ? 'good' : 'warn') + '"><b>' + r.strong + '</b><span>choix forts</span></div><div><b>' + r.weak + '</b><span>choix faibles</span></div><div title="gestes qu\'on peut défaire, sur ' + r.exploreMoments + ' moment' + (r.exploreMoments > 1 ? 's' : '') + ' de la solution"><b>' + r.explore + '</b><span>exploration</span></div><div><b>' + pct + ' %</b><span>états sans issue</span></div></div>' +
    '<p class="ed-note">' + (r.strong >= 3 ? 'Assez de choix pour une finale (objectif ≥ 3).' : r.strong >= 2 ? 'Assez de choix pour un approfondissement ou un twist (objectif ≥ 2), pas encore pour une finale (≥ 3).' : 'Pas assez de vrais choix, sauf pour un niveau de découverte (objectif ≥ 2, ou ≥ 3 pour une finale).') + '</p>' +
    '<p><b>Moments de décision</b> le long de la solution (gestes encore gagnants / gestes irréversibles) :<br>' + (chips || '—') + '</p>' +
    '<p><b>Leurres</b> : ' + ((r.decoys || []).length ? r.decoys.map(u => u.name + ' (ligne ' + (u.r + 1) + ', colonne ' + (u.c + 1) + ')').join(', ') + '. Retirables, mais un bloc du même genre est indispensable : ce sont des alternatives crédibles au bon bloc, permises par les principes (cerclés en bleu).' : 'aucun.') + '</p>' +
    '<p><b>Blocs inutiles</b> : ' + (r.useless.length ? r.useless.map(u => u.name + ' (ligne ' + (u.r + 1) + ', colonne ' + (u.c + 1) + ')').join(', ') + '. Ils sont entourés en rouge sur le plan : sans eux, le niveau reste résoluble.' : 'aucun, chaque bloc est nécessaire.') + '</p>' +
    '<p><b>Impasses superflues</b> : ' + (r.zones.length ? r.zones.length + ' impasse' + (r.zones.length > 1 ? 's' : '') + ' (' + r.zones.map(z => z.cells.length + ' case' + (z.cells.length > 1 ? 's' : '')).join(', ') + '), en pointillés orange sur le plan. Les murer ne rend pas le niveau impossible et ne fait perdre aucun choix : elles n\'ajoutent que du bruit. <button class="ed-btn" id="ed-trim">Murer ces impasses</button>' : 'aucune, aucun chemin ne part vers une impasse inutile.') + (r.minorCells ? ' <span class="ed-note">(' + r.minorCells + ' autre' + (r.minorCells > 1 ? 's' : '') + ' case' + (r.minorCells > 1 ? 's' : '') + ' de sol pourrai' + (r.minorCells > 1 ? 'ent' : 't') + ' être murée' + (r.minorCells > 1 ? 's' : '') + ' sans rien changer, mais ' + (r.minorCells > 1 ? 'elles ne mènent' : 'elle ne mène') + ' pas à une impasse : ce n\'est pas gênant.)</span>' : '') + '</p>' +
    '<p><b>Mécaniques non indispensables</b> : ' + (r.notEss.length ? r.notEss.map(n => n.name + ' → ' + n.toName).join(', ') + ' : le niveau reste résoluble avec ce remplacement.' : 'aucune, chaque mécanique présente est nécessaire.') + '</p>' +
    '<p>États explorés : ' + r.total + ', dont ' + r.dead + ' sans issue.</p>' +
    '<p>' + solHtml([...r.sol].map(ch => ARROWS[ch]).join('')) + ' <button class="ed-btn" id="ed-replay">▶ Voir la solution</button></p>' +
    '<details><summary>Comment lire ces mesures</summary><p>Le long de la solution la plus courte, à chaque nouvelle disposition des blocs, on compte les gestes irréversibles (pousser un bloc, se téléporter, sans pouvoir revenir ensuite à la même disposition ; marcher et les gestes qu\'on peut défaire ne comptent pas) et ceux qui laissent le niveau gagnable.</p><p><b>Exploration</b> : les gestes qu\'on peut défaire, additionnés sur tous les moments de la solution. Ce ne sont pas des choix, mais ils laissent le joueur essayer et observer sans tout perdre : un niveau sans exploration peut sembler moins vivant.</p><p><b>Choix fort</b> : au moins 3 gestes irréversibles, dont au moins un perdant. <b>Choix faible</b> : au moins 2 gestes irréversibles, dont au moins un perdant.</p><p><b>Bloc inutile</b> : le retirer laisse le niveau résoluble. Un bloc qui sert d\'alternative crédible au bon bloc peut rester. <b>Mécanique non indispensable</b> : la remplacer (par exemple un rond par un carré) laisse le niveau résoluble. Le bloc inamovible et les demi-carrés ne sont que des carrés avec une contrainte : on vérifie plutôt que cette contrainte impose un détour (avec un carré à la place, la solution serait plus courte).</p><p><b>Impasse superflue</b> : un groupe de cases (sol ou trou) relié au reste du plan par un seul côté, que la solution la plus courte ne traverse pas, et qu\'on peut transformer en mur sans rendre le niveau impossible et sans perdre de choix forts ou faibles. Les autres cases sans utilité (marge d\'une salle, par exemple) ne sont pas signalées.</p></details>';
  $('ed-replay').onclick = () => edReplay(edLast.map, edLast.sol);
  if (r.zones.length) $('ed-trim').onclick = () => { let m = edMap; for (const z of r.zones) for (const p of z.cells) m = setCh(m, p.r, p.c, '#'); edSet(m); };
}
let edBest = null;
async function edOpt() {
  const seconds = Math.max(5, Math.min(600, +$('ed-osec').value || 30)), target = +$('ed-otarget').value || 2, maxDiff = Math.max(1, +$('ed-odiff').value || 7);
  edBest = null; $('ed-optres').innerHTML = '<p>Recherche de variantes…</p>'; $('ed-status').textContent = 'Ajustement en cours…';
  const show = (best, start, it, el, done) => {
    edBest = best;
    $('ed-optres').innerHTML = '<p>' + (done ? 'Terminé' : 'En cours') + ' · ' + it + ' variantes essayées' + (el ? ' · ' + Math.round(el) + ' s' : '') + '</p>' +
      '<p>Départ : ' + start + '<br>Meilleure variante : <b>' + best.strong + ' forts</b>, ' + best.weak + ' faibles, ' + best.len + ' coups, ' + best.diff + ' case' + (best.diff > 1 ? 's' : '') + ' modifiée' + (best.diff > 1 ? 's' : '') + (best.valid ? '' : ' (le plan de départ ne respecte pas les contraintes)') + '</p>' +
      (best.diff ? '<div class="ed-prev"><div class="board" id="ed-optboard"></div></div>' : '') +
      (best.diff ? '<p><button class="ed-btn" id="ed-apply">Appliquer au plan</button> <button class="ed-btn" id="ed-optplay">Tester cette variante</button></p>' : '<p>Aucune amélioration trouvée pour l\'instant.</p>');
    if (best.diff) drawStatic($('ed-optboard'), best.map, Math.max(14, Math.floor(edT() * 0.6)), best.map.flatMap((row, r) => [...row].map((ch, c) => ch !== (edMapAtStart[r] || '')[c] ? { r, c, title: 'Case modifiée' } : null).filter(Boolean)));
    if (best.diff) $('ed-optboard').querySelectorAll('.ed-mark').forEach(m => m.classList.add('chg'));
    if (best.diff) { $('ed-apply').onclick = () => edSet(best.map.slice()); $('ed-optplay').onclick = () => edTest(best.map); }
  };
  const edMapAtStart = edMap.slice(); let startTxt = '';
  const r = await edRun('opt', { seconds, target, maxDiff }, p => { startTxt = p.start.strong + ' forts, ' + p.start.weak + ' faibles, ' + p.start.len + ' coups'; show(p.best, startTxt, p.it, p.elapsed, false); });
  if (r.errors || r.error) { $('ed-optres').innerHTML = '<p>⚠ ' + (r.error || r.errors.join(' ')) + '</p>'; return; }
  startTxt = r.start.strong + ' forts, ' + r.start.weak + ' faibles, ' + r.start.len + ' coups';
  show(r.best, startTxt, r.it, 0, true);
  $('ed-optres').insertAdjacentHTML('beforeend', '<p class="ed-note">Contraintes respectées : chaque bloc reste utile, les mécaniques indispensables au départ le restent' + (r.essentials.length ? ' (' + r.essentials.join(', ') + ')' : '') + ', et la solution utilise toujours les mêmes effets (pendule, téléportation…). Relis quand même la variante : l\'outil ne juge pas la lisibilité.</p>');
}

// Tester dans l'onglet Jouer
function edTest(map) {
  testLevel = { world: 'Éditeur', lot: 'Niveau de l\'éditeur', stage: '', name: 'Niveau de l\'éditeur', map: (map || edMap).slice() };
  showTab('play'); build();
}
function edReplay(map, sol) { edTest(map); rpStart(sol); rpPlay(); }

// ---- Relecture pas à pas d'une solution (onglet Jouer) ----
// rp.i = nombre de coups déjà joués. Avancer anime le coup ; reculer annule, ou recalcule l'état si l'historique manque.
let rp = null, rpKeep = false;
const MV = { U: 'up', D: 'down', L: 'left', R: 'right' };
const evalCache = new Map(); // plan → résultat de evaluate, pour la session
const mapKey = m => m.join('\n');
const decCls = (o, v) => o >= 3 && v < o ? 'fort' : o >= 2 && v < o ? 'faible' : '';
function rpStart(sol) {
  const L = testLevel || LEVELS[cur], ev = evalCache.get(mapKey(L.map));
  let dec = [];
  // la solution de l'évaluation porte les moments de décision : on la préfère si elle est aussi courte
  if (ev && ev.sol !== undefined && ev.sol.length <= sol.length) { sol = ev.sol; dec = ev.dec || []; }
  rp = { map: L.map.slice(), sol, i: 0, playing: false, dec: new Map(dec.filter(d => decCls(d[0], d[1])).map(d => [d[2], { cls: decCls(d[0], d[1]), o: d[0], v: d[1] }])), evaluated: !!ev,
    explo: new Map(dec.filter(d => d[3] > d[0]).map(d => [d[2], d[3] - d[0]])) }; // coups où des gestes peuvent être essayés puis défaits
  const tl = $('rptl'); tl.innerHTML = '';
  [...sol].forEach((ch, j) => {
    const b = document.createElement('button'), d = rp.dec.get(j);
    b.textContent = ARROWS[ch]; if (d) b.classList.add(d.cls);
    const x = rp.explo.get(j); if (x) b.classList.add('explo');
    b.title = 'Se placer avant le coup ' + (j + 1) + (d ? ' · choix ' + d.cls + ' : ' + d.v + ' geste' + (d.v > 1 ? 's' : '') + ' gagnant' + (d.v > 1 ? 's' : '') + ' sur ' + d.o : '') + (x ? ' · ' + x + ' geste' + (x > 1 ? 's' : '') + ' à essayer puis défaire' : '');
    b.onclick = () => rpJump(j); tl.appendChild(b);
  });
  $('rpleg').innerHTML = rp.dec.size || rp.explo.size ? 'Soulignés, les moments de décision :<i style="background:var(--player)"></i>choix fort<i style="background:#e0a640"></i>choix faible. Point bleu : on peut y explorer (gestes à défaire). Clique un coup pour te placer juste avant.'
    : 'Clique un coup pour te placer juste avant.' + (rp.evaluated ? ' Aucun vrai choix le long de cette solution.' : ' Évalue le niveau (éditeur ou onglet Tableau) pour voir les moments de décision.');
  rpUI();
}
function rpUI() {
  $('rpbar').hidden = !rp; if (!rp) return;
  const n = rp.sol.length;
  $('rpcount').textContent = 'coup ' + rp.i + ' / ' + n;
  $('moves').textContent = rp.i + ' / ' + n;
  $('rp-play').textContent = rp.playing ? '⏸' : '▶';
  $('rp-first').disabled = $('rp-prev').disabled = rp.i === 0;
  $('rp-next').disabled = $('rp-last').disabled = rp.i >= n;
  [...$('rptl').children].forEach((b, j) => { b.classList.toggle('done', j < rp.i); b.classList.toggle('cur', j === rp.i); });
}
function rpEnd() { if (rp) rp.playing = false; rp = null; $('rpbar').hidden = true; }
// Un clic pendant une animation est exécuté dès qu'elle se termine
function whenIdle(fn) { if (!busy) return fn(); setTimeout(() => whenIdle(fn), 40); }
function rpJump(i) {
  if (!rp) return;
  rp.playing = false;
  if (busy) return whenIdle(() => rpJump(i));
  let s = parseLevel(rp.map);
  for (let j = 0; j < i; j++) { const r = applyMove(s, rp.sol[j]); if (!r) break; s = r.state; }
  rpKeep = true; build(i ? s : undefined); rpKeep = false;
  rp.i = i; rpUI();
}
async function rpNext() {
  if (!rp || busy || rp.i >= rp.sol.length) return;
  const ch = rp.sol[rp.i]; rp.i++; rpUI();
  if (ch === '*') await action(true); else await move(MV[ch], true);
}
function rpPrev() {
  if (!rp || !rp.i) return;
  rp.playing = false;
  if (busy) return whenIdle(rpPrev);
  if (history.length) { undo(true); rp.i--; rpUI(); } else rpJump(rp.i - 1);
}
async function rpPlay() {
  if (!rp) return;
  if (rp.playing) { rp.playing = false; rpUI(); return; }
  if (rp.i >= rp.sol.length) rpJump(0);
  const me = rp; me.playing = true; rpUI();
  await wait(350);
  while (rp === me && me.playing && me.i < me.sol.length) { await rpNext(); await wait(140); }
  if (rp === me) { me.playing = false; rpUI(); }
}
const rpPause = () => { if (rp) { rp.playing = false; rpUI(); } };
const rpStep = () => { rpPause(); whenIdle(rpNext); };
function rpKey(e) {
  const f = { ArrowRight: rpStep, ArrowLeft: rpPrev, ' ': rpPlay, Home: () => rpJump(0), End: () => rpJump(rp.sol.length), Escape: rpEnd }[e.key];
  if (!f) return false;
  e.preventDefault(); f(); return true;
}

function edInit() {
  const pal = $('ed-palette'); pal.innerHTML = '';
  for (const [grp, tools] of ED_TOOLS) {
    const g = document.createElement('div'); g.className = 'ed-grp'; g.innerHTML = '<span>' + grp + '</span><div></div>'; pal.appendChild(g);
    for (const [ch, label] of tools) {
      const b = document.createElement('button'); b.className = 'ed-tool' + (ch === edTool ? ' on' : ''); b.title = label + ' (' + ch + ')'; b.setAttribute('aria-label', label);
      const bd = document.createElement('div'); bd.className = 'board mini'; b.appendChild(bd);
      drawStatic(bd, [ch], 28);
      b.onclick = () => { edTool = ch; pal.querySelectorAll('.ed-tool').forEach(x => x.classList.remove('on')); b.classList.add('on'); $('ed-toolname').textContent = label; };
      g.lastChild.appendChild(b);
    }
  }
  $('ed-toolname').textContent = ED_TOOLS.flatMap(g => g[1]).find(t => t[0] === edTool)[1];
  const sel = $('ed-load'); sel.innerHTML = '';
  WORLDS.forEach(w => { const og = document.createElement('optgroup'); og.label = w; LEVELS.forEach((l, i) => { if (l.world === w) { const o = document.createElement('option'); o.value = i; o.textContent = (i + 1) + '. ' + l.name; og.appendChild(o); } }); sel.appendChild(og); });
  sel.value = cur;
  $('ed-loadbtn').onclick = () => edLoad(+sel.value);
  $('ed-new').onclick = () => {
    const W = Math.max(4, Math.min(20, +$('ed-w').value || 9)), H = Math.max(4, Math.min(16, +$('ed-h').value || 7));
    let m = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => r === 0 || c === 0 || r === H - 1 || c === W - 1 ? '#' : '.').join(''));
    m = setCh(m, 1, 1, 'P'); m = setCh(m, H - 2, W - 2, 'E'); edSet(m);
  };
  document.querySelectorAll('[data-rz]').forEach(b => b.onclick = () => edResize(b.dataset.rz));
  let down = false;
  const bd = $('ed-board');
  const strokeEnd = () => { down = false; if (edStroke && edStroke !== edMap) { edPush(edStroke); edHistUI(); } edStroke = null; };
  bd.addEventListener('pointerdown', e => { const p = edCell(e); if (!p) return; down = true; edStroke = edMap; bd.setPointerCapture(e.pointerId); edPaint(...p); e.preventDefault(); });
  bd.addEventListener('pointermove', e => { if (!down) return; const p = edCell(e); if (p && edTool !== 'P' && edTool !== 'E') edPaint(...p); });
  bd.addEventListener('pointerup', strokeEnd);
  bd.addEventListener('pointercancel', strokeEnd);
  $('ed-text').addEventListener('change', () => {
    const rows = $('ed-text').value.split('\n').map(r => r.replace(/\s+$/, '')).filter(r => r.length);
    if (!rows.length) return; const W = Math.max(...rows.map(r => r.length));
    edSet(rows.map(r => r.padEnd(W, '#')));
  });
  $('ed-copy').onclick = () => {
    const txt = JSON.stringify(edMap);
    const done = () => { $('ed-copy').textContent = 'Copié ✓'; setTimeout(() => $('ed-copy').textContent = 'Copier le plan (JSON)', 1500); };
    try { navigator.clipboard.writeText(txt).then(done, () => { $('ed-text').select(); }); } catch (e) { $('ed-text').select(); }
  };
  $('ed-test').onclick = () => edTest();
  $('ed-solve').onclick = edSolve; $('ed-eval').onclick = edEval; $('ed-opt').onclick = edOpt; $('ed-stop').onclick = edStop;
  $('testback').onclick = () => { rpEnd(); showTab('edit'); };
  $('ed-undo').onclick = edUndo; $('ed-redo').onclick = edRedo;
  edRender(); edUI(); edHistUI(); liveSchedule();
}
function edLoad(i) {
  edSet(LEVELS[i].map.slice()); $('ed-load').value = i;
  $('ed-results').innerHTML = '<h3>Résultats</h3><p class="ed-note">Lance le solveur ou l\'évaluation.</p>'; $('ed-optres').innerHTML = ''; $('ed-results').classList.remove('stale');
}
// FIN ÉDITEUR

// Boutons de la relecture et solution des niveaux du jeu
$('rp-first').onclick = () => rpJump(0); $('rp-prev').onclick = rpPrev; $('rp-play').onclick = rpPlay;
$('rp-next').onclick = rpStep; $('rp-last').onclick = () => { if (rp) rpJump(rp.sol.length); };
$('rp-quit').onclick = () => { rpEnd(); build(); };
$('solbtn').onclick = () => { const L = LEVELS[cur]; if (!L.solution) return; build(); rpStart(L.solution); $('rpbar').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };

// ---- Onglet « Tableau » : les mesures de l'évaluation pour tous les niveaux d'un monde ----
// tblWorld : indice du monde affiché, ou -1 pour tous les mondes. Tri et filtres ne changent que l'affichage.
let tblWorld = 0, tblW = null, tblQueue = [], tblCur = -1, tblSort = { key: 'n', dir: 1 };
const TBL_COLS = [ // clé de tri, titre, sens du premier clic (1 croissant, -1 décroissant)
  ['n', '#', 1], ['name', 'Niveau', 1], ['len', 'Coups', -1], ['strong', 'Forts', 1], ['weak', 'Faibles', 1], ['explore', 'Explo.', 1], ['dead', 'Sans issue', -1], ['alerts', 'Alertes', -1],
];
const tblStage = L => /finale/i.test(L.lot) ? 'Finale' : L.stage || 'Autre';
// Mesures et alertes d'un niveau, d'après son évaluation (r), si elle a été faite
function tblInfo(L, i) {
  const r = evalCache.get(mapKey(L.map)), info = { L, i, r, stage: tblStage(L), alerts: [] };
  if (!r) return { ...info, status: 'pending' };
  if (r.errors || r.unsolvable || r.over) return { ...info, status: 'error', alerts: [{ red: true, kind: 'erreur', txt: r.errors ? r.errors.join(' ') : r.unsolvable ? 'impossible' : 'trop d\'états' }] };
  // objectifs des Principes : ≥ 2 choix forts hors découverte, ≥ 3 pour une finale
  const finale = info.stage === 'Finale', discovery = !finale && (!L.stage || L.stage === 'Découverte');
  const few = !discovery && r.strong < (finale ? 3 : 2);
  info.discovery = discovery;
  if (few) info.alerts.push({ red: true, kind: 'peu de choix', txt: 'peu de choix' + (finale ? ' pour une finale' : '') });
  info.notes = (r.decoys || []).length ? [{ txt: 'leurre ×' + r.decoys.length, title: r.decoys.map(u => u.name + ' (l. ' + (u.r + 1) + ', c. ' + (u.c + 1) + ')').join(', ') + ' : alternative crédible à un bloc indispensable' }] : [];
  if (r.useless.length) info.alerts.push({ red: true, kind: 'bloc inutile', txt: 'bloc inutile ×' + r.useless.length, title: r.useless.map(u => u.name + ' (l. ' + (u.r + 1) + ', c. ' + (u.c + 1) + ')').join(', ') });
  // une alerte par mécanique (les quatre orientations du demi-carré n'en font qu'une)
  for (const n of r.notEss.filter((n, k, all) => all.findIndex(m => m.name === n.name) === k)) info.alerts.push({ kind: 'mécanique non indispensable', txt: n.name + ' non indispensable', title: 'I^v<>'.includes(n.from) && n.to === 'S' ? 'avec un carré à la place, la solution n\'est pas plus courte : la contrainte n\'impose aucun détour' : 'remplacer par ' + n.toName + ' laisse le niveau résoluble' });
  if (r.zones.length) info.alerts.push({ kind: 'impasse superflue', txt: 'impasse ×' + r.zones.length });
  return { ...info, status: 'ok', few, len: r.len, strong: r.strong, weak: r.weak, explore: r.explore, exploreMoments: r.exploreMoments, dead: Math.round(100 * r.dead / r.total) };
}
function tblRows() {
  const f = $('tbl-filter').value, st = $('tbl-stage').value;
  let rows = LEVELS.map((L, i) => (tblWorld < 0 || L.world === WORLDS[tblWorld]) ? tblInfo(L, i) : null).filter(Boolean);
  const scope = rows.length;
  rows = rows.filter(x => (!st || x.stage === st) && (f === 'all' || (f === 'alerts' ? x.alerts.length > 0 : f === 'clean' ? x.status === 'ok' && !x.alerts.length : x.status === 'pending')));
  const { key, dir } = tblSort;
  const val = x => key === 'n' ? x.i : key === 'name' ? x.L.name : key === 'alerts' ? (x.status === 'pending' ? null : x.alerts.length) : x.status === 'ok' ? x[key] : null;
  // les niveaux pas encore évalués restent en bas, quel que soit le sens
  rows.sort((a, b) => { const va = val(a), vb = val(b); if (va === null || vb === null) return va === vb ? a.i - b.i : va === null ? 1 : -1; return (typeof va === 'string' ? va.localeCompare(vb, 'fr') : va - vb) * dir || a.i - b.i; });
  return { rows, scope };
}
function tblRender() {
  const wEl = $('tbl-worlds'); wEl.innerHTML = '';
  [[-1, 'Tous les mondes', 'Tous les niveaux du jeu'], ...WORLDS.map((w, wi) => [wi, 'Monde ' + (wi + 1), w])].forEach(([wi, label, title]) => {
    const b = document.createElement('button'); b.textContent = label; b.title = title;
    b.className = wi === tblWorld ? 'on' : ''; b.onclick = () => { tblWorld = wi; tblRender(); };
    wEl.appendChild(b);
  });
  const { rows, scope } = tblRows(), byOrder = tblSort.key === 'n' && tblSort.dir === 1, t = $('tbl');
  let html = '<thead><tr>' + TBL_COLS.map(([k, label]) => '<th class="sort' + (['len', 'strong', 'weak', 'explore', 'dead'].includes(k) ? ' n' : '') + (tblSort.key === k ? ' on' : '') + '" data-sort="' + k + '" title="Trier par ' + label.toLowerCase() + '">' + label + (tblSort.key === k ? (tblSort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>').join('') + '<th></th></tr></thead><tbody>';
  let lot = null;
  for (const x of rows) {
    const { L, i } = x, first = byOrder && (L.world + L.lot) !== lot; lot = L.world + L.lot;
    html += '<tr class="' + (first ? 'lot' : '') + (i === tblCur ? ' busy' : '') + '"><td>' + (i + 1) + '</td><td><b>' + L.name + '</b><small>' + (tblWorld < 0 ? L.world.split(' · ')[0] + ' · ' : '') + L.lot + (L.stage ? ' · ' + L.stage : '') + '</small></td>' + tblCells(x) +
      '<td class="act"><button data-play="' + i + '">Jouer</button><button data-edit="' + i + '" title="Ouvrir dans l\'éditeur">Éditer</button></td></tr>';
  }
  if (!rows.length) html += '<tr><td colspan="9" class="pend">Aucun niveau ne correspond aux filtres.</td></tr>';
  t.innerHTML = html + '</tbody>';
  t.querySelectorAll('[data-sort]').forEach(th => th.onclick = () => {
    const k = th.dataset.sort, col = TBL_COLS.find(c => c[0] === k);
    tblSort = tblSort.key === k ? { key: k, dir: -tblSort.dir } : { key: k, dir: col[2] }; tblRender();
  });
  t.querySelectorAll('[data-play]').forEach(b => b.onclick = () => { showTab('play'); go(+b.dataset.play); scrollTo(0, 0); });
  t.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { edLoad(+b.dataset.edit); showTab('edit'); scrollTo(0, 0); });
  // graphiques : les niveaux affichés et évalués, toujours dans l'ordre du jeu
  const chartRows = rows.filter(x => x.status === 'ok').sort((a, b) => a.i - b.i).map(x => {
    const wi = WORLDS.indexOf(x.L.world);
    return { ...x, name: x.L.name, group: tblWorld < 0 ? wi : x.L.lot, groupLabel: tblWorld < 0 ? 'Monde ' + (wi + 1) : x.L.lot, groupShort: tblWorld < 0 ? 'M' + (wi + 1) : x.L.lot.split(' ').map(w => w[0]).join('').slice(0, 3) };
  });
  renderCharts($('tbl-charts'), chartRows, rows.length, i => { showTab('play'); go(i); scrollTo(0, 0); });
  const inScope = LEVELS.filter(L => tblWorld < 0 || L.world === WORLDS[tblWorld]), done = inScope.filter(L => evalCache.has(mapKey(L.map))).length;
  const withAl = inScope.map((L, k) => tblInfo(L, k)).filter(x => x.alerts.length).length;
  $('tbl-count').textContent = rows.length + ' / ' + scope + ' niveau' + (scope > 1 ? 'x' : '') + ' affiché' + (rows.length > 1 ? 's' : '') + ' · ' + done + ' évalué' + (done > 1 ? 's' : '') + ' · ' + withAl + ' avec alertes';
  $('tbl-run').hidden = tblWorld < 0;
  $('tbl-run').disabled = !!tblW || done === inScope.length; $('tbl-all').disabled = !!tblW; $('tbl-stop').hidden = !tblW;
}
function tblCells(x) {
  const { L, r } = x;
  if (x.status === 'pending') return '<td class="n pend">' + (L.solution ? L.solution.length : '—') + '</td><td class="n pend">…</td><td class="n pend">…</td><td class="n pend">…</td><td class="n pend">…</td><td class="pend">' + (x.i === tblCur ? 'calcul…' : '') + '</td>';
  const als = x.alerts.map(a => '<span class="al' + (a.red ? ' red' : '') + '"' + (a.title ? ' title="' + a.title + '"' : '') + '>' + a.txt + '</span>').join('')
    + (x.notes || []).map(a => '<span class="al note" title="' + a.title + '">' + a.txt + '</span>').join('');
  if (x.status === 'error') return '<td colspan="5" class="pend">—</td><td>' + als + '</td>';
  return '<td class="n">' + x.len + '</td><td class="n ' + (x.few ? 'warn' : x.strong >= 3 ? 'good' : '') + '">' + x.strong + '</td><td class="n">' + x.weak + '</td><td class="n' + (x.explore ? '' : ' muted') + '" title="' + x.exploreMoments + ' moment' + (x.exploreMoments > 1 ? 's' : '') + ' avec des gestes à défaire">' + x.explore + '</td><td class="n">' + x.dead + ' %</td><td>' + (x.alerts.length ? als : '<span class="ok">✓</span> ' + als) + '</td>';
}
function tblStart(all) {
  tblQueue = LEVELS.map((L, i) => i).filter(i => (all || LEVELS[i].world === WORLDS[tblWorld]) && !evalCache.has(mapKey(LEVELS[i].map)));
  if (!tblQueue.length) return;
  try { tblW = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch (e) { tblW = null; $('tbl-status').textContent = 'Les tâches de fond ne sont pas disponibles dans ce navigateur.'; return; }
  const total = tblQueue.length;
  const next = () => {
    if (!tblQueue.length) { tblStop(); $('tbl-status').textContent = 'Terminé : ' + total + ' niveau' + (total > 1 ? 'x' : '') + ' évalué' + (total > 1 ? 's' : '') + '.'; return; }
    tblCur = tblQueue.shift();
    $('tbl-status').textContent = 'Niveau ' + (tblCur + 1) + ' · ' + LEVELS[tblCur].name + ' (' + (total - tblQueue.length) + ' / ' + total + ')';
    if (!$('tab-table').hidden) tblRender();
    tblW.postMessage({ cmd: 'eval', map: LEVELS[tblCur].map });
  };
  tblW.onmessage = e => {
    const d = e.data;
    if (d.type === 'progress') $('tbl-status').textContent = 'Niveau ' + (tblCur + 1) + ' · ' + LEVELS[tblCur].name + ' : ' + d.msg;
    if (d.type === 'done') { evalCache.set(mapKey(LEVELS[tblCur].map), d.r); next(); }
  };
  tblW.onerror = () => { tblStop(); $('tbl-status').textContent = 'Erreur pendant le calcul.'; };
  next();
}
function tblStop() { if (tblW) { tblW.terminate(); tblW = null; } tblCur = -1; tblQueue = []; $('tbl-status').textContent = 'Calcul arrêté.'; tblRender(); }
$('tbl-run').onclick = () => tblStart(false);
$('tbl-all').onclick = () => tblStart(true);
$('tbl-stop').onclick = tblStop;
$('tbl-filter').onchange = tblRender; $('tbl-stage').onchange = tblRender;
renderMechs();
edInit();
const h = /^#niveau-(\d+)$/.exec(location.hash);
cur = h ? Math.min(Math.max(+h[1] - 1, 0), LEVELS.length - 1) : 0;
build();
if (location.hash === '#idees') showTab('ideas');
if (location.hash === '#mecaniques') showTab('mech');
if (location.hash === '#principes') showTab('princ');
if (location.hash === '#tableau') showTab('table');
if (location.hash === '#editeur' || location.hash === '#editeur-test') showTab('edit');
