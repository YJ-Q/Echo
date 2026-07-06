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
- Daily reflection endpoint

See [Echo Voice](docs/VOICE.md) for the project's tone and personality rules.

## Run

```bash
npm install
npm run dev
```

Server defaults to `http://localhost:3000`.

Open `http://localhost:3000` to verify the API status. The frontend is
intentionally paused while the backend memory, reflection, and agent systems are
refined.

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
  "reply": "...",
  "emotion": "motivated",
  "tags": ["learning"],
  "intent": "learning",
  "learning_session": {
    "id": 1,
    "topic": "JavaScript",
    "status": "active"
  },
  "tone": {
    "profile": "second_self_we",
    "perspective": "we"
  }
}
```

When the message is a learning request, Echo creates or reuses a learning
session and returns the current executable step.

While a learning session is active, Echo also reads follow-up messages such as
"done", "完成了", "I don't understand", or "卡住了" as learning progress signals.

### `GET /state?query=...`

Returns Echo's current system state for future frontend and integrations:
current emotional/context state, profile summary, active learning sessions,
recent memories, recent reflections, and one suggested next action.

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

Generates and stores today's Echo reflection. The reflection now detects a
daily theme, emotional trend, behavior pattern, learning progress, and one
Echo-style reflective sentence.

### `GET /summary/recent?limit=7`

Returns recent saved Echo reflections.
