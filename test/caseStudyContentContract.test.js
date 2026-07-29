import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseEvidenceMap,
  parseCaseStudy,
  validateEvidenceRefs,
  validateSectionParity,
  validateRecruiterSummary,
  validateJobApplication
} from "../scripts/case-study/lib/content-contract.mjs";

const evidencePath = new URL("../case-study/content/evidence-map.md", import.meta.url);
const zhPath = new URL("../case-study/content/case-study.zh.md", import.meta.url);
const enPath = new URL("../case-study/content/case-study.en.md", import.meta.url);
const recruiterPath = new URL(
  "../case-study/content/recruiter-summary.json",
  import.meta.url
);
const jobApplicationPath = new URL(
  "../case-study/content/job-application.zh.md",
  import.meta.url
);

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

test("English edition is complete and keeps portfolio-critical language", () => {
  const en = fs.readFileSync(enPath, "utf8");
  assert.match(en, /A Place for the Self Still in Progress/);
  assert.match(en, /not yet validated with external users/i);
  assert.match(en, /Implemented/);
  assert.match(en, /Scenario-validated/);
  assert.match(en, /Hypothesis/);
  assert.match(en, /108\/108/);
  const words = en
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/[^A-Za-z0-9'-]+/g, " ")
    .trim()
    .split(/\s+/);
  assert.ok(words.length >= 4000);
});

test("English edition contains no untranslated Chinese body paragraphs", () => {
  const en = fs.readFileSync(enPath, "utf8");
  const withoutApprovedTitle = en.replace("Margin：为尚未整理好的自己，留一个位置", "");
  assert.doesNotMatch(withoutApprovedTitle, /[\u3400-\u9fff]{8,}/);
});

test("recruiter summary keeps bilingual structure, resources, and known evidence", () => {
  const evidence = parseEvidenceMap(fs.readFileSync(evidencePath, "utf8"));
  const summary = JSON.parse(fs.readFileSync(recruiterPath, "utf8"));

  assert.deepEqual(validateRecruiterSummary(summary, evidence), []);
  assert.equal(summary.zh.quickRead.decisions.length, 3);
  assert.equal(summary.en.quickRead.decisions.length, 3);
  assert.equal(summary.resources.fullCaseAnchor, "overview");
  assert.equal(summary.resources.pdf.zh, "../dist/margin-case-study.zh.pdf");
  assert.equal(summary.resources.pdf.en, "../dist/margin-case-study.en.pdf");
  assert.equal(summary.resources.github, "https://github.com/YJ-Q/Echo");
});

test("Chinese job application kit contains every required interview section", () => {
  const markdown = fs.readFileSync(jobApplicationPath, "utf8");
  assert.deepEqual(validateJobApplication(markdown), []);
  assert.match(markdown, /尚未经过真实外部用户验证/);
  assert.doesNotMatch(markdown, /我们团队|带领团队|用户留存率|用户满意度/);
});

test("recruiter contract rejects unknown evidence and missing questions", () => {
  const evidence = parseEvidenceMap(fs.readFileSync(evidencePath, "utf8"));
  const summary = JSON.parse(fs.readFileSync(recruiterPath, "utf8"));
  const invalidSummary = structuredClone(summary);
  invalidSummary.zh.quickRead.decisions[0].evidenceIds = ["E999"];

  assert.deepEqual(
    validateRecruiterSummary(invalidSummary, evidence),
    ["Unknown recruiter evidence id: E999"]
  );
  assert.match(
    validateJobApplication("# 简历项目描述\n\n内容").join("\n"),
    /Missing job application section/
  );
  assert.match(
    validateJobApplication(
      `${fs.readFileSync(jobApplicationPath, "utf8")}\n用户满意度达到 95%。`
    ).join("\n"),
    /Forbidden portfolio claim/
  );
});
