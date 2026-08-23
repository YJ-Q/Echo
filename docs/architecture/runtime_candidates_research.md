# Margin Agent 底座候选资料卡

日期：2026-08-23。状态：第一版事实收集，尚未进入需求加权和选型结论。

## 研究规则

- 优先使用官方仓库、官方文档、许可证和本地可复现证据。
- 仓库 HEAD 只用于固定本次观察时间点，不等于建议采用该 Commit。
- “具备某接口”不等于“适合 Margin”；适配度需要结合用户要求判断。
- 未运行或没有稳定接口保证的能力标记为待验证。

## Pi Agent Harness

- 官方仓库：<https://github.com/earendil-works/pi>；旧地址 `badlogic/pi-mono` 当前重定向到该仓库。
- 本次观察 HEAD：`c1279a65b3ef6b0b19950ed1771d5933241c240f`。
- 许可证：MIT。
- Margin 当前固定依赖：`@earendil-works/pi-coding-agent` `0.84.2`。
- 技术形态：TypeScript/Node monorepo，提供统一模型 API、Agent Core、Coding Agent、TUI，以及 `AgentSession`/`AgentSessionRuntime` SDK 路径。
- 与 Margin 的已有证据：四工具受控适配、Session A/B 连续性、中文召回和终端试点已经真实运行。
- 明确风险：Pi 官方说明不内建文件、进程、网络和凭据的权限隔离；默认继承启动进程权限，需要 Margin 宿主禁用工具或额外沙箱。近期仓库和 npm scope 已发生迁移，需要重新核对上游稳定性与版本策略。
- 待验证：当前新版本相对 `0.84.2` 的兼容变化、长期维护策略、未来前端宿主接口稳定性。

## DeepSeek Harness

- 官方仓库：<https://github.com/deepseek-ai/deepseek-harness>。
- 本次观察 HEAD：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。
- 许可证：MIT。
- 当前成熟度：官方标注 Developer Preview，并明确会发生破坏兼容的变化；仓库说明首个 tagged release 前不承诺兼容，Session 格式版本仍为 `0`。
- 技术形态：TypeScript/Node、基于 Cordis 的全插件架构。模型适配、工具注册、Session 日志、Agent loop、文件系统、审批策略、Web UI 和 headless runner均由插件组合。
- 可能相关的接口：持久 Session 事件流、工具执行前后拦截、Agent 请求拦截、Session fork、Web UI、headless 模式，以及运行时 SDK JSON-RPC 路径。
- 潜在优势（待产品要求验证）：插件边界与 Margin 的可替换 Core 思路相近；官方自带 Web UI 与权限/沙箱扩展点。
- 明确风险：快速迭代和磁盘格式不兼容；插件体系与 Cordis 学习和维护成本；SDK/包边界仍在调整，不能把开发预览能力按稳定产品接口使用。
- 待验证：Windows 运行、第三方模型/YAPI 兼容、最小四工具隔离、宿主确认流程、Session 压缩能力及移动入口适配。

## OpenAI Codex 开源项目

- 官方仓库：<https://github.com/openai/codex>。
- 本次观察 HEAD：`83d1fe0e67b1323f71febc2925817732b449f1d9`。
- 许可证：Apache-2.0。
- 技术形态：核心以 Rust 为主，提供 CLI、桌面/IDE 使用路径、`codex app-server` 双向 JSON-RPC 接口，以及正在发展的 Python SDK。
- 可能相关的接口：thread start/resume/fork、turn start/steer/interrupt、显式审批、沙箱策略、事件流、压缩接口和 App Server UI 宿主协议。
- 潜在优势（待产品要求验证）：线程生命周期、审批和沙箱边界较完整；App Server 本身用于驱动丰富客户端，可能适合后续正式前端。
- 明确风险：Margin 当前是 Node/TypeScript，接入 Codex 更可能经进程/RPC 或 Python SDK，而非现有 Pi 的进程内 SDK；App Server 规模和编码代理默认能力可能显著超过个人连续性 Agent 所需；部分 MCP/API 仍明确标为实验性。
- 待验证：自定义四工具的最小注入方式、非编码任务的系统提示控制、YAPI/Responses 兼容、内置能力关闭程度、Redistributable UI 边界以及 Windows 部署成本。

## 当前可确认但不能据此选型的差异

| 维度 | Pi | DeepSeek Harness | Codex |
| --- | --- | --- | --- |
| Margin 已有适配 | 已有真实终端证据 | 尚无 | 尚无 |
| 主要接入方向 | Node 进程内 SDK | 插件或 JSON-RPC SDK | App Server/RPC 或 Python SDK |
| 官方 UI 路径 | TUI/终端组件 | Web UI | CLI、桌面/IDE及 App Server |
| 许可 | MIT | MIT | Apache-2.0 |
| 当前突出风险 | 权限隔离需宿主补齐、上游迁移 | Developer Preview、兼容性不承诺 | 体量与编码场景偏重、部分接口实验性 |

这张表不包含最终分数。下一步必须先收集用户对产品形态、数据控制、模型/provider、部署、前端、移动访问、开发速度、可维护性和生态依赖的真实要求，再决定哪些候选值得做 spike。

## 一手来源

- Pi repository and SDK: <https://github.com/earendil-works/pi>；<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md>
- Pi license: <https://github.com/earendil-works/pi/blob/main/LICENSE>
- DeepSeek Harness repository and architecture: <https://github.com/deepseek-ai/deepseek-harness>；<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md>
- DeepSeek Harness license and pre-release policy: <https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE>；<https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md>
- Codex repository, App Server and Python SDK: <https://github.com/openai/codex>；<https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>；<https://github.com/openai/codex/blob/main/sdk/python/docs/api-reference.md>
- Codex license: <https://github.com/openai/codex/blob/main/LICENSE>
