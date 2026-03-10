# Myway — OpenClaw Skill Documentation

> This file is the OpenClaw skill contract for the Myway project.
> It tells OpenClaw what this app exposes, how to call it, and what it expects.

---

## Skill Identity

| Field       | Value                        |
|-------------|------------------------------|
| Name        | `myway-ui`                  |
| Slug        | `myway-ui`                  |
| Version     | `0.1.0`                      |
| Author      | `myway`                     |
| Category    | `Utility / UI`               |
| Tags        | `ui`, `pwa`, `homescreen`, `personal-os`, `web`, `notifications` |

---

## What This Skill Does

Myway is a Progressive Web App that wraps OpenClaw's capabilities in a phone home-screen UI.
It is not a replacement for OpenClaw. It is a **front door** — OpenClaw is still the brain,
the executor, and the agent. Myway is what you see.

**From OpenClaw's perspective**, this skill registers:

1. A **push webhook** — `POST /api/openclaw/push`
   OpenClaw calls this to deliver proactive messages, task completions, alerts, and notifications
   into the PWA in real time (via Server-Sent Events piped to the open browser tab, or stored
   for display on next open).

2. A **run endpoint** — `POST /api/openclaw/run`
   The Myway UI calls this to trigger any OpenClaw skill by name with a payload.
   Think of this as the universal bridge between a button press in the UI and a skill execution.

3. A **file endpoint** — `GET /api/openclaw/files`
   Requests a directory listing or file content from the server filesystem via OpenClaw's
   built-in filesystem access. Read-only by default in v1.

---

## Installation

```bash
# From your OpenClaw workspace root
clawhub install myway-ui

# Or manually: clone and place in ./skills/myway-ui/
```

OpenClaw auto-discovers this skill from `<workspace>/skills/myway-ui/` on next session start.

---

## Environment Variables

Myway reads the following from its `.env.local` (Next.js) or from OpenClaw's environment:

```env
# Required
OPENCLAW_BASE_URL=http://localhost:3000        # Where OpenClaw's local API runs
OPENCLAW_API_KEY=your_openclaw_api_key         # If OpenClaw requires auth on local calls

# For the Next.js app
NEXT_PUBLIC_APP_NAME=Myway
NEXT_PUBLIC_OWNER_HANDLE=@yourname            # Your name shown on home screen

# Optional: Web Push (Phase 2)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=mailto:you@example.com

# Optional: APort integration (Phase 3)
APORT_AGENT_DID=                              # Your OpenClaw agent's OAP identity
APORT_POLICY_ENDPOINT=                        # APort policy check endpoint
```

---

## API Contract

### `POST /api/openclaw/run`
The primary bridge. The UI calls this; Next.js forwards to OpenClaw.

**Request:**
```json
{
  "skill": "summarize",
  "prompt": "Summarize the last 5 files I modified",
  "context": {
    "app": "briefing",
    "sessionId": "abc123"
  }
}
```

**Response (streamed):**
```json
{
  "status": "ok",
  "stream": true,
  "output": "..."
}
```
Supports SSE streaming for long-running skills.

---

### `POST /api/openclaw/push`
OpenClaw calls this endpoint to push a notification into the Myway UI.

**Request (from OpenClaw):**
```json
{
  "type": "notification" | "task_complete" | "alert" | "message",
  "title": "Task done",
  "body": "Your morning brief is ready",
  "app": "briefing",
  "payload": {},
  "timestamp": "2026-02-18T09:00:00Z"
}
```

Myway stores this in a lightweight in-memory queue (Redis-optional, file-backed fallback)
and pushes it to any open browser tab via SSE. If no tab is open, it queues for next visit.

---

### `GET /api/openclaw/files?path=/home/user/docs`
Returns a directory listing. OpenClaw executes the filesystem read; Myway's API route
formats and returns the result.

**Response:**
```json
{
  "path": "/home/user/docs",
  "entries": [
    { "name": "report.pdf", "type": "file", "size": 204800, "modified": "2026-02-17" },
    { "name": "projects", "type": "dir" }
  ]
}
```

---

## Skill Configuration (`.clawhub/lock.json` entry)

```json
{
  "slug": "myway-ui",
  "version": "0.1.0",
  "installedAt": "2026-02-18",
  "webhookRegistered": true,
  "webhookUrl": "http://localhost:3001/api/openclaw/push",
  "runUrl": "http://localhost:3001/api/openclaw/run"
}
```

---

## OpenClaw Skill Triggers

These are the OpenClaw-side skill invocations that Myway apps use:

| App         | OpenClaw Skill(s) Called                          |
|-------------|---------------------------------------------------|
| Chat        | Native chat / conversation                        |
| Files       | `filesystem-browse`, `filesystem-read`            |
| Morning Brief | `weather`, `summarize`, `browser`               |
| Roast Me    | Native chat + `filesystem-browse` (reads your files for context) |
| Drama Mode  | Native chat (rewrite prompt)                      |
| Office Translator | Native chat (decode prompt)                 |
| Notes       | `filesystem-write`, `summarize`                   |
| Time Machine | Native chat (chronicle prompt)                   |
| Run a Skill | Any — raw skill runner passthrough                |

---

## Security Notes

- All routes under `/api/openclaw/` are protected by the same Cloudflare Access auth
  that protects the front-end. Do not expose these routes publicly.
- The `push` webhook should validate a shared secret (`OPENCLAW_WEBHOOK_SECRET`) to
  ensure only your OpenClaw instance can post notifications.
- File access is scoped to `ALLOWED_FILE_PATHS` (configurable). Default: `$HOME`.
- In the APort Phase (v3), every skill invocation will carry an OAP agent token, enabling
  policy-based authorization per app.

---

## Changelog

| Version | Date       | Notes                        |
|---------|------------|------------------------------|
| 0.1.0   | 2026-02-18 | Initial skill contract draft |
