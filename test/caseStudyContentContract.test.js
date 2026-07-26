import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseEvidenceMap,
  parseCaseStudy,
  validateEvidenceRefs,
  validateSectionParity
} from "../scripts/case-study/lib/content-contract.mjs";

const evidencePath = new URL("../case-study/content/evidence-map.md", import.meta.url);
const zhPath = new URL("../case-study/content/case-study.zh.md", import.meta.url);
const enPath = new URL("../case-study/content/case-study.en.md", import.meta.url);

test("evidence map exposes traceable classified rows", () => {
  const rows = parseEvidenceMap(fs.readFileSync(evidencePath, "utf8"));
  assert.ok(rows.length >= 18);
  assert.deepEqual(
    new Set(rows.map((row) => row.classification)),
    new Set(["Implemented", "Scenario-validated", "Hypothesis"])
  );
  assert.ok(rows.every((row) => row.sources.length > 0));
  assert.ok(rows.every((row) => row.sections.length > 0));
});

test("every Chinese factual reference exists in the evidence map", () => {
  const evidence = parseEvidenceMap(fs.readFileSync(evidencePath, "utf8"));
  const zh = fs.readFileSync(zhPath, "utf8");
  assert.deepEqual(validateEvidenceRefs(zh, evidence), []);
});

test("Chinese and English editions keep the same chapter contract", () => {
  const zh = fs.readFileSync(zhPath, "utf8");
  const en = fs.readFileSync(enPath, "utf8");
  assert.deepEqual(validateSectionParity(zh, en), []);
});

test("case study parser returns stable section and evidence ids", () => {
  const parsed = parseCaseStudy(`
<!-- section:overview -->
## 项目概览
<!-- evidence:E001,E002 -->
正文
`);
  assert.deepEqual(parsed.sectionIds, ["overview"]);
  assert.deepEqual(parsed.evidenceIds, ["E001", "E002"]);
});

test("Chinese master contains all ten chapters and explicit validation language", () => {
  const zh = fs.readFileSync(zhPath, "utf8");
  const parsed = parseCaseStudy(zh);
  assert.deepEqual(parsed.sectionIds, [
    "overview", "unmet", "reframe", "evolution", "principles",
    "loop", "mvp", "system", "experience", "validation"
  ]);
  assert.match(zh, /尚未经过真实外部用户验证/);
  assert.match(zh, /用户不需要先整理好自己，才值得被理解/);
  assert.match(zh, /108\/108/);
  assert.match(zh, /Implemented/);
  assert.match(zh, /Scenario-validated/);
  assert.match(zh, /Hypothesis/);
  assert.ok(zh.replace(/[#>*_`|<>\-\s]/g, "").length >= 7000);
});

test("every chapter in the Chinese master cites evidence", () => {
  const zh = fs.readFileSync(zhPath, "utf8");
  const sections = zh.split(/<!--\s*section:/).slice(1);
  assert.equal(sections.length, 10);
  assert.ok(sections.every((section) => /<!--\s*evidence:/.test(section)));
});

test("E011 identifies the product test count as a pre-case-study baseline", () => {
  const evidence = parseEvidenceMap(fs.readFileSync(evidencePath, "utf8"));
  const baseline = evidence.find((row) => row.id === "E011");
  assert.ok(baseline);
  assert.match(baseline.claim, /核心产品|制作前基线/);
});
