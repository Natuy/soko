// Rejoue une solution enregistrée (U, D, L, R pour les déplacements, * pour le bouton d'action).
import { parseLevel, step, teleport, actionDir, isWin, stateKey } from './engine.js';

const MOVES = { U: 'up', D: 'down', L: 'left', R: 'right' };

export function applyMove(state, letter) {
  if (letter === '*') {
    const dir = state.mirrors ? actionDir(state) : null;
    return dir ? teleport(state, dir) : null;
  }
  const dir = MOVES[letter];
  if (!dir) throw new Error(`Coup inconnu : « ${letter} »`);
  return step(state, dir);
}

// Renvoie { won, state, at } : at est l'indice du premier coup impossible, s'il y en a un.
export function replay(map, solution) {
  let state = parseLevel(map);
  for (let i = 0; i < solution.length; i++) {
    const r = applyMove(state, solution[i]);
    if (!r) return { won: false, state, at: i };
    state = r.state;
  }
  return { won: isWin(state), state, key: stateKey(state) };
}
