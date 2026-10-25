// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Package boundaries (CLAUDE.md, ADR-020), enforced with no-restricted-imports so a
 * violation fails CI. Each entry lists what a package may NOT import.
 */
const pkg = (name) => ({ group: [`@queuesprout/${name}`, `@queuesprout/${name}/*`] });
const boundary = (files, banned, message) => ({
  files,
  rules: {
    'no-restricted-imports': [
      'error',
      { patterns: banned.map((name) => ({ ...pkg(name), message })) },
    ],
  },
});

const ALL = ['shared', 'core', 'providers', 'db', 'storage', 'auth', 'ui', 'ai'];

/** Credential schema and queries: packages/db and apps/worker only (ADR-010). */
const CREDENTIAL_MODULES = [
  '@queuesprout/db/credentials',
  '@queuesprout/db/schema/credentials',
  '**/schema/credentials',
  '**/queries/credentials',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      'packages/db/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
    settings: { next: { rootDir: 'apps/web' } },
  },

  // --- Boundaries ---------------------------------------------------------
  boundary(
    ['packages/shared/**'],
    ALL.filter((p) => p !== 'shared'),
    'packages/shared imports no other workspace package.',
  ),
  boundary(
    ['packages/core/**'],
    ALL.filter((p) => p !== 'shared' && p !== 'core'),
    'packages/core imports shared only.',
  ),
  boundary(
    ['packages/providers/**'],
    ['db', 'storage', 'auth', 'ui', 'ai'],
    'packages/providers gets everything through PublishContext: no db, storage or auth.',
  ),
  {
    files: ['packages/providers/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'next', message: 'Adapters never import Next.js.' }],
          patterns: [
            { group: ['next/*'], message: 'Adapters never import Next.js.' },
            ...['db', 'storage', 'auth', 'ui', 'ai'].map((name) => ({
              ...pkg(name),
              message: 'packages/providers gets everything through PublishContext.',
            })),
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'Adapters never read env vars.' },
      ],
    },
  },
  {
    files: ['packages/auth/**', 'packages/storage/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: CREDENTIAL_MODULES,
              message: 'Credential tables are read only by apps/worker.',
            },
          ],
        },
      ],
    },
  },
  boundary(
    ['packages/ui/**'],
    ['db', 'auth', 'storage', 'providers', 'ai'],
    'packages/ui is presentation only.',
  ),
  {
    // apps/web: providers only through the client entry; never the credential schema.
    files: ['apps/web/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@queuesprout/providers',
              message: 'Import "@queuesprout/providers/client"; only apps/worker calls publish().',
            },
            {
              name: '@queuesprout/core/credentials',
              importNames: ['decryptSecret', 'decryptCredentials', 'getFreshToken'],
              message: 'Only apps/worker decrypts credentials or refreshes tokens.',
            },
          ],
          patterns: [
            {
              group: CREDENTIAL_MODULES,
              message:
                'Credential tables are read only by packages/core/credentials and apps/worker.',
            },
            {
              group: ['@queuesprout/providers/testing'],
              message: 'The adapter test harness is for tests only.',
            },
          ],
        },
      ],
    },
  },

  {
    files: [
      '**/*.test.ts',
      '**/*.int.test.ts',
      '**/test-utils.ts',
      '**/cli/**',
      '**/*.config.{ts,mjs}',
    ],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
