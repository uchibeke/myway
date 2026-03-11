# Partner Integration Guide

This guide explains how to embed Myway in your platform via iframe with cryptographically verified user authentication. Your backend signs HMAC tokens, Myway verifies them, and each user gets an isolated tenant database.

---

## Overview

```
┌──────────────────┐    HMAC token (URL param)    ┌──────────────────┐
│  Your Platform   │ ─────────────────────────────→│  Myway (iframe) │
│  (partner)       │    <iframe> embed             │  client JS       │
└──────────────────┘                               └────────┬─────────┘
                                                            │ POST /api/partner/auth
                                                            │ body: { token }
                                                            ▼
                                                   ┌──────────────────┐
                                                   │  Myway server   │
                                                   │  validates HMAC  │
                                                   │  returns session  │
                                                   └────────┬─────────┘
                                                            │ sessionToken (15 min)
                                                            ▼
                                                   ┌──────────────────┐
                                                   │  Client stores   │
                                                   │  in JS memory,   │
                                                   │  auto-injects on │
                                                   │  all /api/* calls│
                                                   └──────────────────┘
```

**Flow:**

1. Your backend creates an HMAC-signed token containing the user ID
2. You embed Myway in an iframe with `?partnerToken=<token>` in the URL
3. Myway's client JS reads the token, POSTs it to `/api/partner/auth`
4. Server validates signature + expiration → returns a 15-minute session token
5. Client overrides `window.fetch` to inject `Authorization: Bearer <session>` on all `/api/*` calls
6. Middleware validates the session token on each request and sets the tenant user ID

**No cookies** — the session token lives in JS memory only. This avoids third-party cookie restrictions in iframes.

---

## Setup (Myway side)

### 1. Generate a shared secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → e.g. a1b2c3d4e5f6...  (64 hex chars)
```

### 2. Add environment variables

Add these to Myway's `.env.local` (replace `YOURPLATFORM` with your partner ID in UPPER_CASE):

```bash
# Required — the shared HMAC secret
MYWAY_PARTNER_YOURPLATFORM_SECRET=a1b2c3d4e5f6...

# Optional — restrict to specific domains (comma-separated)
MYWAY_PARTNER_YOURPLATFORM_DOMAINS=yourplatform.com,staging.yourplatform.com

# Optional — display name (defaults to capitalized ID)
MYWAY_PARTNER_YOURPLATFORM_NAME=YourPlatform
```

The partner ID is derived from the env var name: `MYWAY_PARTNER_YOURPLATFORM_SECRET` → partner ID `yourplatform`.

### 3. Restart Myway

```bash
yarn build && pm2 restart myway
```

That's it on the Myway side. Setting the partner secret automatically:
- Enables authentication on all API routes
- Adds your domains to CORS and CSP frame-ancestors
- Strips any externally-provided `X-Myway-User-Id` headers (anti-spoofing)

---

## Setup (your platform side)

### 1. Generate HMAC tokens in your backend

Token format: `base64url(JSON_payload) + "." + hmac_sha256_hex(base64url_part, shared_secret)`

**Payload fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | yes | Unique user identifier — becomes the Myway tenant ID. Each user ID gets its own isolated database. |
| `partnerId` | string | yes | Must match your configured partner ID (lowercase). E.g. `yourplatform` |
| `timestamp` | number | yes | Unix milliseconds when the token was created |
| `expiresAt` | number | yes | Unix milliseconds when the token expires. Recommended: 5 minutes from now. |
| `metadata` | object | no | Optional key-value data passed through to the auth response |

**Node.js example:**

```javascript
const crypto = require('crypto');

function createMywayToken(userId) {
  const SHARED_SECRET = process.env.MYWAY_SHARED_SECRET;
  const PARTNER_ID = 'yourplatform';

  const payload = {
    userId,
    partnerId: PARTNER_ID,
    timestamp: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SHARED_SECRET)
    .update(encoded)
    .digest('hex');

  return `${encoded}.${signature}`;
}
```

**Python example:**

```python
import json, time, hmac, hashlib, base64

def create_myway_token(user_id: str, shared_secret: str) -> str:
    payload = {
        "userId": user_id,
        "partnerId": "yourplatform",
        "timestamp": int(time.time() * 1000),
        "expiresAt": int(time.time() * 1000) + 5 * 60 * 1000,
    }

    encoded = base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).rstrip(b"=").decode()

    signature = hmac.new(
        shared_secret.encode(),
        encoded.encode(),
        hashlib.sha256
    ).hexdigest()

    return f"{encoded}.{signature}"
```

**Go example:**

```go
func createMywayToken(userID, secret string) string {
    payload, _ := json.Marshal(map[string]interface{}{
        "userId":    userID,
        "partnerId": "yourplatform",
        "timestamp": time.Now().UnixMilli(),
        "expiresAt": time.Now().Add(5 * time.Minute).UnixMilli(),
    })

    encoded := base64.RawURLEncoding.EncodeToString(payload)
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write([]byte(encoded))
    sig := hex.EncodeToString(mac.Sum(nil))

    return encoded + "." + sig
}
```

### 2. Embed Myway in an iframe

```html
<iframe
  src="https://myway.yourhost.com/apps/chat?partnerToken=TOKEN_HERE"
  style="width: 100%; height: 600px; border: none;"
  allow="clipboard-write"
