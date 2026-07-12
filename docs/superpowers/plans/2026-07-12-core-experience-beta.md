# Margin Core Experience Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a deterministic, restart-safe path from reflective conversation to user-confirmed growth line, recorded experiment, traces, profile calibration, and achievement visibility.

**Architecture:** Keep SQLite as the only durable source of truth. Add a persisted growth-suggestion boundary between conversation analysis and learning-session creation, expose confirm/dismiss mutations through the existing learning API, and make frontend mutations wait for a coherent workspace refresh. Verify the complete story with an isolated-database API test plus focused UI model and structure tests.

**Tech Stack:** Node.js 22, Express 4, SQLite/sqlite3, React 19, TypeScript 5.8, Vite 6, Node test runner with `tsx`.

## Global Constraints

- Do not add a fourth functional page or change the approved notebook shell and 58/42 page structure.
- AI observations do not become a growth line, long-term understanding, or actively saved trace before explicit user confirmation.
- Push one small experiment at a time; do not create a multi-task planning system.
- Keep the backend database as the only durable source of truth; renderer state may only hold temporary interaction state.
- Do not add a new supplier, psychology model, decorative mood feature, or package dependency.
- Do not expose API keys, request headers, or upstream response bodies in UI errors, logs, tests, or fixtures.
- Keep full-page paper surfaces owned exclusively by `notebook-shell-v1.png`.

---

### Task 1: Persist pending growth suggestions without creating learning sessions

**Files:**
- Create: `src/services/growthSuggestionEngine.js`
- Modify: `src/storage/memoryStore.js`
- Create: `test/growthSuggestionEngine.test.js`

**Interfaces:**
- Produces: `buildGrowthSuggestion({ message, analysis }): GrowthSuggestion | null`.
- Produces: `saveGrowthSuggestion(suggestion)`, `getGrowthSuggestion(key)`, `getLatestPendingGrowthSuggestion()`, `dismissGrowthSuggestionRecord(key)`, and `confirmGrowthSuggestionRecord(key, steps)`.
- `GrowthSuggestion` fields are `key`, `topic`, `reason`, `experiment`, `source_input`, `status`, `session_id`, `created_at`, and `updated_at`.

- [x] **Step 1: Write failing suggestion tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGrowthSuggestion } from '../src/services/growthSuggestionEngine.js';

test('meeting-expression struggle becomes a confirmable growth suggestion', () => {
  const suggestion = buildGrowthSuggestion({
    message: '我在会议里总是不敢完整表达，担心自己说得不够好。',
    analysis: { intent: 'chat', emotion: 'anxious', tags: ['life'] }
  });

  assert.equal(suggestion.topic, '在会议中更完整地表达');
  assert.match(suggestion.reason, /反复|担心|表达/);
  assert.match(suggestion.experiment, /下一次会议|先说完/);
  assert.match(suggestion.key, /^growth:[a-f0-9]{24}$/);
  assert.equal(suggestion.status, 'pending');
});

test('ordinary low-signal chat does not create a suggestion', () => {
  assert.equal(buildGrowthSuggestion({
    message: '今天天气不错。',
    analysis: { intent: 'chat', emotion: 'neutral', tags: ['life'] }
  }), null);
});
```

- [x] **Step 2: Run the test and verify the missing-module failure**

Run: `node --test test/growthSuggestionEngine.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `growthSuggestionEngine.js`.

- [x] **Step 3: Implement deterministic suggestion extraction**

```js
import { createHash } from 'node:crypto';
import { extractLearningTopic } from './topicExtractor.js';

const MEETING_EXPRESSION_CUES = ['会议', '开会', '表达', '发言', '不敢说', '说不完整'];
const REPEAT_CUES = ['总是', '经常', '每次', '反复', '一直'];
const CONCERN_CUES = ['担心', '害怕', '不敢', '焦虑', '紧张', '卡住'];

export function buildGrowthSuggestion({ message, analysis = {} }) {
  const input = String(message || '').trim();
  if (!input) return null;

  const meetingExpression = includesAny(input, MEETING_EXPRESSION_CUES)
    && includesAny(input, CONCERN_CUES);
  const explicitLearning = analysis.intent === 'learning';
  const repeatedStruggle = includesAny(input, REPEAT_CUES)
    && (analysis.intent === 'struggle' || includesAny(input, CONCERN_CUES));

  if (!meetingExpression && !explicitLearning && !repeatedStruggle) return null;

  const topic = meetingExpression
    ? '在会议中更完整地表达'
    : extractLearningTopic(input);
  const normalized = `${topic}|${input}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 24);

  return {
    key: `growth:${digest}`,
    topic,
    reason: meetingExpression
      ? '你反复提到对表达不完整的担心，这可能值得用一个很小的练习继续看看。'
      : `“${topic}”已经出现了一个可以持续练习的方向。`,
    experiment: meetingExpression
      ? '下一次会议先完整说完一个观点，再停下来听回应。'
      : `先用十分钟完成一个关于“${topic}”的最小例子。`,
    source_input: input,
    status: 'pending'
  };
}

