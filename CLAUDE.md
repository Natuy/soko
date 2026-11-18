# Instructions pour Claude Code

- Tout le projet est en français : code commenté en français, textes du jeu en français.
- Les règles du jeu vivent uniquement dans `packages/core/src/engine.js`. Ne jamais dupliquer une règle dans `apps/lab` ou `apps/game` : ils appellent `step`, `teleport`, `applyMove`, `parseLevel`, `isWin`.
- `packages/core` reste sans dépendance et sans DOM : il doit tourner dans le navigateur, dans un Web Worker et dans Node.
- Après toute modification de `packages/core` ou de `levels/`, lancer `bun run test`. Un test cassé signale un niveau dont le comportement a changé : le dire à l'utilisateur avant de régénérer les solutions avec `bun run levels:solve -- --all`.
- Nouveau niveau : l'ajouter dans `levels/monde-N.json`, puis `bun run levels:solve`. Les noms de niveau doivent rester uniques (la progression du joueur est enregistrée par nom).
- Les principes de level design (découverte / approfondissement / twist, vrais choix plutôt que pièges, mécanique indispensable) sont dans l'onglet « Principes » du lab (`apps/lab/index.html`). Les respecter quand on propose un niveau, et le vérifier avec `evaluate` de `packages/core/src/analysis.js`.
- `apps/game` utilise Shallot (WebGPU, Bun, Vite). Sa doc et ses exemples : https://github.com/dylanebert/shallot (dossier `examples/`).