></iframe>
```

Generate the token server-side, inject it into the iframe `src` attribute. Do not expose the shared secret to the client.

You can embed any Myway page:
- `/apps/chat?partnerToken=...` — direct chat
- `/apps/drama?partnerToken=...` — drama mode
- `/apps/mise?partnerToken=...` — recipe vault
- `/?partnerToken=...` — home screen with all apps

### 3. Optional: white-label branding

Combine the partner token with branding URL params:

```
/apps/chat?partnerToken=TOKEN&brandName=YourApp&brandPrimary=2563eb&brandBg=0a0a0a
```

See the branding section in `.env.local.example` for all available params.

---

## API Reference

### POST `/api/partner/auth`

Exchange a partner HMAC token for a session token. This endpoint does not require authentication.

**Request:**

```json
{
  "token": "base64url_payload.hmac_signature"
}
```

**Success response (200):**

```json
{
  "success": true,
  "sessionToken": "base64url_session.hmac_signature",
  "userId": "user-123",
  "partnerId": "yourplatform",
  "expiresAt": 1772542190916
}
```

**Error response (401):**

```json
{
  "success": false,
  "error": "Token expired",
  "errorCode": "INVALID_TOKEN"
}
```

**Error codes:**

| Code | Meaning |
|------|---------|
| `MISSING_TOKEN` | No token in request body |
| `INVALID_TOKEN` | Token format invalid, signature mismatch, expired, unknown partner, or domain mismatch |
| `INTERNAL_ERROR` | Server error |

### Session token

The session token returned by `/api/partner/auth` is valid for **15 minutes**. It uses the same format (`base64url.hmac_hex`) but is signed with Myway's internal `MYWAY_SECRET`.

Myway's client-side `PartnerAuthProvider` handles this automatically — it reads the `partnerToken` from the URL, exchanges it, and injects the session token as `Authorization: Bearer <session>` on all `/api/*` calls via a `window.fetch` override.

On page refresh, the flow re-runs from the URL param (the partner token has a 5-minute lifetime, so refreshes within that window work).

---

## Security Model

### Tenant isolation

Each `userId` in the partner token maps to an isolated SQLite database via Myway's multi-tenant layer. User A cannot access User B's data even if both are on the same Myway instance.

### Anti-spoofing

When any partner is configured, Myway's middleware:
1. **Strips** any externally-provided `X-Myway-User-Id` header (only middleware sets it from validated sessions)
2. **Requires authentication** on all `/api/*` routes (except `/api/partner/auth`)
3. **Validates** the HMAC signature using timing-safe comparison

### Domain validation

If you set `MYWAY_PARTNER_YOURPLATFORM_DOMAINS`, Myway checks the `Referer` header on token exchange. Requests from unlisted domains are rejected.

### Token lifetimes

| Token | Lifetime | Purpose |
|-------|----------|---------|
| Partner token | 5 min (recommended) | One-time exchange — short-lived to limit replay window |
| Session token | 15 min | API access — stored in JS memory only (no cookies, no localStorage) |

---

## Testing

### Generate a test token from the CLI

```bash
npx tsx scripts/generate-partner-token.ts \
  --partner yourplatform \
  --user test-user-123 \
  --secret a1b2c3d4e5f6...
```

### Test the full flow with curl

```bash
# 1. Exchange partner token for session
curl -X POST http://localhost:48291/api/partner/auth \
  -H 'Content-Type: application/json' \
  -d '{"token":"TOKEN_FROM_ABOVE"}'

# 2. Use the session token on a protected route
curl -H 'Authorization: Bearer SESSION_TOKEN' \
  http://localhost:48291/api/health
```

### Verify anti-spoofing

```bash
# This header gets stripped — session userId is used instead
curl -H 'X-Myway-User-Id: hacker' \
     -H 'Authorization: Bearer SESSION_TOKEN' \
     http://localhost:48291/api/health
```

---

## Multiple Partners

Add more partners by adding more env var sets. Each partner gets its own shared secret:

```bash
MYWAY_PARTNER_APPROOM_SECRET=...
MYWAY_PARTNER_APPROOM_DOMAINS=approom.ai

MYWAY_PARTNER_ACME_SECRET=...
MYWAY_PARTNER_ACME_DOMAINS=acme.com

MYWAY_PARTNER_INTERNAL_SECRET=...
# No DOMAINS = allow from any origin
```

Partners are completely independent — they share the Myway instance but each user ID is scoped to its own tenant database.

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `Unknown partner: xyz` | Partner ID in token doesn't match env var | Check `partnerId` matches the lowercase ID from `MYWAY_PARTNER_XYZ_SECRET` |
| `Invalid signature` | Secret mismatch | Verify both sides use the exact same secret string |
| `Token expired` | Token `expiresAt` is in the past | Generate a fresh token — ensure server clocks are synced |
| `Referer domain not allowed` | Request came from an unlisted domain | Add the domain to `MYWAY_PARTNER_XYZ_DOMAINS` |
| 401 on all routes | Partners are configured but no token provided | All routes require auth when any partner secret exists |
| CORS error in iframe | Partner domain not in allowed origins | Setting `MYWAY_PARTNER_XYZ_DOMAINS` auto-adds CORS — restart Myway after changing env |

---

## File Reference

| File | Description |
|------|-------------|
| `src/lib/partners.ts` | Partner registry, HMAC token validation, session token create/validate |
| `src/app/api/partner/auth/route.ts` | Token exchange endpoint |
| `src/components/PartnerAuthProvider.tsx` | Client-side auth provider (fetch override) |
| `src/middleware.ts` | Session token validation, CORS merge, header stripping |
| `scripts/generate-partner-token.ts` | CLI helper for generating test tokens |
| `.env.local.example` | Environment variable documentation |
