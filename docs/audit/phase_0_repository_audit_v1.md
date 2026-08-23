# Phase 0 — Margin V1 Repository Audit

日期：2026-08-23
范围：只读审计、Gap Analysis 与规划；未修改生产代码或数据。

## 1. Current Architecture

```text
Terminal Pilot
  scripts/run-terminal-pilot.js
    -> src/pilot/terminalPilotController.js
      -> src/runtime/pi/piTerminalPilotRuntime.js
        -> Pi AgentSession / model / tool lifecycle
      -> src/core/createMarginCore.js
        -> four governed tools
        -> continuity planner / write-routing hint
        -> data/terminal-pilot/margin-core.sqlite

Legacy API compatibility path
  src/server.js -> src/app.js -> routes/services
    -> src/storage/memoryStore.js
    -> data/echo.sqlite
```

当前仓库不是单一架构，而是两条并存链路：新的 Pi + Margin Core 终端试点，以及旧 Express/Echo 业务链。二者使用不同 Schema、不同状态语义和不同数据库；旧 API 没有调用新的 Margin Core。

### 新 Margin Core

- `src/core/`：SQLite Store、迁移、权限、四个工具和审计证据。
- `src/continuity/`：确定性上下文规划、跨 Session harness、四路写入建议。
- `src/runtime/pi/`：Pi SDK 资源隔离、四工具适配、Session 创建与终端运行时。
- `src/pilot/`：单一 `career_project` 的终端控制器。
- `evaluation/stage1/`：10 个冻结种子任务，覆盖 `career_project` 与 `learning_research`；这是 fixture，不是成功率评测。

### 旧兼容链路

- `src/app.js`、`src/routes/`、`src/services/`、`src/storage/memoryStore.js`：旧聊天、学习、行动、摘要、画像、TTS 和管理 API。
- `data/echo.sqlite`：10 张旧表；当前存在少量真实记录。
- 旧链路测试仍占完整测试套件较大比例，但不证明它适合新的 Workstream-first V1。

### 当前数据

- `data/terminal-pilot/margin-core.sqlite`：1 project、1 task、2 actions、1 confirmed memory、9 events、20 audit rows；没有 decision 或 embedding 记录。
- `data/echo.sqlite`：19 conversations、1 learning session、12 learning events、2 actions、1 summary、8 profile rows、6 state rows，以及 proposal/event 记录。
- 两库均需先清单化、导出和决定迁移/归档，不得静默合并或删除。

## 2. Pi Agent / CLI 已有能力

固定基线为 `@earendil-works/pi-coding-agent` `0.84.2`、MIT、Node `22.23.1`。`npm run audit:pi` 已验证声明版本、安装版本、许可证和 runtime 一致。

### 已直接复用的 Pi 能力

- Agent loop 与模型请求生命周期；
- Provider / model 注册；
- Tool 注册、调用与结果事件；
- AgentSession 创建、消息历史和压缩配置；
- 自定义隐藏上下文注入；
- Session dispose 与运行时资源释放。

### Margin 已自研的边界

- `project/task/decision/memory/event/action/audit` 结构化持久化；
- `memory_search`、`memory_propose`、`state_update`、`action_update`；
- 权限决策、宿主确认、项目隔离、乐观版本和审计日志；
- 确定性上下文规划和来源坐标；
- 中文 n-gram 召回与默认关闭的 embedding 接口；
- 终端 `/state`、`/memory`、`/confirm-memory`、`/new`、`/exit`；
- Pi 内置工具关闭和准确四工具 allowlist。

### 当前 CLI 的真实限制

- 只固定运行一个 `career_project`；
- 没有 Workstream 列表、Run、Artifact、Checkpoint、Pause/Stop/Resume；
- `/new` 是新 Session，不是可持久恢复的后台执行 Run；
- 没有 Scheduler、Calendar、Feishu 或 Web Workbench；
- 没有文件工具，因此尚未验证 Human-Agent shared Workspace；
- 终端报告只保存脱敏技术证据，不是完整 Activity 产品记录。

## 3. Verification Evidence

