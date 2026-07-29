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

const diagramNames = [
  "category-boundary.svg",
  "product-loop.svg",
  "memory-system.svg",
  "validation-layers.svg"
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
  const seedSource = fs.readFileSync(
    new URL("../scripts/case-study/seed-operation-event.mjs", import.meta.url),
    "utf8"
  );

  assert.match(source, /async function seedDemoData\(/);
  assert.match(source, /await seedDemoData\(\)/);
  assert.match(source, /async function waitForView\(/);
  assert.match(source, /async function waitForSeededData\(/);
  assert.match(source, /await waitForSeededData\(/);
  assert.match(source, /session\.clearCache/);
  assert.match(source, /actionCount >= 2/);
  assert.doesNotMatch(source, /requestJson\("\/management\/proposals"/);
  assert.match(source, /async function seedOperationEvent\(/);
  assert.match(seedSource, /addOperationEvent/);
  assert.match(seedSource, /addLearningEvent/);
  assert.match(source, /MARGIN_LLM_PROVIDER:\s*"local"/);
  assert.match(source, /MARGIN_DB_PATH:\s*tempDb/);
  assert.match(seedSource, /先用一句话说明它解决的核心问题/);
  assert.match(source, /dataset\.activeView/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /window\.scrollTo\(0, 0\)/);
  assert.match(source, /mainWindow\.scrollTop = 0/);
  assert.match(source, /requestAnimationFrame/);
});

test("case study capture delegates owned backend startup with explicit info logging", () => {
  const scriptPath = new URL("../scripts/case-study/capture-product.mjs", import.meta.url);
  const source = fs.readFileSync(scriptPath, "utf8");

  assert.doesNotMatch(source, /const port\s*=\s*3197/u);
  assert.match(source, /startCaptureBackend/u);
  assert.match(source, /MARGIN_LOG_LEVEL:\s*"info"/u);
  assert.match(source, /await stopBackend/u);
});

test("case study capture and review use current Margin temporary database names", () => {
  const scriptPath = new URL("../scripts/case-study/capture-product.mjs", import.meta.url);
  const reviewPath = new URL("../case-study/REVIEW.md", import.meta.url);
  const source = fs.readFileSync(scriptPath, "utf8");
  const review = fs.readFileSync(reviewPath, "utf8");

  assert.match(source, /margin-case-study\.sqlite/u);
  assert.doesNotMatch(source, /echo-case-study\.sqlite/u);
  assert.match(review, /case-study\/\.tmp\/margin-case-study\.sqlite/u);
  assert.match(review, /MARGIN_DB_PATH/u);
});

test("case study capture rejects loading and object-string artifacts", () => {
  const scriptPath = new URL("../scripts/case-study/capture-product.mjs", import.meta.url);
  const source = fs.readFileSync(scriptPath, "utf8");

  assert.match(source, /正在铺开这一页/);
  assert.match(source, /\[object Object\]/);
  assert.match(source, /"Node\.js"/);
  assert.match(source, /throw new Error\(`Unsafe screenshot/);
});

test("case study diagrams are accessible and self-contained", () => {
  for (const name of diagramNames) {
    const path = new URL(`../case-study/assets/diagrams/${name}`, import.meta.url);
    const svg = fs.readFileSync(path, "utf8");

    assert.match(svg, /viewBox="0 0 1600 900"/);
    assert.match(svg, /role="img"/);
    assert.match(svg, /<title>[^<]+<\/title>/);
    assert.match(svg, /<desc>[^<]+<\/desc>/);
    assert.doesNotMatch(svg, /(?:href|src)=["']https?:\/\//);
    assert.doesNotMatch(svg, /@font-face|url\((?!#)/);
    assert.doesNotMatch(svg, /<foreignObject/);
    assert.doesNotMatch(svg, /overflow\s*=\s*["']visible["']/);

    const fontSizes = [...svg.matchAll(/font-size="(\d+)"/g)].map((match) => Number(match[1]));
    assert.ok(fontSizes.length > 0, `${name} must declare legible text sizes`);
    assert.ok(Math.min(...fontSizes) >= 17, `${name} must not use text smaller than 17px`);
  }
});

test("recruiter delivery includes both non-empty PDF editions", () => {
  for (const name of [
    "margin-case-study.zh.pdf",
    "margin-case-study.en.pdf"
  ]) {
    const path = new URL(`../case-study/dist/${name}`, import.meta.url);
    const buffer = fs.readFileSync(path);
    assert.ok(buffer.length > 1_000_000, `${name} is missing or unexpectedly small`);
    assert.equal(buffer.toString("ascii", 0, 4), "%PDF");
  }
});
