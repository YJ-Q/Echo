# Echo

Echo is a memory-driven personal AI companion built as a "second self" rather than a generic chatbot.

The current repository is centered on the backend MVP:

- conversation and memory storage
- state aggregation
- learning flow guidance
- daily reflection summaries
- action suggestions
- explainability output for `/chat` and `/state`

See [docs/VOICE.md](docs/VOICE.md) for Echo's voice rules and [docs/API_CONTRACT.md](docs/API_CONTRACT.md) for the backend response contract.
For local data handling, see [docs/BACKUP_AND_EXPORT.md](docs/BACKUP_AND_EXPORT.md).
For release-facing change history, see [CHANGELOG.md](CHANGELOG.md).

## Current Status

The backend MVP is functional and test-covered.

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

Still worth improving before a polished open-source `1.0`:

- stronger long-term memory organization
- production-ready deployment and backups
- richer provider configuration
- frontend rebuild on top of the stabilized backend

## Quick Start

```bash
git clone https://github.com/YJ-Q/Echo.git
cd Echo
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

Start the backend:

```bash
npm run dev
```

Default local URL:

```text
http://localhost:3000
```

## Environment

Core variables:

```bash
PORT=3000
NODE_ENV=development
ECHO_LOG_LEVEL=info
ECHO_LLM_PROVIDER=local
ECHO_DB_PATH=./data/echo.sqlite
```

Optional provider variables:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
ANTHROPIC_API_KEY=
SILICONFLOW_API_KEY=
```

Notes:

- `ECHO_LLM_PROVIDER` supports `local`, `openai`, `anthropic`
- if a remote provider fails, Echo falls back to the local reflective engine
- if `SILICONFLOW_API_KEY` is not set, `/tts` stays unavailable

## Logging

Echo now emits lightweight JSON logs for:

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

Current backend test status: `19/19` passing.

## Backup And Export

Create a JSON export and SQLite backup:

```bash
npm run backup
```

Create JSON export only:

```bash
npm run export:data
```

Import a snapshot back into Echo:

```bash
npm run import:data -- --file=./data/exports/echo-export.json
```

## License

MIT
