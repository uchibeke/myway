# CLAUDE.md — Project Rules for AI Agents

## Production Safety

If this repo is cloned onto a server running a live Myway instance:

- **NEVER modify `.env.local`** — it contains real secrets. Overwriting it breaks the live site.
- **NEVER run `bin/myway` from inside a live deployment** — the CLI detects "existing installation" and overwrites `.env.local`.
- **NEVER run e2e/integration tests in a live deployment directory** — use `/tmp/` or isolated paths.
- **All dev/testing must use isolated directories**: `/tmp/`, Docker, or git worktrees.

## Project Conventions

- **Package manager**: yarn (not npm)
- **Node**: 22+ (see .nvmrc)
- **Framework**: Next.js 16, App Router, TypeScript, Tailwind
- **Database**: SQLite via better-sqlite3
- **Tests**: `npx vitest run`
- **Lint**: `yarn lint`
- **Default port**: 48291

## PM2 Deployment

```bash
yarn build
pm2 delete myway 2>/dev/null; pm2 start ecosystem.config.cjs && pm2 save
```

Never use `pm2 restart` — it reuses stale dump config. Always delete + start.
