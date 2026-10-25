import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  // Workspace packages ship TypeScript source, so bundle them; npm deps stay external.
  noExternal: [/^@queuesprout\//],
  clean: true,
  sourcemap: true,
  // The bundle cannot find packages/db/migrations by relative path, so ship a copy.
  async onSuccess() {
    cpSync('../../packages/db/migrations', 'dist/migrations', { recursive: true });
  },
});
