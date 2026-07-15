import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL("../frontend/src/components/TraceWorkspace.tsx", import.meta.url);
const appPath = new URL("../frontend/src/App.tsx", import.meta.url);

test("trace workspace contains the approved recent-trace spread", async () => {
  const source = await readFile(componentPath, "utf8");
  for (const label of ["最近留下", "最近 10 条", "慢慢形成", "最近印记", "共"] ) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /trace-date-group/);
  assert.match(source, /trace-item-expanded/);
  assert.match(source, /recent-imprint-coins/);
  assert.doesNotMatch(source, /wax|火漆|section-paper|archive-cotton/i);
});

test("trace workspace owns focus exchange without subpage navigation", async () => {
  const [source, app] = await Promise.all([readFile(componentPath, "utf8"), readFile(appPath, "utf8")]);
  assert.match(source, /useState<TraceFocus>/);
  assert.match(source, /useState<TraceMode>/);
  assert.match(source, /resolveTraceSlots/);
  assert.match(source, /长期留下/);
  assert.match(source, /最近留下/);
  assert.doesNotMatch(app, /TraceSectionNav/);
  assert.doesNotMatch(app, /memorySubpage/);
});
