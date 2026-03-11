# Myway

Self-hosted personal AI app — tasks, briefings, file browser, recipe vault, bedtime stories, and a live feed of every action your AI agent takes. Runs locally with [OpenClaw](https://openclaw.ai) and ships with [APort agent guardrails](https://github.com/aporthq/aport-agent-guardrails) baked in.

No cloud. No subscription. Your agent, your data, your machine.

---

## Three ways to run Myway

| Mode | What it is | AI Backend | Status |
|------|-----------|------------|--------|
| **OpenClaw** | Full-featured self-hosted setup with local AI gateway | [OpenClaw](https://openclaw.ai) | Tested, recommended |
| **BYOK** | Bring your own API key — any OpenAI-compatible provider | OpenAI, Ollama, Gemini, OpenRouter, LiteLLM, Together AI, etc. | Works, needs more testing |
| **Hosted** | Multi-tenant cloud deployment (e.g. [myway.sh](https://myway.sh)) | Platform-configured | Tested in production |

**OpenClaw** gives you everything: all apps, APort guardrails, cron jobs, agent orchestration. **BYOK** gets you the core apps (chat, tasks, briefings, recipes, Somni, etc.) with any provider — but APort guardrails and some agent features require OpenClaw. **Hosted** adds authentication, per-user database isolation, billing, and tenant management on top of either backend.

See [docs/byok.md](docs/byok.md) for BYOK provider-specific setup and known limitations.

---

## What it does

| App | What it is |
|-----|-----------|
| **Guardrails** | Live feed of every agent action — blocked or allowed — from APort |
| **Tasks** | AI task manager with ambient monitoring and nudges |
| **Briefing AI** | Morning brief, evening recap, mid-day check-ins |
| **Mise** | Recipe vault with dinner suggestions and weekly meal plans |
| **Files** | Browser + editor for your server — no SSH needed |
| **Somni** | AI bedtime stories that know your day |
| **Roast Me** | Feed it anything. Get a savage but loving roast |
| **Drama Mode** | Paste anything. Get the most dramatic rewrite possible |
| **Decode** | Reads subtext in any message and crafts the perfect reply |
| **Chat** | Direct line to your OpenClaw agent |
| **Settings** | Connections, OAuth, delivery channels, system health |

---

## APort Guardrails

The Guardrails app shows you exactly what your AI agent is doing:

- **Live Feed** — every tool call, allowed or blocked, streamed in real time via SSE
- **Passport** — your APort passport status, capabilities, and assurance level
- **Kill Switch** — one button that blocks all agent actions immediately

Supports all three APort evaluation modes:

| Mode | Passport | Policy Evaluation | Kill Switch |
|------|----------|-------------------|-------------|
| **Local** | File on disk | Local bash script | Passport status field |
| **API** | File on disk | APort API | Passport status field |
| **Hosted** | APort registry | APort API | API suspend |

Mode is auto-detected from your OpenClaw plugin config. See [APort setup](#aport-setup) below.

Built on [APort agent guardrails](https://github.com/aporthq/aport-agent-guardrails). Every Myway install is an APort install.

---

## Requirements

- **Node.js 22+**
- **AI backend** — one of:
  - **[OpenClaw](https://openclaw.ai)** — local AI gateway (recommended, all features)
  - **Any OpenAI-compatible API** — OpenAI, Gemini, OpenRouter, Ollama, LiteLLM, Together AI, vLLM, etc. See [BYOK docs](docs/byok.md).
- **[APort agent guardrails](https://github.com/aporthq/aport-agent-guardrails)** — optional. Without it, the Guardrails app shows a "not configured" state.

---

## Quick Start

### Option A — npx (recommended)

Interactive setup:

```bash
npx @uchibeke/myway
```

The wizard scaffolds a new directory, installs dependencies, prompts for your AI backend (OpenClaw or BYOK), generates secrets, builds for production, and offers to start the server. When it starts, it auto-opens your browser.

Non-interactive setup (for scripts, agents, CI):

```bash
# With OpenClaw
npx @uchibeke/myway my-app --ai-mode openclaw --start

# With your own API key (BYOK)
npx @uchibeke/myway my-app \
  --ai-mode byok \
  --ai-url https://api.openai.com/v1 \
  --ai-key sk-your-key \
  --ai-model gpt-4o \
  --start
```

Other options:

```bash
npx @uchibeke/myway my-app          # scaffold in ./my-app
npx @uchibeke/myway --setup         # reconfigure an existing install
npx @uchibeke/myway --help          # see all flags
```

### Option B — git clone

```bash
git clone https://github.com/uchibeke/myway && cd myway
yarn install
cp .env.local.example .env.local
```

Edit `.env.local` with your values:

```bash
# Required
MYWAY_ROOT=/path/to/your/vault     # directory for the file browser
MYWAY_SECRET=$(openssl rand -hex 32)

# AI backend — pick ONE:
# Option A: OpenClaw (default)
OPENCLAW_BASE_URL=http://localhost:18789
OPENCLAW_GATEWAY_TOKEN=your_token   # from: openclaw gateway status

# Option B: BYOK — any OpenAI-compatible API (see docs/byok.md)
# MYWAY_AI_BASE_URL=http://localhost:11434/v1   # Ollama (local, no key)
# MYWAY_AI_BASE_URL=https://api.openai.com/v1   # OpenAI
# MYWAY_AI_TOKEN=sk-...
# MYWAY_AI_MODEL=gpt-4o
```

Initialize and start:

```bash
yarn db:init             # create SQLite database (first run only)
yarn build               # production build
yarn start               # start on port 48291
```

Or with PM2 (install globally first: `npm install -g pm2`):

```bash
cp ecosystem.config.cjs.example ecosystem.config.cjs
pm2 start ecosystem.config.cjs
```

Open [http://localhost:48291](http://localhost:48291).

---

## APort Setup

### Option A — Interactive setup (recommended)

```bash
npx @aporthq/aport-agent-guardrails
```

This detects your OpenClaw installation, creates a passport, and configures the guardrail script. The Guardrails app in Myway auto-detects the config.

### Option B — Framework-specific

```bash
npx @aporthq/aport-agent-guardrails openclaw
```

### Option C — Hosted passport

```bash
npx @aporthq/aport-agent-guardrails ap_your_agent_id
```

For hosted mode, your agent's passport lives in the APort registry at [aport.io](https://aport.io). The kill switch suspends the passport via the API — all agents using that ID are blocked within seconds.

### Mode auto-detection

Myway reads your OpenClaw plugin config (`~/.openclaw/openclaw.json`) to determine the APort mode:

```jsonc
// Local mode (default)
"openclaw-aport": {
  "config": {
    "mode": "local",
    "passportFile": "~/.openclaw/aport/passport.json"
  }
}

// API mode with hosted passport
"openclaw-aport": {
  "config": {
    "mode": "api",
    "agentId": "ap_your_agent_id",
    "apiUrl": "https://api.aport.io",
    "apiKey": "your_api_key"
  }
}
```

You can also override via environment variables — see `.env.local.example`.

---

## Hosted Mode (Public Deployment)

If you're deploying Myway as a public service (e.g. `myway.sh`), you need hosted mode. This adds authentication, tenant isolation, and filesystem sandboxing so multiple users can safely share the same instance.

**What changes in hosted mode:**

| Concern | Self-hosted | Hosted |
|---------|-------------|--------|
| Authentication | None required | All routes require login |
| Database | Single shared DB | Per-user isolated DB |
| File browser | Your local filesystem | Artifact storage (DB-backed, quota-enforced) |
| Visitors | Full access | Landing page only |

**Minimum setup:**

```bash
# Add to .env.local
MYWAY_BASE_DOMAIN=myway.sh          # your public domain
MYWAY_SECRET=$(openssl rand -hex 32) # 32-byte secret (REQUIRED, min 32 hex chars)
MYWAY_ADMIN_EMAILS=admin@example.com # who can access /apps/admin (REQUIRED for hosted)
```

Hosted mode activates when **any** of these env vars are set:
- `MYWAY_BASE_DOMAIN` — public domain deployment
- `MYWAY_PARTNER_<ID>_SECRET` — partner integration (see below)
- `MYWAY_API_TOKEN` — API token auth

For billing and quotas, also configure the AppRoom integration vars in `.env.local.example`.

**Security hardening in hosted mode:**
- All API routes and pages require authentication (except `/` landing page)
- Each user gets an isolated SQLite database — no cross-tenant access
- Server filesystem is never exposed (files use quota-enforced artifact storage)
- OAuth redirect URIs validated against `MYWAY_BASE_DOMAIN`
- System info endpoints (hostname, kernel, PID) are redacted for non-admin users
- `X-Myway-User-Id` headers are stripped from incoming requests (anti-spoofing)
- Auth endpoints are rate-limited (10 req/min per IP)
- Admin panel requires `MYWAY_ADMIN_EMAILS` — if unset, admin access is denied

**Self-hosted users: you don't need any of this.** Without these env vars, Myway runs fully open on localhost — no auth, no tenant isolation, direct filesystem access. Nothing changes for you.

---

## Platform Mode (Partner Embedding)

Myway can be embedded in other platforms (like AppRoom) via iframe with per-user tenant isolation. Each partner authenticates users via HMAC-signed tokens.

**How it works:**

1. Partner backend signs a token with a shared secret
2. Embeds Myway in an iframe: `<iframe src="https://myway.host/apps/chat?partnerToken=TOKEN">`
3. Myway validates the signature, issues a session token, and isolates the user's data

**Quick setup:**

```bash
# Generate a shared secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Add to .env.local
MYWAY_PARTNER_APPROOM_SECRET=<the secret>
MYWAY_PARTNER_APPROOM_DOMAINS=approom.ai
```

When any partner secret is configured:
- All API routes require authentication
- Partner domains are auto-added to CORS and CSP
- External `X-Myway-User-Id` headers are stripped (anti-spoofing)
- Self-hosted mode (no partners) remains fully open — no breaking changes

For the full integration guide with code examples in Node.js, Python, and Go, see **[docs/partner-integration.md](docs/partner-integration.md)**.

---

## Environment Variables

See [`.env.local.example`](.env.local.example) for the full list with comments.

### Required

| Variable | Description |
|----------|-------------|
| `MYWAY_ROOT` | Path to your vault root (exposed in the file browser). Self-hosted only — hosted mode uses artifact storage instead. |
| `MYWAY_SECRET` | 32-byte hex secret for OAuth encryption and auth (`openssl rand -hex 32`) |

Plus **one** AI backend — OpenClaw or BYOK:

| OpenClaw | BYOK (any OpenAI-compatible API) |
|----------|----------------------------------|
| `OPENCLAW_BASE_URL` | `MYWAY_AI_BASE_URL` |
| `OPENCLAW_GATEWAY_TOKEN` | `MYWAY_AI_TOKEN` (optional for Ollama) |
| | `MYWAY_AI_MODEL` (optional) |

See [docs/byok.md](docs/byok.md) for provider-specific examples.

### Optional — APort Guardrails

| Variable | Default | Description |
|----------|---------|-------------|
| `APORT_MODE` | Auto-detected | `local`, `api`, or omit for auto-detection from OpenClaw config |
| `APORT_PASSPORT_FILE` | `~/.openclaw/aport/passport.json` | Local passport file path |
| `APORT_AUDIT_LOG` | `~/.openclaw/aport/audit.log` | Audit log file path |
| `APORT_API_URL` | `https://api.aport.io` | APort API base URL (API/hosted mode) |
| `APORT_API_KEY` | — | API key (API/hosted mode + org provisioning) |
| `APORT_AGENT_ID` | — | Agent ID like `ap_xxxx` (hosted mode) |
| `APORT_ORG_ID` | — | Org ID for auto-provisioning passports to new users (hosted mode) |

### Optional — Partner Authentication (Platform Mode)

For embedding Myway in another platform via iframe with per-user tenant isolation. See [docs/partner-integration.md](docs/partner-integration.md) for the full integration guide.

| Variable | Description |
|----------|-------------|
| `MYWAY_PARTNER_<ID>_SECRET` | Shared HMAC secret for a partner (32+ hex chars). Enables auth on all API routes. |
| `MYWAY_PARTNER_<ID>_DOMAINS` | Comma-separated allowed domains. Auto-added to CORS + CSP. |
| `MYWAY_PARTNER_<ID>_NAME` | Display name (defaults to capitalized ID) |

Example: `MYWAY_PARTNER_APPROOM_SECRET=...` creates partner ID `approom`.

### Optional — Hosted Mode

For deploying Myway as a public service. Self-hosted users can ignore this section entirely.

| Variable | Description |
|----------|-------------|
| `MYWAY_BASE_DOMAIN` | Public domain (e.g. `myway.sh`). Enables auth enforcement + subdomain tenant binding. |
| `MYWAY_API_TOKEN` | API bearer token. When set, all `/api/*` routes require `Authorization: Bearer <token>`. |
| `MYWAY_APPROOM_URL` | AppRoom backend URL for billing/quotas |
| `MYWAY_INSTANCE_ID` | Instance ID for AppRoom (e.g. `prod`) |
| `MYWAY_MAX_FREE_SPEND` | Max USD/month for free-tier users (default: no limit) |
| `MYWAY_MAX_PAID_SPEND` | Max USD/month for paid users (default: no limit) |

### Optional — Integrations

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (for Gmail + Calendar sync) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (for message delivery) |
| `LMNT_API_KEY` | LMNT TTS provider key |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS provider key |

---

## Development

```bash
yarn dev             # Next.js dev server on :48291
yarn test            # Run unit tests (vitest)
yarn test:coverage   # Tests with coverage report
yarn db:init         # (Re)initialise the database
yarn db:status       # Show table row counts
```

---

## Architecture

Next.js 16 (App Router) with local SQLite. No cloud services required.

```
src/
  app/
    api/            # API routes
      aport/        # APort guardrails endpoints
      partner/      # Partner auth token exchange
    apps/           # App pages (one per app)
  components/       # Shared UI components
    AppPage.tsx     # Phone-card shell (390px mobile / 960px expanded)
    AppShell.tsx    # Chat UI shell
    TransformerShell.tsx  # Input→output transformer
    ButtonShell.tsx # One-tap→output
    PartnerAuthProvider.tsx  # iframe auth (fetch override)
  lib/
    apps.ts         # App registry — single source of truth
    partners.ts     # Partner config, HMAC token/session validation
    tenant.ts       # Tenant ID extraction from request headers
    aport/          # APort integration layer
    db/             # SQLite layer + multi-tenant migrations
    store/          # Resource handlers (one per entity)
  middleware.ts     # Auth, rate limiting, CORS/CSP, header injection
```

### Interaction shells

Each app has an `interactionType` that maps to a shell:

| Type | Shell | Example |
|------|-------|---------|
| `chat` | AppShell | Chat, Forge, Decode |
| `transformer` | TransformerShell | Drama Mode, Office Translator |
| `button` | ButtonShell | Compliment Avalanche |
| `tool` | Custom page | Guardrails, Files, Mise |

### Adding a new app

1. Add one entry to `APPS` in `src/lib/apps.ts`
2. Add a skill prompt: `~/.openclaw/workspace/skills/<slug>/SKILL.md` (OpenClaw) or `src/lib/skills/<slug>.md` (bundled)
3. If `interactionType: 'tool'` — add a `src/app/apps/<slug>/page.tsx`
4. That's it — opener, header, gradients, chat UI all auto-generate

---

## Tests

**Unit tests** — modules only, no server needed:
```bash
yarn test --run
```
```
Test Files: 8 passed
Tests:      65 passed
```

**API integration tests** — runs against a live server:
```bash
# Start Myway first, then:
yarn test:api
```
```
Results: 10/10 passed
```

CI runs both suites automatically. See `.github/workflows/ci.yml`.

---

## License

MIT

---

*Ships with [APort agent guardrails](https://github.com/aporthq/aport-agent-guardrails). Built on [OpenClaw](https://openclaw.ai).*
