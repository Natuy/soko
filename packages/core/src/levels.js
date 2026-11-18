// Niveaux du jeu : un fichier JSON par monde, dans /levels à la racine du dépôt.
// Pour ajouter un monde, crée levels/monde-N.json et ajoute-le à la liste ci-dessous.
import monde1 from '../../../levels/monde-1.json' with { type: 'json' };
import monde2 from '../../../levels/monde-2.json' with { type: 'json' };
import monde3 from '../../../levels/monde-3.json' with { type: 'json' };
import monde4 from '../../../levels/monde-4.json' with { type: 'json' };
import monde5 from '../../../levels/monde-5.json' with { type: 'json' };

export const WORLDS = [monde1, monde2, monde3, monde4, monde5];

// Liste à plat, dans l'ordre du jeu. Chaque niveau garde le nom de son monde.
export const LEVELS = WORLDS.flatMap(w => w.levels.map(l => ({ world: w.world, ...l })));
