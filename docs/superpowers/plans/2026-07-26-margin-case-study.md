# Margin AI 产品 Case Study Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于当前 Echo/Margin 仓库的真实证据，制作面向 AI 产品经理岗位的中英双语长篇网页、独立中文版 PDF 和独立英文版 PDF。

**Architecture:** 以 Markdown 内容和证据映射作为事实源，通过无依赖的 Node 构建脚本生成双语静态网页和两套独立 PDF HTML；使用当前已有的 Electron 进行无真实数据产品截图与 PDF 导出。内容合同、双语章节一致性、证据引用、隐私扫描、网页结构和 PDF 文件均使用 `node:test` 自动检查，最终再执行浏览器与 PDF 渲染审校。

**Tech Stack:** Node.js 22、ES modules、`node:test`、静态 HTML/CSS/JavaScript、Electron 43、SVG、Poppler（仅用于最终 PDF 渲染检查）

**Scope Decision:** 网页与 PDF 不拆成独立计划，因为二者共享同一证据合同、双语内容、截图和论证图；拆开会造成事实源和验证数字漂移。Task 1–5 先形成可独立验收的内容与资产层，Task 6 和 Task 7 再分别生成可独立打开的网页与 PDF。

## Global Constraints

- 当前工作区已有未提交改动；每个任务只能暂存该任务明确列出的文件，禁止使用 `git add .`。
- 不修改 Margin 现有前端和后端产品行为；Case Study 代码全部位于 `case-study/`、`scripts/case-study/` 和对应测试文件。
- 不修改当前已有未提交改动的 `package.json`；所有命令直接调用 `node` 或 `node_modules\.bin\electron.cmd`。
- 中文内容是事实与写作母版，英文版是面向国际 AI 产品岗位的重写，不做逐句机械翻译。
- 网页使用完整中文/英文模式切换，不并排堆叠双语正文。
- PDF 必须使用独立排版 HTML，禁止直接打印长篇网页。
- 所有结论必须属于 `Implemented`、`Scenario-validated` 或 `Hypothesis` 三类之一。
- 不虚构用户访谈、人物画像、用户原话、使用量、留存率、转化率、满意度或产品市场匹配。
- 产品截图必须来自空白临时数据库，禁止读取或展示 `data/echo.sqlite` 中的真实内容。
- 网页和 PDF 不添加访问分析、埋点或外部数据收集。
- 不公开部署；部署需要用户另行明确授权。
- 视觉方向固定为“编辑出版感 + 产品证据”：温暖纸张、墨色文字、赤陶页边线、衬线标题、无衬线证据标签、严格系统图。
- 桌面端与移动端均需保持清晰阅读层级；PDF 每页只证明一个主要判断。
- 执行实现任务前使用 `test-driven-development`；制作网页视觉时遵循 `huashu-design`；制作和审校 PDF 时使用 `pdf` skill 的渲染验证流程。
- 当前测试基线（2026-07-26）为 `108/108` 通过；最终结果只能引用执行时重新运行得到的实际数字。

---

## 实施文件结构

```text
case-study/
├── content/
│   ├── evidence-map.md              # 结论、分类、来源和使用章节的事实映射
│   ├── glossary.md                  # 中英文产品术语
│   ├── case-study.zh.md             # 中文内容母版
│   └── case-study.en.md             # 英文适配稿
├── assets/
│   ├── diagrams/
│   │   ├── category-boundary.svg
│   │   ├── product-loop.svg
│   │   ├── memory-system.svg
│   │   └── validation-layers.svg
│   └── screenshots/
│       ├── now.png
│       ├── learn.png
│       ├── actions.png
│       ├── memory.png
│       ├── management.png
│       └── achievements.png
├── web/
│   ├── index.html                   # 网页壳与可访问性结构
│   ├── styles.css                   # Editorial Evidence 视觉系统
│   ├── case-study.js                # 语言切换、目录和渲染
│   └── content.generated.js         # 由 Markdown 构建，不手工编辑
├── pdf/
│   ├── pdf.css
│   ├── margin-case-study.zh.html    # 由构建脚本生成
│   └── margin-case-study.en.html    # 由构建脚本生成
├── dist/
│   ├── margin-case-study.zh.pdf
│   ├── margin-case-study.en.pdf
│   └── qa/                          # PDF 页渲染检查图，不纳入 Git
└── REVIEW.md

scripts/case-study/
├── lib/
│   ├── content-contract.mjs
│   └── markdown-renderer.mjs
├── build-web.mjs
├── build-pdf-html.mjs
├── capture-product.mjs
├── render-pdf.mjs
└── check-privacy.mjs

test/
├── caseStudyContentContract.test.js
├── caseStudyAssets.test.js
├── caseStudyWeb.test.js
├── caseStudyPdf.test.js
└── caseStudyPrivacy.test.js
```

生成文件规则：

- `case-study/web/content.generated.js`、两份 PDF HTML 和两份 PDF 需要提交，便于作品集直接打开和审阅。
- `case-study/dist/qa/` 与 `case-study/.tmp/` 只用于本地验证，不提交；在 Task 4 创建 `case-study/.gitignore` 精确忽略这两个目录。
- 不把 Case Study 合并进现有 `public/`，避免改变当前产品。

---

### Task 1: 建立证据合同、术语表和自动校验器

**Files:**
- Create: `case-study/content/evidence-map.md`
- Create: `case-study/content/glossary.md`
- Create: `scripts/case-study/lib/content-contract.mjs`
- Create: `test/caseStudyContentContract.test.js`

**Interfaces:**
- Produces: `parseEvidenceMap(markdown: string): EvidenceRow[]`
- Produces: `parseCaseStudy(markdown: string): { sectionIds: string[], evidenceIds: string[] }`
- Produces: `validateEvidenceRefs(documentText: string, evidenceRows: EvidenceRow[]): string[]`
- Produces: `validateSectionParity(zhText: string, enText: string): string[]`
- `EvidenceRow` shape: `{ id: string, claim: string, classification: "Implemented" | "Scenario-validated" | "Hypothesis", sources: string[], sections: string[] }`

- [ ] **Step 1: 先写失败的证据合同测试**

Create `test/caseStudyContentContract.test.js`:

```js
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
```

- [ ] **Step 2: 运行测试并确认因文件或导出不存在而失败**

Run:

```powershell
node --test test/caseStudyContentContract.test.js
```

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 或缺少 `evidence-map.md`。

- [ ] **Step 3: 实现内容合同解析器**

Create `scripts/case-study/lib/content-contract.mjs`:

```js
const CLASSIFICATIONS = new Set([
  "Implemented",
  "Scenario-validated",
  "Hypothesis"
]);

export function parseEvidenceMap(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|\s*[EH]\d{3}\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const [id, claim, classification, sourceCell, sectionCell] = cells;
      if (!CLASSIFICATIONS.has(classification)) {
        throw new Error(`Invalid classification for ${id}: ${classification}`);
      }
      return {
        id,
        claim,
        classification,
        sources: sourceCell.split("<br>").map((value) => value.trim()).filter(Boolean),
        sections: sectionCell.split(",").map((value) => value.trim()).filter(Boolean)
      };
    });
}

export function parseCaseStudy(markdown) {
  const sectionIds = [...markdown.matchAll(/<!--\s*section:([a-z0-9-]+)\s*-->/g)]
    .map((match) => match[1]);
  const evidenceIds = [...markdown.matchAll(/<!--\s*evidence:([EH]\d{3}(?:\s*,\s*[EH]\d{3})*)\s*-->/g)]
    .flatMap((match) => match[1].split(",").map((value) => value.trim()));
  return { sectionIds, evidenceIds };
}

export function validateEvidenceRefs(documentText, evidenceRows) {
  const known = new Set(evidenceRows.map((row) => row.id));
  return [...new Set(parseCaseStudy(documentText).evidenceIds)]
    .filter((id) => !known.has(id))
    .map((id) => `Unknown evidence id: ${id}`);
}

export function validateSectionParity(zhText, enText) {
  const zh = parseCaseStudy(zhText).sectionIds;
  const en = parseCaseStudy(enText).sectionIds;
  return JSON.stringify(zh) === JSON.stringify(en)
    ? []
    : [`Section mismatch: zh=${zh.join(",")} en=${en.join(",")}`];
}
```

- [ ] **Step 4: 写入真实证据映射**

Create `case-study/content/evidence-map.md` with this exact schema and source set:

