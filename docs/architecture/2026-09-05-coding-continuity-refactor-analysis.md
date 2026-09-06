# Margin Coding Continuity：架构重构前置分析

日期：2026-09-05
状态：分析与规划，尚未执行重构。本文同时记录用户确认的产品形态。

## 产品目标与交互形态

Margin 从原 Coding Session 和当前代码仓库中恢复“最小充分开发状态”，生成跨 Agent 可复制的 Handoff。核心原则是恢复 Development State，不复制完整 Conversation。

用户因 Coding Agent 切换、账号切换、额度耗尽或 Session 丢失需要换新会话时，新 Agent 应能够依据交接继续开发，减少重新阅读项目和历史的成本。

### 用户明确期望的产品形态

Margin 是一个**卡片样式的浮窗**：

1. 平时以紧凑卡片显示，简要呈现 Token 消耗情况。
2. 需要切换 Agent、继续工作时，用户才点开 Margin 卡片。
3. 展开后显示当前 Agent 的会话列表。
4. 用户点进对应会话，查看并选择复制交接文本。
5. 用户自行打开另一个 Agent，新建会话，粘贴文本，继续前一个 Agent 的工作。

交互主线：

```text
紧凑浮窗：Token 消耗概览
  → 点击展开：当前 Agent 的 Session 列表
  → 选择 Session：查看 Smart Handoff，必要时查看 Detailed
  → 复制文本
  → 用户在另一 Agent 新建会话并粘贴
```

“复制文本”在本架构中指可直接交接的 Handoff，而不是完整原始对话。默认 Smart；Detailed 提供更深的状态恢复信息。

### 对架构的直接影响

- 新 UI 围绕会话选择、交接预览和复制构建，不再围绕 Workstream、Run、Memory 与 Agent 执行控制构建。
- 交接文本必须自包含：目标、约束、当前事实和下一步所需信息不能依赖用户额外复制整个证据目录。本地 Evidence Pointer 用于按需追溯。
- Token 消耗展示与 Handoff 长度是两个指标；源 Session 累计消耗不能当成交接文本长度。
- 现有实验观察到原生 usage 记录与 continues 提取值可能不一致。展示时应标明来源、统计范围和更新时间；没有可靠数据时显示未知，不能推算成账号剩余额度。
- 浮窗是产品方向，但桌面宿主技术、当前 Agent 的确定方式、用量刷新方式尚未选定。后续根据实际实现选择最小方案，不在 Core 中提前加入窗口管理、监听框架或多 Agent Provider 系统。
- 第一个重构切片仍是独立 Core + CLI。它交付浮窗后续可调用的数据管线，不要求先实现桌面浮窗。

## 1. Current Architecture Diagnosis

当前适合开始一个独立的 Core 重构切片，但不适合原样迁入 PoC。

仓库现有三条路径：

- **旧伴侣产品**：`src/services`、旧 API、人格/记忆/学习/TTS，目标与 Coding Continuity 已明显不同。
- **持久化 Workbench**：React → HTTP Gateway → Application Contract → SQLite Core，Pi/Claude Runtime 执行交互。它恢复的是 Margin 自己维护的状态，不是外部 Coding Session。
- **实验管线**：Phase 0 获取 Session 并补充原始事件；Phase 1 关联执行证据、刷新仓库、生成状态。这是新产品最直接的基础。

关键代码依据：

- `src/core/createMarginCore.js` 绑定数据库、Workstream、Run、权限和工具写入。
- `src/application/resumeBriefService.js` 从已有数据库字段组织 Brief，没有恢复原生 Session。
- `experiments/phase1-distiller/evidence.mjs` 的 `buildEvidence()` 直接读取 `context.phase0Evidence`。continues 的标准 Context 不是完整证据来源。
- `experiments/phase1-distiller/distiller.mjs` 已有事实规则，但 Goal 基本保留历史请求，Decisions 是占位说明，Next Step 是固定建议；尚不是完整语义提炼器。

分析时 Git 为 `main @ 0836e80`。已有 5 个 tracked 文件修改：根 package/lock、`persistentWorkRepository.js`、`marginPiAdapter.js`、`piTerminalPilotRuntime.js`；另有 experiments、Claude Runtime、飞书模块等未跟踪内容。这些不是本次分析产生的修改。

Phase 1 已有记录：191 条原始记录、25 次工具调用、24 次调用匹配、37 个内部操作；原始 Session 约 387,346 Token、continues standard 约 1,893 Token、PoC Handoff 约 2,835 Token。数字使用同一离线编码，不能视为账号计费用量或续接质量证明。15 项通过来自已有实验记录，本次分析未重新运行测试。

## 2. Keep / Adapt / Remove

以下是目标架构判断，不是本轮删除清单。第一切片不清理旧链路。

