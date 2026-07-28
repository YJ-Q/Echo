import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllContent } from "./build-web.mjs";
import { escapeHtml } from "./lib/markdown-renderer.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../..");
const pdfDir = path.join(root, "case-study/pdf");
const totalPages = 18;
const caseStudyContent = buildAllContent();

const TITLES = {
  zh: [
    "Margin：为尚未整理好的自己，留一个位置",
    "项目概览", "核心命题", "未被满足的时刻", "不是另一个聊天机器人",
    "从 Echo 到 Margin", "五条产品原则", "核心产品闭环",
    "四个功能，一个关系闭环", "MVP 纳入什么", "明确不做什么",
    "AI 与状态聚合", "选择性记忆系统", "体验语言", "当前产品界面",
    "场景验证与自动化测试", "三层验证边界", "局限与下一步实验"
  ],
  en: [
    "Margin: A Place for the Self Still in Progress",
    "Project Overview", "Core Thesis", "The Unmet Moment", "Not Another Chatbot",
    "From Echo to Margin", "Five Product Principles", "The Core Product Loop",
    "Four Capabilities, One Relationship Loop", "What the MVP Includes", "Explicit Non-goals",
    "AI and State Aggregation", "The Selective Memory System", "Experience Language",
    "The Current Product", "Scenario Validation and Automated Tests",
    "Three Validation Layers", "Limitations and Next Experiments"
  ]
};

function sectionMap(lang) {
  return Object.fromEntries(
    caseStudyContent[lang].sections.map((section) => [section.id, section])
  );
}

function paragraphs(section, count = 2) {
  const matches = [...section.html.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .slice(0, count)
    .map((match) => `<p>${match[1]}</p>`);
  if (!matches.length) {
    return section.html.replace(/<h2>[\s\S]*?<\/h2>/, "");
  }
  return matches.join("");
}

function bullets(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function pageDefinitions(lang) {
  const meta = caseStudyContent[lang].meta;
  const s = sectionMap(lang);
  const zh = lang === "zh";
  const title = TITLES[lang];
  return [
    {
      kind: "cover",
      title: title[0],
      bodyHtml: `<p>${escapeHtml(meta.subtitle)}</p><p>${escapeHtml(meta.role)} · ${escapeHtml(meta.year)}</p>`
    },
    { kind: "evidence", title: title[1], bodyHtml: paragraphs(s.overview, 3) },
    {
      kind: "statement",
      title: title[2],
      bodyHtml: `<blockquote>${zh ? "用户不需要先整理好自己，才值得被理解。" : "People should not have to arrive organized in order to be understood."}</blockquote>`
    },
    { kind: "evidence", title: title[3], bodyHtml: paragraphs(s.unmet, 3) },
    {
      kind: "diagram",
      title: title[4],
      bodyHtml: paragraphs(s.reframe, 1),
      asset: "../assets/diagrams/category-boundary.svg"
    },
    { kind: "evidence", title: title[5], bodyHtml: paragraphs(s.evolution, 3) },
    { kind: "evidence", title: title[6], bodyHtml: paragraphs(s.principles, 4) },
    {
      kind: "diagram",
      title: title[7],
      bodyHtml: paragraphs(s.loop, 1),
      asset: "../assets/diagrams/product-loop.svg"
    },
    {
      kind: "statement",
      title: title[8],
      bodyHtml: bullets(zh
        ? ["Talk：先接住", "Continue：保留活线", "Remember：选择性保留", "Reflect：让痕迹可见"]
        : ["Talk: receive first", "Continue: preserve the live line", "Remember: retain selectively", "Reflect: make traces visible"])
    },
    { kind: "evidence", title: title[9], bodyHtml: paragraphs(s.mvp, 2) },
    {
      kind: "statement",
      title: title[10],
      bodyHtml: bullets(zh
        ? ["不做重型规划", "不做任务压力升级", "不做诊断", "不做语音人格", "不把成长变成分数"]
        : ["No heavy planning", "No escalating task pressure", "No diagnosis", "No voice persona", "No score-based growth"])
    },
    { kind: "evidence", title: title[11], bodyHtml: paragraphs(s.system, 2) },
    {
      kind: "diagram",
      title: title[12],
      bodyHtml: paragraphs(s.system, 1),
      asset: "../assets/diagrams/memory-system.svg"
    },
    { kind: "evidence", title: title[13], bodyHtml: paragraphs(s.experience, 3) },
    {
      kind: "screens",
      title: title[14],
      bodyHtml: `<p>${zh ? "所有界面来自临时空白数据库，不包含真实个人数据。" : "All screens use an isolated empty database and contain no personal data."}</p>`,
      assets: [
        "../assets/screenshots/now.png",
        "../assets/screenshots/learn.png",
        "../assets/screenshots/memory.png"
      ]
    },
    { kind: "evidence", title: title[15], bodyHtml: paragraphs(s.validation, 3) },
    {
      kind: "diagram",
      title: title[16],
      bodyHtml: `<p>${zh ? "实现、场景验证与用户价值不是同一件事。" : "Implementation, scenario validation, and user value are not the same thing."}</p>`,
      asset: "../assets/diagrams/validation-layers.svg"
    },
    {
      kind: "closing",
      title: title[17],
      bodyHtml: `${paragraphs(s.validation, 3)}<blockquote>${zh ? "先留一个位置，再从痕迹继续。" : "Leave a place first. Continue from the trace."}</blockquote>`
    }
  ].map((page, index) => ({ ...page, number: index + 1 }));
}

function verifyAsset(relativeAsset) {
  const absolute = path.resolve(pdfDir, relativeAsset);
  if (!absolute.startsWith(path.resolve(root, "case-study") + path.sep)) {
    throw new Error(`Unsafe PDF asset path: ${relativeAsset}`);
  }
  if (!fs.existsSync(absolute)) throw new Error(`Missing PDF asset: ${relativeAsset}`);
}

function assetMarkup(page) {
  const assets = page.assets || (page.asset ? [page.asset] : []);
  for (const asset of assets) verifyAsset(asset);
  if (!assets.length) return "";
  return `<div class="page-assets page-assets--${page.kind}">${assets.map((asset) =>
    `<img src="${asset}" alt="">`
  ).join("")}</div>`;
}

function renderPage(page) {
  if (!page.title.trim() || !page.bodyHtml.trim()) {
    throw new Error(`Page ${page.number} is missing title or body`);
  }
  return `
    <section class="pdf-page pdf-page--${page.kind}">
      <p class="page-kicker">MARGIN / AI PRODUCT CASE STUDY</p>
      <h1>${escapeHtml(page.title)}</h1>
      <div class="page-body">${page.bodyHtml}</div>
      ${assetMarkup(page)}
      <span class="page-number">${String(page.number).padStart(2, "0")} / ${totalPages}</span>
    </section>
  `;
}

function renderDocument(lang) {
  const pages = pageDefinitions(lang);
  if (pages.length !== totalPages) {
    throw new Error(`${lang} PDF requires ${totalPages} pages`);
  }
  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(caseStudyContent[lang].meta.title)}</title>
  <link rel="stylesheet" href="./pdf.css">
</head>
<body>${pages.map(renderPage).join("")}</body>
</html>`.replace(/[ \t]+$/gm, "");
}

fs.mkdirSync(pdfDir, { recursive: true });
for (const lang of ["zh", "en"]) {
  const output = path.join(pdfDir, `margin-case-study.${lang}.html`);
  fs.writeFileSync(output, renderDocument(lang), "utf8");
  console.log(`Built ${path.relative(root, output)}`);
}
