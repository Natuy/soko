// Calcule la solution la plus courte de chaque niveau sans solution (ou de tous avec --all),
// l'écrit dans les fichiers de /levels, puis met à jour le snapshot des états finaux.
// Usage : bun run levels:solve [-- --all]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { solve, replay } from '../packages/core/src/index.js';

const all = process.argv.includes('--all');
const dir = new URL('../levels/', import.meta.url);
const snapFile = new URL('../packages/core/test/replays.snap.json', import.meta.url);
const snap = {};

for (const file of readdirSync(dir).filter(f => /^monde-\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6)))) {
  const url = new URL(file, dir), world = JSON.parse(readFileSync(url, 'utf8'));
  let changed = false;
  for (const level of world.levels) {
    if (all || level.solution === undefined) {
      const r = solve(level.map, 3_000_000);
      if (r.sol === undefined) { console.error(`✗ ${level.name} : ${r.unsolvable ? 'impossible' : r.over ? 'trop d’états' : r.error}`); continue; }
      level.solution = r.sol; changed = true;
      console.log(`✓ ${level.name} : ${r.sol.length} coups`);
    }
    const rp = replay(level.map, level.solution);
    if (rp.won) snap[level.name] = rp.key;
    else console.error(`✗ ${level.name} : la solution enregistrée ne gagne plus`);
  }
  if (changed) writeFileSync(url, JSON.stringify(world, null, 2) + '\n');
}
writeFileSync(snapFile, JSON.stringify(snap, null, 2) + '\n');
console.log(`Snapshot mis à jour (${Object.keys(snap).length} niveaux).`);
