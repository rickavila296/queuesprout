import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // credentials.ts is outside index.ts so apps/web cannot reach it through ./schema.
  schema: ['./src/schema/index.ts', './src/schema/credentials.ts'],
  out: './migrations',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? 'postgres://queuesprout:queuesprout@localhost:5432/queuesprout',
  },
  strict: true,
  verbose: true,
});
