# Margin Pi Stage 0 Audit and SDK Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 固定 Margin 使用的 Pi 上游、版本、许可、Node 运行时和 SDK 集成方式，并在不开放 Pi 内置高风险工具的前提下，跑通可审计的新建 Session、恢复 Session、分支和压缩最小示例。

**Architecture:** 本阶段不改造现有聊天主链路。新增独立的 Pi 基线配置、审计脚本和隔离的 SDK spike；所有 spike 数据写入被忽略的 `data/pi-spike/`，生产代码只获得可测试的版本约束和运行时边界。真实模型调用使用显式环境变量和现有 Pi 认证，离线测试使用纯函数与假 API，不依赖网络或密钥。

**Tech Stack:** Node.js 22.23.1、JavaScript ESM、Node test runner、`@earendil-works/pi-coding-agent@0.84.2`、现有 npm/Electron/Express/SQLite 工程。

## Global Constraints

- 保留工作区现有未提交修改；每次提交只暂存本任务列出的文件。
- 精确锁定 `@earendil-works/pi-coding-agent` 为 `0.84.2`，不得使用 `^`、`~` 或浮动 tag。
- `.runtime/` 和 `data/pi-spike/` 不得进入 Git；Node 二进制不纳入仓库。
- spike 的 Pi 内置工具列表必须为空；仅注册无副作用的 `margin_spike_echo`。
- 未配置模型或认证时，脚本必须明确返回“需要凭据”，不得伪造成功报告。
- 阶段 0 不修改 `src/services/chatService.js`，不接管现有用户会话，不实现四个正式 Margin 工具。
- 每个实现任务遵循红—绿—重构；先运行指定测试观察失败，再写最小实现。

---

## Task 1: 固定 Pi 与 Node 版本契约

**Files:**

- Create: `src/runtime/pi/piBaseline.js`
- Create: `test/piBaseline.test.js`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: 写版本契约失败测试**

```js
// test/piBaseline.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  PI_BASELINE,
  parseNodeVersion,
  isSupportedNodeVersion,
  assertSupportedNodeVersion,
} from "../src/runtime/pi/piBaseline.js";

test("Pi baseline is pinned to the audited upstream release", () => {
  assert.deepEqual(PI_BASELINE, {
    repository: "https://github.com/earendil-works/pi",
    tag: "v0.84.2",
    packageName: "@earendil-works/pi-coding-agent",
    packageVersion: "0.84.2",
    license: "MIT",
    minimumNode: "22.19.0",
    runtimeNode: "22.23.1",
  });
});

test("Node support comparison handles patch and major versions", () => {
  assert.deepEqual(parseNodeVersion("v22.23.1"), [22, 23, 1]);
  assert.equal(isSupportedNodeVersion("22.18.0"), false);
  assert.equal(isSupportedNodeVersion("22.19.0"), true);
  assert.equal(isSupportedNodeVersion("22.23.1"), true);
  assert.equal(isSupportedNodeVersion("23.0.0"), true);
});

test("invalid or old Node versions produce an actionable error", () => {
  assert.throws(() => assertSupportedNodeVersion("20.19.6"), /Node >=22\.19\.0/);
  assert.throws(() => parseNodeVersion("nightly"), /Invalid Node version/);
});
```

- [ ] **Step 2: 运行测试并确认因模块缺失失败**

Run: `node --test test/piBaseline.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 和 `src/runtime/pi/piBaseline.js`。

- [ ] **Step 3: 实现版本契约**

```js
// src/runtime/pi/piBaseline.js
export const PI_BASELINE = Object.freeze({
  repository: "https://github.com/earendil-works/pi",
  tag: "v0.84.2",
  packageName: "@earendil-works/pi-coding-agent",
  packageVersion: "0.84.2",
  license: "MIT",
  minimumNode: "22.19.0",
  runtimeNode: "22.23.1",
});

