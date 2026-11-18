import { defineConfig } from 'vite';

// base relative : le lab marche aussi bien à la racine qu'à /mon-depot/ sur GitHub Pages.
export default defineConfig({
  base: './',
  server: { fs: { allow: ['../..'] } }, // le lab importe packages/core et /levels
  worker: { format: 'es' },
});
