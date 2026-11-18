// Tâche de fond de l'éditeur : solveur, évaluation et ajustement automatique, sans figer la page.
import AN from '../../../packages/core/src/analysis.js';

self.onmessage = e => {
  const { cmd, map, opts } = e.data;
  const progress = msg => self.postMessage({ type: 'progress', msg });
  try {
    if (cmd === 'solve') { const r = AN.solve(map, (opts && opts.cap) || 600000, i => progress('Recherche : ' + i + ' états')); self.postMessage({ type: 'done', cmd, r }); }
    if (cmd === 'eval') self.postMessage({ type: 'done', cmd, r: AN.evaluate(map, { progress }) });
    if (cmd === 'opt') self.postMessage({ type: 'done', cmd, r: AN.optimize(map, opts, p => self.postMessage({ type: 'opt', p })) });
  } catch (err) { self.postMessage({ type: 'done', cmd, r: { errors: [String(err && err.message || err)] } }); }
};
