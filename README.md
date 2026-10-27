# QueueSprout

**Decide what to create, make it, publish it, learn from it.** An open-source content suite for
solo creators, freelancers and small agencies: four modules that share one workflow, so every
post links back to the idea behind it and every result informs the next idea.

| Module           | Answers                                        | Status                |
| ---------------- | ---------------------------------------------- | --------------------- |
| **Intelligence** | What should I create, and why?                 | Planned               |
| **Studio**       | How should I create it?                        | Planned               |
| **Publisher**    | When and where should I publish it?            | In progress (Phase 2) |
| **Insights**     | What worked, and what should I do differently? | Planned               |

- **Intelligence** researches a topic from a small set of reliable sources, keeps every claim
  linked to its source, scores ideas on explicit criteria and produces a content brief.
- **Studio** turns an approved brief into text posts, captions and short-form video scripts in
  the workspace's brand voice, flags unsupported claims, and needs explicit approval before
  handing off.
- **Publisher** schedules and publishes posts across 12 target channels, with a public API and
  webhooks for n8n, Make and AI agents.
- **Insights** pulls performance per post, compares topics and formats against a transparent
  baseline, and suggests the next experiment instead of claiming causes.

Each client or brand gets its own workspace, and what one workspace learns never shapes
another's. AI features use your own provider key, a local Ollama model, or a mock mode for
demos, so the hosted app adds no AI markup.

> Status: **Publisher, Phase 2 (media and deploy).** Sign-in, workspaces, invites and roles work.
> Posts and threads with images publish to Bluesky, Mastodon, Discord, Telegram and Slack, with
> retries and a calendar to reschedule. Review-gated channels come next, then the Intelligence,
> Studio and Insights MVPs, then video.

Inspired by [Postiz](https://github.com/gitroomhq/postiz-app) in concept only: this is a
clean-room build with no shared code (ADR-003).

## Channels

| Open (no review gate)                       | Review-gated                                            | Video-first     |
| ------------------------------------------- | ------------------------------------------------------- | --------------- |
| Bluesky, Mastodon, Discord, Telegram, Slack | LinkedIn, Pinterest, Facebook Pages, Instagram, Threads | YouTube, TikTok |

## Stack

TypeScript everywhere in a pnpm + Turborepo monorepo.

| Layer    | Choice                                                                         |
| -------- | ------------------------------------------------------------------------------ |
| Web      | Next.js 16 (App Router), React 19, Tailwind CSS v4                             |
| Auth     | Better Auth: magic link, Google, GitHub (sessions in Postgres)                 |
| Database | Postgres 16 + Drizzle ORM, row-level security on every tenant table            |
| Jobs     | pg-boss in a long-running Node worker (no Redis)                               |
| Storage  | Any S3-compatible bucket: Supabase Storage in the cloud, SeaweedFS self-hosted |
| Tests    | Vitest, real-Postgres integration tests, MSW for platform APIs                 |

## Architecture

```text
browser ──► apps/web (Next.js: UI, Server Actions, /api/v1, OAuth callbacks)
   │              │ writes posts, never publishes
   │              ▼
   │         Postgres  ◄── apps/worker (dispatcher, publish steps, token refresh)
   │                              │ the only caller of platform APIs
   └── presigned upload ─► S3 bucket ◄┘
```

The web app and the worker never call each other: they meet in Postgres, so either can restart
without losing a scheduled post. Tenancy is enforced twice: every query runs through
`withWorkspace()`, which sets `app.user_id` for the transaction, and RLS policies check it.

```text
apps/
  web/        Next.js app
  worker/     Node worker
packages/
  shared/     Zod schemas, types, constants
  core/       Domain logic and token encryption (no framework, no I/O)
  db/         Drizzle schema, migrations, RLS, data access
  providers/  One adapter per channel, the adapter contract, the sandbox mock adapter
  auth/       Better Auth config and role checks
  storage/    S3 client and presigned URLs
  ui/         Design tokens and shared components
  config/     tsconfig presets
deploy/       Production setup: Supabase SQL, worker Compose file
docker/       Compose files
```

Package boundaries are lint rules, so `pnpm lint` fails if, say, `core` imports the database.

## Run it locally

Requirements: Node 22.12+, Docker, and Corepack (ships with Node).

```bash
corepack enable
pnpm install
cp .env.example .env            # set BETTER_AUTH_SECRET and TOKEN_ENCRYPTION_KEY
                                # (each: openssl rand -base64 32)
pnpm services:up                # Postgres + SeaweedFS
pnpm db:migrate
pnpm dev                        # http://localhost:3000
```

Without `RESEND_API_KEY`, sign-in and invite links print to the terminal running `pnpm dev`.
Google and GitHub buttons appear once their client id and secret are set in `.env`.

Publishing runs in **mock mode** by default (`PUBLISH_MODE=mock`): the full pipeline runs with
zero platform calls. Live publishing is for production only. In mock mode, text containing
`[[mock:rate_limit]]`, `[[mock:auth]]`, `[[mock:transient]]` or `[[mock:timeout]]` fails that
way, to exercise retries.

| Command                                      | What it does                                             |
| -------------------------------------------- | -------------------------------------------------------- |
| `pnpm dev`                                   | Web and worker in watch mode                             |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | The checks CI runs                                       |
| `pnpm test:integration`                      | RLS and pipeline tests on Postgres (`TEST_DATABASE_URL`) |
| `pnpm db:generate`                           | Generate a migration after a schema change               |
| `pnpm db:migrate`                            | Apply migrations (owner role)                            |

## Self-hosting

A four-container Docker Compose stack (web, worker, Postgres, SeaweedFS) and a setup guide per
platform arrive with the launch phase.

## License

[AGPL-3.0](LICENSE). The repository is read-only: see [CONTRIBUTING.md](CONTRIBUTING.md).