- `npm test`：266/266 通过；
- `npm run validate:stage1`：10 个冻结 fixture 校验通过；
- `npm run audit:pi`：Pi 版本、许可证和 runtime 审计通过；
- `git diff --check`：通过；
- 既有真实 YAPI/Pi 试点已证明 Session A/B、状态、行动、候选记忆确认和中文召回可运行。

这些证据只证明实现行为和最小技术可运行性，不证明 V1 三闭环、可靠性、用户价值或底座最终适配度。

## 4. Reusable Components

| 组件 | 决策 | 理由 |
| --- | --- | --- |
| Pi Session/runtime adapter | 保留为可替换 Runtime Adapter | 已有真实证据；不把 Pi 固化为最终底座 |
| 四个 Margin 工具 | 保留并演进 | 权限、来源、版本和审计边界已稳定 |
| Margin Core Store / migrations | 保留并扩展 | 可作为 Workstream V1 的迁移起点 |
| Event / Audit | 保留并分清语义 | Event 是产品事实；Audit 是调用与授权证据 |
| Decision | 保留并扩展字段 | 已有版本/替代语义，符合长期母版 |
| Memory retrieval / confirmation | 保留 | 已验证保存不等于召回、候选需确认 |
| Context planner | 保留并加入 Workstream/Run/Artifact 来源 | 已有有界、可追溯、底座无关接口 |
| Terminal controller | 保留为 Debug Surface，后续改调统一 Core API | 符合 One Agent / One State / Multiple Surfaces |
| 旧 Express route/service | 冻结，不新增功能 | 与新 Core 分裂；仅作为迁移来源和暂时兼容 |
| 旧 memoryStore / echo.sqlite | 只读清点后迁移或归档 | 含用户数据，不可直接删除或自动混合 |
| TTS、成就、画像等旧功能 | 不进入 V1 主线 | 不直接服务三条核心闭环 |

## 5. Gap Analysis

| V1 要求 | 当前状态 | Gap / 最小处理 |
| --- | --- | --- |
| Persistent Workstream | 部分：project + 单 active task | 增加 Workstream 状态、计划、阻塞、依赖、workspace、autonomy、checkpoint |
| Persistent Run | 缺失 | 新建 Run 模型和状态机；Session 不能代替 Run |
| Artifact | 缺失 | 新建只保存 URI/path/hash/来源的元数据服务 |
| Checkpoint | 缺失 | 新建 checkpoint；V1 先支持 Git ref + state snapshot |
| Event | 部分 | 扩展到 run、artifact、人工接管、文件变化和计划变化 |
| Decision | 部分 | 增加 context、choice、alternatives、rationale、reversibility |
| Pause / Stop / Resume | 缺失 | 作为宿主控制，不通过模型自由文本授权 |
| Shared Workspace | 缺失且当前禁用文件工具 | Phase 3 增加受 Scope 限制的 Workspace capability 与冲突检测 |
| Web Workbench | 缺失 | Phase 2 只建三栏 MVP，不建完整 IDE |
| Feishu Surface | 缺失 | Phase 4 通过统一 API 接入，不保存独立状态 |
| Scheduler / Night Run | 缺失 | Phase 5 用持久队列和 lease/checkpoint，不让 LLM 负责计时 |
| Daily Loop | 缺失 | Phase 6 增加 Calendar ingest、DayPlan、Review 与结构化 brief |
| Multiple Surfaces / one state | 缺失 | 先建立统一 Core Service/API，再接 UI |
| 自动 Domain/项目路由 | 只有写入类型提示 | 延后到 Core/Workstream 稳定后；低置信度必须确认 |
| Secrets 分离 | 仅凭环境变量且未入普通 DB | 保持；正式部署引入 Vault/secret provider |
| 云端长期在线 | 缺失 | 不在 Phase 1 强行迁移；Scheduler/Feishu 前形成部署决策 |
| PostgreSQL | 未使用 | 当前不构成 V1 Phase 1 阻塞；Repository 边界保持可迁移 |

## 6. Minimum Incremental Architecture

```text
Feishu Adapter       Web Workbench       CLI Adapter
       \                  |                  /
                 Margin Application API
                          |
  Workstream | Run | Artifact | Decision/Event | DayPlan
                          |
       Personal State Repository + Scheduler Repository
                          |
          SQLite V1 (single-node) / future PostgreSQL
                          |
                Agent Runtime Adapter
             Pi now; replaceable after review
```

