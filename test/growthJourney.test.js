import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL("../frontend/src/components/GrowthJourney.tsx", import.meta.url);
const appPath = new URL("../frontend/src/App.tsx", import.meta.url);
const cssPath = new URL("../frontend/src/index.css", import.meta.url);

test("growth journey contains the approved workspace regions and no imprint UI", async () => {
  const source = await readFile(componentPath, "utf8");
  for (const label of ["我现在的理解", "我注意到", "可能担心", "想试试看", "本周小实验", "真实情境记录", "当前成长线"]) {
    assert.match(source, new RegExp(label));
  }
  assert.doesNotMatch(source, /Imprint|印记|coin|硬币/i);
  assert.match(source, /onWheel/);
  assert.match(source, /aria-current="step"/);
  assert.match(source, /experiment-result-form/);
  assert.match(source, /maxLength=\{4000\}/);
  assert.match(source, /onRecordExperiment/);
  assert.match(source, /disabled=\{node\.disabled\}/);
});

test("growth journey uses the approved name and warm full-spread override", async () => {
  const [app, css] = await Promise.all([readFile(appPath, "utf8"), readFile(cssPath, "utf8")]);
  assert.match(app, /id: "learning", label: "成长轨迹"/);
  assert.match(css, /\.section-paper-learning\.growth-workspace\s*\{/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 58fr\) minmax\(0, 42fr\);/);
});