```markdown
# Margin Case Study 证据映射

| ID | 结论 | 分类 | 来源 | 使用章节 |
|---|---|---|---|---|
| E001 | Margin 的核心定位是第二自我式陪伴空间，而非效率工具 | Implemented | docs/PRODUCT_POSITIONING_V2.md | overview,reframe,principles |
| E002 | 纸、墨、页边、痕迹和继续构成当前设计语言 | Implemented | docs/MARGIN_DESIGN_LANGUAGE.md | evolution,experience |
| E003 | 当前 MVP 提供聊天、状态、行动、学习、记忆、总结和 TTS 路由 | Implemented | README.md<br>docs/API_CONTRACT.md | overview,mvp,system |
| E004 | 当前后端已实现 SQLite 记忆、状态聚合、学习连续性和备份导入导出 | Implemented | CHANGELOG.md<br>docs/BACKEND_STATUS.md | overview,mvp,system |
| E005 | 产品通过 current_action、current_learning、current_reflection 和 current_memory 聚合当前状态 | Implemented | docs/API_CONTRACT.md<br>src/services/echoStateEngine.js | loop,system |
| E006 | 记忆系统区分上下文、记忆笔记、洞察、画像、校准与优先级 | Implemented | docs/MEMORY_LAYERS.md<br>src/services/contextBuilder.js | loop,system |
| E007 | 对话节奏要求先接住用户，再决定是否推进 | Implemented | docs/DIALOGUE_RHYTHM.md<br>docs/VOICE_AND_GUARDRAILS.md | principles,experience |
| E008 | Now 页把当前状态、活线和下一步放在同一到场体验中 | Implemented | docs/NOW_PAGE_INFORMATION_ARCHITECTURE.md<br>public/index.html | loop,experience |
| E009 | 当前界面包含 Now、Learn、Actions、Memory、Management 和 Achievements 视图 | Implemented | public/index.html<br>public/app.js | experience |
| E010 | 功能验收覆盖初次进入、聊天、学习、行动、总结、记忆和 TTS 不可用状态 | Scenario-validated | docs/FUNCTIONAL_ACCEPTANCE.md | validation |
| E011 | 现有自动化测试在 2026-07-26 本地运行结果为 108/108 通过 | Scenario-validated | test/*.test.js<br>command:npm test | overview,validation |
| E012 | 学习相关性和主题提取曾出现误判，并被记录为真实发现 | Scenario-validated | docs/FUNCTIONAL_ACCEPTANCE.md | validation |
| E013 | Action 建议具有去重和状态优先级规则 | Scenario-validated | test/api.test.js<br>test/actionSelectionEngine.test.js | system,validation |
| E014 | 记忆召回同时考虑主题连续性和核心锚点 | Scenario-validated | test/api.test.js<br>src/services/contextBuilder.js | system,validation |
| E015 | 反思输出避免把一天简化为计数和个人失败 | Scenario-validated | test/reflectionEngine.test.js<br>src/services/reflectionEngine.js | principles,system |
| E016 | Echo 到 Margin 代表从功能集合向关系定位收紧 | Implemented | README.md<br>docs/PRODUCT_POSITIONING_V2.md<br>git log | evolution |
| E017 | 用户最需要支持时往往无法先提出清晰问题 | Hypothesis | founder-observation | unmet,reframe |
| E018 | 保留活线能降低重复开始的负担 | Hypothesis | founder-observation | unmet,loop,validation |
| H001 | 目标用户会把 Margin 理解为陪伴空间而不是任务管理器 | Hypothesis | future-user-research | reframe,validation |
| H002 | 选择性记忆会提升跨会话连续性感受 | Hypothesis | future-user-research | system,validation |
| H003 | 低压力继续比强任务推动更适合目标场景 | Hypothesis | future-user-research | principles,validation |
```

在实现时运行 `npm test`，如果通过数量不再是 108，必须同步更新 E011；不得为匹配计划而保留旧数字。

- [ ] **Step 5: 写入中英文术语表**

Create `case-study/content/glossary.md`:

```markdown
# Margin 中英文术语表

| 中文 | 英文 | 使用说明 |
|---|---|---|
| 第二自我 | second self | 表达持续理解关系，不写 digital twin |
| 到场 | arrival | 指用户无需整理即可进入，不写 onboarding |
| 当前仍然鲜活的线 | live line | 首次出现时解释为 what still matters now |
| 痕迹 | trace | 指被选择性保留、可继续的内容 |
| 选择性记忆 | selective memory | 强调相关性而非存储数量 |
| 继续 | continuation | 表达从上次痕迹接续，不等同 task completion |
| 接住 | receive / hold | 依语境选择，避免机械使用 catch |
| 页边批注 | margin note | 表达轻量建议，不写 instruction |
| 反思 | reflection | 避免 diagnostic analysis |
| 已实现 | implemented | 代码或可执行流程直接支持 |
| 已通过场景验证 | scenario-validated | 测试或功能场景支持，不代表真实用户价值 |
| 假设 | hypothesis | 仍需外部用户或市场验证 |
```

- [ ] **Step 6: 创建暂时满足章节合同的双语最小文件**

Create both `case-study/content/case-study.zh.md` and `case-study/content/case-study.en.md` with the same ten section markers so Task 1 can pass before Task 2 expands the copy:

```markdown
<!-- section:overview -->
## 01. 项目概览
<!-- evidence:E001 -->
```

Repeat using these exact IDs in this exact order:

```text
overview
unmet
reframe
evolution
principles
loop
mvp
system
experience
validation
```

The English file uses English headings but the same markers.

- [ ] **Step 7: 运行证据合同测试**

Run:

```powershell
node --test test/caseStudyContentContract.test.js
```

Expected: `4` tests pass, `0` fail.

- [ ] **Step 8: 提交 Task 1**

```powershell
git add case-study/content/evidence-map.md case-study/content/glossary.md case-study/content/case-study.zh.md case-study/content/case-study.en.md scripts/case-study/lib/content-contract.mjs test/caseStudyContentContract.test.js
git commit -m "docs: establish Margin case study evidence contract"
```

---

### Task 2: 写作中文内容母版

**Files:**
- Modify: `case-study/content/case-study.zh.md`
- Modify: `test/caseStudyContentContract.test.js`

**Interfaces:**
- Consumes: Task 1 的章节 ID 与证据 ID
- Produces: 10 章中文母版；每章至少一个 `<!-- evidence:... -->` 引用
- Content length target: 7,000–11,000 个中文字符，不包含 Markdown 标记

- [ ] **Step 1: 先补充失败的中文内容完整性测试**

Append to `test/caseStudyContentContract.test.js`:

```js
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
```

- [ ] **Step 2: 运行测试并确认内容长度和关键表达失败**

Run:

```powershell
node --test test/caseStudyContentContract.test.js
```

Expected: FAIL at `Chinese master contains all ten chapters...` because the Task 1 file is only a skeleton.

- [ ] **Step 3: 按固定论证写完整中文母版**

Rewrite `case-study/content/case-study.zh.md` with this exact front matter:

```markdown
---
title: Margin：为尚未整理好的自己，留一个位置
subtitle: 一个从模糊的人类处境出发，被落实为 AI 行为、产品边界与可运行闭环的独立产品案例
role: 独立 AI 产品经理 / 产品设计与实现
stage: 可运行 MVP；技术与场景验证完成；真实用户验证待进行
year: 2026
---
```

Use the ten approved sections. Each section must prove these exact points and cite only the listed evidence:

1. `overview`
   - 独立从 0 到 1 完成定位、体验、系统和验证
   - 当前是 MVP，不是已验证商业产品
   - cite `E001,E003,E004,E011`
2. `unmet`
   - 开场使用原句“用户不需要先整理好自己，才值得被理解”
   - 把无法清晰表达、重复开始和连续性丢失标为创作者观察
   - cite `E017,E018`
3. `reframe`
   - 对比通用聊天、任务管理、治疗替代和语音助手四个边界
   - 明确第二自我不是数字孪生，也不是人格模仿
   - cite `E001,H001`
4. `evolution`
   - 把 Echo → Margin 写成问题定义收紧
   - 不虚构不存在的用户反馈或时间线
   - cite `E002,E016`
5. `principles`
   - 逐条写五项产品原则
   - 每项包含用户矛盾、产品行为和一个范围/体验后果
   - cite `E001,E002,E007,E015,H003`
6. `loop`
   - 展开“到场 → 保留活线 → 选择性记忆 → 轻量继续 → 留下痕迹”
   - 把 Talk、Continue、Reflect、Remember 放入闭环
   - cite `E005,E006,E008,E018`
7. `mvp`
   - 解释纳入聊天、状态、行动、学习、记忆、反思和可选 TTS 的理由
   - 解释不做重型规划、游戏化、诊断和语音优先
   - cite `E003,E004,E007`
8. `system`
   - 用产品语言解释状态聚合、记忆分层、召回、行动去重、反思和失败回退
   - 避免罗列数据库表
   - cite `E005,E006,E013,E014,E015`
9. `experience`
   - 解释纸、墨、页边、文字主角和低压力 CTA
   - 只描述当前真实存在的视图
   - cite `E002,E008,E009`
10. `validation`
    - 明确写出当前 `108/108` 自动化测试
    - 呈现场景验收以及学习相关性、主题提取误判
    - 使用三层总结：Implemented / Scenario-validated / Hypothesis
    - 给出下一阶段 5–8 位目标用户的定性研究、首次到场任务、7 天连续性日记研究三个实验；这些是计划，不是假装已完成
    - cite `E010,E011,E012,H001,H002,H003`

Writing rules:

- 每段先给判断，再给证据或取舍。
- 不使用“行业领先”“革命性”“显著提升”等无法证明的词。
- 不把 `108/108` 测试解释为用户价值。
- 章节标题下第一屏必须可扫描出结论。
- 技术实现最多占正文 5%。

- [ ] **Step 4: 运行中文内容合同测试**

Run:

```powershell
node --test test/caseStudyContentContract.test.js
```

Expected: all tests pass.

- [ ] **Step 5: 人工做一次中文编辑审校**