export function parseNodeVersion(version) {
  const match = String(version).match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Invalid Node version: ${version}`);
  return match.slice(1).map(Number);
}

export function isSupportedNodeVersion(version) {
  const actual = parseNodeVersion(version);
  const minimum = parseNodeVersion(PI_BASELINE.minimumNode);
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

export function assertSupportedNodeVersion(version = process.versions.node) {
  if (!isSupportedNodeVersion(version)) {
    throw new Error(
      `Pi requires Node >=${PI_BASELINE.minimumNode}; received ${version}. ` +
      `Use .runtime/node-v${PI_BASELINE.runtimeNode}-win-x64/node.exe.`,
    );
  }
}
```

- [ ] **Step 4: 增加仓库运行时约束且保留现有 package 修改**

在 `.gitignore` 末尾加入：

```gitignore
.runtime/
data/pi-spike/
```

在 `package.json` 顶层合并以下字段；不得删除当前工作区已有的 `scripts.design:review` 或其他用户修改：

```json
"engines": {
  "node": ">=22.19.0"
}
```

- [ ] **Step 5: 运行单测与全量回归**

Run: `node --test test/piBaseline.test.js`

Expected: PASS，3 tests passed。

Run: `npm test`

Expected: PASS，现有测试与新增测试全部通过；若测试数不再是审计时的 186，以测试日志实际数量为准记录，禁止修改断言凑数。

- [ ] **Step 6: 提交版本契约**

```powershell
git add -- .gitignore package.json src/runtime/pi/piBaseline.js test/piBaseline.test.js
git diff --cached --check
git commit -m "build: pin Pi and Node runtime contract"
```

## Task 2: 建立可测试的 Pi 安装审计器

**Files:**

- Create: `src/runtime/pi/piAudit.js`
- Create: `scripts/audit-pi-baseline.js`
- Create: `test/piAudit.test.js`
- Modify: `package.json`

- [ ] **Step 1: 写审计器失败测试**

```js
// test/piAudit.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { buildPiAudit } from "../src/runtime/pi/piAudit.js";

test("audit passes only when dependency, installation, license, and Node match", () => {
  const report = buildPiAudit({
    nodeVersion: "22.23.1",
    dependencyVersion: "0.84.2",
    installedVersion: "0.84.2",
    installedLicense: "MIT",
    runtimeExists: true,
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
});

test("audit reports every mismatch without hiding additional failures", () => {
  const report = buildPiAudit({
    nodeVersion: "20.19.6",
    dependencyVersion: "^0.84.2",
    installedVersion: null,
    installedLicense: null,
    runtimeExists: false,
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.failures.map((item) => item.code), [
    "unsupported_node",
    "dependency_not_exactly_pinned",
    "package_not_installed",
    "license_not_verified",
    "bundled_runtime_missing",
  ]);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/piAudit.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 和 `src/runtime/pi/piAudit.js`。

- [ ] **Step 3: 实现纯函数审计核心**

`src/runtime/pi/piAudit.js` 必须导出：

```js
import { PI_BASELINE, isSupportedNodeVersion } from "./piBaseline.js";

export function buildPiAudit(input) {
  const failures = [];
  if (!isSupportedNodeVersion(input.nodeVersion)) {
    failures.push({ code: "unsupported_node", actual: input.nodeVersion });
  }
  if (input.dependencyVersion !== PI_BASELINE.packageVersion) {
    failures.push({ code: "dependency_not_exactly_pinned", actual: input.dependencyVersion });
  }
  if (input.installedVersion !== PI_BASELINE.packageVersion) {
    failures.push({ code: "package_not_installed", actual: input.installedVersion });
  }
  if (input.installedLicense !== PI_BASELINE.license) {
    failures.push({ code: "license_not_verified", actual: input.installedLicense });
  }
  if (!input.runtimeExists) {
    failures.push({ code: "bundled_runtime_missing", actual: false });
  }
  return { baseline: PI_BASELINE, observed: input, failures, ok: failures.length === 0 };
}
```

- [ ] **Step 4: 实现 CLI 文件探测与稳定退出码**

`scripts/audit-pi-baseline.js` 使用 `fs/promises` 读取根目录 `package.json`、`node_modules/@earendil-works/pi-coding-agent/package.json`，并检查 `.runtime/node-v22.23.1-win-x64/node.exe`。输出格式固定为：

```json
{
  "ok": false,
  "baseline": {},
  "observed": {},
  "failures": []
}
```

规则：JSON 写到 stdout；文件缺失转为 `null`，不打印堆栈；`ok=true` 时退出码 0，否则退出码 1。意外解析错误写入 stderr 并退出 2。脚本通过 `pathToFileURL(process.argv[1]).href === import.meta.url` 限制 CLI 入口，便于测试导入。

- [ ] **Step 5: 添加 npm 脚本并验证失败报告**

合并到 `package.json.scripts`：

```json
"audit:pi": "node scripts/audit-pi-baseline.js"
```

Run: `npm run audit:pi`

Expected before runtime/package installation: exit 1，stdout 是有效 JSON，至少包含 `package_not_installed` 或 `bundled_runtime_missing`。

- [ ] **Step 6: 运行测试并提交**

Run: `node --test test/piAudit.test.js test/piBaseline.test.js`

Expected: PASS，5 tests passed。

```powershell
git add -- package.json src/runtime/pi/piAudit.js scripts/audit-pi-baseline.js test/piAudit.test.js
git diff --cached --check
git commit -m "feat: add auditable Pi baseline checks"
```

## Task 3: 安装固定 Node 运行时与 Pi 包

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/bootstrap-pi-runtime.ps1`
- Create: `test/piRuntimeBootstrap.test.js`

- [ ] **Step 1: 写 bootstrap 静态契约测试**

测试读取脚本文本并断言：下载 URL 精确包含 `node-v22.23.1-win-x64.zip`；SHA256 必须从 Node 官方 `SHASUMS256.txt` 解析后比较；解压目标必须是仓库内 `.runtime/node-v22.23.1-win-x64`；已存在且 `node.exe --version` 正确时不重复下载。

Run: `node --test test/piRuntimeBootstrap.test.js`

Expected: FAIL，因为 `scripts/bootstrap-pi-runtime.ps1` 不存在。

- [ ] **Step 2: 实现安全且幂等的运行时安装脚本**

脚本必须：

1. 用 `$PSScriptRoot` 解析仓库绝对路径，不依赖调用位置；
2. 只允许目标目录为 `<repo>\.runtime\node-v22.23.1-win-x64`；
3. 下载 `https://nodejs.org/dist/v22.23.1/node-v22.23.1-win-x64.zip` 与同目录 `SHASUMS256.txt` 到 `New-TemporaryFile` 所在临时目录；
4. 从官方清单提取 zip 的 SHA256，并用 `Get-FileHash -Algorithm SHA256` 比较；
5. 校验成功后才 `Expand-Archive`；失败则保留现有目标、不覆盖；
6. 最后执行目标 `node.exe --version`，必须等于 `v22.23.1`；
7. `finally` 中仅删除本次创建的临时目录。

- [ ] **Step 3: 在固定 Node 下精确安装 Pi**

先运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-pi-runtime.ps1
```

Expected: 输出 `v22.23.1`，目标 runtime 存在且仍被 Git 忽略。

然后在 `package.json.dependencies` 合并：

```json
"@earendil-works/pi-coding-agent": "0.84.2"
```

使用固定 runtime 自带 npm 更新锁文件：

```powershell
.\.runtime\node-v22.23.1-win-x64\npm.cmd install --save-exact @earendil-works/pi-coding-agent@0.84.2
```

Expected: `package.json` 和 `package-lock.json` 均精确记录 `0.84.2`；安装过程无 engine mismatch。

- [ ] **Step 4: 验证审计转绿**

Run: `.\.runtime\node-v22.23.1-win-x64\node.exe scripts/audit-pi-baseline.js`

Expected: exit 0，JSON 中 `ok: true`、installed version `0.84.2`、license `MIT`。

Run: `.\.runtime\node-v22.23.1-win-x64\node.exe --test test/piBaseline.test.js test/piAudit.test.js test/piRuntimeBootstrap.test.js`

Expected: PASS。

- [ ] **Step 5: 提交依赖与 bootstrap**

提交前运行 `git status --short --ignored`，确认 `.runtime/` 只出现在 ignored 列表，未被暂存。

```powershell
git add -- package.json package-lock.json scripts/bootstrap-pi-runtime.ps1 test/piRuntimeBootstrap.test.js
git diff --cached --check
git commit -m "build: install pinned Pi SDK runtime"
```

## Task 4: 创建无高风险工具的 Pi SDK spike

**Files:**

- Create: `src/runtime/pi/piSpikeExtension.js`
- Create: `test/piSpikeExtension.test.js`
- Create: `scripts/run-pi-sdk-spike.js`
- Create: `test/piSdkSpike.test.js`
- Modify: `package.json`

- [ ] **Step 1: 写 extension 与配置失败测试**

测试构造 fake Pi extension API，捕获 `registerTool` 调用，并断言：

- 只注册 `margin_spike_echo`；
- 工具 schema 只接受必填字符串 `message`；
- execute 返回输入文本和 `isError: false`，不读写文件、不执行命令；
- `buildSpikeSessionOptions()` 返回 `tools: []`，确保 bash/read/write/edit 等内置工具均未启用；
- session manager 根目录必须在传入的 `dataDir` 下，不接受仓库根或空路径。

Run: `node --test test/piSpikeExtension.test.js test/piSdkSpike.test.js`

Expected: FAIL，因为实现文件不存在。

- [ ] **Step 2: 实现唯一无副作用工具**

`src/runtime/pi/piSpikeExtension.js` 导出默认 extension factory。注册工具名固定为 `margin_spike_echo`，描述明确标注“Stage 0 audit-only tool”；参数通过 Pi 导出的 TypeBox `Type.Object({ message: Type.String() })` 定义；execute 返回：

```js
{
  content: [{ type: "text", text: params.message }],
  details: { echoed: true },
  isError: false,
}
```

- [ ] **Step 3: 实现 spike 的纯配置边界**

`scripts/run-pi-sdk-spike.js` 必须导出 `buildSpikeSessionOptions({ dataDir, extensionFactory })`。返回对象包含：

```js
{
  sessionManager: SessionManager.create(sessionFilePath),
  tools: [],
  extensionFactories: [extensionFactory],
}
```

其中 `sessionFilePath` 由 `path.resolve(dataDir, "sessions", "stage-0.jsonl")` 生成；先验证其相对路径不以 `..` 开头且不为绝对逃逸路径，再创建父目录。

- [ ] **Step 4: 实现真实 SDK 流程与证据输出**

CLI 启动时先执行 `assertSupportedNodeVersion()`，然后使用 Pi v0.84.2 SDK 的 `createAgentSessionRuntime()` 创建 runtime。流程固定为：

1. 创建初始 session；
2. 发送提示，要求调用 `margin_spike_echo` 返回 nonce；
3. 记录 session id 与捕获到的 `tool_call`；
4. 通过 runtime 恢复相同 session 并验证 id 不变；
5. 创建分支并验证新 id 与 parent id；
6. 调用 session 压缩，记录 compaction 事件；
7. 将逐步结果、Pi/Node 版本、工具清单和时间写入 `data/pi-spike/report.json`。

环境变量仅允许：

```text
MARGIN_PI_PROVIDER
MARGIN_PI_MODEL
MARGIN_PI_SPIKE_PROMPT
```

认证只使用 Pi SDK 支持的既有凭据存储或 provider 官方环境变量，报告中不得写入 token、API key、完整用户目录或完整对话内容。若模型/认证不可用，stdout 输出 `{"ok":false,"blockedBy":"pi_credentials_required"}` 并退出 3；不得生成成功报告。

- [ ] **Step 5: 添加脚本并运行离线测试**

合并到 `package.json.scripts`：

```json
"spike:pi": ".\\.runtime\\node-v22.23.1-win-x64\\node.exe scripts/run-pi-sdk-spike.js"
```

Run: `.\.runtime\node-v22.23.1-win-x64\node.exe --test test/piSpikeExtension.test.js test/piSdkSpike.test.js`

Expected: PASS；测试不发起网络请求。

- [ ] **Step 6: 运行真实 spike**

在已配置 Pi 认证和模型时运行：

```powershell
$env:MARGIN_PI_PROVIDER='<configured-provider>'
$env:MARGIN_PI_MODEL='<configured-model-id>'
npm run spike:pi
```

Expected: exit 0；`data/pi-spike/report.json` 的 `ok=true`，四项 session/branch/compaction/tool checks 均为 true，`enabledBuiltInTools` 为空数组。

若退出 3：将阶段状态记为“凭据阻塞”，保存脱敏错误信息并等待用户提供认证，不绕过检查。

- [ ] **Step 7: 提交 spike**

```powershell
git add -- package.json src/runtime/pi/piSpikeExtension.js scripts/run-pi-sdk-spike.js test/piSpikeExtension.test.js test/piSdkSpike.test.js
git diff --cached --check
git commit -m "test: prove isolated Pi SDK session lifecycle"
```

## Task 5: 输出当前 Margin 审计与贡献边界

**Files:**

- Create: `docs/audit/current_margin_status.md`
- Create: `docs/architecture/pi_version_and_license.md`
- Create: `docs/architecture/contribution_boundary.md`
- Create: `docs/architecture/integration_decision.md`
- Create: `test/piAuditDocs.test.js`

- [ ] **Step 1: 写文档证据完整性失败测试**

测试读取四个文件，并逐项断言存在以下可检索字段：

- `current_margin_status.md`: `chatService.js`、`memoryStore.js`、`186`、`会话历史`、`长期记忆`、`尚未集成`；
- `pi_version_and_license.md`: upstream URL、tag、package、MIT、Node 要求、验证日期、证据链接；
- `contribution_boundary.md`: `Pi 原生能力`、`Margin 新增能力`、`尚未实现`、Agent loop、Session、压缩、四个 Margin 工具；
- `integration_decision.md`: `AgentSessionRuntime`、RPC fallback、否决方案、风险、回滚边界。

Run: `node --test test/piAuditDocs.test.js`

Expected: FAIL，因为四份文档不存在。

- [ ] **Step 2: 编写当前 Margin 状态审计**

`current_margin_status.md` 必须区分“代码已验证”“测试已验证”“设计目标”三种状态，并记录：

- 当前 JS ESM + Express + Electron + SQLite 架构；
- `chatService.js` 当前编排路径；
- `memoryStore.js` 当前多职责与 `conversations` 语义混用；
- operation proposal/confirmation 已有能力和 destructive delete 当前限制；
- 审计时 186 个测试通过，但测试通过数不等于用户价值；
- 当前尚未真实集成 Pi，不得据此修改简历。

- [ ] **Step 3: 编写版本许可与贡献边界**

`pi_version_and_license.md` 引用以下上游原始证据并写明 2026-08-20 验证：

- `https://github.com/earendil-works/pi`
- `https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/package.json`
- `https://github.com/earendil-works/pi/blob/v0.84.2/LICENSE`
- `https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/sdk.md`
- `https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/rpc.md`

`contribution_boundary.md` 用三列表格逐条区分：Pi 的 agent loop、tool lifecycle、Session/branch/compaction；Margin 的结构化状态、跨 Session 召回、权限/确认、评测；以及尚未实现项。任何未被代码与 trace 证明的项目标为“尚未实现”。

- [ ] **Step 4: 编写 ADR 集成决策**

`integration_decision.md` 采用 ADR 结构：Context、Decision、Alternatives、Consequences、Validation、Rollback。决策固定为：

- 首选直接使用 `AgentSessionRuntime` SDK；
- RPC 只用于未来跨进程隔离需求；
- 不直接基于低层 `pi-agent-core` 重建会话生命周期；
- Stage 0 spike 与现有 `chatService.js` 完全隔离；
- 未通过 spike 时可删除新 runtime 目录和入口，不影响 legacy path。

- [ ] **Step 5: 运行文档测试并提交**

Run: `node --test test/piAuditDocs.test.js`

Expected: PASS。

```powershell
git add -- docs/audit/current_margin_status.md docs/architecture/pi_version_and_license.md docs/architecture/contribution_boundary.md docs/architecture/integration_decision.md test/piAuditDocs.test.js
git diff --cached --check
git commit -m "docs: audit Margin and Pi contribution boundary"
```

## Task 6: 建立 Stage 0 一键验收与证据摘要

**Files:**

- Create: `scripts/verify-pi-stage-0.ps1`
- Create: `test/piStage0Verification.test.js`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: 写验收脚本契约测试**

测试读取 PowerShell 脚本并断言按顺序执行：固定 Node 版本检查、Pi audit、Stage 0 专项测试、全量测试、spike 报告校验；任一步非零立即失败；不得自动设置认证或伪造报告。

Run: `node --test test/piStage0Verification.test.js`

Expected: FAIL，因为验收脚本不存在。

- [ ] **Step 2: 实现一键验收**

`scripts/verify-pi-stage-0.ps1` 解析固定 Node 路径并依次运行：

```powershell
& $nodeExe --version
& $nodeExe scripts/audit-pi-baseline.js
& $nodeExe --test test/piBaseline.test.js test/piAudit.test.js test/piRuntimeBootstrap.test.js test/piSpikeExtension.test.js test/piSdkSpike.test.js test/piAuditDocs.test.js test/piStage0Verification.test.js
& $npmCmd test
```

随后读取 `data/pi-spike/report.json`，要求 `ok=true`、package/version/license/node 与 baseline 一致、`enabledBuiltInTools.Count -eq 0`。报告不存在或凭据阻塞时退出 3，并输出唯一的人工动作：配置 Pi 认证后执行 `npm run spike:pi`。

- [ ] **Step 3: 添加 npm 入口和用户文档**

合并到 `package.json.scripts`：

```json
"verify:pi-stage-0": "powershell -ExecutionPolicy Bypass -File .\\scripts\\verify-pi-stage-0.ps1"
```

README 只新增“Pi Stage 0 开发验证”章节，明确当前不是生产集成，并给出三条命令：bootstrap、spike、verify。CHANGELOG 在 `Unreleased` 下记录版本固定、审计文档和隔离 spike；不得写“完成基于 Pi 重构”。

- [ ] **Step 4: 运行完整验收**

Run: `npm run verify:pi-stage-0`

Expected with valid credentials and prior spike: exit 0，全量测试通过，审计与 trace 一致。

Expected without credentials: exit 3，明确提示 `pi_credentials_required`；此状态不得勾选 Stage 0 完成。

- [ ] **Step 5: 检查仓库边界**

Run: `git status --short --ignored`

Expected: `.runtime/`、`data/pi-spike/` 为 ignored；无认证、API key、Node 二进制或 spike 对话正文进入 staged files。

Run: `git diff --check`

Expected: 无输出，exit 0。

- [ ] **Step 6: 提交验收入口**

```powershell
git add -- package.json README.md CHANGELOG.md scripts/verify-pi-stage-0.ps1 test/piStage0Verification.test.js
git diff --cached --check
git commit -m "chore: add Pi stage zero verification gate"
```

## Stage 0 Completion Gate

只有同时满足下列条件，才能进入双层状态 Schema 与四工具实现计划：

- [ ] `npm run audit:pi` 在固定 Node 22.23.1 下退出 0；
- [ ] Pi 依赖与 lockfile 精确固定为 0.84.2，许可证记录为 MIT；
- [ ] 真实 spike 证明新建、恢复、分支、压缩和唯一自定义工具调用；
- [ ] spike 期间 Pi 内置高风险工具为空；
- [ ] 四份审计/架构文档通过证据完整性测试；
- [ ] 全量自动化测试通过；
- [ ] `data/pi-spike/report.json` 可复核且不含秘密；
- [ ] README 和 CHANGELOG 没有把 Stage 0 描述成完整 Pi 产品集成；
- [ ] 若缺认证，明确标记为外部阻塞并等待用户处理，不进入阶段 2。
