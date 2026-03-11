---
name: myway-byok
description: >
  Set up Myway, a self-hosted personal AI home screen, using your own AI API key (BYOK).
  Use this skill when the user wants to install Myway with OpenAI, Gemini, Ollama, OpenRouter,
  Together AI, or any OpenAI-compatible provider. Requires Node.js 22+ and yarn.
metadata:
  author: uchibeke
  version: 0.2.0
  tags: personal-ai, home-screen, self-hosted, byok, openai, gemini, ollama, dashboard
---

# Myway + BYOK (Bring Your Own Key) Setup

Myway is a self-hosted personal AI home screen — a local-first PWA that gives you a
phone-style dashboard powered by AI. This skill sets it up using **your own AI API key**
from any OpenAI-compatible provider.

## When to use this skill

- User wants to install Myway with their own API key (OpenAI, Gemini, Ollama, etc.)
- User asks about setting up a personal AI dashboard without OpenClaw
- User wants to switch AI providers or update their API key in Myway

## Supported providers

Any OpenAI-compatible API works. Common options:

| Provider | Base URL | Key required? |
|----------|----------|---------------|
| **Ollama** (local) | `http://localhost:11434/v1` | No |
| **OpenAI** | `https://api.openai.com/v1` | Yes |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` | Yes |
| **OpenRouter** | `https://openrouter.ai/api/v1` | Yes |
| **Together AI** | `https://api.together.xyz/v1` | Yes |

## Prerequisites

Check these before starting:

1. **Node.js 22+** — run `node -v` to verify (must show v22 or higher)
2. **yarn** — run `yarn -v` to verify. If missing: `npm install -g yarn`
3. **An API key** from the user's chosen provider (or Ollama running locally)

If prerequisites fail, stop and help the user install them first.

## Installation

Ask the user for:
1. Their AI provider (OpenAI, Gemini, Ollama, OpenRouter, or Together AI)
2. Their API key (not needed for Ollama)
3. Their preferred model (optional)
4. A directory for the file browser (default: `~/vault`)
5. Where to install (directory name, default: `myway`)

Then run the setup with their values:

```bash
npx @uchibeke/myway <directory> \
  --ai-mode byok \
  --ai-url <PROVIDER_BASE_URL> \
  --ai-key <API_KEY> \
  --ai-model <MODEL> \
  --root <FILE_BROWSER_DIR> \
  --port 48291 \
  --start
```

**Example — OpenAI with gpt-4o:**

```bash
npx @uchibeke/myway myway \
  --ai-mode byok \
  --ai-url https://api.openai.com/v1 \
  --ai-key sk-proj-abc123 \
  --ai-model gpt-4o \
  --root ~/Documents \
  --start
```

**Example — Ollama (local, no key):**

```bash
npx @uchibeke/myway myway \
  --ai-mode byok \
  --ai-url http://localhost:11434/v1 \
  --root ~/vault \
  --start
```

All flags are optional except `--ai-mode byok` and `--ai-url`. Defaults:
- directory: `myway`
- `--root`: `~/vault`
- `--port`: `48291`
- `--ai-key`: empty (fine for Ollama)
- `--ai-model`: empty (uses provider default)

Add `--no-aport` to skip APort guardrails setup.

The command will:
1. Scaffold a new directory with the Myway source
2. Install dependencies (2-5 minutes)
3. Write `.env.local` with the provided config
4. Initialize the database
5. Build for production (1-2 minutes)
6. Start the server and open the browser (if `--start` is passed)

**Important**: This command takes 3-7 minutes to complete. Do not interrupt it.

### Verify it worked

After the command completes with `--start`, the server should be running. Verify:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:48291/
```

Should return `200`. If the user didn't pass `--start`:

```bash
cd <directory>
yarn start
```

### Background running with PM2

For long-running deployments:

```bash
cd <directory>
cp ecosystem.config.cjs.example ecosystem.config.cjs
pm2 start ecosystem.config.cjs
```

## Reconfiguring

To change provider, API key, or other settings on an existing install:

```bash
cd <existing-myway-directory>
npx @uchibeke/myway --setup \
  --ai-mode byok \
  --ai-url <NEW_URL> \
  --ai-key <NEW_KEY> \
  --ai-model <NEW_MODEL>
```

Or edit `.env.local` directly, then rebuild:

```bash
cd <existing-myway-directory>
# Edit .env.local with new values
yarn build
# Restart: yarn start, or pm2 restart myway
```

## Provider-specific notes

### Ollama (free, local, private)
- Install: https://ollama.com
- Pull a model first: `ollama pull llama3`
- No API key needed
- Base URL: `http://localhost:11434/v1`
- Best for: privacy-focused users, no API costs

### OpenAI
- Get key: https://platform.openai.com/api-keys
- Recommended model: `gpt-4o` or `gpt-4o-mini` (cheaper)

### Google Gemini
- Get key: https://aistudio.google.com/apikey
- Recommended model: `gemini-2.0-flash`
- Uses the OpenAI-compatible endpoint

### OpenRouter
- Get key: https://openrouter.ai/keys
- Access to 100+ models from one key
- Good for: trying different models without switching providers

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Invalid API key" errors | Check `MYWAY_AI_TOKEN` in `.env.local` |
| Ollama connection refused | Ensure Ollama is running: `ollama serve` |
| Wrong model name | Check provider docs for exact model IDs |
| Port already in use | Change `PORT` in `.env.local` or: `fuser -k 48291/tcp` |
| Black screen after restart | Run `pm2 logs myway --err`. Usually EADDRINUSE — kill stale process and restart PM2 |
| Build fails | Ensure Node.js 22+ and run `yarn install` first |
| Command hangs | Normal — dependency install takes 2-5 min, build takes 1-2 min |

## Environment variables

All config lives in `<directory>/.env.local`. Key variables for BYOK mode:

```env
PORT=48291
MYWAY_ROOT=~/vault
MYWAY_AI_BASE_URL=https://api.openai.com/v1
MYWAY_AI_TOKEN=sk-your-key-here
MYWAY_AI_MODEL=gpt-4o
MYWAY_SECRET=<auto-generated>
```

See `.env.local.example` in the install directory for all options (Google OAuth, Telegram, TTS, etc.).
