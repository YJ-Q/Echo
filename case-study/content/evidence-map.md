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
| E011 | 现有自动化测试在 2026-07-26 本地运行结果为 112/112 通过 | Scenario-validated | test/*.test.js<br>command:npm test | overview,validation |
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