function includesAny(text, cues) {
  return cues.some((cue) => text.includes(cue));
}
```

- [x] **Step 4: Add the suggestion table and storage functions**

Add this table to `ensureSchema()` in `src/storage/memoryStore.js`:

```sql
CREATE TABLE IF NOT EXISTS growth_suggestions (
  suggestion_key TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  reason TEXT NOT NULL,
  experiment TEXT NOT NULL,
  source_input TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  session_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES learning_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_growth_suggestions_status_updated
  ON growth_suggestions(status, updated_at DESC);
```

Add storage functions that map `suggestion_key` to public field `key` and use an upsert that never changes `confirmed` or `dismissed` records back to `pending`:

```js
export async function saveGrowthSuggestion(suggestion) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(`
    INSERT INTO growth_suggestions
      (suggestion_key, topic, reason, experiment, source_input, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(suggestion_key) DO UPDATE SET
      topic = excluded.topic,
      reason = excluded.reason,
      experiment = excluded.experiment,
      source_input = excluded.source_input,
      updated_at = CASE
        WHEN growth_suggestions.status = 'pending' THEN excluded.updated_at
        ELSE growth_suggestions.updated_at
      END
  `, suggestion.key, suggestion.topic, suggestion.reason, suggestion.experiment,
  suggestion.source_input, now, now);
  return getGrowthSuggestion(suggestion.key);
}

