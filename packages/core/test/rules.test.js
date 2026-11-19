// Règles de la propriété « cassant » : le mur transparent se brise comme le bloc cassant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel, step, stateKey, solve } from '../src/index.js';

const go = (map, ...dirs) => { let s = parseLevel(map); for (const d of dirs) { const r = step(s, d); if (!r) return null; s = r.state; } return s; };

test('un rond qui roule vers une vitre s\'arrête devant et la brise', () => {
  const s = go(['#########', '#PR...T.#', '#########'], 'right');
  assert.equal(s.blocks.get('1,5'), 'R');
  assert.ok(!s.glass.has('1,6') && s.shattered.has('1,6'));
  // la case de la vitre devient un sol libre : le rond, poussé de nouveau, la traverse jusqu'au mur
  const t = go(['#########', '#PR...T.#', '#########'], 'right', 'right', 'right', 'right', 'right');
  assert.equal(t.blocks.get('1,7'), 'R');
});

test('un rond poussé collé à une vitre la brise, le joueur ne bouge pas', () => {
  const s = go(['#######', '#.PRT.#', '#######'], 'right');
  assert.equal(s.player, '1,2');
  assert.equal(s.blocks.get('1,3'), 'R');
  assert.ok(s.shattered.has('1,4'));
});

test('un carré ou le joueur ne brise pas une vitre', () => {
  assert.equal(step(parseLevel(['######', '#PST.#', '######']), 'right'), null);
  assert.equal(step(parseLevel(['#####', '#PT.#', '#####']), 'right'), null);
});

test('un rond renvoyé par un déflecteur brise la vitre à la sortie du déflecteur', () => {
  // le rond part à droite, tourne vers le bas sur « \\ » et percute la vitre en dessous : il s'arrête avant le déflecteur
  const s = go(['#######', '#PR.\\.#', '####T##', '####.##', '#######'], 'right');
  assert.equal(s.blocks.get('1,3'), 'R');
  assert.ok(s.shattered.has('2,4'));
});

test('un essieu brise une vitre comme un bloc cassant', () => {
  // le rond collant (G) se colle au rond : poussés de côté, ils roulent ensemble (essieu)
  for (const ch of ['T', 'B']) {
    const s = go(['#######', '#.G..' + ch + '#', '#PR...#', '#######'], 'right');
    assert.ok(s.blocks.has('1,4') && s.blocks.has('2,4'), ch + ' : l\'essieu s\'arrête devant');
    assert.ok(!s.glass.has('1,5') && !s.blocks.has('1,5'), ch + ' : il est brisé');
  }
});

test('une vitre brisée change l\'état (le solveur distingue les deux)', () => {
  const a = parseLevel(['#######', '#PR.T.#', '#######']), b = go(['#######', '#PR.T.#', '#######'], 'right');
  assert.notEqual(stateKey(a), stateKey(b));
  assert.ok(solve(['#######', '#PR.TE#', '#######'], 1000).sol === undefined, 'le rond reste devant la vitre brisée et bloque le passage');
  assert.equal(solve(['#######', '#.....#', '#PR.TE#', '#######'], 10000).sol !== undefined, true);
});
