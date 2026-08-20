# Margin

Margin is a memory-driven personal AI companion built as a "second self" rather than a generic chatbot.

Its brand language is centered on paper, ink, margin notes, and continuation:

- a quiet place to leave what is still unfinished
- a companion that remembers the live line, not just the task list
- a product that helps the user continue from the last trace, without making them feel managed

The current repository is centered on the backend MVP:

- conversation and memory storage
- state aggregation
- learning flow guidance
- daily reflection summaries
- action suggestions
- explainability output for `/chat` and `/state`

See [docs/VOICE.md](docs/VOICE.md) for Margin's voice rules and [docs/API_CONTRACT.md](docs/API_CONTRACT.md) for the backend response contract.
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

## Pi Stage 0 Development Verification

Margin has pinned and audited the Pi SDK, but Pi is not yet connected to the production chat path. Stage 0 is an isolated runtime spike used to verify version, license, Session lifecycle, compaction, and tool safety boundaries.

On Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-pi-runtime.ps1
$env:MARGIN_PI_PROVIDER='<configured-provider>'
$env:MARGIN_PI_MODEL='<configured-model-id>'
npm run spike:pi
npm run verify:pi-stage-0
```

For the YAPI-compatible endpoint, the spike recognizes `yapi` with `https://yapi.click/v1`, the OpenAI Responses wire API, and `YAPI_API_KEY`. Generic custom endpoints can instead set `MARGIN_PI_BASE_URL`, `MARGIN_PI_API`, and `MARGIN_PI_API_KEY_ENV`. Only the environment-variable name is configured; the credential value remains process-local.

The spike enables only `margin_spike_echo`; Pi's built-in file, command, edit, and write tools remain disabled. User/project extensions, skills, prompt templates, themes, and context files are also disabled, and the spike uses an isolated agent directory under ignored local data. Authentication must be supplied through the environment for the selected provider; credentials are not read from the user's normal Pi directory or stored in the repository. Without configured Pi authentication, the spike and final verification exit with `pi_credentials_required` instead of reporting success.

See `docs/architecture/pi_version_and_license.md`, `docs/architecture/contribution_boundary.md`, and `docs/architecture/integration_decision.md` for the audited boundary.

## Quick Start

```bash
git clone https://github.com/YJ-Q/Echo.git
cd Echo
npm install
```

The GitHub URL and cloned directory retain `Echo` until the repository itself is
renamed; `Echo` is currently a legacy external identifier, while the product is Margin.

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
MARGIN_LOG_LEVEL=info
MARGIN_LLM_PROVIDER=local
MARGIN_DB_PATH=./data/margin.sqlite
```

Optional provider variables:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
ANTHROPIC_API_KEY=
SILICONFLOW_API_KEY=
```

Notes:

- `MARGIN_LLM_PROVIDER` supports `local`, `openai`, `anthropic`
- `ECHO_LOG_LEVEL`, `ECHO_LLM_PROVIDER`, and `ECHO_DB_PATH` are deprecated but remain supported for one compatibility period. `MARGIN_*` takes priority when both are present.
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

Test counts are reported by each run rather than kept as a static product-value claim.

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
