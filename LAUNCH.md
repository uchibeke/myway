# Myway v0.1.0 — Launch Guide

## Server Migration Checklist

### Prerequisites
- Node.js 22+
- SQLite3 (bundled via better-sqlite3)
- Domain with HTTPS (required for auth cookies)

### Environment Variables

**Required:**
```env
MYWAY_SECRET=<64-char-hex-string>          # Session signing, encryption key. Generate:
                                             # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**OpenClaw mode (self-hosted, no billing):**
```env
OPENCLAW_BASE_URL=http://localhost:18789     # OpenClaw gateway
OPENCLAW_GATEWAY_TOKEN=<your-token>          # Gateway auth token
```

**BYOK mode (bring your own keys):**
```env
MYWAY_AI_BASE_URL=https://api.openai.com/v1   # Any OpenAI-compatible API
MYWAY_AI_TOKEN=sk-...                          # API key for the provider
MYWAY_AI_MODEL=gpt-4o                          # Default model
```

**Hosted mode (full platform with billing via AppRoom):**
```env
# AppRoom connection (server-to-server)
MYWAY_APPROOM_URL=https://approom.ai           # AppRoom base URL
MYWAY_PARTNER_APPROOM_SECRET=<64-char-hex>     # Shared HMAC secret (same value as MYWAY_PARTNER_SECRET in AppRoom)
MYWAY_PARTNER_APPROOM_DOMAINS=approom.ai       # Comma-separated domains for CORS/CSP
MYWAY_PARTNER_APPROOM_NAME=AppRoom             # Display name

# Admin + auth
MYWAY_API_TOKEN=<hex-string>                   # Admin bearer token for API access
MYWAY_INSTANCE_ID=prod                         # Instance identifier sent to AppRoom

# Public URLs
NEXT_PUBLIC_APP_URL=https://myway.example.com  # Myway public URL (used in Stripe success/cancel URLs)
NEXT_PUBLIC_APPROOM_URL=https://approom.ai      # Client-side AppRoom URL (session refresh, error pages)
```

**Optional:**
```env
MYWAY_DATA_DIR=~/.myway/data               # SQLite + audit logs location
MYWAY_ROOT=/home/user/vault                  # File browser root directory
MYWAY_ALLOWED_ORIGINS=https://approom.ai     # CORS + CSP frame-ancestors (merged with partner domains)
MYWAY_MODEL_PRICING=my-model:0.50:2.00       # Override model pricing (name:input:output per 1M tokens)
MYWAY_BASE_DOMAIN=myway.sh                   # Subdomain-based tenant binding (e.g. user.myway.sh)
```

### Deployment Steps

1. **Clone and install:**
   ```bash
   git clone <repo> myway && cd myway
   npm install
   ```

2. **Build:**
   ```bash
   npm run build
   ```

3. **Set up data directory:**
   ```bash
   mkdir -p ~/.myway/data
   # Migrations run automatically on first request
   ```

4. **Start:**
   ```bash
   npm start
   # Or with PM2:
   pm2 start npm --name myway -- start
   ```

5. **Verify:**
   - `GET /api/health` should return `{"status":"ok"}`
   - Visit the home page, check that apps load
   - Check `~/.myway/data/myway.db` was created

### Database

- SQLite, stored at `$MYWAY_DATA_DIR/myway.db`
- Migrations auto-run (001-020 currently)
- Multi-tenant: each tenant gets `$MYWAY_DATA_DIR/tenants/<id>/myway.db`
- Audit log: `$MYWAY_DATA_DIR/auth-audit.log` (JSON Lines)

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name myway.example.com;

    location / {
        proxy_pass http://127.0.0.1:48291;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

---

## AppRoom Setup (Cloudflare)

AppRoom runs on Cloudflare Pages + D1 + KV.

### Cloudflare Resources

| Resource | Type | Purpose |
|----------|------|---------|
| D1 Database | `approom-db` | Users, skills, installations, addon transactions, quotas |
| KV Namespace | `approom-kv` | Rate limiting, session cache |
| Pages Project | `approom` | Next.js app via `@cloudflare/next-on-pages` |

### AppRoom Environment Variables (Cloudflare Dashboard → Settings → Variables)

**Required:**
```env
JWT_SECRET=<64-char-hex-string>              # Token signing (generate same way as MYWAY_SECRET)
STRIPE_SECRET_KEY=sk_live_...                # Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_...              # From Stripe webhook endpoint config
NEXT_PUBLIC_APP_URL=https://approom.ai       # AppRoom public URL
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
RESEND_API_KEY=re_...                        # Transactional email via Resend
```

**Myway Integration (must match Myway's config):**
```env
MYWAY_PARTNER_SECRET=<64-char-hex>          # Same value as MYWAY_PARTNER_APPROOM_SECRET in Myway
```

**MFA (optional but recommended):**
```env
TOTP_ENCRYPTION_KEY=<64-char-hex>            # Encrypts TOTP secrets at rest. Generate:
                                              # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Optional:**