Read the complete file and record no inline notes until all answers are “是”:

- 每一章是否只证明一个主要能力？
- 是否区分创作者观察与用户研究结论？
- 是否解释为什么做与为什么不做？
- 是否存在重复描述同一功能？
- 是否把技术细节放在产品判断之后？
- 是否有任何一句话暗示已经有真实外部用户？

Fix all violations in `case-study/content/case-study.zh.md`.

- [ ] **Step 6: 提交 Task 2**

```powershell
git add case-study/content/case-study.zh.md test/caseStudyContentContract.test.js
git commit -m "docs: write Chinese Margin case study narrative"
```

---

### Task 3: 完成英文适配稿与章节一致性校验

**Files:**
- Modify: `case-study/content/case-study.en.md`
- Modify: `case-study/content/glossary.md`
- Modify: `test/caseStudyContentContract.test.js`

**Interfaces:**
- Consumes: 中文母版的 10 个章节、证据引用和术语表
- Produces: 相同章节 ID、相同证据边界的英文适配稿
- English length target: 4,000–7,000 English words

- [ ] **Step 1: 先写失败的英文适配测试**

Append:

```js
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
```

- [ ] **Step 2: 运行测试并确认英文骨架失败**

Run:

```powershell
node --test test/caseStudyContentContract.test.js
```

Expected: FAIL because the English file is shorter than 4,000 words.

- [ ] **Step 3: 按英文招聘阅读习惯重写完整内容**

Rewrite `case-study/content/case-study.en.md` using the same section markers and evidence references as Chinese.

Use this exact front matter:

```markdown
---
title: "Margin: A Place for the Self Still in Progress"
subtitle: "An independent AI product case study that turns an ambiguous human need into product behavior, boundaries, and a working system loop"
role: "Independent AI Product Manager / Product Design and Implementation"
stage: "Functional MVP; technical and scenario validation complete; external user validation pending"
year: 2026
---
```

Adaptation requirements:

- Translate “接住” by meaning: use `receive` for arrival, `hold` for continuity, and avoid `catch`.
- Explain `live line` once as “what still matters and remains active for the user.”
- Use `second self`, never `digital twin`.
- Use shorter English paragraphs than the Chinese edition.
- Preserve the difference between companionship and management.
- Preserve every `Implemented`, `Scenario-validated`, and `Hypothesis` boundary.
- Keep evidence markers unchanged so both editions remain auditable.

- [ ] **Step 4: 更新术语表中的上下文例句**

Add one approved Chinese and English example sentence for each of these terms in `glossary.md`:

```text
second self
arrival
live line
trace
selective memory
continuation
margin note
scenario-validated
```

- [ ] **Step 5: 运行全部内容合同测试**

Run:

```powershell
node --test test/caseStudyContentContract.test.js
```

Expected: all tests pass.

- [ ] **Step 6: 提交 Task 3**

```powershell
git add case-study/content/case-study.en.md case-study/content/glossary.md test/caseStudyContentContract.test.js
git commit -m "docs: add English Margin case study adaptation"
```

---

### Task 4: 生成无真实数据的产品截图

**Files:**
- Create: `case-study/.gitignore`
- Create: `scripts/case-study/capture-product.mjs`
- Create: `test/caseStudyAssets.test.js`
- Generate: `case-study/assets/screenshots/now.png`
- Generate: `case-study/assets/screenshots/learn.png`
- Generate: `case-study/assets/screenshots/actions.png`
- Generate: `case-study/assets/screenshots/memory.png`
- Generate: `case-study/assets/screenshots/management.png`
- Generate: `case-study/assets/screenshots/achievements.png`

**Interfaces:**
- Produces six 1440×1000 PNG files from the current `public/` product
- Uses temporary DB only at `case-study/.tmp/echo-case-study.sqlite`
- Does not read `data/echo.sqlite`

- [ ] **Step 1: 先写失败的截图资产测试**

Create `test/caseStudyAssets.test.js`:

```js
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
```

- [ ] **Step 2: 运行测试并确认截图不存在**

Run:

```powershell
node --test test/caseStudyAssets.test.js
```

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: 精确忽略临时数据与 QA 输出**

Create `case-study/.gitignore`:

```gitignore
.tmp/
dist/qa/
```

- [ ] **Step 4: 实现安全截图脚本**

Create `scripts/case-study/capture-product.mjs`:

```js
import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../..");
const outputDir = path.join(root, "case-study/assets/screenshots");
const tempDir = path.join(root, "case-study/.tmp");
const tempDb = path.join(tempDir, "echo-case-study.sqlite");
const serverEntry = path.join(root, "src/server.js");
const port = 3197;
const appUrl = `http://127.0.0.1:${port}`;
const views = ["now", "learn", "actions", "memory", "management", "achievements"];

function assertSafeTempPath(target) {
  const expectedRoot = path.resolve(root, "case-study/.tmp") + path.sep;
  const resolved = path.resolve(target);
  if (!resolved.startsWith(expectedRoot)) {
    throw new Error(`Refusing to remove unsafe path: ${resolved}`);
  }
}

