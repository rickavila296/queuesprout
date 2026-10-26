# QueueSprout: rules for AI coding sessions

## Before you start
- Read the private planning docs in docs/private/ (git-ignored, on Rick's machine only): reference.md,
  decisions.md and the latest row of progress-log.md. In a session without them, ask Rick for the
  Project Reference doc. Never commit them or quote them in public files, PRs or commits.
- One feature branch, one small PR with tests. Never push to main.
- Next.js 16 differs from older training data: read apps/web/AGENTS.md and the docs it points to
  (node_modules/next/dist/docs/) before changing apps/web.

## Package boundaries (enforced by ESLint boundary rules in CI)
- packages/shared imports no other workspace package.
- packages/core imports shared only: no Next.js, no database driver, no platform calls.
- packages/providers imports shared and core types only. It never touches db, storage, auth,
  next or process.env; everything arrives through PublishContext.
- packages/db is the only place Drizzle schema and SQL live.
- apps/web may import providers only from the "@queuesprout/providers/client" entry
  (validate, limits, settingsSchema) and, in server code, "@queuesprout/providers/connect"
  (sign-in and OAuth callbacks). It never calls publish() or refreshToken().
- apps/worker is the only caller of publish(), refreshToken() and credential decryption.
- Credential tables are imported only by packages/core/credentials and apps/worker.

## Golden Adapter pattern
- packages/providers/src/bluesky/ is the golden adapter. Every new adapter copies its layout:
  index.ts, auth.ts, publish.ts, validate.ts, settings.ts, limits.ts, errors.ts,
  __fixtures__/, <provider>.test.ts
- publish() does one bounded step (< 60 s) and returns done, pending or error.
  Never sleep or poll in a loop inside an adapter.
- Never create a container when ctx.checkpoint already has one.
- Map every platform error to an errorKind in errors.ts; never throw raw errors.
- Adapters never read env vars or the database, and never log tokens.

## TDD with MSW
1. Add fixtures for each platform call to __fixtures__/ (pnpm fixtures:record <provider> redacts tokens).
2. Write failing tests first: validate() table tests; publish() for success, 401, 429 with
   Retry-After, 5xx, and every pending-to-done transition and checkpoint resume.
3. Implement until green. Tests never reach the network: useMswServer() from
   "@queuesprout/providers/testing" sets MSW 3's onUnhandledFrame: "error".
4. Run pnpm lint && pnpm typecheck && pnpm test before every commit.

## Code style
- TypeScript strict. No any. No non-null assertion without a comment explaining why.
- Zod at every boundary: forms, API, job payloads, adapter settings.
- Server Actions return { ok: true, data } or { ok: false, error }; never throw to the client.
- Store UTC; convert to the user's timezone only at the edges.
- Every web query goes through withWorkspace(). Never use the worker database role in apps/web.

## Safety
- PUBLISH_MODE is mock locally and in tests. Never set live in tests or for the demo workspace.
- Never commit secrets or print tokens in logs, errors or test snapshots.
- A schema change ships its Drizzle migration and RLS policy changes in the same PR.
- A change to the stack, schema strategy or scope needs an ADR and Rick's approval first.

## When you finish
- Add a row at the top of docs/private/progress-log.md (and the Project Reference doc): done, next,
  blockers, PR link.
