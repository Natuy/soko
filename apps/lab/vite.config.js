import { defineConfig } from 'vite';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LEVELS_DIR = fileURLToPath(new URL('../../levels/', import.meta.url));
const LEVELS_JS = fileURLToPath(new URL('../../packages/core/src/levels.js', import.meta.url));

// En développement seulement : l'onglet « Niveaux » du lab écrit les fichiers levels/monde-N.json.
// POST /__niveaux { file: "monde-N.json", data: { world, levels } }
const ecritureNiveaux = {
  name: 'ecriture-niveaux',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__niveaux', (req, res) => {
      const reply = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
      if (req.method === 'GET') return reply(200, { ok: true });
      if (req.method !== 'POST') return reply(405, { error: 'Méthode non autorisée' });
      let body = '';
      req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
      req.on('end', () => {
        try {
          const { file, data } = JSON.parse(body);
          if (!/^monde-\d+\.json$/.test(file || '')) return reply(400, { error: 'Nom de fichier invalide' });
          if (!data || typeof data.world !== 'string' || !Array.isArray(data.levels)) return reply(400, { error: 'Contenu invalide' });
          writeFileSync(LEVELS_DIR + file, JSON.stringify(data, null, 2) + '\n');
          // un nouveau monde doit aussi être importé dans packages/core/src/levels.js
          const imported = readFileSync(LEVELS_JS, 'utf8').includes('levels/' + file);
          reply(200, { ok: true, imported });
        } catch (e) { reply(500, { error: String(e && e.message || e) }); }
      });
    });
  },
};

// base relative : le lab marche aussi bien à la racine qu'à /mon-depot/ sur GitHub Pages.
export default defineConfig({
  base: './',
  server: { fs: { allow: ['../..'] } }, // le lab importe packages/core et /levels
  worker: { format: 'es' },
  plugins: [ecritureNiveaux],
});