async function waitForServer(attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}/health`);
      if (response.ok) return;
    } catch {
      // Wait for the isolated backend.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Isolated screenshot backend did not become ready.");
}

async function capture() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  assertSafeTempPath(tempDb);
  await fs.rm(tempDb, { force: true });
  await fs.rm(`${tempDb}-shm`, { force: true });
  await fs.rm(`${tempDb}-wal`, { force: true });

  const backend = spawn(process.env.CASE_STUDY_NODE || "node", [serverEntry], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      ECHO_LLM_PROVIDER: "local",
      ECHO_DB_PATH: tempDb
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  backend.stdout.on("data", (chunk) => process.stdout.write(chunk));
  backend.stderr.on("data", (chunk) => process.stderr.write(chunk));

  try {
    await waitForServer();
    const window = new BrowserWindow({
      width: 1440,
      height: 1000,
      useContentSize: true,
      frame: false,
      show: false,
      backgroundColor: "#f5f2ea",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    await window.loadURL(appUrl);
    await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const done = () => {
          document.querySelector("#launch-screen")?.remove();
          resolve();
        };
        document.readyState === "complete"
          ? setTimeout(done, 1200)
          : window.addEventListener("load", () => setTimeout(done, 1200), { once: true });
      })
    `);
    await window.webContents.insertCSS(`
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `);

    for (const view of views) {
      await window.webContents.executeJavaScript(`
        document.querySelector('[data-view="${view}"]')?.click();
        new Promise((resolve) => setTimeout(resolve, 350));
      `);
      const image = await window.webContents.capturePage();
      await fs.writeFile(path.join(outputDir, `${view}.png`), image.toPNG());
    }
    window.destroy();
  } finally {
    backend.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

app.whenReady()
  .then(capture)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
```

- [ ] **Step 5: 运行 Electron 截图**

Run:

```powershell
node_modules\.bin\electron.cmd scripts\case-study\capture-product.mjs
```

Expected:

- exit code `0`
- six PNG files appear under `case-study/assets/screenshots/`
- `data/echo.sqlite` modification time remains unchanged

- [ ] **Step 6: 运行截图资产测试并人工检查**

Run:

```powershell
node --test test/caseStudyAssets.test.js
```

Expected: `1` test passes.

Open all six PNG files and verify:

- no personal conversation or memory appears
- navigation state matches the filename
- no loading overlay covers the UI
- text remains legible
- screenshots reflect the current product, not an invented redesign

- [ ] **Step 7: 提交 Task 4**

```powershell
git add case-study/.gitignore case-study/assets/screenshots scripts/case-study/capture-product.mjs test/caseStudyAssets.test.js
git commit -m "assets: capture sanitized Margin product views"
```

---

### Task 5: 制作四张产品论证图

**Files:**
- Create: `case-study/assets/diagrams/category-boundary.svg`
- Create: `case-study/assets/diagrams/product-loop.svg`
- Create: `case-study/assets/diagrams/memory-system.svg`
- Create: `case-study/assets/diagrams/validation-layers.svg`
- Modify: `test/caseStudyAssets.test.js`

**Interfaces:**
- Produces four self-contained SVG files
- Each SVG uses `viewBox="0 0 1600 900"`, contains `<title>` and `<desc>`, and has no external URL or font dependency

- [ ] **Step 1: 先写失败的 SVG 资产测试**

Append:

```js
const diagramNames = [
  "category-boundary.svg",
  "product-loop.svg",
  "memory-system.svg",
  "validation-layers.svg"
];

test("case study diagrams are accessible and self-contained", () => {
  for (const name of diagramNames) {
    const path = new URL(`../case-study/assets/diagrams/${name}`, import.meta.url);
    const svg = fs.readFileSync(path, "utf8");
    assert.match(svg, /viewBox="0 0 1600 900"/);
    assert.match(svg, /<title>[^<]+<\/title>/);
    assert.match(svg, /<desc>[^<]+<\/desc>/);
    assert.doesNotMatch(svg, /https?:\/\//);
    assert.doesNotMatch(svg, /<foreignObject/);
  }
});
```

- [ ] **Step 2: 运行测试并确认 SVG 不存在**

Run:

```powershell
node --test test/caseStudyAssets.test.js
```

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: 按固定信息结构制作 SVG**

Create `case-study/assets/diagrams/category-boundary.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" role="img">
  <title>Margin 的产品类别边界</title>
  <desc>Margin 位于四类常见 AI 产品之外，以陪伴连续性而不是回答、管理、诊断或语音人格为中心。</desc>
  <rect width="1600" height="900" fill="#F4EEDF"/>
  <g fill="none" stroke="#D6CABB" stroke-width="3">
    <line x1="800" y1="260" x2="800" y2="150"/>
    <line x1="1040" y1="450" x2="1290" y2="450"/>
    <line x1="800" y1="640" x2="800" y2="750"/>
    <line x1="560" y1="450" x2="310" y2="450"/>
  </g>
  <rect x="560" y="260" width="480" height="380" rx="4" fill="#FBF8F0" stroke="#A74735" stroke-width="4"/>
  <text x="800" y="400" text-anchor="middle" fill="#25211C" font-size="58" font-family="Georgia, Songti SC, serif">Margin</text>
  <text x="800" y="474" text-anchor="middle" fill="#A74735" font-size="32" font-family="Segoe UI, PingFang SC, sans-serif">第二自我式陪伴空间</text>
  <text x="800" y="540" text-anchor="middle" fill="#6E6257" font-size="25" font-family="Segoe UI, PingFang SC, sans-serif">保留仍然鲜活的线，再从痕迹继续</text>
  <g fill="#25211C" font-family="Segoe UI, PingFang SC, sans-serif" text-anchor="middle">
    <text x="800" y="94" font-size="31">通用聊天</text><text x="800" y="137" fill="#6E6257" font-size="23">回答 ≠ 保留连续性</text>
    <text x="1390" y="430" font-size="31">任务管理</text><text x="1390" y="473" fill="#6E6257" font-size="23">继续 ≠ 管理</text>
    <text x="800" y="815" font-size="31">治疗替代</text><text x="800" y="858" fill="#6E6257" font-size="23">反思 ≠ 诊断</text>
    <text x="210" y="430" font-size="31">语音助手</text><text x="210" y="473" fill="#6E6257" font-size="23">朗读 ≠ 语音人格</text>
  </g>
</svg>
```

Create `case-study/assets/diagrams/product-loop.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" role="img">
  <title>Margin 核心产品闭环</title>
  <desc>用户从无需整理的到场开始，经过活线、选择性记忆和轻量继续，最终留下可再次接续的痕迹。</desc>
  <rect width="1600" height="900" fill="#F4EEDF"/>
  <path d="M190 390H1410" fill="none" stroke="#A74735" stroke-width="5"/>
  <g font-family="Segoe UI, PingFang SC, sans-serif" text-anchor="middle">
    <g transform="translate(190 390)"><circle r="78" fill="#FBF8F0" stroke="#A74735" stroke-width="4"/><text y="10" fill="#25211C" font-size="31">到场</text><text y="125" fill="#6E6257" font-size="22">Talk</text></g>
    <g transform="translate(495 390)"><circle r="78" fill="#FBF8F0" stroke="#D6CABB" stroke-width="4"/><text y="10" fill="#25211C" font-size="31">保留活线</text><text y="125" fill="#6E6257" font-size="22">Continue</text></g>
    <g transform="translate(800 390)"><circle r="92" fill="#FBF8F0" stroke="#D6CABB" stroke-width="4"/><text y="-4" fill="#25211C" font-size="28">选择性</text><text y="33" fill="#25211C" font-size="28">记忆</text><text y="139" fill="#6E6257" font-size="22">Remember</text></g>
    <g transform="translate(1105 390)"><circle r="78" fill="#FBF8F0" stroke="#D6CABB" stroke-width="4"/><text y="10" fill="#25211C" font-size="31">轻量继续</text><text y="125" fill="#6E6257" font-size="22">Continue</text></g>
    <g transform="translate(1410 390)"><circle r="78" fill="#25211C"/><text y="10" fill="#F4EEDF" font-size="31">留下痕迹</text><text y="125" fill="#6E6257" font-size="22">Reflect</text></g>
  </g>
  <path d="M1410 600C1410 760 190 760 190 600" fill="none" stroke="#D6CABB" stroke-width="3"/>
  <text x="800" y="790" text-anchor="middle" fill="#6E6257" font-size="24" font-family="Segoe UI, PingFang SC, sans-serif">下一次到来，不必从零开始</text>
</svg>
```

Create `case-study/assets/diagrams/memory-system.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" role="img">
  <title>Margin 的状态聚合与选择性记忆系统</title>
  <desc>对话输入经过状态聚合并参考五层记忆，输出当前线索、一个下一步和解释性信息。</desc>
  <rect width="1600" height="900" fill="#F4EEDF"/>
  <g font-family="Segoe UI, PingFang SC, sans-serif">
    <rect x="90" y="350" width="240" height="170" rx="4" fill="#FBF8F0" stroke="#D6CABB" stroke-width="3"/>
    <text x="210" y="430" text-anchor="middle" fill="#25211C" font-size="34">对话输入</text>
    <text x="210" y="475" text-anchor="middle" fill="#6E6257" font-size="22">当下表达与语境</text>
    <path d="M330 435H455" stroke="#A74735" stroke-width="5"/>
    <rect x="455" y="300" width="300" height="270" rx="4" fill="#25211C"/>
    <text x="605" y="420" text-anchor="middle" fill="#F4EEDF" font-size="38">状态聚合</text>
    <text x="605" y="468" text-anchor="middle" fill="#D6CABB" font-size="22">什么仍然鲜活？</text>
    <g fill="#FBF8F0" stroke="#D6CABB" stroke-width="2">
      <rect x="815" y="120" width="310" height="100"/><rect x="815" y="240" width="310" height="100"/>
      <rect x="815" y="360" width="310" height="100"/><rect x="815" y="480" width="310" height="100"/>
      <rect x="815" y="600" width="310" height="100"/>
    </g>
    <g x="970" text-anchor="middle" fill="#25211C" font-size="27">
      <text x="970" y="180">近期上下文</text><text x="970" y="300">记忆笔记</text>
      <text x="970" y="420">洞察</text><text x="970" y="540">长期画像</text><text x="970" y="660">人工校准</text>
    </g>
    <path d="M755 435H815M1125 435H1235" stroke="#A74735" stroke-width="5"/>
    <g fill="#FBF8F0" stroke="#A74735" stroke-width="3">
      <rect x="1235" y="210" width="275" height="120" rx="4"/>
      <rect x="1235" y="390" width="275" height="120" rx="4"/>
      <rect x="1235" y="570" width="275" height="120" rx="4"/>
    </g>
    <g text-anchor="middle" fill="#25211C" font-size="29">
      <text x="1372" y="282">当前线索</text><text x="1372" y="462">一个下一步</text><text x="1372" y="642">解释性输出</text>
    </g>
  </g>
</svg>
```

Create `case-study/assets/diagrams/validation-layers.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" role="img">
  <title>Margin 的三层验证边界</title>
  <desc>已实现、已通过场景验证和仍待验证的假设被并列呈现，不构成自动递进的成功漏斗。</desc>
  <rect width="1600" height="900" fill="#F4EEDF"/>
  <g font-family="Segoe UI, PingFang SC, sans-serif">
    <rect x="110" y="190" width="420" height="520" rx="4" fill="#25211C"/>
    <text x="160" y="285" fill="#F4EEDF" font-size="35">Implemented</text>
    <text x="160" y="345" fill="#D6CABB" font-size="25">系统存在并可运行</text>
    <line x1="160" y1="395" x2="480" y2="395" stroke="#A74735" stroke-width="4"/>
    <text x="160" y="465" fill="#F4EEDF" font-size="23">代码 · API · 当前界面</text>
    <text x="160" y="515" fill="#F4EEDF" font-size="23">可执行工作流</text>
    <rect x="590" y="190" width="420" height="520" rx="4" fill="#FBF8F0" stroke="#A74735" stroke-width="4"/>
    <text x="640" y="285" fill="#25211C" font-size="35">Scenario-validated</text>
    <text x="640" y="345" fill="#6E6257" font-size="25">在设定场景中行为一致</text>
    <line x1="640" y1="395" x2="960" y2="395" stroke="#A74735" stroke-width="4"/>
    <text x="640" y="465" fill="#25211C" font-size="23">自动化测试 · 功能验收</text>
    <text x="640" y="515" fill="#25211C" font-size="23">不等于真实用户价值</text>
    <rect x="1070" y="190" width="420" height="520" rx="4" fill="#F4EEDF" stroke="#D6CABB" stroke-width="4"/>
    <text x="1120" y="285" fill="#25211C" font-size="35">Hypothesis</text>
    <text x="1120" y="345" fill="#6E6257" font-size="25">仍需外部用户与市场验证</text>
    <line x1="1120" y1="395" x2="1440" y2="395" stroke="#D6CABB" stroke-width="4"/>
    <text x="1120" y="465" fill="#25211C" font-size="23">问题强度 · 连续性感受</text>
    <text x="1120" y="515" fill="#25211C" font-size="23">目标人群 · 使用意愿</text>
  </g>
</svg>
```

Use square or 4px corners; do not add glossy gradients, icons, or decorative charts.

- [ ] **Step 4: 运行 SVG 测试并打开四张图检查**

Run:

```powershell
node --test test/caseStudyAssets.test.js
```

Expected: `2` tests pass.

Visual checks:

- Chinese labels do not clip
- reading order is obvious at 50% zoom
- diagrams remain evidence-first, not decorative
- validation layers do not imply that hypotheses have already been proven

- [ ] **Step 5: 提交 Task 5**

```powershell
git add case-study/assets/diagrams test/caseStudyAssets.test.js
git commit -m "design: add Margin product argument diagrams"
```

---

### Task 6: 构建双语长篇网页

**Files:**
- Create: `scripts/case-study/lib/markdown-renderer.mjs`
- Create: `scripts/case-study/build-web.mjs`
- Create: `case-study/web/index.html`
- Create: `case-study/web/styles.css`
- Create: `case-study/web/case-study.js`
- Generate: `case-study/web/content.generated.js`
- Create: `test/caseStudyWeb.test.js`

**Interfaces:**
- Produces: `renderMarkdown(markdown: string): string`
- Produces: `buildLanguageDocument(markdown: string): { meta: object, sections: object[] }`
- `content.generated.js` assigns `globalThis.caseStudyContent = { zh, en }` so the page works directly from `file://`
- Browser state uses only `document.documentElement.lang` and `data-active-language`

- [ ] **Step 1: 先写失败的 Markdown 渲染与网页结构测试**

Create `test/caseStudyWeb.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderMarkdown } from "../scripts/case-study/lib/markdown-renderer.mjs";

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
  assert.doesNotMatch(html, /https:\/\/.*analytics|googletagmanager|segment\.com/i);
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
```

- [ ] **Step 2: 运行测试并确认缺少网页构建文件**

Run:

```powershell
node --test test/caseStudyWeb.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 实现受控 Markdown 渲染器**

Create `scripts/case-study/lib/markdown-renderer.mjs` with:

```js
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function renderMarkdown(markdown) {
  const lines = markdown.trim().split(/\r?\n/);
  const blocks = [];
  let list = [];
  let paragraph = [];

  const flushList = () => {
    if (list.length) {
      blocks.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      list = [];
    }
  };
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  for (const line of lines) {
    if (!line.trim() || /^<!--/.test(line.trim()) || /^---$/.test(line.trim())) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^###\s+/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(`<h3>${renderInline(line.replace(/^###\s+/, ""))}</h3>`);
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(`<h2>${renderInline(line.replace(/^##\s+/, ""))}</h2>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    if (/^-\s+/.test(line)) {
      flushParagraph();
      list.push(line.replace(/^-\s+/, ""));
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks.join("\n");
}
```

- [ ] **Step 4: 实现网页内容构建脚本**

Create `scripts/case-study/build-web.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseEvidenceMap,
  parseCaseStudy,
  validateEvidenceRefs,
  validateSectionParity
} from "./lib/content-contract.mjs";
import { renderMarkdown } from "./lib/markdown-renderer.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../..");
const contentDir = path.join(root, "case-study/content");
const outputPath = path.join(root, "case-study/web/content.generated.js");
const requiredSections = [
  "overview", "unmet", "reframe", "evolution", "principles",
  "loop", "mvp", "system", "experience", "validation"
];

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error("Missing front matter");
  const meta = Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator < 1) throw new Error(`Invalid front matter line: ${line}`);
        return [
          line.slice(0, separator).trim(),
          stripQuotes(line.slice(separator + 1))
        ];
      })
  );
  for (const key of ["title", "subtitle", "role", "stage", "year"]) {
    if (!meta[key]) throw new Error(`Missing front matter key: ${key}`);
  }
  return { meta, body: markdown.slice(match[0].length) };
}

export function buildLanguageDocument(markdown) {
  const { meta, body } = parseFrontMatter(markdown);
  const markers = [...body.matchAll(/<!--\s*section:([a-z0-9-]+)\s*-->/g)];
  const sections = markers.map((marker, index) => {
    const start = marker.index + marker[0].length;
    const end = markers[index + 1]?.index ?? body.length;
    const source = body.slice(start, end).trim();
    const evidenceIds = [...source.matchAll(
      /<!--\s*evidence:([EH]\d{3}(?:\s*,\s*[EH]\d{3})*)\s*-->/g
    )].flatMap((match) => match[1].split(",").map((value) => value.trim()));
    return {
      id: marker[1],
      html: renderMarkdown(source),
      evidenceIds: [...new Set(evidenceIds)]
    };
  });
  return { meta, sections };
}

function read(name) {
  return fs.readFileSync(path.join(contentDir, name), "utf8");
}

export function buildAllContent() {
  const zhText = read("case-study.zh.md");
  const enText = read("case-study.en.md");
  const evidence = parseEvidenceMap(read("evidence-map.md"));
  const errors = [
    ...validateSectionParity(zhText, enText),
    ...validateEvidenceRefs(zhText, evidence),
    ...validateEvidenceRefs(enText, evidence)
  ];

  for (const [lang, text] of [["zh", zhText], ["en", enText]]) {
    const actual = parseCaseStudy(text).sectionIds;
    if (JSON.stringify(actual) !== JSON.stringify(requiredSections)) {
      errors.push(`${lang} sections must be ${requiredSections.join(",")}; got ${actual.join(",")}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    zh: buildLanguageDocument(zhText),
    en: buildLanguageDocument(enText)
  };
}

export function writeWebContent() {
  const caseStudyContent = buildAllContent();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    `globalThis.caseStudyContent = ${JSON.stringify(caseStudyContent, null, 2)};\n`,
    "utf8"
  );
  console.log(`Built ${path.relative(root, outputPath)}`);
}

const invoked = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) writeWebContent();
```

- [ ] **Step 5: 创建可访问的静态网页壳**

Create `case-study/web/index.html` with these required regions:

```html
<!doctype html>
<html lang="zh-CN" data-active-language="zh">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Margin AI 产品经理作品集 Case Study">
    <title>Margin Case Study</title>
    <link rel="stylesheet" href="./styles.css">
  </head>
  <body>
    <a class="skip-link" href="#case-study-content">跳到正文</a>
    <header class="site-header">
      <a class="wordmark" href="#top" aria-label="Margin Case Study 首页">MARGIN / CASE STUDY</a>
      <div class="language-switch" aria-label="语言选择">
        <button type="button" data-language="zh" aria-pressed="true">中文</button>
        <button type="button" data-language="en" aria-pressed="false">EN</button>
      </div>
    </header>
    <div id="top" class="case-layout">
      <aside>
        <nav id="case-study-nav" aria-label="Case Study 章节"></nav>
      </aside>
      <main id="case-study-content" tabindex="-1"></main>
    </div>
    <p class="visually-hidden" id="language-status" aria-live="polite"></p>
    <script src="./content.generated.js" defer></script>
    <script src="./case-study.js" defer></script>
  </body>
</html>
```

- [ ] **Step 6: 实现网页渲染和语言切换**

Create `case-study/web/case-study.js`:

```js
const caseStudyContent = globalThis.caseStudyContent;
if (!caseStudyContent) {
  throw new Error("Missing generated Case Study content.");
}

const LANGUAGE_CONFIG = {
  zh: {
    htmlLang: "zh-CN",
    status: "已切换为中文",
    overview: ["独立 0→1", "可运行 MVP", "外部用户验证待进行"],
    evidenceLabel: "证据",
    sectionLabel: "章节"
  },
  en: {
    htmlLang: "en",
    status: "Switched to English",
    overview: ["Independent 0→1", "Functional MVP", "External validation pending"],
    evidenceLabel: "Evidence",
    sectionLabel: "Section"
  }
};

const DIAGRAMS = {
  reframe: "category-boundary.svg",
  loop: "product-loop.svg",
  system: "memory-system.svg",
  validation: "validation-layers.svg"
};

const SCREENSHOTS = ["now", "learn", "actions", "memory", "management", "achievements"];
const contentNode = document.querySelector("#case-study-content");
const navNode = document.querySelector("#case-study-nav");
const statusNode = document.querySelector("#language-status");
const languageButtons = [...document.querySelectorAll("[data-language]")];

function firstHeading(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.querySelector("h2")?.textContent?.trim() || "";
}

function diagramFigure(sectionId, lang) {
  const file = DIAGRAMS[sectionId];
  if (!file) return "";
  const alt = {
    zh: {
      reframe: "Margin 产品类别边界图",
      loop: "Margin 核心产品闭环图",
      system: "状态聚合与选择性记忆系统图",
      validation: "已实现、场景验证与假设三层边界图"
    },
    en: {
      reframe: "Margin product category boundaries",
      loop: "Margin core product loop",
      system: "State aggregation and selective memory system",
      validation: "Implemented, scenario-validated, and hypothesis boundaries"
    }
  }[lang][sectionId];
  return `
    <figure class="evidence-figure evidence-figure--wide">
      <img src="../assets/diagrams/${file}" alt="${alt}">
      <figcaption>${alt}</figcaption>
    </figure>
  `;
}

function screenshotGallery(lang) {
  const labels = {
    zh: ["此刻", "学习", "行动", "记忆", "整理", "成就"],
    en: ["Now", "Learn", "Actions", "Memory", "Management", "Achievements"]
  }[lang];
  return `
    <div class="screen-gallery" aria-label="${lang === "zh" ? "产品界面证据" : "Product interface evidence"}">
      ${SCREENSHOTS.map((name, index) => `
        <figure class="evidence-figure">
          <img src="../assets/screenshots/${name}.png" alt="Margin ${labels[index]} ${lang === "zh" ? "页面" : "view"}">
          <figcaption>${labels[index]}</figcaption>
        </figure>
      `).join("")}
    </div>
  `;
}

function renderHero(meta, lang) {
  const facts = LANGUAGE_CONFIG[lang].overview;
  return `
    <section class="case-hero" aria-labelledby="case-title">
      <p class="eyebrow">AI PRODUCT CASE STUDY · ${meta.year}</p>
      <h1 id="case-title">${meta.title}</h1>
      <p class="case-subtitle">${meta.subtitle}</p>
      <dl class="fact-strip">
        <div><dt>${lang === "zh" ? "角色" : "Role"}</dt><dd>${meta.role}</dd></div>
        <div><dt>${lang === "zh" ? "阶段" : "Stage"}</dt><dd>${meta.stage}</dd></div>
        <div><dt>${lang === "zh" ? "边界" : "Boundary"}</dt><dd>${facts[2]}</dd></div>
      </dl>
    </section>
  `;
}

function renderSection(section, index, lang) {
  const evidence = section.evidenceIds
    .map((id) => `<span class="evidence-id">${id}</span>`)
    .join("");
  const visual = diagramFigure(section.id, lang)
    || (section.id === "experience" ? screenshotGallery(lang) : "");
  return `
    <section class="case-section" id="${section.id}" data-section="${section.id}">
      <p class="section-index">${LANGUAGE_CONFIG[lang].sectionLabel} ${String(index + 1).padStart(2, "0")}</p>
      <div class="section-copy">${section.html}</div>
      ${visual}
      <aside class="evidence-note" aria-label="${LANGUAGE_CONFIG[lang].evidenceLabel}">
        <strong>${LANGUAGE_CONFIG[lang].evidenceLabel}</strong>${evidence}
      </aside>
    </section>
  `;
}

function renderNav(sections, lang) {
  navNode.innerHTML = `
    <ol>
      ${sections.map((section, index) => `
        <li>
          <a href="#${section.id}">
            <span>${String(index + 1).padStart(2, "0")}</span>
            ${firstHeading(section.html)}
          </a>
        </li>
      `).join("")}
    </ol>
  `;
  navNode.setAttribute("aria-label", lang === "zh" ? "Case Study 章节" : "Case study sections");
}

function setLanguage(lang, { announce = true } = {}) {
  const safeLang = caseStudyContent[lang] ? lang : "zh";
  const { meta, sections } = caseStudyContent[safeLang];
  document.documentElement.lang = LANGUAGE_CONFIG[safeLang].htmlLang;
  document.documentElement.dataset.activeLanguage = safeLang;
  contentNode.innerHTML = renderHero(meta, safeLang)
    + sections.map((section, index) => renderSection(section, index, safeLang)).join("");
  renderNav(sections, safeLang);
  for (const button of languageButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.language === safeLang));
  }
  try {
    sessionStorage.setItem("margin-case-study-language", safeLang);
  } catch {
    // The static page still works when storage is unavailable.
  }
  if (announce) statusNode.textContent = LANGUAGE_CONFIG[safeLang].status;
  const target = location.hash && document.querySelector(location.hash);
  target?.scrollIntoView({ block: "start" });
}