function mapGrowthSuggestionRow(row) {
  if (!row) return null;
  return {
    key: row.suggestion_key,
    topic: row.topic,
    reason: row.reason,
    experiment: row.experiment,
    source_input: row.source_input,
    status: row.status,
    session_id: row.session_id,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
```

Implement confirmation as one SQLite write transaction so concurrent duplicate clicks cannot create two sessions:

```js
export async function confirmGrowthSuggestionRecord(key, steps) {
  const db = await getDb();
  await db.exec('BEGIN IMMEDIATE');
  try {
    const row = await db.get('SELECT * FROM growth_suggestions WHERE suggestion_key = ?', key);
    if (!row) {
      await db.exec('ROLLBACK');
      return null;
    }
    if (row.status === 'dismissed') {
      const error = new Error('growth suggestion was dismissed');
      error.status = 409;
      error.code = 'growth_suggestion_dismissed';
      throw error;
    }
    if (row.status === 'confirmed' && row.session_id) {
      const sessionRow = await db.get(
        'SELECT id, topic, status, current_step, steps, created_at, updated_at FROM learning_sessions WHERE id = ?',
        row.session_id
      );
      await db.exec('COMMIT');
      return { suggestion: mapGrowthSuggestionRow(row), session: mapLearningSessionRow(sessionRow), created: false };
    }

    const now = new Date().toISOString();
    const result = await db.run(`
      INSERT INTO learning_sessions (topic, status, current_step, steps, created_at, updated_at)
      VALUES (?, 'active', 0, ?, ?, ?)
    `, row.topic, JSON.stringify(steps), now, now);
    await db.run(`
      UPDATE growth_suggestions
      SET status = 'confirmed', session_id = ?, updated_at = ?
      WHERE suggestion_key = ?
    `, result.lastID, now, key);
    const confirmedRow = await db.get('SELECT * FROM growth_suggestions WHERE suggestion_key = ?', key);
    const sessionRow = await db.get(
      'SELECT id, topic, status, current_step, steps, created_at, updated_at FROM learning_sessions WHERE id = ?',
      result.lastID
    );
    await db.exec('COMMIT');
    return { suggestion: mapGrowthSuggestionRow(confirmedRow), session: mapLearningSessionRow(sessionRow), created: true };
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => {});
    throw error;
  }
}
```

- [x] **Step 5: Add isolated storage assertions and run the focused tests**

Extend `test/growthSuggestionEngine.test.js` with the repository's temporary `ECHO_DB_PATH` pattern and assert that saving the same key twice produces one pending row and that dismissed rows remain dismissed.

Run: `node --test test/growthSuggestionEngine.test.js`

Expected: PASS.

- [x] **Step 6: Commit the suggestion boundary**

```bash
git add src/services/growthSuggestionEngine.js src/storage/memoryStore.js test/growthSuggestionEngine.test.js
git commit -m "feat: persist confirmable growth suggestions"
```

---

### Task 2: Require explicit confirmation before session creation

**Files:**
- Modify: `src/services/chatService.js`
- Modify: `src/services/learningEngine.js`
- Modify: `src/services/profileEngine.js`
- Modify: `src/services/profileSynthesisEngine.js`
- Modify: `src/routes/learningRoutes.js`
- Modify: `test/api.test.js`
- Modify: `test/learningEngine.test.js`
- Create: `test/profileEngine.test.js`
- Modify: `test/profileSynthesisEngine.test.js`

**Interfaces:**
- Consumes: persisted `GrowthSuggestion` from Task 1.
- Produces: `confirmGrowthSuggestion(key)` and `dismissGrowthSuggestion(key)`.
- Produces: `POST /learning/suggestions/:key/confirm` and `POST /learning/suggestions/:key/dismiss`.
- `GET /learning/active` adds `pending_suggestion` without changing existing fields.
- `/chat` and `/api/reflect` add `growth_suggestion`; `learning_session` remains `null` until confirmation.

- [x] **Step 1: Replace the old auto-create API test with a failing confirmation-boundary test**

Add these envelope-aware helpers near `startTestServer()`:

```js
async function postJson(baseUrl, pathname, payload) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body.error || body));
  return body.data || body;
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body.error || body));
  return body.data || body;
}
```

```js
test('growth suggestion requires confirmation and confirmation is idempotent', async () => {
  const ctx = await startTestServer();
  try {
    const reflect = await postJson(ctx.baseUrl, '/api/reflect', {
      message: '我在会议里总是不敢完整表达，担心自己说得不够好。'
    });
    const before = await getJson(ctx.baseUrl, '/learning/active');

    assert.equal(reflect.result.learning_session, null);
    assert.equal(reflect.result.growth_suggestion.status, 'pending');
    assert.equal(before.current_session, null);

    const profileBefore = await getJson(ctx.baseUrl, '/memory/profile');
    assert.equal(profileBefore.profile.some((entry) => entry.key === 'current_learning_focus'), false);

    const key = reflect.result.growth_suggestion.key;
    const first = await postJson(ctx.baseUrl, `/learning/suggestions/${encodeURIComponent(key)}/confirm`, {});
    const second = await postJson(ctx.baseUrl, `/learning/suggestions/${encodeURIComponent(key)}/confirm`, {});
    const after = await getJson(ctx.baseUrl, '/learning/active');

    assert.equal(first.session.id, second.session.id);
    assert.equal(second.already_confirmed, true);
    assert.equal(after.sessions.length, 1);
    assert.equal(after.current_learning.topic, '在会议中更完整地表达');

    const profileAfter = await getJson(ctx.baseUrl, '/memory/profile');
    assert.equal(profileAfter.profile.find((entry) => entry.key === 'current_learning_focus').value, '在会议中更完整地表达');
  } finally {
    await ctx.cleanup();
  }
});
```

- [x] **Step 2: Run the focused API test and verify it fails because chat still creates a session**

Run: `node --test --test-name-pattern="growth suggestion requires confirmation" test/api.test.js`

Expected: FAIL because `current_session` is already populated or `growth_suggestion` is missing.

- [x] **Step 3: Change chat handling from auto-create to propose-only**

In `handleChat`, keep `assessLearningProgress(message)` for an existing active line, but remove `prepareLearningSession(message)` from the `analysis.intent === 'learning'` branch. After the conversation memory is written, build and save a suggestion only when no learning progress was recorded:

```js
const learningProgress = await assessLearningProgress(message);
const suggested = learningProgress
  ? null
  : buildGrowthSuggestion({ message, analysis });
const growthSuggestion = suggested
  ? await saveGrowthSuggestion(suggested)
  : null;

