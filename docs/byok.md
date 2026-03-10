# BYOK — Bring Your Own Key

Myway works with any OpenAI-compatible API. You don't need OpenClaw.

## Quick Setup

Set these environment variables in `.env.local`:

```bash
# Example: Ollama (local, no API key needed)
MYWAY_AI_BASE_URL=http://localhost:11434/v1
MYWAY_AI_MODEL=llama3

# Example: OpenAI
# MYWAY_AI_BASE_URL=https://api.openai.com/v1
# MYWAY_AI_TOKEN=sk-...
# MYWAY_AI_MODEL=gpt-4o
```

Or use the interactive wizard which handles this for you:

```bash
npx @uchibeke/myway
# Choose option 2 (BYOK) when prompted
```

Myway is not affiliated with any AI provider. Use whichever service you prefer.

## Supported Providers

Any provider that exposes an OpenAI-compatible `/v1/chat/completions` endpoint with SSE streaming works.

| Provider | Base URL | Token Required | Notes |
|----------|----------|----------------|-------|
| **Ollama** | `http://localhost:11434/v1` | No | Local models, no API key needed |
| **vLLM** | `http://localhost:8000/v1` | No | Self-hosted inference |
| **LiteLLM** | `http://localhost:4000/v1` | Depends | Proxy for 100+ providers |
| **OpenAI** | `https://api.openai.com/v1` | Yes | GPT-4o, o1, etc. |
| **OpenRouter** | `https://openrouter.ai/api/v1` | Yes | Access to 100+ models from one key |
| **Together AI** | `https://api.together.xyz/v1` | Yes | Open-source models |
| **Groq** | `https://api.groq.com/openai/v1` | Yes | Fast inference |
| **Fireworks** | `https://api.fireworks.ai/inference/v1` | Yes | Open-source models |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MYWAY_AI_BASE_URL` | Yes | Provider's OpenAI-compatible base URL |
| `MYWAY_AI_TOKEN` | No* | API key / bearer token |
| `MYWAY_AI_MODEL` | No | Model to use (provider default if omitted) |

*Token is optional for local providers like Ollama and vLLM that don't require auth.

## What Works in BYOK Mode

**All apps work.** Every chat, transformer, and button app functions in BYOK mode.

**Memory and persistence are fully functional.** All backed by local SQLite — no OpenClaw dependency:

| Feature | Storage | BYOK Status |
|---------|---------|-------------|
| Conversation history | SQLite | Works |
| Long-term memories | SQLite | Works |
| Personality signals | SQLite | Works |
| Tasks | SQLite | Works |
| User identity (name, timezone) | SQLite (synced from client) | Works |
| Cross-app context | SQLite | Works |
| Recipes and notes | Filesystem (`MYWAY_ROOT/`) | Works |
| Email and calendar context | SQLite + Google OAuth | Works (if Google connected) |
| Temporal context (date/time) | Client-provided each request | Works |

Your AI gets the same rich context injection (memories, tasks, signals, recipes, notes, email, calendar) regardless of which provider you use.

## What Requires OpenClaw

These features depend on OpenClaw's agent infrastructure:

| Feature | BYOK Behavior |
|---------|---------------|
| **Heartbeat/Autonomy** | Disabled — no background agent without OpenClaw |
| **Cron jobs** | Disabled — cron scheduler is part of OpenClaw |
| **Workspace context** (USER.md, IDENTITY.md) | Returns null — apps work without it |
| **Workspace writer** (TASKS.md, CALENDAR.md snapshots) | Skipped — no external markdown sync |
| **OpenClaw webhook bridge** | Silently skipped |
| **Tool calls** (file read, web search via agent) | Not available — BYOK sends chat completions only |
| **APort guardrails** | Independent — works if configured separately |

All OpenClaw-dependent features degrade gracefully. No errors, no broken UI — those features simply aren't active.

## Bundled Skill Prompts

Myway ships with bundled skill prompts for all built-in apps. In OpenClaw mode, skill prompts are read from `~/.openclaw/workspace/skills/<slug>/SKILL.md`. In BYOK mode (or when the workspace file doesn't exist), Myway falls back to bundled defaults at `src/lib/skills/<slug>.md`.

**Lookup order:**
1. `~/.openclaw/workspace/skills/<slug>/SKILL.md` — user customizations always win
2. `src/lib/skills/<slug>.md` — bundled defaults
3. `null` — returns 500 (unknown skill)

You can customize any app's personality by creating a workspace SKILL.md, even in BYOK mode.

## Health Check

The `/api/health` endpoint reports the AI backend mode:

```json
{
  "status": "ok",
  "aiBackend": { "mode": "byok" }
}
```

In BYOK mode, the OpenClaw reachability check is skipped — no false "degraded" status.

## Limitations

- **No streaming function/tool calls**: BYOK sends standard chat completions. The AI can't read files, search the web, or execute tools. It only receives context that Myway injects into the system prompt.
- **Model quality varies**: Myway's skill prompts are optimized for capable models (Claude, GPT-4o class). Smaller models may not follow complex instructions as well.
- **No multi-turn tool use**: Apps like Mise (recipe extraction from URLs) rely on the AI agent calling tools. In BYOK mode, recipe saving from URLs won't work unless the AI model supports function calling through the provider.

## Switching Between Modes

To switch from OpenClaw to BYOK:
1. Comment out `OPENCLAW_BASE_URL` and `OPENCLAW_GATEWAY_TOKEN` in `.env.local`
2. Add `MYWAY_AI_BASE_URL` and optionally `MYWAY_AI_TOKEN`
3. Restart Myway

To switch back: reverse the process.