| Path / Module | Decision | Reason |
| --- | --- | --- |
| `package.json` 中 Node、ESM、node:test 基础 | Keep | 足以承载新管线，无需换技术栈 |
| `web/vite.config.js`、React 构建基础 | Keep | 后续卡片内容可继续使用；浮窗宿主待选 |
| `web/src/styles.css` | Adapt | 可复用基础样式；Workstream 专属布局需调整为卡片与展开视图 |
| `web/src/App.js`、业务组件和数据 hooks | Adapt / Retire | 保留展示经验；重做 Session 列表、Handoff 预览与复制，退役 Run/Memory/NeedsOwner 流程 |
| `src/core`、`src/domain` 的旧持久化模型 | Retire | 不应将外部执行证据塞进 Workstream/Run、数据库版本与权限模型 |
| `resumeBriefService.js`、`contextPlanner.js` | Adapt 概念，重写实现 | 事实与建议分离有价值；数据库读取和 maxItems 截断不适用 |
| `src/application`、`src/contracts`、`src/http` 的旧命令体系 | Retire | 读取 Session、生成 Handoff 不需要治理 Agent 写操作 |
| `src/runtime`、`src/pilot` | Retire | 新产品不需要自己运行 Coding Agent |
| `src/services`、`src/routes`、`src/storage` 的旧产品链路 | Retire | 人格、情绪、学习、TTS 与开发状态恢复无关；旧 memoryDistiller 也不适用 |
| `src/surfaces/feishu` | Retire | 招聘、面试、晨报不属于新产品 |
| `data` | Keep，原地保留 | 无需迁移、双写或删除现有数据；新管线不依赖它 |
| `experiments` | Keep 记录，选择性提取 | 保留验证依据；正式代码不能反向依赖实验目录 |

## 3. Target Minimal Architecture

新增正式目录 `src/core/handoff/`，暂不改旧 `createMarginCore`：

```text
src/core/handoff/
  session-source.js   # continues 边界、Session 选择、原始证据捕获
  evidence.js         # 规范事件 → 调用/结果关联、执行事实
  exec.js             # 已验证的静态 exec 解析
  repo-truth.js       # 当前 Git、相关文件、哈希与内容核对
  distiller.js        # Evidence + Repo Truth → 单份状态
  handoff.js          # 状态选择与 Markdown 输出
  index.js            # 一个管线函数，串联上述步骤

scripts/
  generate-handoff.js
```

目录表示职责，不建立对应的 Service、Manager 或 Provider 类。使用普通对象与 JSDoc，不引入 DI、Event Bus 或 Plugin System。

```text
Native Session
  → session-source
      ├─ continues：发现、基础解析
      └─ 原始记录补充：完整工具输入/输出、来源指针
  → Evidence
  → Repo Truth reconciliation
  → Distilled State
  → Smart / Detailed selection + render
  → Markdown → User Copy → 新 Agent 会话
```

原始记录补充不可省略，不能将 continues Context 宣传为无损证据。后续浮窗读取 Session 列表和用量元信息，在用户选择会话后调用同一生成入口；本阶段不设计后台持续蒸馏。

## 4. PoC → Core Mapping

| PoC 代码 | 去向与必要调整 |
| --- | --- |
| Phase 0 run-baseline 的 discovery、完整行快照、哈希、事件读取 | 提取到 session-source；取消固定 Session ID、实验路径与重复 baseline extraction |
| evidence.mjs：unwrapExec、decodeOutput | 进入 exec.js；保留静态识别范围，未知形态为 Uncertain |
| buildEvidence：call/result、wait、PTY 关联 | 进入 evidence.js；去掉 phase0Evidence 输入要求，将 Codex 原生字段转换集中在 source 边界 |
| patchEdits、commandKinds、outcome | 进入 Evidence；保留调用意图与成功、进程成功与内部语句成功的区别 |
| observeFile、gitState、refreshRepoTruth | 进入 repo-truth；移除固定 Phase 0 产物及专用报告格式解释 |
| distill | 提取事实判定、重试消解、历史/当前区分；重写占位 Decisions、固定 Next Step、历史请求堆叠 |
| renderHandoff | 改成状态选择后渲染；省略无证据空章节，Smart 不堆完整工具日志 |
| run-distiller 中证据节点登记、引用完整性检查 | 提取到正式管线；属于正确输出必需步骤 |
| distiller.test.mjs | 迁移相关断言；真实样本检查作为显式本地回归，不让普通测试依赖私有 output |
| measurements、tokenizer、baseline 比较、git-before 保留校验 | 留在 experiments，不成为产品运行依赖 |
| 固定产物列表、固定样本 ID、报告文案、实验启动脚本 | 不迁移，无需兼容包装层 |

## 5. Key Architecture Decisions

### 1. continues：直接依赖 + 一个薄 source 边界