return {
  learning_session: learningProgress?.session || null,
  growth_suggestion: growthSuggestion
};
```

The snippet above replaces those two fields in the existing final response object; retain the existing `reply`, `emotion`, `tags`, `intent`, `behavior_hint`, `decision`, `memory_note`, `insight_note`, `explanation`, `tone`, and `agent` fields unchanged.

Both `/chat` and `/api/reflect` must return the same `handleChat` result contract.

Change `updateProfileFromInteraction(userInput, analysis, options)` so `options.allowGrowthSignals === false` writes only non-interpretive preferences (`preferred_language` and `echo_interaction_style`). Chat calls it with `allowGrowthSignals: false`; confirmation writes `current_learning_focus` and `active_growth_area` from the confirmed suggestion. This prevents an unconfirmed one-turn inference from appearing in “慢慢形成”. Repeated-memory synthesis remains governed by its existing multi-sample thresholds.

In `synthesizeProfileFromMemories`, filter a generated `sustained_learning_topic` signal unless `getLearningSessions({ limit: 100 })` contains a confirmed session with the same topic. Other multi-sample emotional and recovery signals keep their existing confidence rules and stay editable through the existing profile correction flow; they must not be relabeled as user-confirmed facts.

- [x] **Step 4: Implement confirmation and dismissal in the learning service**

Move learning-session creation behind these functions in `src/services/learningEngine.js`:

```js
export async function confirmGrowthSuggestion(key) {
  const suggestion = await getGrowthSuggestion(key);
  if (!suggestion) return null;
  const steps = buildGrowthSteps(suggestion.topic, suggestion.experiment);
  const result = await confirmGrowthSuggestionRecord(key, steps);
  if (!result) return null;
  if (result.created) await addLearningEvent(buildLearningEvent({
    session: result.session,
    eventType: LEARNING_EVENT_TYPES.SESSION_CREATED,
    reason: 'user_confirmed_growth_suggestion',
    userInput: suggestion.source_input
  }));
  await upsertUserProfile('current_learning_focus', result.suggestion.topic, 0.9, { force: true });
  await upsertUserProfile('active_growth_area', result.suggestion.topic, 0.82, { force: true });
  return { ...result, already_confirmed: !result.created };
}

export async function dismissGrowthSuggestion(key) {
  const suggestion = await getGrowthSuggestion(key);
  if (!suggestion) return null;
  if (suggestion.status === 'confirmed') {
    const error = new Error('confirmed growth suggestion cannot be dismissed');
    error.status = 409;
    error.code = 'growth_suggestion_already_confirmed';
    throw error;
  }
  return dismissGrowthSuggestionRecord(key);
}
```

Implement `buildGrowthSteps(topic, experiment)` so the first active step is the single supplied experiment and later steps are “留下真实情境记录” and “用自己的话回看变化”.

- [x] **Step 5: Add confirm/dismiss routes and pending recovery**

Add the two POST routes before `/:id/steps/:stepIndex`. Return `404 growth_suggestion_not_found` for unknown keys. Extend `/learning/active`:

```js
const pendingSuggestion = await getLatestPendingGrowthSuggestion();
sendData(res, {
  sessions,
  current_session: currentSession,
  current_learning: currentSession
    ? buildLearningViewModel(currentSession)
    : emptyLearningViewModel(),
  pending_suggestion: pendingSuggestion
});
```

- [x] **Step 6: Update learning tests to confirm before assessing progress**

Keep `prepareLearningSession` available only as a low-level test/setup helper. API tests must create sessions through confirmation; learning-engine unit tests may use `prepareLearningSession` when testing progress classification in isolation. Add this helper beside the other `test/api.test.js` HTTP helpers and use it in every API test that currently expects `/chat` to auto-create a line:

```js
async function confirmGrowthFromMessage(baseUrl, message) {
  const reflect = await postJson(baseUrl, '/api/reflect', { message });
  const suggestion = reflect.result?.growth_suggestion;
  assert.ok(suggestion?.key, `expected growth suggestion for: ${message}`);
  return postJson(
    baseUrl,
    `/learning/suggestions/${encodeURIComponent(suggestion.key)}/confirm`,
    {}
  );
}
```

Replace setup calls in the existing learning view-model, manual-step, linked-action, idempotency, out-of-range, profile-refresh, and backup/import tests. Preserve their original assertions after changing only the setup path.

Add `test/profileEngine.test.js` assertions that `extractProfileSignals(input, analysis, { allowGrowthSignals: false })` returns `preferred_language` and `echo_interaction_style` but not `current_learning_focus`, `active_growth_area`, `recurring_pattern`, or `emotional_trigger`.

Extend `test/profileSynthesisEngine.test.js` so repeated learning-tagged memories without a matching learning session do not persist `sustained_learning_topic`, while the same memories after suggestion confirmation do.

Run: `node --test test/growthSuggestionEngine.test.js test/learningEngine.test.js test/profileEngine.test.js test/profileSynthesisEngine.test.js test/api.test.js`

Expected: PASS.

- [x] **Step 7: Commit the confirmation API**

```bash
git add src/services/chatService.js src/services/learningEngine.js src/services/profileEngine.js src/services/profileSynthesisEngine.js src/routes/learningRoutes.js test/api.test.js test/learningEngine.test.js test/profileEngine.test.js test/profileSynthesisEngine.test.js
git commit -m "feat: require confirmation before growth lines"
```

---

### Task 3: Add the confirmable growth card to the homepage

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/hooks/useMarginWorkspace.ts`
- Modify: `frontend/src/components/ConversationAnnotations.tsx`
- Modify: `frontend/src/components/TraceWorkspace.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`
- Create: `test/growthSuggestionUi.test.js`