```env
GITHUB_CLIENT_ID=...                         # GitHub OAuth for login
GITHUB_CLIENT_SECRET=...
ADMIN_EMAILS=admin@approom.ai                # Comma-separated admin emails
MAIL_DOMAIN=mail.approom.ai                  # Email sender domain
```

### Stripe Webhook Setup

1. Go to https://dashboard.stripe.com/webhooks
2. Add endpoint: `https://approom.ai/api/stripe/webhook`
3. Events to listen for:
   - `checkout.session.completed` — subscriptions + addon purchases
   - `customer.subscription.updated` — plan changes
   - `customer.subscription.deleted` — cancellations
4. Copy the signing secret → set as `STRIPE_WEBHOOK_SECRET`

### D1 Migrations

```bash
# Apply all migrations (run from approom-marketplace repo)
for f in migrations/*.sql; do
  npx wrangler d1 execute approom-db --file="$f"
done
```

**Important**: Migration 012 creates `addon_transactions` and `user_app_quotas`. Migration 019 ALTERs them to the schema expected by the webhook and usage API. They must run in order.

### Deployment

```bash
npm run build
npx wrangler pages deploy .vercel/output/static
```

---

## Cross-Repo Secret Alignment

The shared HMAC secret must be identical on both sides:

| Myway env var | AppRoom env var | Purpose |
|----------------|-----------------|---------|
| `MYWAY_PARTNER_APPROOM_SECRET` | `MYWAY_PARTNER_SECRET` | Signs all Myway→AppRoom API calls (usage reports, quota checks, addon checkout, email notifications) |

Generate once, set in both:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Addon Purchase Flow (end-to-end)

```
User clicks "Buy more" in QuotaExceeded component
  → POST /api/addons/checkout (Myway)
    → HMAC-signed POST to AppRoom /api/addons/checkout
      → Creates Stripe checkout session (with requestId as idempotency key)
      → Returns checkoutUrl (validated as *.stripe.com before redirect)
  → User completes payment on Stripe
  → Stripe fires checkout.session.completed webhook → AppRoom /api/stripe/webhook
    → Idempotency check (stripe_session_id UNIQUE index)
    → INSERT into addon_transactions
    → UPSERT user_app_quotas (credits additional_quota)
  → User redirected to Myway success URL
```

---

## Architecture Overview

### How Modes Work

There is no `MYWAY_MODE` env var. The mode is implicit:
- **OpenClaw**: `OPENCLAW_BASE_URL` is set, no AppRoom vars → uses OpenClaw gateway
- **BYOK**: `MYWAY_AI_BASE_URL` is set → direct provider API calls
- **Hosted**: `MYWAY_APPROOM_URL` + `MYWAY_PARTNER_APPROOM_SECRET` are set → full platform with billing

### User Personas

| Persona | Config | Billing | Admin Tabs | AppRoom |
|---------|--------|---------|------------|---------|
| OpenClaw | `OPENCLAW_BASE_URL` | None | Usage + Costs | Not connected |
| BYOK | `MYWAY_AI_BASE_URL` | None | Usage + Costs | Optional |
| Hosted | `MYWAY_APPROOM_URL` + secret | AppRoom quota + addons | Users + Costs + Usage | Required |

### Key Subsystems

