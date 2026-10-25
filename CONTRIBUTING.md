# Contributing

QueueSprout is a public, **read-only** portfolio project (ADR-001). The code is open so you can
read it, learn from it, and self-host it under the AGPL-3.0, but **pull requests are not
accepted** and will be closed without review. Please don't take it personally: it keeps the
project a clear record of one person's work.

What is welcome:

- **Forks.** Fork it and build your own version. The AGPL-3.0 requires that if you run a
  modified version as a network service, you offer its source to its users.
- **Security reports.** If you find a vulnerability, email the address on the privacy page
  instead of opening a public issue.

## Working on your fork

```bash
corepack enable          # uses the pnpm version pinned in package.json
pnpm install
cp .env.example .env     # then set BETTER_AUTH_SECRET
pnpm services:up         # Postgres + SeaweedFS in Docker
pnpm db:migrate
pnpm dev                 # web on :3000, worker alongside
```

Before every commit: `pnpm lint && pnpm typecheck && pnpm test`. See `CLAUDE.md` for the
package boundaries and conventions the codebase follows.