**Interfaces:**
- Produces TypeScript interface `GrowthSuggestion` and API functions `confirmGrowthSuggestion(key)` and `dismissGrowthSuggestion(key)`.
- `UseMarginWorkspaceResult` adds matching mutation methods that await `refresh()` before resolving.
- `ConversationAnnotations` consumes `growthSuggestion`, `growthSuggestionBusy`, `onConfirmGrowth`, and `onDismissGrowth`.

- [x] **Step 1: Write a failing UI structure test**

```js
test('homepage growth suggestion is confirmable and dismissible', async () => {
  const [annotations, app] = await Promise.all([
    readFile(new URL('../frontend/src/components/ConversationAnnotations.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8')
  ]);
  assert.match(annotations, /onConfirmGrowth/);
  assert.match(annotations, /onDismissGrowth/);
  assert.match(annotations, /形成这条成长线/);
  assert.match(annotations, /先不形成/);
  assert.match(app, /response\.result\?\.growth_suggestion/);
});

test('automatic profile signals are not labeled as user-confirmed facts', async () => {
  const traces = await readFile(new URL('../frontend/src/components/TraceWorkspace.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(traces, /已经确认/);
  assert.match(traces, /反复出现/);
  assert.match(traces, /尚在形成/);
});
```

- [x] **Step 2: Run the UI test and verify it fails**

Run: `node --test test/growthSuggestionUi.test.js`

Expected: FAIL because the confirmation props and copy do not exist.

- [x] **Step 3: Add typed API contracts**

```ts
export interface GrowthSuggestion {
  key: string;
  topic: string;
  reason: string;
  experiment: string;
  source_input?: string;
  status: 'pending' | 'confirmed' | 'dismissed';
  session_id?: number | null;
}

export interface GrowthSuggestionMutationResponse {
  suggestion: GrowthSuggestion;
  session?: LearningSession;
  already_confirmed?: boolean;
}
```

Set `ChatResponse.growth_suggestion?: GrowthSuggestion | null` and `LearningActiveResponse.pending_suggestion?: GrowthSuggestion | null`. Implement POST helpers using encoded keys.

- [x] **Step 4: Make workspace mutations refresh coherently**

Use `await refresh()` rather than `void refresh()` for confirm and dismiss:

```ts
const workspaceConfirmGrowthSuggestion = useCallback(async (key: string) => {
  const result = await confirmGrowthSuggestion(key);
  await refresh();
  return result;
}, [refresh]);
```

Return both functions from `useMarginWorkspace` and include their exact signatures in `UseMarginWorkspaceResult`.

- [x] **Step 5: Render a two-action paper note**

Change `ConversationAnnotations` so a pending suggestion shows topic, reason, and the small experiment. Its footer contains two text buttons:

```tsx
<div className="growth-suggestion-actions">
  <button disabled={growthSuggestionBusy} onClick={onDismissGrowth} type="button">
    先不形成
  </button>
  <button disabled={growthSuggestionBusy} onClick={onConfirmGrowth} type="button">
    形成这条成长线 <ArrowRight aria-hidden="true" size={13} />
  </button>
</div>
```

