# Pi 与 Margin 贡献边界

本表是简历、演示和面试表述的事实边界。状态必须由代码、测试或运行 Trace 支撑。

| Pi 原生能力 | Margin 新增能力 | 尚未实现 |
| --- | --- | --- |
| Agent loop 与模型调用生命周期 | 固定 Pi/Node 基线与可复现审计 | Pi 接入生产 `chatService.js` |
| 工具注册、调用事件和执行结果 | 默认关闭 Pi 内置高风险工具的 allowlist | `memory_search` 正式工具 |
| Session 持久化与恢复 | 将 spike 证据写入脱敏报告 | `memory_propose` 与敏感信息确认 |
| Session 分支、树导航 | 未来将项目/任务/决策与 Session 来源关联 | `state_update` 正式工具 |
| 上下文压缩及压缩事件 | 未来的写入门控、召回门控与冲突提示 | `action_update` 正式工具 |
| AgentSessionRuntime 的新建、切换、分支运行时替换 | A/B/C 冻结评测协议及可复算日志设计 | 双层 Schema、50 个冻结任务、真实用户研究 |

## 表述约束

- 可以说：选型并固定 Pi SDK；设计 Margin 的结构化连续性层；实现隔离、安全的 SDK 验证入口。
- 不可以说：从零实现 Agent loop、Session、分支或压缩。
- 不可以把普通会话摘要称为长期记忆，也不可以把自动化测试数量称为用户价值。
- 在四个 Margin 工具、跨 Session MVP 和基线评测完成前，所有相关条目均保持“尚未实现”。
