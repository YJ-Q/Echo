# Margin API Contract

Date: 2026-07-10

This document describes the current implemented contract used by the React desktop interface. It replaces the archived Echo-era page contract.

## 1. Envelope

Successful responses:

```json
{
  "ok": true,
  "data": {}
}
```

Errors:

```json
{
  "ok": false,
  "error": {
    "code": "stable_error_code",
    "message": "Readable explanation"
  }
}
```

The renderer must preserve already loaded content when one workspace request fails.

## 2. Capabilities

### `GET /health`

Returns backend readiness.

### `GET /api`

Returns the product name, endpoint catalog, and capability flags:

```json
{
  "name": "Margin",
  "capabilities": {
    "tts": false,
    "stt": false
  }
}
```

`tts` and `stt` become available when the speech provider is configured.

## 3. Conversation

### `POST /api/reflect`

Primary desktop conversation entry.

```json
{
  "message": "我想把这件事慢慢说清楚。"
}
```

Returns `text` plus the underlying chat result.

### `POST /chat`

Lower-level conversation endpoint. It may update memory, learning state, actions, and profile signals according to deterministic service rules.

Errors:

- `message_required`

## 4. State And Actions

### `GET /state`

Returns the aggregated current state, current action, current learning line, current reflection, current memory view, and decision explanation.

### `GET /actions`

Optional query parameters:

- `status`
- `limit`

### `POST /actions`

Creates a manual action.

### `POST /actions/suggested`

Creates or reuses a deterministic suggested action.

### `POST /actions/:id/status`

Supported statuses:

- `pending`
- `active`
- `done`
- `dismissed`

Activating one action demotes other active actions. Completing an action linked to a learning step synchronizes that step.

## 5. Learning

### `GET /learning/active`

Returns all active sessions plus `current_session` and the page-ready `current_learning` view model.

### `GET /learning/events`

Optional `sessionId` filter.

### `POST /learning/:id/steps/:stepIndex`

```json
{
  "status": "done"
}
```

The UI exposes completion only for the current active step. Historical and future step markers are read-only.

## 6. Traces And Profile

### `GET /memory`

Returns recent memory records and a page-ready `current_memory` view model.

### `POST /memory/:id/pin`

User-facing meaning: “留住这条”.

### `POST /memory/:id/priority`

Updates salience, priority bucket, pin state, and reinforcement count. The desktop UI uses this for “这条只是当时” rather than exposing numeric controls.

### `GET /memory/profile`

Returns raw profile signals and a structured summary:

```json
{
  "profile": [],
  "summary": {
    "profile_note": "",
    "stable_signals": [],
    "developing_signals": [],
    "long_term_notes": []
  }
}
```

The UI must not expose raw confidence values or internal rule codes.

### `POST /memory/profile/refresh`

Rebuilds long-term profile signals from retained memories.

### `POST /memory/profile/override`

```json
{
  "key": "learning_preference",
  "value": "先看一个例子，再解释概念"
}
```

Manual corrections have stronger authority than automatic low-confidence updates.

### `GET /memory/calibration`

Returns pinned and high-priority memory groups.

### `GET /memory/context`

Optional `query` parameter. Returns layered retrieval context.

## 7. Reflection

### `POST /summary`

Creates today's reflection. The operation is idempotent per day.

### `GET /summary/recent`

Optional `limit` parameter.

## 8. Imprints

### `GET /achievements`

Returns the complete imprint collection:

- `summary`
- `groups`
- `achievements`
- `recent_unlocks`

Unlock discovery is deterministic. Definitions and first unlock events are persisted in `achievement_definitions` and `achievement_unlocks`. Once unlocked, an imprint cannot disappear when source data changes.

`is_new` is true until the first visible press feedback is acknowledged.

### `GET /achievements/recent?limit=5`

Returns persisted unlocks ordered by first `unlocked_at`.

### `POST /achievements/:key/acknowledge`

Idempotently records that the one-time press feedback has been shown.

Errors:

- `achievement_not_found`

### `GET /achievements/icons`

Returns the fixed SVG line-stamp catalog. Every `asset_path` must resolve under `/assets/achievements/`.

## 9. Organization

### `GET /management/overview?scope=all`

Scopes:

- `all`
- `learning`
- `memory`
- `actions`

The overview is read-only.

### `GET /management/proposals`

Optional filters:

- `scope`
- `status`

### `POST /management/proposals`

Creates a draft without executing it.

Current executable matrix:

| Operation | Target |
| --- | --- |
| `review` | item, action, memory, learning_session |
| `keep` | memory |
| `keep_active` | action |
| `dismiss` | action |
| `archive` | memory, learning_session |
| `pin` | memory |

`merge`, `rename`, and `reprioritize` are rejected at draft time until an executor and complete target metadata exist.

### `POST /management/proposals/:id/confirm`

Executes a supported non-destructive proposal once and records operation events.

### `POST /management/proposals/:id/cancel`

Cancels an unexecuted proposal without changing its targets.

Destructive proposals are not executable in the current confirmation flow.

## 10. Speech

### `POST /tts`

```json
{
  "text": "需要朗读的新回复"
}
```

Returns Base64 audio. The renderer calls this only when light reading is enabled or the user explicitly requests replay.

Stable errors include:

- `text_required`
- `tts_not_configured`
- `tts_provider_request_failed`
- `tts_provider_http_error`
- `tts_empty_audio`

### `POST /stt`

```json
{
  "audio_base64": "...",
  "mime_type": "audio/webm",
  "filename": "margin-recording.webm"
}
```

The backend keeps audio in memory, enforces an 8 MB limit, sends it to the configured SiliconFlow transcription adapter, and does not write a temporary audio file.

The transcript is returned to the input box and is never automatically sent.

Stable errors include:

- `audio_required`
- `invalid_audio_encoding`
- `audio_too_large`
- `stt_missing_api_key`
- `stt_http_error`
- `stt_invalid_json`
- `stt_empty_text`

## 11. Desktop Settings

Desktop settings are exposed through the restricted `marginDesktop` IPC bridge, not HTTP.

- `getSettings()` returns non-sensitive values and masked key status.
- `updateSettings(patch)` stores API keys with Electron `safeStorage`.
- Plaintext keys never return to the renderer.
- Provider changes restart the backend.
- Startup failure restores the previous encrypted state and restarts the last working backend configuration.
- Browser development mode continues to use `.env` and does not store keys.

## 12. Backup

JSON export and import include:

- conversations
- user states and profile
- learning sessions and events
- actions
- summaries
- management proposals and events
- achievement definitions and unlocks

SQLite backup remains the complete recovery format.
