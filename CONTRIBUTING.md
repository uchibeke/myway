# Contributing to Myway

Thanks for your interest in contributing. This guide covers setup, conventions, and how to get a PR merged.

## Prerequisites

- **Node.js 22+** (see `.nvmrc` — run `nvm use` to auto-select)
- **yarn** — install with `npm install -g yarn`
- **AI backend** — either [OpenClaw](https://openclaw.ai) running locally, or any OpenAI-compatible API key (see [BYOK docs](docs/byok.md))
- **APort guardrails** (optional) — `npx @aporthq/aport-agent-guardrails`

## Local Setup

```bash
git clone https://github.com/uchibeke/myway && cd myway
yarn install
cp .env.local.example .env.local   # fill in your values
yarn db:init                        # create SQLite database
yarn dev                            # dev server on http://localhost:48291
```

## Project Structure

```
src/
  app/
    api/            API routes (aport, openclaw, connections, partner, cron)
    apps/           App pages — one directory per app
  components/       Shared UI components
    AppPage.tsx     Phone-card shell (390px mobile / 960px expanded)
    AppShell.tsx    Chat UI shell
    TransformerShell.tsx   Input-to-output transformer
    ButtonShell.tsx One-tap-to-output
    FeedShell.tsx   Scrollable feed
    PartnerAuthProvider.tsx  iframe partner auth (fetch override)
  lib/
    apps.ts         App registry — single source of truth for all apps
    partners.ts     Partner config registry, HMAC token/session validation
    tenant.ts       Tenant ID extraction from request headers
    aport/          APort integration (config, passport, kill-switch, audit)
    db/             SQLite layer + multi-tenant migrations
    store/          Resource handlers (CRUD per entity)
    connections/    External service integrations (Google, etc.)
  middleware.ts     Auth (session tokens + API tokens), rate limiting, CORS/CSP
```

## Adding a New App

1. Add one entry to the `APPS` array in `src/lib/apps.ts`
2. Create a `SKILL.md` at `~/.openclaw/workspace/skills/<slug>/SKILL.md`
3. If `interactionType: 'tool'` — create `src/app/apps/<slug>/page.tsx`
4. For `chat`, `transformer`, `button`, or `feed` types — no custom page needed, the dynamic route handles it

### Interaction Types

| Type | Shell | Use When |
|------|-------|----------|
| `chat` | AppShell | Conversational back-and-forth |
| `transformer` | TransformerShell | Paste input, get transformed output |
| `button` | ButtonShell | One tap, get a result |
| `feed` | FeedShell | Scrollable content feed |
| `tool` | Custom page | Complex UI with tabs, custom layout |

## Running Tests

```bash
yarn test             # unit tests (vitest)
yarn test:coverage    # with coverage report
yarn test:api         # API integration tests (needs running server)
```

Tests live in `__tests__/` at the repo root. When adding new modules, add corresponding tests.

## Code Conventions

- **TypeScript** everywhere — no `any` unless absolutely necessary
- **Tailwind** for styling — no CSS modules or inline style objects
- **Container queries** for responsive design: `@lg:` (512px+) and `@3xl:` (768px+) on the phone card container
- **Server components** by default — add `'use client'` only when needed
- **Next.js 16 params**: `params` is a Promise in dynamic routes — always `await params`

## Commit Messages

Use conventional commit style:

- `feat: add recipe import from URL`
- `fix: kill switch not updating passport status`
- `test: add connection crypto roundtrip test`
- `docs: update README setup steps`

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes with tests where applicable
3. Run `npx tsc --noEmit` to verify types
4. Run `yarn test --run` to verify tests pass
5. Open a PR with a clear description of what changed and why

## Private Apps

Myway supports private apps that aren't included in the open-source distribution. This is how the project owner runs proprietary apps (like a real estate pipeline or social media manager) alongside the public ones.

**How it works:** At startup, `src/lib/apps.ts` tries to `require('./apps-private')`. If the file exists, its apps are merged into the registry. If it doesn't exist (normal for OSS installs), the require fails silently — no error, no missing feature.

**To add your own private apps:**

1. Copy the template: `cp src/lib/apps-private.ts.example src/lib/apps-private.ts`
2. Add your app entries to the `PRIVATE_APPS` array
3. If `interactionType` is `'tool'`, create a custom page at `src/app/apps/<slug>/page.tsx`
4. Create a SKILL.md at `~/.openclaw/workspace/skills/<slug>/SKILL.md`

The `apps-private.ts` file is in `.gitignore` — it will never be committed or pushed.

## Partner Authentication

Myway supports embedding in partner platforms via iframe with HMAC-signed token authentication. If you're working on auth code:

- Partner config: `src/lib/partners.ts` — scans `MYWAY_PARTNER_<ID>_SECRET` env vars at startup
- Token exchange: `src/app/api/partner/auth/route.ts` — POST-only, exempt from auth in middleware
- Client auth: `src/components/PartnerAuthProvider.tsx` — reads `?partnerToken=` URL param, exchanges for session, overrides `window.fetch`
- Middleware: `src/middleware.ts` — validates session tokens using **Web Crypto API** (Edge Runtime compatible, not Node.js `crypto`)
- Session tokens: same `base64url.hmac_hex` format, signed with `MYWAY_SECRET`, 15-minute expiry
- Tenant isolation: validated session userId is injected as `X-Myway-User-Id` header by middleware → `getTenantId()` reads it unchanged

**Important:** Middleware runs in Next.js Edge Runtime. Do not use Node.js `crypto` (`createHmac`, `timingSafeEqual`) in `middleware.ts` — use Web Crypto API (`crypto.subtle`) and pure-JS constant-time comparison instead.

See [docs/partner-integration.md](docs/partner-integration.md) for the full partner-facing integration guide.

## APort Integration

Myway ships with APort agent guardrails built in. If you're working on guardrails code:

- APort config: `src/lib/aport/config.ts` — auto-detects local/API/hosted mode
- Passport is the single source of truth — no separate kill-switch files
- Kill switch sets `passport.json` status to `suspended` (local) or calls API (hosted)
- Myway does NOT enforce policies — APort guardrail script handles that at the OpenClaw level
- All APort tests are in `__tests__/aport/`

## Questions?

Open an issue on GitHub. For APort-specific questions, see the [APort guardrails repo](https://github.com/aporthq/aport-agent-guardrails).