for (const button of languageButtons) {
  button.addEventListener("click", () => setLanguage(button.dataset.language));
}

let initialLanguage = "zh";
try {
  initialLanguage = sessionStorage.getItem("margin-case-study-language") || "zh";
} catch {
  initialLanguage = "zh";
}
setLanguage(initialLanguage, { announce: false });
```

- [ ] **Step 7: 实现 Editorial Evidence 视觉系统**

`case-study/web/styles.css` must define and use these exact tokens:

```css
:root {
  --paper: #f4eedf;
  --paper-raised: #fbf8f0;
  --ink: #25211c;
  --ink-soft: #6e6257;
  --terracotta: #a74735;
  --rule: #d6cabb;
  --serif: Georgia, "Times New Roman", "Songti SC", serif;
  --sans: Inter, "Segoe UI", "PingFang SC", sans-serif;
  --content: 760px;
  --wide: 1240px;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; background: var(--paper); color: var(--ink); }
body { margin: 0; font: 17px/1.7 var(--serif); }
button, a { font: inherit; }
a { color: inherit; }
img { display: block; max-width: 100%; }

:focus-visible {
  outline: 2px solid var(--terracotta);
  outline-offset: 4px;
}

.skip-link {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 20;
  padding: 9px 14px;
  background: var(--ink);
  color: var(--paper-raised);
  transform: translateY(-160%);
}
.skip-link:focus { transform: translateY(0); }

