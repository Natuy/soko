// Tests de référence : chaque niveau doit être valide, et sa solution enregistrée doit gagner.
// Si une règle change, ces tests disent quels niveaux sont touchés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { LEVELS, checkMap, replay, solve } from '../src/index.js';

const SNAP = new URL('./replays.snap.json', import.meta.url);
const snapshot = existsSync(SNAP) ? JSON.parse(readFileSync(SNAP, 'utf8')) : {};

test('les noms de niveaux sont uniques', () => {
  const names = LEVELS.map(l => l.name);
  assert.equal(new Set(names).size, names.length);
});

for (const level of LEVELS) {
  test(`${level.world} › ${level.name}`, () => {
    assert.deepEqual(checkMap(level.map), [], 'plan invalide');
    assert.ok(level.solution !== undefined, 'pas de solution enregistrée (lance « bun run levels:solve »)');
    const r = replay(level.map, level.solution);
    assert.ok(r.won, r.at !== undefined ? `coup ${r.at + 1} impossible (« ${level.solution[r.at]} »)` : 'la solution ne mène pas à la sortie');
    // L'état final doit rester identique : sinon, une règle a changé le comportement du niveau.
    if (snapshot[level.name]) assert.equal(r.key, snapshot[level.name], 'état final différent du snapshot (règle modifiée ?)');
  });
}

test('le solveur trouve une solution au moins aussi courte que celle enregistrée', () => {
  for (const level of LEVELS.slice(0, 10)) {
    const r = solve(level.map, 200000);
    assert.ok(r.sol !== undefined, level.name);
    assert.ok(r.sol.length <= level.solution.length, level.name);
  }
});
