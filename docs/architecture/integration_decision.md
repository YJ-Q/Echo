# ADR：Pi 集成方式

状态：阶段 0 已采纳，生产接入待验证。日期：2026-08-20。

## Context

Margin 当前是 JS ESM 的 Express/Electron/SQLite 应用，已有自己的聊天与记忆链路。目标是复用 Pi 的 Agent 运行时，同时让 Margin 对结构化项目状态、跨 Session 记忆、安全控制和评测负责。

## Decision

首选直接集成 `AgentSessionRuntime` SDK。使用 `createAgentSessionServices` 与 `createAgentSessionFromServices` 构造 runtime factory，由 `AgentSessionRuntime` 负责新建、恢复、分支和运行时替换。阶段 0 与现有 `chatService.js` 隔离，只允许 `margin_spike_echo`，Pi 内置工具默认关闭。

## Alternatives 与否决方案

- RPC fallback：保留为未来跨进程隔离或不同语言宿主的备选；当前会增加进程管理、协议错误和部署复杂度，因此不作为 MVP 首选。
- 直接基于低层 `pi-agent-core`：否决。这样会重复构造 Pi 已提供的 Session、工具和压缩生命周期，也会模糊贡献边界。
- 继续只用现有 provider adapter：可保留为 legacy rollback，但不能验证 Pi Session/分支/压缩能力。

## Consequences

- 优点：与现有 Node ESM 技术栈一致；可直接订阅工具与压缩事件；贡献边界清楚。
- 成本：Node 必须升级到 >=22.19.0；需要管理 Pi 认证、模型版本和 SDK 升级；现有 SQLite 状态仍需单独迁移。

## 风险与控制

- 工具越权风险：显式 `noTools: "builtin"` 和唯一工具 allowlist。
- 上游变化风险：精确锁定 v0.84.2/0.84.2，并用安装审计阻止漂移。
- 状态不一致风险：阶段 0 不写生产状态；后续用 event/audit log 和幂等事务处理。
- 凭据风险：不把 token、API key、用户目录或完整对话写入 spike 报告。

## Validation

离线测试必须证明版本、路径和工具边界。真实 spike 必须证明 Session 新建、恢复、分支、压缩和自定义工具调用；缺凭据时明确退出 3，不伪造成功。

## 回滚边界

在生产接入前，可删除新增 Pi runtime 模块、spike 脚本与依赖，现有 `chatService.js` 和 legacy provider path 不受影响。生产接入后必须通过显式 feature flag 回退到 legacy path，不删除或隐式迁移现有用户数据。