.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 64px;
  padding: 0 32px;
  border-bottom: 1px solid var(--rule);
  background: color-mix(in srgb, var(--paper) 92%, transparent);
  backdrop-filter: blur(12px);
}

.wordmark, .language-switch {
  font: 700 12px/1 var(--sans);
  letter-spacing: .13em;
  text-decoration: none;
}

.language-switch { display: flex; gap: 8px; }
.language-switch button {
  padding: 8px 10px;
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
}
.language-switch button[aria-pressed="true"] {
  border-color: var(--terracotta);
  background: var(--terracotta);
  color: white;
}

.case-layout {
  display: grid;
  grid-template-columns: minmax(190px, 250px) minmax(0, 1fr);
  gap: clamp(32px, 6vw, 96px);
  width: min(calc(100% - 48px), var(--wide));
  margin: 0 auto;
}

.case-layout > aside {
  position: sticky;
  top: 92px;
  align-self: start;
  max-height: calc(100vh - 112px);
  overflow: auto;
  padding: 18px 0;
}

#case-study-nav ol { margin: 0; padding: 0; list-style: none; }
#case-study-nav a {
  display: grid;
  grid-template-columns: 30px 1fr;
  gap: 10px;
  padding: 8px 0;
  color: var(--ink-soft);
  font: 12px/1.35 var(--sans);
  text-decoration: none;
}
#case-study-nav a:hover { color: var(--terracotta); }

#case-study-content { min-width: 0; }
.case-hero {
  display: flex;
  min-height: calc(100vh - 64px);
  flex-direction: column;
  justify-content: center;
  padding: 80px 0;
}

.eyebrow, .section-index, .evidence-note, figcaption, dt {
  font-family: var(--sans);
  text-transform: uppercase;
  letter-spacing: .12em;
}

.eyebrow, .section-index { color: var(--terracotta); font-size: 12px; }
h1 {
  max-width: 880px;
  margin: 22px 0;
  font: 500 clamp(48px, 7vw, 96px)/1.04 var(--serif);
  letter-spacing: -.045em;
}
.case-subtitle {
  max-width: var(--content);
  color: var(--ink-soft);
  font-size: clamp(20px, 2.2vw, 29px);
}

.fact-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  margin: 56px 0 0;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}
.fact-strip div { padding: 20px 18px; border-left: 1px solid var(--rule); }
.fact-strip div:first-child { border-left: 0; }
.fact-strip dt { color: var(--terracotta); font-size: 10px; }
.fact-strip dd { margin: 8px 0 0; font: 14px/1.5 var(--sans); }

.case-section {
  position: relative;
  padding: 120px 0;
  border-top: 1px solid var(--rule);
}
.section-copy { max-width: var(--content); }
.section-copy h2 {
  margin: 16px 0 36px;
  font: 500 clamp(38px, 5vw, 68px)/1.08 var(--serif);
  letter-spacing: -.035em;
}
.section-copy h3 { margin-top: 48px; font: 500 29px/1.25 var(--serif); }
.section-copy p, .section-copy ul { max-width: 700px; }
.section-copy blockquote {
  margin: 48px 0;
  padding-left: 28px;
  border-left: 3px solid var(--terracotta);
  font-size: 1.35em;
}
.section-copy code { font: .88em var(--sans); color: var(--terracotta); }

.evidence-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 42px;
  color: var(--ink-soft);
  font-size: 10px;
}
.evidence-id {
  padding: 5px 7px;
  border: 1px solid var(--rule);
  background: var(--paper-raised);
}

