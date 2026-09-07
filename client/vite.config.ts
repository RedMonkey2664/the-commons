import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const resolvePath = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  /**
   * Served static root is the repo-level assets/ folder, not client/public.
   * 09_PROJECT_STRUCTURE_SETUP.md puts tilesets/sprites/audio/maps at the repo
   * root so the server can read the same map JSON for authoritative collision
   * in Phase 1 — duplicating them under client/public would guarantee drift.
   * So `assets/maps/town_square.json` is served at `/maps/town_square.json`.
   */
  publicDir: resolvePath('../assets'),
  resolve: {
    alias: {
      '@commons/shared': resolvePath('../shared/index.ts'),
    },
  },
  server: {
    port: 5173,
    fs: {
      // Allow reading shared/ and assets/, which live outside client/.
      allow: [resolvePath('..')],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
