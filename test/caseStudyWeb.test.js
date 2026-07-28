import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderMarkdown } from "../scripts/case-study/lib/markdown-renderer.mjs";
import { buildAllContent } from "../scripts/case-study/build-web.mjs";

test("controlled Markdown renderer supports portfolio content safely", () => {
  const html = renderMarkdown(`
## 标题
> 引文
- 一项
**判断** 与 \`证据\`
`);
  assert.match(html, /<h2>标题<\/h2>/);
  assert.match(html, /<blockquote>引文<\/blockquote>/);
  assert.match(html, /<ul><li>一项<\/li><\/ul>/);
  assert.match(html, /<strong>判断<\/strong>/);
  assert.match(html, /<code>证据<\/code>/);
});

test("renderer handles ordered lists and real case-study tables", () => {
  const html = renderMarkdown(`
1. 第一项
2. 第二项

| 层级 | 边界 |
|---|---|
| **Implemented** | 已实现 |
`);
  assert.match(html, /<ol><li>第一项<\/li><li>第二项<\/li><\/ol>/);
  assert.match(html, /<table>/);
  assert.match(html, /<thead><tr><th>层级<\/th><th>边界<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody><tr><td><strong>Implemented<\/strong><\/td><td>已实现<\/td><\/tr><\/tbody>/);
});

test("renderer escapes executable HTML", () => {
  const html = renderMarkdown("<script>alert(1)</script>");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("web shell exposes language, navigation, accessibility and content hooks", () => {
  const html = fs.readFileSync(
    new URL("../case-study/web/index.html", import.meta.url),
    "utf8"
  );
  assert.match(html, /class="skip-link"/);
  assert.match(html, /data-language="zh"/);
  assert.match(html, /data-language="en"/);
  assert.match(html, /id="case-study-nav"/);
  assert.match(html, /id="case-study-content"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("web interaction keeps section position without scrollIntoView", () => {
  const source = fs.readFileSync(
    new URL("../case-study/web/case-study.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /scrollIntoView/);
  assert.match(source, /window\.scrollTo/);
  assert.match(source, /getBoundingClientRect/);
  assert.match(source, /history\.replaceState/);
});

test("editorial evidence CSS enforces reading and touch contracts", () => {
  const css = fs.readFileSync(
    new URL("../case-study/web/styles.css", import.meta.url),
    "utf8"
  );
  for (const token of [
    "--paper: #f4eedf",
    "--paper-raised: #fbf8f0",
    "--ink: #25211c",
    "--ink-soft: #6e6257",
    "--terracotta: #a74735",
    "--rule: #d6cabb"
  ]) {
    assert.ok(css.includes(token), `missing approved token ${token}`);
  }
  assert.match(css, /font-synthesis:\s*none/);
  assert.match(css, /line-break:\s*strict/);
  assert.match(css, /text-wrap:\s*balance/);
  assert.match(css, /text-wrap:\s*pretty/);
  assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|conic-gradient/i);
});

test("generated web content contains both languages and all ten chapters", () => {
  const generated = fs.readFileSync(
    new URL("../case-study/web/content.generated.js", import.meta.url),
    "utf8"
  );
  assert.match(generated, /"zh"/);
  assert.match(generated, /"en"/);
  for (const id of [
    "overview", "unmet", "reframe", "evolution", "principles",
    "loop", "mvp", "system", "experience", "validation"
  ]) {
    assert.match(generated, new RegExp(`"id"\\s*:\\s*"${id}"`));
  }
});

test("web assets are file-protocol portable and contain no external dependencies", () => {
  const paths = [
    "../case-study/web/index.html",
    "../case-study/web/styles.css",
    "../case-study/web/case-study.js",
    "../case-study/web/content.generated.js"
  ];
  const combined = paths
    .map((relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"))
    .join("\n");
  assert.doesNotMatch(combined, /(?:src|href)\s*=\s*["']https?:|@import\s+url|fetch\s*\(/i);
  assert.doesNotMatch(combined, /analytics|googletagmanager|segment\.com/i);
});

test("checked-in generated content exactly matches both Markdown sources", () => {
  const expected = `globalThis.caseStudyContent = ${JSON.stringify(buildAllContent(), null, 2)};\n`;
  const generated = fs.readFileSync(
    new URL("../case-study/web/content.generated.js", import.meta.url),
    "utf8"
  );
  assert.equal(generated.replace(/\r\n/g, "\n"), expected);
  for (const language of Object.values(buildAllContent())) {
    assert.equal(language.sections.length, 10);
    assert.ok(language.sections.every((section) => /^<h2>/.test(section.html)));
  }
});

test("responsive shell contains every evidence asset and local overflow boundaries", () => {
  const source = fs.readFileSync(
    new URL("../case-study/web/case-study.js", import.meta.url),
    "utf8"
  );
  const css = fs.readFileSync(
    new URL("../case-study/web/styles.css", import.meta.url),
    "utf8"
  );
  for (const name of [
    "category-boundary.svg",
    "product-loop.svg",
    "memory-system.svg",
    "validation-layers.svg"
  ]) {
    assert.ok(source.includes(name), `missing diagram route ${name}`);
    assert.ok(fs.existsSync(new URL(`../case-study/assets/diagrams/${name}`, import.meta.url)));
  }
  for (const name of ["now", "learn", "actions", "memory", "management", "achievements"]) {
    assert.match(source, new RegExp(`(?:^|[", ])${name}(?:[", ]|$)`));
    assert.ok(fs.existsSync(new URL(`../case-study/assets/screenshots/${name}.png`, import.meta.url)));
  }
  assert.match(css, /@media\s*\(max-width:\s*860px\)/);
  assert.match(css, /\.screen-gallery\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.chapter-rail\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
});

test("mobile header and Chinese title fit without clipping controls or glyphs", () => {
  const css = fs.readFileSync(
    new URL("../case-study/web/styles.css", import.meta.url),
    "utf8"
  );
  assert.match(css, /\.site-header\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.wordmark\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.language-switch\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.match(
    css,
    /@media\s*\(max-width:\s*860px\)[\s\S]*?h1,[\s\S]*?\{[^}]*font-size:\s*clamp\(38px,\s*10\.5vw,\s*48px\)[^}]*overflow-wrap:\s*anywhere[^}]*text-wrap:\s*wrap/s
  );
  assert.doesNotMatch(css, /(?:html|body)\s*\{[^}]*overflow-x:\s*(?:hidden|clip)/s);
});

test("case study root provides a static-hosting entry point", () => {
  const html = fs.readFileSync(
    new URL("../case-study/index.html", import.meta.url),
    "utf8"
  );
  assert.match(html, /url=web\/index\.html/i);
  assert.match(html, /href="web\/index\.html"/i);
  assert.doesNotMatch(html, /https?:\/\//i);
});
