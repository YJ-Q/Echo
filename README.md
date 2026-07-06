# Echo (回声)

Echo is a memory-driven, emotionally aware personal AI companion MVP.

Echo is not a generic chatbot. It is being built as a second-self system: a
small reflective engine that remembers conversations, notices patterns, and
helps the user return to action.

## Current Status

- Express backend
- `/chat` interaction endpoint
- SQLite memory storage
- Lightweight emotion, intent, and tag detection
- User state and profile signals
- Memory context summaries for second-self continuity
- Current Echo state endpoint for future UI and integrations
- Action queue engine for small executable next steps
- Learning sessions with actionable steps
- Learning action events for reflection
- Echo voice profile with "we" perspective audit
- Distilled memory notes and insight notes for each turn
- Long-term profile synthesis from recent memory patterns
- Memory priority, reinforcement, and lightweight decay for relevance ranking
- Daily reflection endpoint
- Abstracted Echo agent with `local / openai / anthropic` provider selection

See [Echo Voice](D:/Echo/docs/VOICE.md) for the project's tone and personality rules.

## Run

```bash
npm install
npm run dev
```

Server defaults to `http://localhost:3000`.

Open `http://localhost:3000` to verify the API status. The frontend is
intentionally paused while the backend memory, reflection, and agent systems are
refined.

## Agent Configuration

Echo now routes all reply generation through a unified agent layer:

- `ECHO_LLM_PROVIDER=local | openai | anthropic`
- `OPENAI_API_KEY=...`
- `OPENAI_MODEL=...`
- `ANTHROPIC_API_KEY=...`
- `ANTHROPIC_MODEL=...`

Selection order:

1. Explicit `ECHO_LLM_PROVIDER`
2. `OPENAI_API_KEY`
3. `ANTHROPIC_API_KEY`
4. local reflective fallback

If a remote provider fails or returns an empty response, Echo falls back to the
local reflective generator and marks that in the API response.

## API

### `POST /chat`

```json
{
  "message": "I want to learn JavaScript"
}
```

Returns:

```json
{
  "ok": true,
  "data": {
    "reply": "...",
    "emotion": "motivated",
    "tags": ["learning"],
    "intent": "learning",
    "learning_session": {
      "id": 1,
      "topic": "JavaScript",
      "status": "active"
    },
    "behavior_hint": {
      "type": "continue_learning",
      "label": "继续：说清 JavaScript 是什么",
      "detail": "用一句话写下：JavaScript 解决什么问题。",
      "reason": "学习线“JavaScript”还在进行中。",
      "source": "active_learning_session",
      "confidence": 0.92
    },
    "decision": {
      "source": "active_learning_session",
      "confidence": 0.92,
      "rule": "continue_learning"
    },
    "memory_note": "我们把注意力放回了“JavaScript”，想把学习变成能执行的一小步。",
    "insight_note": "学习在这里不是多知道一点，而是把理解推进成动作。",
    "tone": {
      "profile": "second_self_we",
      "perspective": "we"
    },
    "agent": {
      "provider": "local",
      "model": "echo-local-reflective",
      "fallback_used": false
    }
  }
}
```

When the message is a learning request, Echo creates or reuses a learning
session and returns the current executable step.

Each chat response now also includes a `behavior_hint`, so Echo's language and
its suggested next action stay aligned through the same decision rules.

Each stored memory now also keeps:

- `memory_note`: a short distilled note of what this turn was really about
- `insight_note`: a small behavioral or reflective takeaway Echo wants to keep

Echo also synthesizes long-term profile signals from recent memories so the
system can gradually form a more stable second-self picture rather than only
stacking raw conversation history.

Stored memories now also carry lightweight priority metadata:

- `salience`
- `reinforcement_count`
- `priority_bucket`
- `last_accessed_at`

This lets Echo keep some memories closer to the center while ambient memories
fade back unless they are repeatedly revisited.

While a learning session is active, Echo also reads follow-up messages such as
`done`, `完成`, `I don't understand`, or `卡住了` as learning progress signals.

### `GET /state?query=...`

Returns Echo's current system state for future frontend and integrations:
current emotional/context state, profile summary, active learning sessions,
recent memories, recent reflections, and one suggested next action.

Most API endpoints now use a shared response envelope:

```json
{
  "ok": true,
  "data": {}
}
```

Errors use:

```json
{
  "ok": false,
  "error": {
    "code": "request_error",
    "message": "..."
  }
}
```

### `GET /actions?status=pending`

Returns Echo's action queue.

### `POST /actions`

Creates a manual action.

```json
{
  "type": "start_small",
  "title": "先做 5 分钟",
  "detail": "打开编辑器，只写第一行。",
  "priority": 2
}
```

### `POST /actions/suggested`

Creates an action from Echo's current `/state` next action.

```json
{
  "query": "Node.js"
}
```

### `POST /actions/:id/status`

Updates an action status: `pending`, `active`, `done`, or `dismissed`.

### `GET /memory`

Returns stored memory entries.

### `GET /memory/states`

Returns current lightweight user state signals.

### `GET /memory/profile`

Returns long-term profile signals Echo has inferred, plus a readable profile
summary for the second-self layer.

### `POST /memory/profile/refresh`

Runs long-term profile synthesis over recent memories and returns:

- synthesized profile signals
- raw profile entries
- refreshed profile summary with `long_term_notes`

### `GET /memory/context?query=...`

Returns the memory context Echo would use for a message, including relevant
memories, recent memories, user state/profile signals, and a compact
`summary.context_note` for debugging the second-self continuity layer.

### `GET /learning`

Returns learning sessions.

### `GET /learning/active`

Returns active learning sessions.

### `GET /learning/events`

Returns learning action events such as session creation, step completion,
attempts, and stuck points. These events are used by daily reflection.

### `POST /learning/:id/steps/:stepIndex`

Updates a learning step.

```json
{
  "status": "done"
}
```

### `POST /summary`

Generates and stores today's Echo reflection. The reflection detects a daily
theme, emotional trend, behavior pattern, learning progress, and one Echo-style
reflective sentence.

### `GET /summary/recent?limit=7`

Returns recent saved Echo reflections.
