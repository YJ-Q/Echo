# Echo (回声)

A memory-driven, emotionally aware personal AI companion — a **second-self system** that remembers conversations, notices patterns, and helps return to action.

Echo is not a chatbot. It speaks as an internal reflective voice, using "we" to mirror the user's own thinking.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Route Layer                 │
│  /chat  /state  /actions  /memory  /summary │
│                /learning                     │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│              Service Layer                   │
│  inputAnalyzer → echoAgent → chatService    │
│  contextBuilder → learningEngine             │
│  reflectionEngine → profileEngine            │
│  behaviorDecisionEngine                      │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│           Memory System Layer                │
│  memoryDistiller → memoryInjection          │
│  memoryPriorityEngine → memoryCalibration   │
│  profileSynthesisEngine                      │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│          LLM Provider Layer                  │
│  SiliconFlow / OpenAI / Anthropic / Local    │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│            Storage Layer                     │
│        SQLite (memoryStore.js)               │
└─────────────────────────────────────────────┘
```

---

## Quick Start

```bash
# 1. Install
git clone https://github.com/YJ-Q/Echo.git
cd Echo
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env: set your LLM API key
#   ECHO_LLM_PROVIDER=siliconflow
#   SILICONFLOW_API_KEY=sk-...

# 3. Start
npm run dev      # development (with --watch)
# or
npm start        # production
```

Server runs at `http://localhost:3000`.

```bash
# Verify
curl http://localhost:3000/health
```

---

## Configuration

### LLM Provider

Echo supports four LLM backends. Set via `ECHO_LLM_PROVIDER`:

| Provider | Env Key | Model Env | Default Model |
|----------|---------|-----------|---------------|
| **siliconflow** | `SILICONFLOW_API_KEY` | `SILICONFLOW_MODEL` | `deepseek-ai/DeepSeek-V3.2` |
| openai | `OPENAI_API_KEY` | `OPENAI_MODEL` | `gpt-4.1-mini` |
| anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` | `claude-3-5-sonnet-latest` |
| local | — | — | Rule-based fallback |

> 💡 **siliconflow** (硅基流动) is recommended for users in mainland China — no VPN required.

**Automatic fallback chain:** If the selected provider fails (network error, API error, empty response), Echo falls back to the local reflective engine and marks `fallback_used: true` in the response.

### Storage

| Env | Default | Description |
|-----|---------|-------------|
| `ECHO_DB_PATH` | `<project>/data/echo.sqlite` | SQLite database path |
| `LOG_LEVEL` | `info` | Pino log level (`debug`, `info`, `warn`, `error`) |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | — | Set to `production` for Docker/minimal logging |

---

## API Reference

All endpoints return a unified response envelope:

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

### Chat

**`POST /chat`** — Main interaction endpoint

```json
// Request
{ "message": "我想学 Node.js，但是总在开始前拖延" }

// Response (truncated)
{
  "ok": true,
  "data": {
    "reply": "...",
    "intent": "learning",
    "emotion": "neutral",
    "tags": ["learning", "procrastination"],
    "learning_session": {
      "id": 1, "topic": "Node.js", "status": "active",
      "current_step": 0,
      "steps": [
        { "title": "说清 Node.js 是什么", "action": "...", "status": "active" },
        { "title": "做一个最小例子", "action": "...", "status": "pending" }
      ]
    },
    "behavior_hint": { "type": "continue_learning", "label": "...", "detail": "...", "confidence": 0.92 },
    "decision": { "source": "active_learning_session", "rule": "continue_learning", "confidence": 0.92 },
    "memory_note": "...",
    "insight_note": "...",
    "tone": { "profile": "second_self_we", "perspective": "we" },
    "agent": { "provider": "siliconflow", "model": "deepseek-ai/DeepSeek-V3.2", "fallback_used": false }
  }
}
```

### State

**`GET /state?query=...`** — Echo's current internal state (emotion, focus, active learning, pending actions, profile summary)

### Actions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/actions?status=pending` | List actions |
| `POST` | `/actions` | Create manual action |
| `POST` | `/actions/suggested` | Save Echo's suggested next action |
| `POST` | `/actions/:id/status` | Update status (active/done/dismissed) |

### Memory

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/memory?limit=N` | List stored memories |
| `GET` | `/memory/states` | User state signals |
| `GET` | `/memory/profile` | Long-term profile + summary |
| `POST` | `/memory/profile/refresh` | Re-synthesize profile from memories |
| `POST` | `/memory/profile/override` | Manually set a profile signal |
| `GET` | `/memory/context?query=...` | Layered context for continuity |
| `GET` | `/memory/calibration` | Calibration snapshot |
| `POST` | `/memory/:id/pin` | Pin memory to core bucket |
| `POST` | `/memory/:id/priority` | Adjust priority metadata |

### Learning

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/learning` | All sessions |
| `GET` | `/learning/active` | Active sessions |
| `GET` | `/learning/events` | Learning action events |
| `POST` | `/learning/:id/steps/:stepIndex` | Update step status (`done`) |

### Summary

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/summary` | Generate today's Echo reflection (idempotent per day) |
| `GET` | `/summary/recent?limit=7` | Recent reflections |

---

## Docker

```bash
# Build
docker build -t echo-backend .

# Run with persistent data
docker run -d \
  --name echo \
  -p 3000:3000 \
  -v echo-data:/app/data \
  -e SILICONFLOW_API_KEY=sk-... \
  echo-backend
```

---

## Testing

```bash
npm test
```

12 integration tests covering: state, chat, learning sessions, behavior hints, summary idempotency, action dedup, memory context injection, memory priority, calibration, profile synthesis.

Tests run in isolated temp directories and do not require an API key.

---

## Project Structure

```
src/
├── app.js                    # Express app factory
├── server.js                 # Entry point
├── lib/
│   ├── apiResponse.js        # Unified response envelope
│   ├── logger.js             # Pino structured logging
│   └── validate.js           # Request validation helpers
├── routes/                   # 6 route files, 7 endpoint groups
├── services/
│   ├── echoAgent.js          # State orchestrator
│   ├── chatService.js        # Chat pipeline
│   ├── inputAnalyzer.js      # Intent, emotion, tag detection
│   ├── contextBuilder.js     # Memory context composition
│   ├── learningEngine.js     # Learning session management
│   ├── behaviorDecisionEngine.js  # Next-action decision logic
│   ├── reflectionEngine.js   # Daily summary generation
│   ├── profileEngine.js      # User profile query/update
│   ├── toneProfile.js        # We-perspective voice audit
│   ├── topicExtractor.js     # Learning topic extraction
│   ├── memoryDistiller.js    # Memory → insight distillation
│   ├── memoryInjection.js    # Layered context injection
│   ├── memoryPriorityEngine.js   # Priority bucketing
│   ├── memoryCalibrationEngine.js # Pin/override tools
│   ├── profileSynthesisEngine.js  # Long-term profile inference
│   └── llm/
│       ├── echoPrompt.js     # System prompt + message builder
│       ├── providerRegistry.js    # Provider resolution
│       └── providers/        # siliconflow, openai, anthropic, local
└── storage/
    └── memoryStore.js        # SQLite persistence layer
```

---

## License

MIT