After confirmation, the existing “去成长轨迹看看” entry may appear from `current_learning`; dismissal removes the card and leaves the conversation unchanged.

In the compact “慢慢形成” panel, replace automatic-signal status copy “已经确认 / 等待确认” with “反复出现 / 尚在形成”. Keep the correction action in the expanded profile view. This prevents confidence thresholds from being presented as explicit user consent.

- [x] **Step 6: Wire response and recovered pending state in App**

Store only the latest response suggestion temporarily, with persisted workspace state as fallback:

```ts
const [responseGrowthSuggestion, setResponseGrowthSuggestion] = useState<GrowthSuggestion | null>(null);
const pendingGrowthSuggestion = responseGrowthSuggestion?.status === 'pending'
  ? responseGrowthSuggestion
  : workspace.learningLine?.pending_suggestion || null;
```

In `handleSend`, assign `response.result?.growth_suggestion || null`. Confirmation and dismissal clear the temporary value only after the backend mutation succeeds. Display failures through the existing `sendError` region.

- [x] **Step 7: Add restrained action styles without new paper surfaces**

Add `.growth-suggestion-actions` as a flex row using transparent text buttons and existing underline colors. Do not add a full-page background, shadow, or container outside `PaperNote`.

Run: `node --test test/growthSuggestionUi.test.js test/visualSystem.test.js && npm run lint:ui && npm run build:ui`

Expected: PASS.

- [x] **Step 8: Commit the homepage confirmation flow**

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/useMarginWorkspace.ts frontend/src/components/ConversationAnnotations.tsx frontend/src/components/TraceWorkspace.tsx frontend/src/App.tsx frontend/src/index.css test/growthSuggestionUi.test.js
git commit -m "feat: confirm growth lines from the homepage"
```

---

### Task 4: Record experiment results and make completion idempotent

**Files:**
- Modify: `src/storage/memoryStore.js`
- Modify: `src/routes/learningRoutes.js`
- Modify: `src/routes/memoryRoutes.js`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/viewModels/paperWorkspace.ts`
- Modify: `frontend/src/viewModels/paperWorkspace.test.ts`
- Modify: `frontend/src/hooks/useMarginWorkspace.ts`
- Modify: `frontend/src/components/GrowthJourney.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`
- Modify: `test/api.test.js`
- Modify: `test/growthJourney.test.js`

**Interfaces:**
- `POST /learning/:id/steps/:stepIndex` accepts `{ status, result? }`.
- Response adds `already_applied: boolean`.
- `GET /memory` adds `growth_records`, built from result-bearing learning events.
- `updateLearningStep` frontend helper accepts optional `result`.
- `GrowthJourney` replaces `onCompleteCurrent` with `onRecordExperiment(result: string)`.

- [x] **Step 1: Write failing API tests for result persistence and duplicate completion**

After creating a confirmed growth line, submit the same step completion twice:

```js
const payload = { status: 'done', result: '我先说完了一个观点，没有在中途自我否定。' };
const first = await postJson(baseUrl, `/learning/${sessionId}/steps/0`, payload);
const second = await postJson(baseUrl, `/learning/${sessionId}/steps/0`, payload);
const events = await getJson(baseUrl, `/learning/events?sessionId=${sessionId}`);
const completions = events.events.filter((event) => event.event_type === 'manual_step_done');

assert.equal(first.already_applied, false);
assert.equal(second.already_applied, true);
assert.equal(completions.length, 1);
assert.equal(completions[0].user_input, payload.result);
```

- [x] **Step 2: Run the focused test and verify duplicate events are currently written**

Run: `node --test --test-name-pattern="result persistence|duplicate completion" test/api.test.js`

Expected: FAIL because the route always appends a manual event and ignores `result`.

- [x] **Step 3: Make the route compare before mutating**

Export the existing internal `getLearningSessionById(id)` from `memoryStore.js`. Read the session before `updateLearningStep`. If the target step already has the requested status, return the existing session with `already_applied: true` and do not write an event. Otherwise update and pass trimmed `result` into the existing `buildManualStepEvent` `userInput` parameter.

Reject result strings longer than 4000 characters with `400 learning_result_too_long`; an empty result is allowed for non-experiment steps, while completing the active first experiment from the UI requires non-empty text.