固定已验证的 `continues 4.1.1`，只从公开包入口导入。Core 接收 Margin 的普通数据对象，不接收上游 Context 类型。首期只接 Codex；原始证据补充集中在 source 边界，不重建多个 Agent 的完整 parser。

### 2. 数据模型以事实为单位

```text
Core State:
  schemaVersion
  source { agent, sessionId, checkpointHash, capturedAt, pointer }
  repoTruth { workspace, capturedAt, git, relevantFiles }
  goal: Fact | null
  currentState: Fact[]
  evidence: Evidence[]
  limitations: string[]

Optional State:
  constraints, completed, decisions, failedOrRejected,
  openIssues, changedFiles, tests, nextStep

Fact:
  text
  confidence: Confirmed | Inferred | Uncertain
  evidenceIds[]
  scope: historical | current | proposed
```

`goal=null` 表示未恢复。Optional 字段仅按证据生成，Next Step 可以缺失；已识别的有效约束不能因其字段可选而被裁掉。Tests 保留命令、退出状态和时间；Changed Files 区分历史编辑与当前文件状态。没有测试证据是覆盖限制，不是测试失败。

用量是 Session 展示元信息，不是 Development State 必填字段。Handoff 的估算长度也不进入业务事实模型。

### 3. Confidence 不替代时间范围与证明范围

请求确实出现可以 Confirmed；它仍是当前目标可能只是 Inferred。历史失败、后来成功、当前文件存在分别表达。Git dirty 不归因于原 Session，失败尝试不自动成为 Rejected 决策。历史 running/缺失结果不能直接变成当前阻塞项。

### 4. 一次 Distillation，两种选择策略

采用方案 A。Smart/Detailed 使用同一份结构化状态和证据，不重复推理。Smart 保留有效目标、约束、影响行动的未知项与关键证据；Detailed 增加失败过程、测试细节和必要原文。区别是恢复深度，不是最后 N 条对话。

1K–3K Token 是期望而非截断条件。第一切片只实现 Smart，不预建模式框架。

### 5. 新 Core 独立于旧运行体系

不启动 Pi/Claude，不打开 SQLite，不经过旧 Application Gateway。首期使用已有确定性规则，不为语义提炼不足提前引入 LLM Provider 框架。浮窗负责呈现与复制，用户自行启动目标 Agent 新会话。

## 6. First Refactor Slice

唯一建议任务：**建立“一个真实 Codex Session → 正式 Core → Smart Handoff”的独立 CLI。**

- **目标**：摆脱 Phase 0 产物依赖；用户指定已发现 Session 和实际仓库，即可生成交接。
- **修改范围**：新 Core 目录、一个 CLI、根依赖中固定版本 continues/Acorn、相关 targeted tests、简短说明。
- **调用形态建议**：`--session <id> --repo <path> --out <directory>`。
- **产物**：Smart Markdown、Distilled State、Evidence、Repo Truth、可定位的源快照。
- **不做**：浮窗/UI、实时用量监控、Runtime、数据库迁移、旧功能清理、Detailed、多源接入、模型推理、Benchmark。

### 完成标准

1. 不先运行实验脚本，也能从真实 Session 生成结果；正式代码不导入 experiments。
2. 去掉固定 ID、路径、报告格式与占位章节；未知目标、决策、下一步明确缺失。
3. 保留修改意图、历史成功/失败、未返回状态与当前文件事实的区别；引用可解析。
4. 再次生成时刷新 Git 和相关文件，只写指定输出目录，不执行历史命令。
5. Smart 可直接复制给下一 Agent；关键约束和影响行动的不确定性不会因压缩消失。

### 直接相关测试

- 迁入的 exec、混合结果、缺失/重复 ID、wait/PTY、截断、重试关联断言。
- Repo Truth 文件变化、缺失与历史测试不能升级为当前通过的断言。
- source 到 Smart 的小型管线测试：参数化输入、证据引用、必要信息保留。
- 本机已有真实 Session 一次生成核对。

不运行旧项目全量测试、UI 构建或新评测平台。真实 Continuation Quality 通过后续实际使用自然验证，不另起大型实验。

## 7. Risks / Unknowns

没有必须先解决才能开始第一切片的阻塞问题。实施中有两项具体缺口：

- **原始证据边界尚未正式化**：buildEvidence 直接解释 Codex response_item；迁入时必须消除 phase0Evidence 耦合，否则只是给实验换入口。
- **语义提炼仍有限**：当前 Goal、Decisions、Next Step 不支持任意业务任务的自动恢复承诺。第一切片交付可追溯事实与明确未知，不将固定建议包装成恢复出的下一步。

浮窗宿主、当前 Agent 识别、Token 用量口径与刷新策略属于后续 UI 切片的待定事项，不阻塞上述 Core 切片。

## 8. Recommendation

YES

本记录不代表已开始下一阶段实现；本轮仅新增分析文档。