### 架构决定

1. 以现有 Margin Core 为唯一演进起点，不再向旧 Express service 增加业务能力。
2. 先建立底座无关的 Application Service；Pi Adapter 只负责 Session/turn/tool bridge。
3. 将现有 `project` 视为 Workstream 的试点前身。Phase 1 通过版本化迁移保留 ID 和来源，不并行维护两个 Source of Truth。
4. Run 是持久执行单元，Pi Session 只是某个 Run 的运行时引用；两者不能互相替代。
5. Artifact 只保存可验证引用和版本，不把大文件内容塞入状态表。
6. Event append-only；可变实体保存当前投影；Audit 单独保存权限和工具执行证据。
7. Scheduler 只调度持久 Run；模型不能依靠“记得稍后继续”实现后台任务。
8. Phase 1 继续 SQLite 单机模式，先用 repository contract 隔离；在 Feishu/云端部署前依据并发、备份和运维要求决定 PostgreSQL。
9. 外部写入、删除、发布和战略变更默认需要宿主确认；现有四工具权限不会因新增 Surface 自动扩大。

## 7. Risks / Non-blocking Questions

- **双数据源风险**：这是 Phase 1 首要工程风险，必须先导出和明确迁移策略。
- **概念迁移风险**：`project/task/action` 与 `workstream/run/next action` 有重叠，需先冻结词汇和状态机，避免仅改名。
- **底座锁定风险**：当前 Pi 可继续作为试点 runtime，但选型须结合完整 V1 要求和针对性 spike。
- **自动执行风险**：没有持久 lease、幂等键和 checkpoint 前，不得开启真正夜间无人执行。
- **Workspace 风险**：文件修改能力必须在 Phase 3 按目录、Run、动作和 checkpoint 授权，不能恢复 Pi 默认全权限工具。
- **部署问题暂不阻塞 Phase 1**：Cloud Core、PostgreSQL、Feishu 凭据和公开域名在对应 Phase 前形成 ADR。

## 8. Phase 0 Conclusion

指导方案对仓库的核心假设基本成立：Pi + CLI 原型真实存在，并已具备比文档假设更成熟的结构化状态、四工具、安全与召回基础。但它尚不是 Margin V1：当前只是单项目连续性技术试点。

最小正确路线不是重写 Pi，也不是先做 Web 页面，而是先把现有 Margin Core 收敛成统一 Persistent Core，并消除新旧状态链路的双重 Source of Truth。完成 Phase 1 后，才有稳定接口支撑 Web、Workspace、Feishu、Scheduler 和 Daily Loop。

## 9. Runtime Recommendation for V1

根据本次完整 V1 要求，当前推荐 **Pi Agent `0.84.2` 作为 V1 主 Runtime**，但只通过可替换 Adapter 使用：

- 它已经在本仓库完成四工具、Session A/B、provider 和真实终端试点，Phase 1 的增量与风险最小；
- V1 的主要缺口位于 Margin 的 Workstream、Run、Scheduler、Artifact、Surface 和 Personal State，而不是 Agent loop；更换底座不能自动补齐这些核心产品能力；
- DeepSeek Harness 的插件/Web 架构与长期方向相近，但官方仍处 Developer Preview 且明确不承诺兼容，更适合作为 Technology Watch 与隔离 spike；
- Codex 的审批、沙箱、线程和 Workspace 执行更成熟，但产品重心与集成面更偏编码代理，当前更适合作为未来某类 Workspace Worker 候选，而不是直接取代 Personal Work Operating Layer 的主 Runtime。

该推荐不授权把 Margin Core 绑定到 Pi 类型，也不排除后续替换。建议在 Phase 3 Shared Workspace 规格前复查一次 Runtime：届时已经有稳定 Run/Workspace contract，可以用同一接口对 DeepSeek Harness 与 Codex 做有意义的最小 spike。若用户希望现在就冻结最终长期底座，应先单独确认可接受的上游兼容风险、云端部署方式和模型/provider 约束。
