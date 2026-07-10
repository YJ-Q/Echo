# Margin

Margin is a paper-and-ink companion space that keeps the user's live line visible.

Its brand language is centered on paper, ink, margin notes, and continuation:

- a quiet place to leave what is still unfinished
- a companion that remembers the live line, not just the task list
- a product that helps the user continue from the last trace, without making them feel managed

The current repository contains one product surface:

- React/Vite paper interface in `frontend/`
- Express API and local memory engine in `src/`
- Electron desktop shell in `electron/`

Core capabilities include:

- conversation and memory storage
- state aggregation
- learning flow guidance
- daily reflection summaries
- action suggestions
- explainability output for `/chat` and `/state`

See [docs/README.md](docs/README.md) for the current documentation index, [docs/VOICE_AND_GUARDRAILS.md](docs/VOICE_AND_GUARDRAILS.md) for voice rules, and [docs/API_CONTRACT.md](docs/API_CONTRACT.md) for the backend response contract.
For local data handling, see [docs/BACKUP_AND_EXPORT.md](docs/BACKUP_AND_EXPORT.md).
For release-facing change history, see [CHANGELOG.md](CHANGELOG.md).

## Current Status

The MVP is functional across the Express backend, React/Vite frontend, and Electron desktop shell.

Implemented:

- `POST /chat`
- `GET /state`
- `GET/POST /actions`
- `GET /learning/active`
- `GET /memory`, `GET /memory/context`
- `POST /summary`, `GET /summary/recent`
- profile synthesis and memory calibration
- startup config validation and request logging
- local backup / export / import tooling
- optional TTS route
- React notebook interface backed by the real state, learning, memory, achievement, action, summary, and management APIs
- Electron desktop window with a fixed 4:3 aspect ratio and managed backend lifecycle

Still worth improving before a polished open-source `1.0`:

- clean migration of early records that were corrupted by shell encoding
- installer packaging, application icons, and release signing
- optional speech-to-text provider for microphone input
- persisted custom notebook sections

## Quick Start

```bash
git clone <repository-url> margin
cd margin
npm install
```

Copy the environment template:

```bash
cp .env.example .env
```

On Windows PowerShell, the equivalent is:

```powershell
Copy-Item .env.example .env
```

Build and start the web application:

```bash
npm start
```

Default local URL:

```text
http://localhost:3000
```

For frontend development, run the backend and Vite dev server in separate terminals:

```bash
npm run dev
npm run dev:ui
```

Start the desktop application:

```bash
npm run desktop
```

## Environment

Core variables:

```bash
PORT=3000
NODE_ENV=development
MARGIN_LOG_LEVEL=info
MARGIN_LLM_PROVIDER=local
MARGIN_DB_PATH=./data/echo.sqlite
```

Optional provider variables:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
ANTHROPIC_API_KEY=
SILICONFLOW_API_KEY=
```

Notes:

- `MARGIN_LLM_PROVIDER` supports `local`, `openai`, `anthropic`, `siliconflow`
- legacy `ECHO_LOG_LEVEL`, `ECHO_LLM_PROVIDER`, and `ECHO_DB_PATH` remain supported during migration
- the existing `data/echo.sqlite` filename is intentionally preserved so renaming does not hide current user data
- if a remote provider fails, Margin falls back to the local reflective engine
- if `SILICONFLOW_API_KEY` is not set, `/tts` stays unavailable

## Logging

Margin now emits lightweight JSON logs for:

- server startup
- configuration warnings
- every HTTP request
- unhandled route errors

Each request receives an `x-request-id` response header for easier debugging.

## API Overview

All endpoints share the same response envelope:

```json
{ "ok": true, "data": {} }
```

```json
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

Main routes:

| Group | Paths |
|---|---|
| chat | `/chat` |
| state | `/state` |
| actions | `/actions`, `/actions/suggested`, `/actions/:id/status` |
| learning | `/learning`, `/learning/active`, `/learning/events` |
| memory | `/memory`, `/memory/context`, `/memory/profile`, `/memory/calibration` |
| summary | `/summary`, `/summary/recent` |
| tts | `/tts` |

## Testing

```bash
npm test
```

The current backend test suite covers:

- chat flow
- state flow
- learning session continuity
- summary idempotency
- memory reinforcement and retrieval
- profile synthesis
- calibration behavior
- backup export and import restore flow

Current test status: `111/111` passing.

## Backup And Export

Create a JSON export and SQLite backup:

```bash
npm run backup
```

Create JSON export only:

```bash
npm run export:data
```

Import a snapshot back into Margin:

```bash
npm run import:data -- --file=./data/exports/margin-export.json
```

## License

MIT
