# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0] — 2026-03-11

### Added

- **Non-interactive CLI** — `npx @uchibeke/myway` now supports flags (`--ai-mode`, `--ai-url`, `--ai-key`, `--ai-model`, `--openclaw-url`, `--root`, `--port`, `--no-aport`) for fully automated setup by agents and CI. Early validation catches bad inputs before slow operations.
- **Auto-start and browser open** — interactive setup now asks "Start Myway now?" and auto-opens the browser when the server is ready. `--start` flag for non-interactive mode.
- **Agent Skills (SKILL.md)** — two skills following the Agent Skills standard: `myway-byok` and `myway-openclaw`, enabling setup via any of 40+ AI agents (Claude Code, Cursor, Copilot, Gemini CLI, etc.) through [skills.sh](https://skills.sh).
- **PM2 crash loop protection** — `ecosystem.config.cjs` now includes `max_restarts: 10`, `min_uptime: '5s'`, and `kill_timeout: 5000` to prevent infinite restart loops.
- **Partner authentication** — HMAC-signed token exchange for embedding Myway in partner platforms via iframe. Partners generate tokens with a shared secret; Myway validates and issues 15-minute session tokens. Env-var-driven: add `MYWAY_PARTNER_<ID>_SECRET` to onboard a partner with zero code changes.
- **Multi-tenant auth enforcement** — when any partner is configured, all API routes require valid session or API tokens. External `X-Myway-User-Id` headers are stripped to prevent spoofing.
- **Auto CORS/CSP merge** — partner domains from `MYWAY_PARTNER_<ID>_DOMAINS` are automatically added to CORS and CSP frame-ancestors.
- **Partner integration guide** — [docs/partner-integration.md](docs/partner-integration.md) with code examples in Node.js, Python, and Go.
- **Token generation script** — `scripts/generate-partner-token.ts` for testing partner auth flows.

### Security

- CLI now double-quotes all `.env.local` values to prevent `#` comment truncation and `$` variable expansion
- CLI validates port (numeric, 1–65535) and URL flags (`http://`/`https://` required) before any slow operations
- Partner auth error messages no longer reveal whether a partner ID exists (prevents enumeration)
- Partner auth endpoint rejects tokens larger than 4KB
- Partner auth errors are now logged server-side for operational visibility
- Signal trap added for clean server shutdown when using `--start`

## [0.1.0] — 2026-03-02

Initial open-source release.

### Added

- **App registry** — single source of truth in `src/lib/apps.ts` for all apps, with typed fields for identity, autonomy, storage, and interaction type
- **5 interaction shells** — Chat (AppShell), Transformer, Button, Feed, and Tool (custom page) — all generic and app-agnostic
- **Dynamic routing** — `/apps/[id]` auto-routes to the correct shell based on `interactionType`; only `tool` apps need custom pages
- **Private apps pattern** — `apps-private.ts` (gitignored) lets owners run proprietary apps alongside the open-source registry
- **Home screen** — 5-layer architecture with dock, spaces, cards, and ambient status
- **Connections** — Gmail and Google Calendar integration with encrypted OAuth token storage (AES-256-GCM)
- **Email briefings** — HTML email delivery via Gmail API with auto-execution support
- **APort guardrails** — live feed, passport reader, kill switch, audit log parser, with 6 test files
- **Notification system** — DB-backed with lifecycle states and typed categories
- **File browser** — virtual symlinks (MYWAY_LINKS), preview, download, and raw file access
- **Middleware** — API token auth + sliding-window rate limiting (60 req/min on expensive routes)
- **SQLite database** — migrations, resource stores, connection token encryption
- **CI/CD** — GitHub Actions with type-check, unit tests, build, and integration tests
- **PWA** — glassmorphism design, phone-card desktop pattern (390x844px), container queries
- **CLI setup wizard** — `npx @uchibeke/myway` scaffolds, configures, and starts Myway interactively

### Infrastructure

- MIT license
- Node 22+ (.nvmrc)
- Next.js 16 (App Router) + Tailwind + TypeScript
- Vitest for unit tests, shell scripts for API integration tests
- ESLint with TypeScript parser, React Hooks, and Next.js rules
- npm package `@uchibeke/myway` with `bin` CLI for `npx` usage
- PM2 config template (`ecosystem.config.cjs.example`)
- `.env.local.example` with all supported environment variables documented
