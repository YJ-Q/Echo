import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const screenshotNames = [
  "now.png",
  "learn.png",
  "actions.png",
  "memory.png",
  "management.png",
  "achievements.png"
];

function pngSize(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

test("case study product screenshots are complete and portfolio-sized", () => {
  for (const name of screenshotNames) {
    const path = new URL(`../case-study/assets/screenshots/${name}`, import.meta.url);
    const buffer = fs.readFileSync(path);
    assert.ok(buffer.length > 80_000, `${name} is unexpectedly small`);
    assert.deepEqual(pngSize(buffer), { width: 1440, height: 1000 });
  }
});

test("case study capture disables Electron hardware acceleration before startup", () => {
  const scriptPath = new URL("../scripts/case-study/capture-product.mjs", import.meta.url);
  const source = fs.readFileSync(scriptPath, "utf8");
  const disableIndex = source.indexOf("app.disableHardwareAcceleration()");
  const readyIndex = source.indexOf("app.whenReady()");

  assert.ok(disableIndex >= 0, "capture script must disable hardware acceleration");
  assert.ok(disableIndex < readyIndex, "hardware acceleration must be disabled before app.whenReady()");
});

test("case study capture force-hides the launch overlay", () => {
  const scriptPath = new URL("../scripts/case-study/capture-product.mjs", import.meta.url);
  const source = fs.readFileSync(scriptPath, "utf8");

  assert.match(
    source,
    /#launch-screen\s*\{[^}]*display:\s*none\s*!important/s,
    "capture CSS must hide the launch overlay deterministically"
  );
});

test("case study capture seeds synthetic data and waits for stable routes", () => {
  const scriptPath = new URL("../scripts/case-study/capture-product.mjs", import.meta.url);
  const source = fs.readFileSync(scriptPath, "utf8");

  assert.match(source, /async function seedDemoData\(/);
  assert.match(source, /await seedDemoData\(\)/);
  assert.match(source, /async function waitForView\(/);
  assert.match(source, /async function waitForSeededData\(/);
  assert.match(source, /await waitForSeededData\(/);
  assert.match(source, /session\.clearCache/);
  assert.match(source, /actionCount >= 2/);
  assert.doesNotMatch(source, /requestJson\("\/management\/proposals"/);
  assert.match(source, /async function seedOperationEvent\(/);
  assert.match(source, /addOperationEvent/);
  assert.match(source, /addLearningEvent/);
  assert.match(source, /先用一句话说明它解决的核心问题/);
  assert.match(source, /dataset\.activeView/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /window\.scrollTo\(0, 0\)/);
  assert.match(source, /mainWindow\.scrollTop = 0/);
  assert.match(source, /requestAnimationFrame/);
});

test("case study capture rejects loading and object-string artifacts", () => {
  const scriptPath = new URL("../scripts/case-study/capture-product.mjs", import.meta.url);
  const source = fs.readFileSync(scriptPath, "utf8");

  assert.match(source, /正在铺开这一页/);
  assert.match(source, /\[object Object\]/);
  assert.match(source, /"Node\.js"/);
  assert.match(source, /throw new Error\(`Unsafe screenshot/);
});