.evidence-figure { margin: 42px 0 0; }
.evidence-figure--wide { width: min(100%, 1000px); }
.evidence-figure img {
  width: 100%;
  border: 1px solid var(--rule);
  background: var(--paper-raised);
}
.evidence-figure figcaption {
  margin-top: 10px;
  color: var(--ink-soft);
  font-size: 10px;
}
.screen-gallery {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  margin-top: 48px;
}
.screen-gallery .evidence-figure { margin: 0; }

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 860px) {
  .site-header { padding: 0 18px; }
  .case-layout {
    display: block;
    width: min(calc(100% - 36px), var(--content));
  }
  .case-layout > aside {
    position: sticky;
    top: 64px;
    z-index: 8;
    max-height: none;
    padding: 8px 0;
    overflow-x: auto;
    background: var(--paper);
  }
  #case-study-nav ol { display: flex; gap: 16px; width: max-content; }
  #case-study-nav a { display: block; white-space: nowrap; }
  #case-study-nav a span { margin-right: 6px; }
  .case-hero { min-height: auto; padding: 86px 0; }
  .fact-strip { grid-template-columns: 1fr; }
  .fact-strip div, .fact-strip div:first-child {
    border-left: 0;
    border-top: 1px solid var(--rule);
  }
  .fact-strip div:first-child { border-top: 0; }
  .case-section { padding: 80px 0; }
  .screen-gallery { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0s !important;
    animation-duration: 0s !important;
  }
}
```

- [ ] **Step 8: 构建网页并运行测试**

Run:

```powershell
node scripts\case-study\build-web.mjs
node --test test/caseStudyContentContract.test.js test/caseStudyAssets.test.js test/caseStudyWeb.test.js
```

Expected: all Case Study tests pass.

- [ ] **Step 9: 浏览器检查桌面与移动端**

Open `case-study/web/index.html` in a browser and inspect:

- 1440×1000
- 390×844

Verify:

- 30 秒内看到标题、独立角色、MVP 阶段和验证边界
- 中文/英文切换不刷新、不丢失章节位置
- 目录链接准确
- 所有图片可辨认并有替代文本
- 无横向溢出
- 关闭网络后仍能完整打开

- [ ] **Step 10: 提交 Task 6**

```powershell
git add scripts/case-study/lib/markdown-renderer.mjs scripts/case-study/build-web.mjs case-study/web test/caseStudyWeb.test.js
git commit -m "feat: build bilingual Margin case study web edition"
```

---

### Task 7: 构建并导出两套独立 PDF

**Files:**
- Create: `case-study/pdf/pdf.css`
- Create: `scripts/case-study/build-pdf-html.mjs`
- Create: `scripts/case-study/render-pdf.mjs`
- Generate: `case-study/pdf/margin-case-study.zh.html`
- Generate: `case-study/pdf/margin-case-study.en.html`
- Generate: `case-study/dist/margin-case-study.zh.pdf`
- Generate: `case-study/dist/margin-case-study.en.pdf`
- Create: `test/caseStudyPdf.test.js`

**Interfaces:**
- `build-pdf-html.mjs` creates 18 `.pdf-page` elements for each language
- `render-pdf.mjs` exports both HTML files with `preferCSSPageSize: true`
- Each PDF is A4 landscape or 16:10 consistently; choose A4 landscape (`297mm × 210mm`) for portfolio review and printing

- [ ] **Step 1: 先写失败的 PDF 结构测试**

Create `test/caseStudyPdf.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

for (const lang of ["zh", "en"]) {
  test(`${lang} PDF HTML has exactly 18 portfolio pages`, () => {
    const html = fs.readFileSync(
      new URL(`../case-study/pdf/margin-case-study.${lang}.html`, import.meta.url),
      "utf8"
    );
    assert.equal((html.match(/class="pdf-page/g) || []).length, 18);
    assert.match(html, /validation-layers\.svg/);
    assert.match(html, /page-number/);
  });

  test(`${lang} PDF artifact is a non-empty PDF`, () => {
    const pdf = fs.readFileSync(
      new URL(`../case-study/dist/margin-case-study.${lang}.pdf`, import.meta.url)
    );
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(pdf.length > 500_000);
  });
}
```

- [ ] **Step 2: 运行测试并确认 PDF 文件不存在**

Run:

```powershell
node --test test/caseStudyPdf.test.js
```

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: 创建独立 PDF 视觉样式**

Create `case-study/pdf/pdf.css`:

```css
@page {
  size: A4 landscape;
  margin: 0;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: #d8d0c3;
  color: #25211c;
}

.pdf-page {
  width: 297mm;
  height: 210mm;
  padding: 18mm 20mm 16mm;
  break-after: page;
  overflow: hidden;
  position: relative;
  background: #f4eedf;
}

.pdf-page:last-child { break-after: auto; }

.page-kicker {
  margin: 0 0 7mm;
  color: #a74735;
  font: 700 8pt/1 "Segoe UI", "PingFang SC", sans-serif;
  letter-spacing: .14em;
}

.pdf-page h1 {
  max-width: 235mm;
  margin: 0 0 9mm;
  font: 500 28pt/1.08 Georgia, "Songti SC", serif;
  letter-spacing: -.025em;
}

.page-body {
  max-width: 120mm;
  font: 11pt/1.58 Georgia, "Songti SC", serif;
}

.page-body p { margin: 0 0 4mm; }
.page-body ul {
  margin: 0;
  padding-left: 6mm;
  columns: 2;
  column-gap: 12mm;
}
.page-body li { margin-bottom: 3mm; break-inside: avoid; }
.page-body blockquote {
  max-width: 235mm;
  margin: 8mm 0;
  padding-left: 9mm;
  border-left: 1.2mm solid #a74735;
  font: 500 24pt/1.25 Georgia, "Songti SC", serif;
}

.page-assets {
  position: absolute;
  right: 20mm;
  bottom: 22mm;
  width: 135mm;
}
.page-assets img {
  display: block;
  width: 100%;
  border: .3mm solid #d6cabb;
  background: #fbf8f0;
}
.page-assets--screens {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4mm;
  width: 175mm;
}
.page-assets--screens img:first-child { grid-row: span 2; }

.pdf-page--cover {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: #25211c;
  color: #f4eedf;
}
.pdf-page--cover .page-kicker { color: #d6cabb; }
.pdf-page--cover h1 { max-width: 220mm; font-size: 38pt; }
.pdf-page--cover .page-body { color: #d6cabb; }
.pdf-page--statement,
.pdf-page--closing {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.pdf-page--statement .page-body,
.pdf-page--closing .page-body { max-width: 240mm; }
.pdf-page--diagram .page-body { max-width: 95mm; }

.page-number {
  position: absolute;
  right: 14mm;
  bottom: 9mm;
  font: 9pt "Segoe UI", sans-serif;
  color: #6e6257;
}

@media print {
  html, body { background: transparent; }
}
```

No page may use body text smaller than `9pt`.

- [ ] **Step 4: 实现 18 页 PDF HTML 构建**

Create `scripts/case-study/build-pdf-html.mjs`:

```js
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
    { kind: "cover", title: title[0], bodyHtml: `<p>${escapeHtml(meta.subtitle)}</p><p>${escapeHtml(meta.role)} · ${escapeHtml(meta.year)}</p>` },
    { kind: "evidence", title: title[1], bodyHtml: paragraphs(s.overview, 3) },
    { kind: "statement", title: title[2], bodyHtml: `<blockquote>${zh ? "用户不需要先整理好自己，才值得被理解。" : "People should not have to arrive organized in order to be understood."}</blockquote>` },
    { kind: "evidence", title: title[3], bodyHtml: paragraphs(s.unmet, 3) },
    { kind: "diagram", title: title[4], bodyHtml: paragraphs(s.reframe, 1), asset: "../assets/diagrams/category-boundary.svg" },
    { kind: "evidence", title: title[5], bodyHtml: paragraphs(s.evolution, 3) },
    { kind: "evidence", title: title[6], bodyHtml: paragraphs(s.principles, 4) },
    { kind: "diagram", title: title[7], bodyHtml: paragraphs(s.loop, 1), asset: "../assets/diagrams/product-loop.svg" },
    { kind: "statement", title: title[8], bodyHtml: bullets(zh
      ? ["Talk：先接住", "Continue：保留活线", "Remember：选择性保留", "Reflect：让痕迹可见"]
      : ["Talk: receive first", "Continue: preserve the live line", "Remember: retain selectively", "Reflect: make traces visible"]) },
    { kind: "evidence", title: title[9], bodyHtml: paragraphs(s.mvp, 2) },
    { kind: "statement", title: title[10], bodyHtml: bullets(zh
      ? ["不做重型规划", "不做任务压力升级", "不做诊断", "不做语音人格", "不把成长变成分数"]
      : ["No heavy planning", "No escalating task pressure", "No diagnosis", "No voice persona", "No score-based growth"]) },
    { kind: "evidence", title: title[11], bodyHtml: paragraphs(s.system, 2) },
    { kind: "diagram", title: title[12], bodyHtml: paragraphs(s.system, 1), asset: "../assets/diagrams/memory-system.svg" },
    { kind: "evidence", title: title[13], bodyHtml: paragraphs(s.experience, 3) },
    { kind: "screens", title: title[14], bodyHtml: `<p>${zh ? "所有界面来自临时空白数据库，不包含真实个人数据。" : "All screens use an isolated empty database and contain no personal data."}</p>`, assets: [
      "../assets/screenshots/now.png",
      "../assets/screenshots/learn.png",
      "../assets/screenshots/memory.png"
    ] },
    { kind: "evidence", title: title[15], bodyHtml: paragraphs(s.validation, 3) },
    { kind: "diagram", title: title[16], bodyHtml: `<p>${zh ? "实现、场景验证与用户价值不是同一件事。" : "Implementation, scenario validation, and user value are not the same thing."}</p>`, asset: "../assets/diagrams/validation-layers.svg" },
    { kind: "closing", title: title[17], bodyHtml: `${paragraphs(s.validation, 3)}<blockquote>${zh ? "先留一个位置，再从痕迹继续。" : "Leave a place first. Continue from the trace."}</blockquote>` }
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
  if (pages.length !== totalPages) throw new Error(`${lang} PDF requires ${totalPages} pages`);
  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(caseStudyContent[lang].meta.title)}</title>
  <link rel="stylesheet" href="./pdf.css">
</head>
<body>${pages.map(renderPage).join("")}</body>
</html>`;
}

fs.mkdirSync(pdfDir, { recursive: true });
for (const lang of ["zh", "en"]) {
  const output = path.join(pdfDir, `margin-case-study.${lang}.html`);
  fs.writeFileSync(output, renderDocument(lang), "utf8");
  console.log(`Built ${path.relative(root, output)}`);
}
```

- [ ] **Step 5: 实现 Electron PDF 导出**

Create `scripts/case-study/render-pdf.mjs`:

```js
import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../..");
const outputDir = path.join(root, "case-study/dist");

async function render(lang) {
  const input = path.join(root, `case-study/pdf/margin-case-study.${lang}.html`);
  const output = path.join(outputDir, `margin-case-study.${lang}.pdf`);
  const window = new BrowserWindow({
    width: 1400,
    height: 990,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  await window.loadURL(pathToFileURL(input).href);
  await window.webContents.executeJavaScript("document.fonts.ready");
  const pdf = await window.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  });
  await fs.writeFile(output, pdf);
  window.destroy();
}

app.whenReady()
  .then(async () => {
    await fs.mkdir(outputDir, { recursive: true });
    await render("zh");
    await render("en");
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
```

- [ ] **Step 6: 构建 HTML、导出 PDF 并运行自动测试**

Run:

```powershell
node scripts\case-study\build-pdf-html.mjs
node_modules\.bin\electron.cmd scripts\case-study\render-pdf.mjs
node --test test/caseStudyPdf.test.js
```

Expected:

- both HTML files contain 18 pages
- both PDFs are larger than 500 KB
- all 4 PDF tests pass

- [ ] **Step 7: 按 PDF skill 执行渲染审校**

At execution time:

1. read the `pdf` skill completely
2. call `load_workspace_dependencies`
3. use the provided Poppler `pdftoppm` path
4. render both PDFs at 144 DPI into `case-study/dist/qa/zh/` and `case-study/dist/qa/en/`

Command form:

```powershell
pdftoppm -png -r 144 case-study\dist\margin-case-study.zh.pdf case-study\dist\qa\zh\page
pdftoppm -png -r 144 case-study\dist\margin-case-study.en.pdf case-study\dist\qa\en\page
```

Expected: 18 PNG pages per language.

Inspect every rendered page and correct until:

- no clipped or overflowing text
- no broken or missing image
- diagrams readable at full-page view
- no body text below 9pt
- Chinese and English editions have matching page logic
- every page has one dominant claim

- [ ] **Step 8: 提交 Task 7**

```powershell
git add case-study/pdf case-study/dist/margin-case-study.zh.pdf case-study/dist/margin-case-study.en.pdf scripts/case-study/build-pdf-html.mjs scripts/case-study/render-pdf.mjs test/caseStudyPdf.test.js
git commit -m "feat: export bilingual Margin case study PDFs"
```

---

### Task 8: 隐私扫描、全量 QA 与最终审阅记录

**Files:**
- Create: `scripts/case-study/check-privacy.mjs`
- Create: `test/caseStudyPrivacy.test.js`
- Create: `case-study/REVIEW.md`

**Interfaces:**
- `scanTextFiles(rootDir: string): { file: string, pattern: string }[]`
- Exit code `0` only when no sensitive pattern is found

- [ ] **Step 1: 先写失败的隐私扫描测试**

Create `test/caseStudyPrivacy.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { scanText } from "../scripts/case-study/check-privacy.mjs";

test("privacy scanner catches credentials and local user paths", () => {
  const findings = scanText(
    "sample.txt",
    "OPENAI_API_KEY=secret\nC:\\Users\\Example\\private\nsk-test-secret"
  );
  assert.deepEqual(
    findings.map((finding) => finding.pattern).sort(),
    ["api-key-assignment", "local-user-path", "secret-token"].sort()
  );
});

test("privacy scanner allows public case study terminology", () => {
  assert.deepEqual(
    scanText("safe.md", "Margin uses a local provider fallback and anonymized scenarios."),
    []
  );
});
```

- [ ] **Step 2: 运行测试并确认扫描器不存在**

Run:

```powershell
node --test test/caseStudyPrivacy.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 实现隐私扫描器**

Create `scripts/case-study/check-privacy.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATTERNS = [
  { name: "api-key-assignment", regex: /\b(?:OPENAI|ANTHROPIC|SILICONFLOW)_API_KEY\s*=\s*\S+/gi },
  { name: "secret-token", regex: /\bsk-[A-Za-z0-9_-]{8,}\b/g },
  { name: "local-user-path", regex: /\b[A-Za-z]:\\Users\\[^\\\s]+\\/gi },
  { name: "private-key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g }
];

const TEXT_EXTENSIONS = new Set([".md", ".html", ".css", ".js", ".mjs", ".json", ".svg"]);

export function scanText(file, text) {
  return PATTERNS.flatMap(({ name, regex }) => {
    regex.lastIndex = 0;
    return regex.test(text) ? [{ file, pattern: name }] : [];
  });
}

export function scanTextFiles(rootDir) {
  const findings = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!["dist", ".tmp"].includes(entry.name)) walk(full);
      } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
        findings.push(...scanText(full, fs.readFileSync(full, "utf8")));
      }
    }
  };
  walk(rootDir);
  return findings;
}

const invoked = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invoked) {
  const target = path.resolve(process.argv[2] || "case-study");
  const findings = scanTextFiles(target);
  if (findings.length) {
    console.error(JSON.stringify(findings, null, 2));
    process.exitCode = 1;
  } else {
    console.log("Case Study privacy scan passed.");
  }
}
```

- [ ] **Step 4: 运行所有 Case Study 检查**

Run:

```powershell
node scripts\case-study\build-web.mjs
node scripts\case-study\build-pdf-html.mjs
node scripts\case-study\check-privacy.mjs case-study
node --test test/caseStudyContentContract.test.js test/caseStudyAssets.test.js test/caseStudyWeb.test.js test/caseStudyPdf.test.js test/caseStudyPrivacy.test.js
```

Expected:

- privacy scan prints `Case Study privacy scan passed.`
- all Case Study tests pass

- [ ] **Step 5: 重新运行项目全部测试**

Run:

```powershell
npm test
```

Expected:

- exit code `0`
- no existing project regression
- record the actual test count in `case-study/REVIEW.md`
- if the count differs from the content, update E011, both language content files, rebuild web/PDF, and rerun all tests

- [ ] **Step 6: 完成最终审阅记录**

Create `case-study/REVIEW.md`:

```markdown
# Margin Case Study 最终审阅