- [x] **Step 4: Expose result-bearing growth records to the traces view**

Extend `GET /memory` with only learning events that contain a non-empty `user_input` and an event type ending in `_done` or `_completed`:

```js
const growthRecords = (await getLearningEvents({ limit: 50 }))
  .filter((event) => event.user_input && /(done|completed)$/i.test(event.event_type))
  .map((event) => ({
    id: `learning-event-${event.id}`,
    timestamp: event.created_at,
    text: event.user_input,
    context: event.step_title || event.topic,
    source: '成长记录'
  }));

sendData(res, {
  memories,
  growth_records: growthRecords,
  current_memory: buildMemoryViewModel(memories)
});
```

Add `growth_records?: GrowthRecord[]` to `MemoryResponse`. Update `buildTracePageModel` to merge normalized growth records with conversation memories before sorting and limiting to ten; preserve the supplied `source` instead of labeling it “思考片段”. Add a view-model test asserting that the recorded experiment text appears as source “成长记录”.

```ts
export interface GrowthRecord {
  id: string;
  timestamp?: string;
  text: string;
  context?: string;
  source: '成长记录';
}
```

- [x] **Step 5: Add a compact result editor to the weekly experiment paper**

In `GrowthJourney`, keep local `experimentResult`, `savingResult`, and `resultNotice`. The paper note action opens a textarea; the save button is disabled for blank input or while saving:

```tsx
<form className="experiment-result-form" onSubmit={submitExperimentResult}>
  <label htmlFor="experiment-result">这次实际发生了什么？</label>
  <textarea
    id="experiment-result"
    maxLength={4000}
    onChange={(event) => setExperimentResult(event.target.value)}
    rows={3}
    value={experimentResult}
  />
  <button disabled={savingResult || !experimentResult.trim()} type="submit">留下结果</button>
</form>
```

Do not introduce a modal or new page. Long text scrolls inside the textarea and later inside the existing record region.

- [x] **Step 6: Await the post-mutation refresh**

Update `useMarginWorkspace` so learning-step mutation performs `await refresh()` before resolving. In `App.handleStepChange`, pass the recorded result and show a calm failure notice without changing the local step to complete on failure.

- [x] **Step 7: Update component and structural tests**

Assert that `GrowthJourney.tsx` contains `experiment-result-form`, `maxLength={4000}`, and `onRecordExperiment`, and that pending path nodes remain disabled.

Run: `node --test test/api.test.js test/growthJourney.test.js && npm run test:ui-views && npm run lint:ui && npm run build:ui`

Expected: PASS.

- [x] **Step 8: Commit experiment recording**

```bash
git add src/storage/memoryStore.js src/routes/learningRoutes.js src/routes/memoryRoutes.js frontend/src/lib/api.ts frontend/src/viewModels/paperWorkspace.ts frontend/src/viewModels/paperWorkspace.test.ts frontend/src/hooks/useMarginWorkspace.ts frontend/src/components/GrowthJourney.tsx frontend/src/App.tsx frontend/src/index.css test/api.test.js test/growthJourney.test.js
git commit -m "feat: record idempotent growth experiment results"
```

---

### Task 5: Prove the full story and restart recovery

