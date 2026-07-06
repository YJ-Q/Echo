# Echo (回声)

Echo is a memory-driven, emotionally aware personal AI companion.

It is being built as a second-self system rather than a generic chatbot: Echo remembers conversations, notices patterns, suggests small executable next steps, and gradually forms a more stable picture of the user through memory, reflection, and profile synthesis.

The repository currently contains:

- the backend API and memory system
- a local desktop-style frontend shell
- an Electron entry for local app experiments

See [docs/VOICE.md](docs/VOICE.md) for Echo's voice and identity rules.

## Architecture

```text
Routes
  /chat  /state  /actions  /memory  /summary  /learning  /tts

Services
  inputAnalyzer -> echoAgent -> chatService
  contextBuilder -> memoryInjection
  learningEngine -> behaviorDecisionEngine
  reflectionEngine -> profileEngine -> profileSynthesisEngine
  memoryDistiller -> memoryPriorityEngine -> memoryCalibrationEngine
  explainabilityEngine

LLM Providers
  SiliconFlow / OpenAI / Anthropic / Local

Storage
  SQLite (memoryStore.js)
```

## Quick Start

```bash
git clone https://github.com/YJ-Q/Echo.git
cd Echo
npm install
```

Create `.env`:

```bash
ECHO_LLM_PROVIDER=siliconflow
SILICONFLOW_API_KEY=sk-...
```

Start backend:

```bash
npm run dev
```

Optional desktop shell:

```bash
npm run desktop
```

## Configuration

Set `ECHO_LLM_PROVIDER` to one of:

- `siliconflow`
- `openai`
- `anthropic`
- `local`

If the selected remote provider fails, Echo falls back to the local reflective engine and marks `fallback_used: true` in the response.

## API

All endpoints use a shared response envelope:

```json
{ "ok": true, "data": {} }
```

```json
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

### `POST /chat`

Request:

```json
{
  "message": "我想学 Node.js，但是总在开始前拖延"
}
```

Response includes:

- `reply`
- `emotion`
- `tags`
- `intent`
- `learning_session`
- `behavior_hint`
- `decision`
- `memory_note`
- `insight_note`
- `explanation`
- `tone`
- `agent`

`explanation` is the new backend explainability layer. It describes:

- how the input was interpreted
- which memory/profile signals were used
- what response mode Echo selected
- why the current next action was chosen

### `GET /state?query=...`

Returns Echo's current internal state, active learning line, pending actions, profile summary, next suggested action, and a structured `explain` block describing the decision trace.

### `POST /tts`

Synthesizes text into MP3 audio through SiliconFlow CosyVoice2.

Request:

```json
{
  "text": "我们先看清它，不急着整理成答案。"
}
```

You can also request audio alongside chat by sending `{"tts": true}` with `/chat`.

### Other endpoint groups

| Group | Paths |
|---|---|
| actions | `/actions`, `/actions/suggested`, `/actions/:id/status` |
| memory | `/memory`, `/memory/states`, `/memory/profile`, `/memory/context`, `/memory/calibration` |
| learning | `/learning`, `/learning/active`, `/learning/events`, `/learning/:id/steps/:stepIndex` |
| summary | `/summary`, `/summary/recent` |

## Testing

```bash
npm test
```

The test suite covers chat flow, state flow, learning sessions, summary idempotency, memory distillation, priority reinforcement, profile synthesis, manual calibration, and explainability output.

## License

MIT
