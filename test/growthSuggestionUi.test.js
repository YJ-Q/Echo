import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const annotationsPath = new URL('../frontend/src/components/ConversationAnnotations.tsx', import.meta.url);
const appPath = new URL('../frontend/src/App.tsx', import.meta.url);
const tracesPath = new URL('../frontend/src/components/TraceWorkspace.tsx', import.meta.url);

test('homepage growth suggestion is confirmable and dismissible', async () => {
  const [annotations, app] = await Promise.all([
    readFile(annotationsPath, 'utf8'),
    readFile(appPath, 'utf8')
  ]);

  assert.match(annotations, /onConfirmGrowth/);
  assert.match(annotations, /onDismissGrowth/);
  assert.match(annotations, /形成这条成长线/);
  assert.match(annotations, /先不形成/);
  assert.match(app, /response\.result\?\.growth_suggestion/);
});

test('automatic profile signals are not labeled as user-confirmed facts', async () => {
  const traces = await readFile(tracesPath, 'utf8');

  assert.doesNotMatch(traces, /已经确认/);
  assert.match(traces, /反复出现/);
  assert.match(traces, /尚在形成/);
});
