**DESIGN DU JEU ET DES NIVEAUX FAIT PAR UN HUMAIN**

**CODE ET VISUELS TEMPORAIRES FAIT PAR UNE IA**

# Puzzle à blocs

Jeu de puzzle à blocs (carrés, ronds, demi-carrés, cassants, collants, miroirs…) où il faut atteindre la sortie.

Le dépôt contient trois parties qui partagent les mêmes règles et les mêmes niveaux :

| Dossier | Rôle |
|---|---|
| `packages/core` | Les règles du jeu (`engine.js`), le solveur et l'évaluation des niveaux (`analysis.js`), la lecture des solutions (`replay.js`). Aucune dépendance, aucun DOM. |
| `levels/` | Les niveaux : un fichier JSON par monde. |
| `apps/lab` | La version légère, en 2D : jouer, consulter les mécaniques et les principes, éditer et vérifier les niveaux. |
| `apps/game` | Le jeu avec [Shallot](https://github.com/dylanebert/shallot) (WebGPU) : scène 3D animée à partir des événements du moteur (`src/anim.ts`), menus (titre, niveaux, pause, victoire, commandes, options) dans `src/menus.ts`. |

Règle d'or : **les règles ne sont écrites qu'une fois, dans `packages/core`**. Le lab et le jeu ne font qu'afficher l'état et transformer les entrées en coups.

## Démarrer

Il faut [Bun](https://bun.sh) (Shallot en a besoin) et Node 22 ou plus.

```bash
bun install
bun run dev        # le lab, sur http://localhost:5173
bun run dev:game   # le jeu Shallot (navigateur compatible WebGPU)
bun run test       # vérifie que chaque niveau se résout avec sa solution enregistrée
```

Après le premier `bun install`, commite le fichier `bun.lock`. Pense aussi à remplacer `"latest"` par la version installée de Shallot dans `apps/game/package.json`.

## Format d'un niveau

Chaque fichier `levels/monde-N.json` contient le nom du monde et la liste de ses niveaux :

```json
{
  "lot": "Bases",
  "stage": "Découverte",
  "name": "Pousser",
  "map": ["#######", "##...##", "#P.S.E#", "##...##", "#######"],
  "teach": ["Ce que le niveau fait découvrir."],
  "hint": "L'indice.",
  "solution": "RURDRR"
}
```

`solution` est une suite de coups : `U` `D` `L` `R` pour se déplacer, `*` pour le bouton d'action.

Légende des plans : `#` mur · `.` sol · `O` trou · `E` sortie · `P` joueur · `S` carré · `R` rond · `X`/`Q` carré/rond posé sur la sortie · `B` cassant · `^ > v <` demi-carrés (la pointe indique le sens où il avance) · `/ \` déflecteurs · `+` interrupteur · `D` porte · `C`/`G` carré/rond collant · `M` miroir · `=` miroir de ligne · `!` miroir de colonne · `I` inamovible · `T` vitre · `Z` miroir à interrupteur · `%` interrupteur de miroir.

## Ajouter ou modifier un niveau

1. Dessine-le dans l'onglet **Éditeur** du lab, puis vérifie-le avec **Résoudre** et **Évaluer**.
2. **Copier le plan (JSON)**, puis colle-le dans le bon fichier `levels/monde-N.json` avec son nom, son lot, ses textes.
3. `bun run levels:solve` calcule la solution des niveaux qui n'en ont pas et met à jour le snapshot des tests.
4. `bun run test`.

## Changer une règle

1. Modifie `packages/core/src/engine.js`.
2. `bun run test` indique les niveaux touchés : soit leur solution ne gagne plus, soit leur état final a changé.
3. Si le changement est voulu : `bun run levels:solve -- --all` recalcule toutes les solutions et le snapshot.

## Publication

Le workflow `.github/workflows/pages.yml` publie le site à chaque push sur `main` :

- `https://<utilisateur>.github.io/<dépôt>/` : le lab ;
- `https://<utilisateur>.github.io/<dépôt>/jeu/` : le jeu Shallot.

À activer une fois dans le dépôt GitHub : **Settings → Pages → Source : GitHub Actions**.