**Files:**
- Create: `test/coreExperienceFlow.test.js`
- Modify: `frontend/src/viewModels/paperWorkspace.test.ts`
- Modify: `test/visualSystem.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces test command `npm run test:core-beta`.
- Consumes only public HTTP endpoints and the existing page view-model builders.

- [ ] **Step 1: Write the end-to-end isolated-database test**

The test must:

1. Start `createApp()` with a temporary `ECHO_DB_PATH`.
2. POST the fixed meeting-expression story to `/api/reflect`.
3. Assert no learning session exists before confirmation.
4. Confirm the returned suggestion twice and assert one session.
5. Record the first experiment result twice and assert one completion event.
6. Fetch `/learning/active`, `/memory`, `/memory/profile`, and `/achievements`.
7. Close the server and memory store without deleting the database.
8. Start a second `createApp()` against the same database.
9. Fetch the same four resources and assert the topic, done step, result-bearing event, trace source, and unlocked new-path/first-step achievements remain present.

Use the existing `startTestServer` mechanics, but define a local helper whose `stop({ remove: false })` preserves the temporary directory between the two starts.

- [ ] **Step 2: Run the story test and fix only contract mismatches found by it**

Run: `node --test test/coreExperienceFlow.test.js`

Expected: PASS after Tasks 1–4. If it fails, fix the producing service or route rather than adding test-only state.

- [ ] **Step 3: Add cross-page view-model consistency assertions**

In `paperWorkspace.test.ts`, construct learning, memory, profile, and achievement fixtures with topic “在会议中更完整地表达”. Assert:

```ts
assert.equal(growth.topic, "在会议中更完整地表达");
assert.equal(growth.nodes[0].status, "done");
assert.match(traces.groups[0].items[0].text, /说完了一个观点/);
assert.equal(traces.recentImprints[0].key, "learning:first_step");
```

- [ ] **Step 4: Extend visual regression structure checks**

Assert that the three workspaces remain transparent, `.experiment-result-form` has a bounded scrollable textarea, and no component adds `background-image` or full-page pseudo-elements over the notebook shell.

- [ ] **Step 5: Add the beta test command**

```json
"test:core-beta": "node --test test/coreExperienceFlow.test.js test/growthSuggestionEngine.test.js test/growthSuggestionUi.test.js test/growthJourney.test.js test/traceWorkspace.test.js test/visualSystem.test.js && npm run test:ui-views"
```

Run: `npm run test:core-beta && npm test && npm run lint:ui && npm run build:ui`

Expected: all commands exit 0.

- [ ] **Step 6: Commit the acceptance gate**

```bash
git add test/coreExperienceFlow.test.js frontend/src/viewModels/paperWorkspace.test.ts test/visualSystem.test.js package.json
git commit -m "test: gate the core growth experience"
```

---

### Task 6: Run and document the desktop acceptance pass

**Files:**
- Create: `docs/qa/2026-07-12-core-beta-acceptance.md`
- Modify only if a blocker is found: files named by the failing behavior from Tasks 1–5

**Interfaces:**
- Produces a dated acceptance record with environment, steps, evidence, blockers, acceptable issues, and deferred issues.

- [ ] **Step 1: Create the acceptance record before testing**

Use this exact structure:

```markdown
# Margin Core Beta Acceptance — 2026-07-12

## Environment
- Branch and commit:
- Windows version:
- Window size: 4:3 default
- Provider mode: local deterministic baseline
- Database: fresh temporary user-data directory

## Core Story
- [ ] Reflective message appears once
- [ ] Growth suggestion appears without creating a session
- [ ] Dismiss leaves no session
- [ ] Confirm creates exactly one session
- [ ] Experiment result is recorded once
- [ ] Growth, traces, profile, and imprint views agree
- [ ] Restart restores the same state

## Boundary States
- [ ] Empty database
- [ ] Long conversation and long experiment result
- [ ] Network failure with retry copy
- [ ] Repeated send, confirm, complete, and acknowledge
- [ ] No page surface covers notebook edges

## Findings
### Blockers
- None

### Acceptable issues
- None

### Deferred issues
- Supplier live matrix belongs to the next phase.
- Windows installer verification belongs to the following phase.
```

- [ ] **Step 2: Run the desktop story with a fresh data directory**

Run `npm run desktop`, use the fixed meeting-expression message and dismiss it once. Then send the related but distinct follow-up “下一次会议我还是担心说不完整，但想试着先说完一个观点再听回应”，confirm that new suggestion once, record the experiment, visit all three pages, and restart the application. Mark each item only after direct observation. The dismissed suggestion key must remain dismissed and must not be silently reopened.

- [ ] **Step 3: Classify and fix blockers with focused red-green tests**

A blocker is any dead end, premature session creation, duplicate durable record, lost restart state, unavailable current action, or notebook-edge coverage. For each blocker, first add the smallest failing automated test to the nearest existing test file, then implement the fix, rerun the focused test, and finally rerun `npm run test:core-beta`.

- [ ] **Step 4: Run the final release gate for this phase**

Run:

```powershell
npm run test:core-beta
npm test
npm run lint:ui
npm run build:ui
git diff --check
```

Expected: every command exits 0 and the acceptance record lists no blockers.

- [ ] **Step 5: Commit the acceptance evidence**

```bash
git add docs/qa/2026-07-12-core-beta-acceptance.md
git commit -m "docs: record core beta acceptance"
```

After this commit, start a separate provider live-matrix plan. Do not mix supplier credential evidence or Windows installer artifacts into this core-experience branch of work.