## 交付物

- [ ] 中文母版完整
- [ ] 英文适配稿完整
- [ ] 双语网页可离线打开
- [ ] 中文 PDF 共 18 页
- [ ] 英文 PDF 共 18 页

## 证据与诚实性

- [ ] 所有事实结论可回溯到 evidence-map.md
- [ ] Implemented / Scenario-validated / Hypothesis 边界清楚
- [ ] 没有虚构用户研究、指标或用户原话
- [ ] 当前测试数字与最后一次 npm test 一致
- [ ] Echo → Margin 的定位变化有上下文

## 隐私

- [ ] 所有产品截图来自临时空白数据库
- [ ] 未出现真实对话、记忆、路径、密钥或凭据
- [ ] check-privacy.mjs 通过

## 网页

- [ ] 1440×1000 无溢出
- [ ] 390×844 无横向滚动
- [ ] 中文/英文切换保持章节位置
- [ ] 关闭网络后可完整阅读
- [ ] 键盘焦点、替代文本和 reduced-motion 可用

## PDF

- [ ] 两种语言均渲染 18 张 QA 页面
- [ ] 每页只有一个主要判断
- [ ] 无文字裁切、图片缺失或低对比内容
- [ ] 图表与界面在常见阅读尺寸下可辨认

## 验证记录

- 项目测试：
- Case Study 测试：
- 隐私扫描：
- 网页检查尺寸：
- PDF 渲染页数：
- 已知局限：
```

Replace every unchecked box with `[x]` only after the corresponding check succeeds. Fill every verification line with the actual command result; `已知局限` must state that external user and market validation remain pending.

- [ ] **Step 7: 检查 Git 范围**

Run:

```powershell
git status --short
git diff --check
git diff --stat
```

Expected:

- only Task 8 files and any evidence-number corrections are unstaged
- unrelated existing `.env.example`, `package.json`, docs, and design-review files remain untouched and unstaged
- no whitespace errors

- [ ] **Step 8: 提交 Task 8**

```powershell
git add scripts/case-study/check-privacy.mjs test/caseStudyPrivacy.test.js case-study/REVIEW.md
git commit -m "test: complete Margin case study quality review"
```

- [ ] **Step 9: 最终交付检查**

Run:

```powershell
git status --short
```

Confirm the user receives links to:

- `case-study/web/index.html`
- `case-study/dist/margin-case-study.zh.pdf`
- `case-study/dist/margin-case-study.en.pdf`
- `case-study/REVIEW.md`

Do not deploy or publish.