- **Apps**: Registered in `src/lib/apps.ts`, each with skills, tabs, categories
- **AI Chat**: SSE streaming via `/api/openclaw/chat` or direct provider APIs
- **Token Tracking**: Real-time extraction from SSE + cost estimation
- **Cron Engine**: Scheduled jobs with delivery endpoints
- **Profile Sync**: Syncs user profile to AppRoom
- **Quota Gate**: Checks AppRoom quotas, fail-closed on error
- **Admin Panel**: `/apps/admin` — financial analytics, user management
- **APort**: App marketplace passport system

### Service-to-Service Auth

Myway → AppRoom communication uses HMAC-SHA256 signatures:
- Header: `X-Myway-Signature: <hex-digest>`
- Header: `X-Myway-Instance: <instance-id>`
- Payload: JSON request body signed with the shared secret
- AppRoom verifies via `timingSafeEqual` on the computed HMAC

### API Routes (50+)

Core: `/api/health`, `/api/home/context`, `/api/auth/status`
Chat: `/api/openclaw/chat`, `/api/openclaw/context`
Settings: `/api/settings/profile`, `/api/settings/system`
Admin: `/api/admin/auth`, `/api/admin/tenants`, `/api/admin/costs`, `/api/admin/usage`, `/api/admin/usage/export`
Addons: `/api/addons/checkout`
Cron: `/api/cron`, `/api/cron/[id]`, `/api/cron/[id]/run`, `/api/cron/delivery`
Files: `/api/files`, `/api/files/upload`, `/api/files/download`, `/api/files/preview`, `/api/files/raw`
APort: `/api/aport/passport`, `/api/aport/events`, `/api/aport/events/stream`, `/api/aport/sync`, `/api/aport/kill-switch`

---

## Test Status

- **Myway**: 417 tests across 31 test files (vitest)
- **AppRoom**: 118 tests across 9 test files (vitest)
- **Total**: 535 tests, all passing

Run: `npx vitest run`

---

## Items 1-10 Implementation Status

| # | Item | Status |
|---|------|--------|
| 1 | Auth callback + session management | Done |
| 2 | Token tracking + usage sync to AppRoom | Done |
| 3 | Quota gating (fail-closed) | Done |
| 4 | Admin panel (Users + Usage tabs) | Done |
| 5 | Admin Costs tab (financial analytics) | Done |
| 6 | AppRoom Usage Dashboard | Done |
| 7 | Addon Purchase Flow (Stripe one-time) | Done |
| 8 | Notification Emails (4 templates) | Done |
| 9 | Security Hardening (rate limiting, audit trail, atomic ops) | Done |
| 10 | Seed apps, tests, documentation | Done |

---

## Security Measures

- **Auth**: HMAC-SHA256 session tokens, constant-time comparison, Edge Runtime compatible
- **Rate Limiting**: Per-IP sliding window, per-endpoint limits (chat=60/min, auth=10/min, addons=10/min)
- **Input Validation**: Regex ID format checks, integer bounds, Zod schemas
- **Path Traversal**: Strict alphanumeric pattern on TTS asset/voice IDs
- **Open Redirect**: checkoutUrl validated as `*.stripe.com`, appRoomUrl validated as HTTPS
- **CSRF**: Auth state cookie HMAC-bound to callback URL
- **Stripe Idempotency**: Myway generates requestId (UUID), AppRoom uses as Stripe idempotency key
- **Webhook Dedup**: SELECT-before-INSERT + UNIQUE index on stripe_session_id
- **Tenant Isolation**: Separate SQLite files per tenant, subdomain binding via MYWAY_BASE_DOMAIN
- **Encryption**: AES-256-GCM for OAuth tokens + passports, HKDF key derivation with unique IVs

---

## Post-Launch Improvements (v0.2 backlog)

### Myway Hardening
- Add retry logic (exponential backoff) to AppRoom quota checks for transient network failures
- Validate MYWAY_SECRET at boot for hosted mode (not lazily on first use)
- Make MAX_TENANTS (50) configurable via env var for large deployments
- Replace `console.log` in production code paths with structured logger

### Observability
- Distinguish timeout errors from network errors in AppRoom client
- Add `last_synced_at` display for stale quota cache warnings on home screen
