import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? 'postgres://queuesprout:queuesprout@localhost:5432/queuesprout',
  },
  strict: true,
  verbose: true,
});
