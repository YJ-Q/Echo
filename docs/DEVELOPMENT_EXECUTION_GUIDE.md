# Echo 开发执行文档

日期：2026-07-08

本文档用于：

- 梳理 Echo 当前真实业务逻辑
- 按可交付的小目标拆解功能
- 补充每个目标的特殊边界条件
- 约定公共方法应该放在哪些文件
- 把复杂逻辑按步骤写清楚
- 作为后续 AI 按文档持续开发与补全的统一依据

---

## 1. 当前项目定位

Echo 当前不是“通用聊天机器人”，也不是“任务管理器”。

它现在的核心业务模型是：

1. 用户通过对话输入当下状态
2. 系统分析意图、情绪、标签
3. 系统结合记忆、画像、学习线、行动队列构建上下文
4. 系统给出 Echo 回复
5. 系统把本轮对话沉淀为记忆、状态、画像变化
6. 系统再聚合出“当前下一步该做什么”

一句话概括：

`Chat 是入口，Memory 是沉淀层，State 是聚合层，Learning / Actions / Summary 是结构化延续层。`

随着对话式后台治理与成就系统加入，产品架构需要轻量升级为：

`Chat 是入口，Domain Modules 是业务状态，Domain Events 是事实流，Governance 是安全操作层，Achievements 是成长记录层，State / ViewModels 是统一展示层。`

这不是重写现有架构，而是在现有模块之上补两层：

- 领域事件层
  - 把 learning event、action status、memory operation、summary pattern 等关键事实统一成可被订阅的事件
  - 成就系统、反思系统、状态解释都应从事件事实中派生，而不是互相硬调用

- 成就资产层
  - 成就文案和触发条件按具体学习线 / 任务生成
  - 成就图标不按单个成就逐次生成，而是按事件类型预生成一套小图标资产
  - 单个成就只选择 `icon_type`、`palette_key`、`accent_color` 和文案

### 1.1 产品架构调整原则

- 保留当前 MVP 的简单路由和单存储层，不为了新概念过早拆大模块
- 新增能力必须通过 service 层接入，不让 `chatService`、route 或前端直接承担治理/成就规则
- 先把“事实事件”和“用户确认”做稳，再做自动化执行和复杂展示
- 成就系统只记录和揭示成长，不反向控制用户行为
- 图标资产先统一生成，后续通过颜色和稀有度变化复用，避免资产风格漂移

---

## 2. 当前代码结构与职责分层

### 2.1 入口层

- `src/server.js`
  - 加载环境变量
  - 创建 app
  - 启动 HTTP 服务

- `src/app.js`
  - 注册中间件
  - 初始化存储
  - 挂载静态页面
  - 注册路由
  - 统一错误处理

### 2.2 路由层

- `src/routes/chatRoutes.js`
  - 对外暴露 `POST /chat`
  - 只做参数校验和响应包装

- `src/routes/stateRoutes.js`
  - 对外暴露 `GET /state`

- `src/routes/actionRoutes.js`
  - 对外暴露 Action 读写与状态更新

- `src/routes/learningRoutes.js`
  - 对外暴露学习线读取、事件读取、步骤状态更新

- `src/routes/memoryRoutes.js`
  - 对外暴露记忆、画像、上下文、校准能力

- `src/routes/summaryRoutes.js`
  - 对外暴露每日总结生成与读取

- `src/routes/ttsRoutes.js`
  - 对外暴露文本转语音能力

路由层原则：

- 不写业务推导
- 不直接写 SQL
- 只做请求解析、轻校验、调用 service 或存储层语义化读写方法、返回统一 envelope
- 如果 route 已直接调用 `memoryStore`，只能调用明确命名的存储方法，不允许在 route 中拼 SQL 或新增复杂业务推导

### 2.3 业务服务层

- `src/services/chatService.js`
  - 聊天主编排器
  - 串联输入分析、上下文构建、学习线、回复生成、记忆沉淀、画像更新、解释输出

- `src/services/echoStateEngine.js`
  - 全局聚合状态编排器
  - 输出前端主入口依赖的统一 state

- `src/services/contextBuilder.js`
  - 从记忆、状态、画像、summary、pending action 组装上下文

- `src/services/behaviorDecisionEngine.js`
  - 从上下文中决定 `next_action`

- `src/services/learningEngine.js`
  - 学习线创建
  - 学习进展判断
  - 学习步骤推进

- `src/services/actionEngine.js`
  - 手动 action 创建
  - 基于 state 的建议 action 创建
  - action 状态切换规则

- `src/services/reflectionEngine.js`
  - 每日总结生成

- `src/services/profileEngine.js`
  - 从单轮对话抽取画像信号

- `src/services/profileSynthesisEngine.js`
  - 从多条记忆回写长期画像

- `src/services/memoryDistiller.js`
  - 把一轮对话浓缩成可长期存储的 memory note / insight note

- `src/services/memoryPriorityEngine.js`
  - 决定记忆 salience 和 priority bucket

- `src/services/memoryCalibrationEngine.js`
  - 手动 pin / priority override / profile override

- `src/services/echoAgent.js`
  - LLM provider 适配与 fallback

- `src/services/domainEventEngine.js`
  - 后续建议新增
  - 将 learning / action / memory / operation 等事实标准化为成就、反思和状态解释可复用的事件

- `src/services/achievementIconCatalog.js`
  - 后续建议新增
  - 管理成就图标类型、默认视觉参数、可换色规则和资产路径

### 2.4 存储层

- `src/storage/memoryStore.js`
  - 当前唯一数据访问层
  - 负责 conversations / learning_sessions / learning_events / summaries / actions / user_profile / user_states

存储层原则：

- 所有数据库读写都走这里
- service 不直接写 SQL
- 后续新增实体时优先补充这里，而不是在 service 层拼 SQL

### 2.5 前端层

- `public/app.js`
  - 当前前端主控制器
  - 拉取 state 和各模块数据
  - 驱动 Now / Learn / Actions / Reflections / Memory 视图切换

- `public/index.html`
  - 页面骨架

- `public/styles.css`
  - 页面样式

前端策略：

- 当前前端可以继续作为验证壳使用，但不再继续无边界塞入新复杂模块
- 对话治理与成就系统优先通过 service / API / 终端脚本验证
- 前端信息架构需要单独做 `F0` 重设计，再决定页面新增、删减、合并
- 前端只消费稳定 view model，不自行推导治理候选、成就解锁或图标选择
- 前端 AI 开工前必须阅读 `docs/FRONTEND_DEVELOPMENT_BRIEF.md`
- 前后端分工以 `docs/BACKEND_FRONTEND_SPLIT_GUIDE.md` 为准
- API 契约以 `docs/API_CONTRACTS.md` 为准
- 前端 mock 数据放在 `docs/frontend-mocks/`

---

## 3. 当前主业务链路

### 3.1 聊天主链路

入口文件：

- `src/routes/chatRoutes.js`
- `src/services/chatService.js`

执行步骤：

1. 校验 `message` 不为空
2. `analyzeInput(message)` 识别：
   - `intent`
   - `emotion`
   - `tags`
3. `buildContext(message)` 拉取：
   - relevant memories
   - recent memories
   - user states
   - user profile
   - pending actions
   - recent summaries
4. 如果 `intent === learning`
   - `prepareLearningSession(message)`
   - 新建或复用学习线
5. 否则
   - `assessLearningProgress(message)`
   - 尝试判断当前消息是否在推进已有学习线
6. `generateEchoResponse(...)`
   - 优先使用配置的 provider
   - provider 失败时回退本地回复
7. `updateUserState(analysis)`
8. `updateProfileFromInteraction(message, analysis)`
9. `getEchoState(message)` 计算当前全局状态
10. `distillInteractionMemory(...)` 生成：
    - `memory_note`
    - `insight_note`
11. `deriveMemoryPriority(...)` 生成：
    - `salience`
    - `priority_bucket`
12. `addMemory(...)` 写入对话记忆
13. `synthesizeProfileFromMemories(...)` 回写长期画像
14. `buildChatExplanation(...)` 输出可解释信息
15. 返回 chat 结果

### 3.1.1 当前主链路的已知问题

- 学习线存在时，普通闲聊可能被误判为学习推进
- topic extraction 已有基础精修，后续仍需补充更多自然语言边界
- `handleChat()` 当前串联职责较多，后续需要拆成更清晰的 orchestration 步骤

### 3.1.2 后续改造要求

- 不允许在 route 层堆业务逻辑
- 不允许在前端自行推导学习状态
- chat 的返回结构必须继续兼容当前前端

---

### 3.2 State 聚合链路

入口文件：

- `src/routes/stateRoutes.js`
- `src/services/echoStateEngine.js`

执行步骤：

1. `buildContext(query)`
2. 取最近记忆
3. 取激活学习线
4. 取最近总结
5. 取 active / pending actions
6. 取 user profile
7. 取 user states
8. `summarizeProfile(userProfile)`
9. `decideNextAction(...)`
10. `explainDecision(nextAction)`
11. 组装：
    - `current_state`
    - `next_action`
    - `current_action`
    - `current_learning`
    - `current_reflection`
    - `current_memory`
    - `decision`
    - `explain`
12. 返回聚合 state

### 3.2.1 当前业务意义

`/state` 不是数据库原样返回，而是“面向前端页面的聚合 view model”。

因此后续开发中：

- 新增页面依赖字段，优先补到 state engine 或对应 view model
- 不要把前端需要的推导逻辑散落到 `public/app.js`

---

### 3.3 Learning 链路

核心文件：

- `src/services/learningEngine.js`
- `src/routes/learningRoutes.js`
- `src/services/learningViewModel.js`

当前能力：

- 根据学习意图创建学习线
- 复用同主题 active session
- 自动生成 4 步学习步骤
- topic extraction 会清理常见连接词、空主题 fallback，并标准化 JS / TS / Node 等常见技术别名
- 学习推进前先做 topic / step 相关性 gating，避免普通闲聊误推进
- 对输入做 `complete / stuck / partial / ignore` 分类
- 最后一步完成后 session 进入 `completed`，不再被 active learning 查询继续推进
- 手动更新步骤状态
- 手动步骤更新越界时返回明确错误，不写入无效 learning event
- 通过统一事件工厂记录 learning event，自动/手动事件共享标准字段、类型和原因文案

执行步骤：

1. 提取 topic
2. 查找同 topic active session
3. 没有则创建新 session
4. 每轮学习回复先判断是否与当前 topic / step 相关
5. 相关时再尝试判定：
   - 完成
   - 卡住
   - 部分推进
   - 忽略
6. 写 learning event
7. 更新 session current_step / step status
8. 通过 `buildLearningViewModel()` 输出给前端

### 3.3.1 当前最重要边界条件

- 只有“确实与学习线相关”的输入才允许推进学习线
- 同一时间仅允许一条主 active learning line 成为 `current_learning`
- topic 为空时必须有稳定 fallback
- 完成最后一步后 session 已进入 completed，而不是停留在 active 假完成
- 手动步骤更新越界已拒绝并避免写入脏事件，后续仍可补更细的人工回滚规则

### 3.3.2 当前应优先补强的规则

1. 学习推进前置 gating 精修
   - 已有基础版：先判断消息是否与当前学习 topic 或 step 相关，再做 `complete / stuck / partial`
   - 后续继续补充更细的 topic alias、跨主题识别与极端短句处理

2. 完成判断更严格
   - 已有基础版：裸 “done / 完成” 不再直接推进
   - 需要结合上下文，避免“我今天完成了工作，但不是这个学习步骤”被误判

3. ignore 判断更完整
   - 已有基础版：纯确认、普通闲聊、明显换话题不推进
   - 情绪聊天
   - 纯问候
   - 完全换话题
   - 极短回复

### 3.3.3 推荐拆分的小目标

- `L1` 学习推进 gating（基础版已完成，后续可继续精修）
- `L2` topic extraction 精修（基础版已完成，后续补更多自然语言样例）
- `L3` session 完结状态处理（基础版已完成，后续补人工回滚/重开规则）
- `L4` 学习事件标准化（基础版已完成，后续补前端解释映射）
- `L5` 学习线相关测试补齐

---

### 3.4 Action 链路

核心文件：

- `src/services/actionEngine.js`
- `src/services/behaviorDecisionEngine.js`
- `src/routes/actionRoutes.js`

当前能力：

- 手动创建 action
- 基于 `/state.next_action` 生成建议 action
- 按 `type + title + source` 复用未完成的同类 action
- suggested action 会写入并复用稳定 `metadata.suggested_identity`，标题轻微变化时也能复用同一建议
- 保证只有一个 active action
- action 排序与 `/state.current_action` 主任务选择已统一：active 优先 pending，priority 数字越小越优先，同级按更新时间、创建时间、id 稳定排序
- 带 `learning_session_id` / `learning_step_index` metadata 的 action 完成后，会保守同步对应 learning step 并写入可被 summary 识别的 learning event

执行步骤：

1. 从 state 获取 `next_action`
2. 将 `next_action` 规范化为 action 数据
3. 创建或复用 action
4. 切换 action 状态时，将其他 active action 降回 pending

### 3.4.1 边界条件

- action 标题为空时必须有 fallback
- 不允许出现多个 active actions
- `dismissed` action 不应再被前端当成主任务
- `done / dismissed` 不参与 current action 选择
- 多个 active 脏数据存在时，主任务选择必须稳定且可解释
- 基于 state 生成的 suggested action 需要幂等，避免重复生成垃圾数据
- `resume_pending_action` 场景下优先复用现有 echo_state action
- 普通 action 完成不应误推进 learning；同一个 action 重复 `done` 不应重复写 learning event
- learning metadata 缺失、session 不存在或 step 越界时，action 状态更新仍应稳定完成，并跳过 learning 联动

### 3.4.2 推荐拆分的小目标

- `A1` 建议 action 幂等增强（基础版已完成，后续补更新旧 action 的策略）
- `A2` action 排序规则统一（基础版已完成，后续可补 due_at 权重）
- `A3` action completion 后与 learning / summary 的联动规则（基础版已完成，后续可补 action-specific event type）
- `A4` action 测试补齐（基础版已完成，后续随 action 新规则补回归）

---

### 3.5 Memory 链路

核心文件：

- `src/services/contextBuilder.js`
- `src/services/memoryDistiller.js`
- `src/services/memoryPriorityEngine.js`
- `src/services/memoryCalibrationEngine.js`
- `src/services/memoryViewModel.js`
- `src/storage/memoryStore.js`

当前能力：

- 存储 conversations 记忆
- 抽取 distilled memory note / insight note
- 计算 salience / reinforcement / priority bucket
- relevant memory 检索时自动强化
- relevant memory ranking 已加入 channel 权重与最终排序，避免低分近期记忆压过直接话题命中
- retrieval channel 已补充中文 label / reason 与 per-memory explanation，可服务前端解释与 prompt context
- memory context 已显式区分长期锚点、当前工作记忆、近期线程和背景信号
- 手动 pin / priority 校准
- 输出 memory view model

执行步骤：

1. 对话完成后写 conversation memory
2. 生成 memory note 和 insight note
3. 计算优先级
4. 后续检索 relevant memory 时进行 salience 强化
5. `buildContext()` 将其注入 prompt context 和聚合 summary

### 3.5.1 边界条件

- 空记忆池时 `/memory`、`/memory/context`、`/state` 都必须稳定返回
- relevance 命中为空时不能报错
- pinned memory 强化规则优先级必须高于普通记忆
- 直接话题命中和学习连续性应优先于仅因近期或情绪相似被召回的记忆
- relevant memory 返回时应能解释“为什么被召回”，且解释缺失不能破坏旧字段
- 长短期分层必须保持旧字段兼容：新增 `memory_layers` 或等价结构，不能移除 `relevantMemories` / `recentMemories`
- 手动优先级校准不能破坏数据库中的数值边界
- memory calibration 测试必须覆盖不存在 memory、无效 id、越界 salience / reinforcement_count、profile override 缺参
- memory note 与 insight note 不能完全依赖 LLM，当前应保持规则生成可落地

### 3.5.2 推荐拆分的小目标

- `M1` relevant memory ranking 规则细化（基础版已完成，后续补更细的衰减/去重策略）
- `M2` retrieval channel 解释增强（基础版已完成，后续补前端展示映射）
- `M3` 长短期记忆分层规则补充（基础版已完成，后续调优 working 阈值）
- `M4` memory calibration 测试补齐（基础版已完成，后续补 service 单测）

---

### 3.6 Summary / Reflection 链路

核心文件：

- `src/services/reflectionEngine.js`
- `src/services/reflectionViewModel.js`
- `src/routes/summaryRoutes.js`

当前能力：

- 按日生成 summary
- 同一天幂等
- 结合 memory 与 learning events 产出 reflection
- summary 文案应偏向延续性反思，而不是机械统计报表
- recent reflection 可在没有更强学习/行动信号时影响 `/state.next_action`
- state explain 会暴露 `reflection_signal`，说明最近 reflection 是参与了决策，还是被更强信号覆盖

执行步骤：

1. 读取当天 memories
2. 读取当天 learning events
3. 统计 emotion / tag / event
4. 提炼 facts
5. 检测 behavioral pattern
6. 基于 facts / pattern / rendering 三层生成：
   - summary
   - emotional_trend
   - behavioral_pattern
   - echo_reflection
7. 保存 summary
8. 通过 `buildReflectionViewModel()` 输出给前端

### 3.6.1 边界条件

- 当天无数据时也必须生成稳定 summary
- 同一天重复生成 summary 必须幂等
- 不允许因为单条异常数据导致整天 summary 崩掉
- summary 文案不能把“卡住”误写成“失败”
- summary 可以保留少量计数事实，但不能只输出“X 次对话 / X 个行动痕迹”的机械统计
- reflection pattern 测试已覆盖 planning_without_action、start_line_procrastination、future_pressure、learning_loop_closed 与 specific_friction
- reflection 影响 state 时必须让 active learning、pending echo action 等更强信号优先
- state explain 需要说明 recent reflection 是否参与了决策

### 3.6.2 推荐拆分的小目标

- `R1` summary 模板去机械化（基础版已完成，后续补更多 pattern 文案）
- `R2` summary 与 state 决策联动增强（基础版已完成，后续可补前端展示映射）
- `R3` reflection 测试覆盖更多 pattern（基础版已完成，后续随新增 pattern 继续补样例）

---

### 3.7 Profile 链路

核心文件：

- `src/services/profileEngine.js`
- `src/services/profileSynthesisEngine.js`
- `src/services/profileDictionary.js`
- `src/routes/memoryRoutes.js`

当前能力：

- 从单轮输入抽取画像信号
- 从历史记忆回写更稳定的长期画像
- 支持 profile override
- profile signal 写入已通过 merge 规则保护高置信度画像，普通低置信度信号不会直接覆盖人工校准
- 手动 profile override 会作为人工校准强制覆盖同 key 旧值
- 长期画像 synthesis 已加入样本数、比例与主题多数门槛，避免少量偶然记忆过早写入长期结论
- profile key / value 的中文展示与基础元信息已集中到 `profileDictionary`

### 3.7.1 边界条件

- profile signal 必须可累积，不应被低置信度输入频繁污染
- 同一 key 更新需要保留置信度演化
- 同一 key 出现冲突时，应优先保护高置信度旧值；只有明显更强信号或手动 override 才替换
- sustained learning topic 需要稳定重复且明显领先，不应在主题并列或样本太少时写入
- emotional baseline / recovery path 需要满足最低样本数和比例门槛，不应从低样本偶然情绪中定型
- profile 字典化不能阻止未知 key 的手动 override；未知 key 应保留稳定 fallback
- summary / state / context 对 profile 的依赖必须允许字段缺失

### 3.7.2 推荐拆分的小目标

- `P1` profile signal 冲突合并规则（基础版已完成，后续可补 profile key 分类策略）
- `P2` 长期画像稳定性增强（基础版已完成，后续可补更多 synthesis 场景）
- `P3` 画像字段字典化（基础版已完成，后续可补字段来源/权限策略）

---

### 3.8 TTS 链路

核心文件：

- `src/routes/ttsRoutes.js`
- `src/services/ttsProvider.js`
- `src/services/ttsErrors.js`

当前能力：

- 文本转语音
- 未配置 `SILICONFLOW_API_KEY` 时明确失败
- TTS provider 支持通过环境变量覆盖 SiliconFlow base URL、model、voice、response format、speed
- TTS provider 暴露非敏感元信息用于排查，不暴露 API key
- provider HTTP 错误、JSON 非音频响应、空音频 payload 与请求失败都会返回稳定错误码
- route 层只把 `TtsProviderError` 转换为统一 API envelope，未知错误继续交给全局错误处理中间件

### 3.8.1 边界条件

- 空文本禁止请求 provider
- TTS 配置缺失或 provider 不支持时必须稳定返回 unavailable
- `SILICONFLOW_TTS_SPEED` 无效时回退默认值
- `SILICONFLOW_TTS_RESPONSE_FORMAT` 应匹配返回 audio MIME type
- provider 返回 JSON 但状态码 200 时仍要视为错误
- 空音频 payload 必须拒绝
- provider 非 2xx 响应必须返回 `tts_provider_http_error`
- provider 请求阶段失败必须返回 `tts_provider_request_failed`
- 前端必须通过 `/api.capabilities.tts` 控制入口显隐

### 3.8.2 推荐拆分的小目标

- `T1` TTS provider 配置扩展（基础版已完成，后续可接多 provider）
- `T2` 更细致的错误码（基础版已完成，后续可补 timeout / retry 分类）
- `T3` 前端播放状态恢复与失败提示增强（基础版已完成，后续可补播放进度与停止按钮）

---

### 3.9 对话式后台治理链路

目标：

让用户可以通过对话管理 Echo 的结构化后台数据，包括记忆、学习线、任务和后续成就记录。

典型输入：

- “你帮我梳理一下当前的学习线路，我们一起讨论修改或者删除”
- “我需要你帮我清理一下旧的记忆存档，删除冗余的部分”
- “把这些重复任务整理一下，留下真正需要继续的”

核心原则：

- 对话可以发起治理，但不能直接绕过安全协议修改数据
- 默认流程必须是：识别意图 -> 生成操作草案 -> 用户确认 -> 执行 -> 记录操作事件
- 对破坏性操作默认优先 `archive` / `dismiss` / `merge`，真正 `delete` 需要更明确的确认
- Echo 的建议必须可解释：为什么保留、归档、合并、重命名或删除
- 所有执行后的变化必须写入操作事件，便于回看和撤销策略设计

建议新增核心文件：

- `src/services/managementIntentEngine.js`
  - 已新增
  - 识别用户是否在请求管理 memory / learning / actions / achievements

- `src/services/operationProposalEngine.js`
  - 基于当前数据生成待确认的操作草案
  - 只产出 proposal，不直接执行

- `src/services/managementOverviewEngine.js`
  - 已新增
  - 生成 memory / learning / actions 的只读治理摘要、候选和建议

- `src/services/operationExecutor.js`
  - 在用户确认后执行被允许的操作
  - 统一写操作事件

- `src/services/operationViewModel.js`
  - 面向前端展示草案、风险、确认状态和执行结果

建议新增数据概念：

- `operation_proposals`
  - `id`
  - `scope`: `memory` / `learning` / `actions` / `achievements`
  - `status`: `draft` / `awaiting_confirmation` / `confirmed` / `executed` / `cancelled`
  - `summary`
  - `operations_json`
  - `risk_level`
  - `created_at`
  - `confirmed_at`

- `operation_events`
  - `id`
  - `proposal_id`
  - `operation_type`
  - `target_type`
  - `target_id`
  - `before_json`
  - `after_json`
  - `reason`
  - `created_at`

### 3.9.1 治理能力边界

- 记忆清理第一版优先支持：
  - 归档低价值旧记忆
  - 合并重复记忆
  - 调整 pin / priority
  - 删除必须二次确认

- 学习线整理第一版优先支持：
  - 列出 active / completed / stale 学习线
  - 重命名学习线
  - 暂停或归档旧学习线
  - 删除无进展学习线时必须确认

- 任务整理第一版优先支持：
  - 合并重复 pending action
  - dismiss 过期任务
  - 调整 priority
  - 保证 active action 唯一性

### 3.9.2 推荐拆分的小目标

- `G1` 对话治理意图识别与只读梳理（基础版已完成，后续继续补更细候选规则）
- `G2` 操作草案 proposal 数据模型
- `G3` 用户确认后执行安全操作
- `G4` 记忆清理候选生成
- `G5` 学习线与任务整理候选生成
- `G6` 操作事件与可回看审计记录

---

### 3.10 成就系统链路

目标：

建立类似单机游戏 / Steam 的成就系统。成就不提供积分压力，主要用于记录用户成长，并在关键事件或特殊事件发生时带来轻微惊喜感。

核心体验：

- 新建学习线或任务时，系统可生成一组待解锁成就
- 完成学习步骤、任务、学习线、恢复推进、整理记忆等事件时触发解锁判断
- 部分成就是公开待解锁，部分成就是隐藏成就，只在达成后揭示
- 成就文案由系统内部生成，必须贴合主题和用户当时的成长语境
- 成就图表第一版先保存结构化 visual spec，后续可以由 CSS / SVG / 图片生成器渲染

成就不应该做成：

- 连续打卡压力
- 排行榜
- 积分与等级压迫
- 把用户没完成的事包装成失败

成就应该更像：

- “你走过这里”的档案
- 一次特殊行为被系统看见
- 某条学习线或任务线里的纪念章
- 隐藏事件触发时的轻量惊喜

建议新增核心文件：

- `src/services/achievementGenerator.js`
  - 在 learning session / action 创建时生成主题相关成就定义

- `src/services/achievementEngine.js`
  - 根据 learning event / action status / memory operation / summary pattern 判断解锁

- `src/services/achievementViewModel.js`
  - 输出成就墙、当前学习线成就、最近解锁成就

- `src/services/achievementIconCatalog.js`
  - 根据事件类型选择统一图标资产、默认配色和可换色参数

建议新增数据概念：

- `achievements`
  - `id`
  - `source_type`: `learning_session` / `action` / `memory` / `global`
  - `source_id`
  - `key`
  - `title`
  - `description`
  - `locked_description`
  - `trigger_type`
  - `trigger_json`
  - `rarity`: `common` / `rare` / `secret` / `core`
  - `hidden`
  - `visual_json`
  - `icon_type`
  - `palette_key`
  - `accent_color`
  - `created_at`

- `achievement_unlocks`
  - `id`
  - `achievement_id`
  - `event_type`
  - `event_id`
  - `unlock_reason`
  - `unlocked_at`

### 3.10.1 成就类型设计

- 学习线成就：
  - 新建学习线
  - 完成第一步
  - 从卡住状态恢复
  - 完成最后一步
  - 在同一主题上跨天继续

- 任务成就：
  - 创建第一个手动任务
  - 完成一个被 Echo 建议的任务
  - 清理重复任务
  - 把一个模糊动作改写成明确动作

- 记忆治理成就：
  - 第一次整理旧记忆
  - 合并重复记忆
  - 置顶长期锚点
  - 从旧记忆中恢复一条学习主线

- 隐藏 / 特殊成就：
  - 长时间中断后重新接回同一学习线
  - 多次卡住后完成一个闭环
  - 清理掉一批不再代表当前自己的旧线索
  - 将一个重复出现的焦虑模式转化成可执行任务

### 3.10.2 成就视觉结构

成就图标不应该每次生成成就时临时生成。第一版建议先总结成就事件类型，然后统一用 image generation 生成一套“小图标资产库”。后续生成具体成就时，只选择对应 `icon_type`，再填入不同颜色、稀有度和文案。

这样做的好处：

- 风格统一，成就墙不会显得杂乱
- 资产数量可控，避免每条学习线都生成一堆不可复用图片
- 解锁成就时可以快速展示，不依赖实时图片生成
- 同一事件类型可以通过颜色表现主题、稀有度或来源

第一版视觉字段：

- `icon_type`: 成就事件类型图标
- `symbol`: `doorway` / `spark` / `loop` / `anchor` / `map` / `key`
- `tone`: `calm` / `bright` / `quiet_rare` / `secret`
- `palette`: `blue_warm` / `gold_soft` / `ink_silver` / `green_growth`
- `shape`: `badge` / `medal` / `stamp` / `sigil`
- `asset_path`: 预生成图标资产路径
- `accent_color`: 当前成就可替换的强调色
- `prompt`: 后续接图片生成器或 SVG 生成器时使用的视觉提示

### 3.10.3 成就事件图标类型

建议先生成下列通用图标类型，每个类型一张基础透明 PNG 或 SVG-like bitmap，优先做单色 / 双色 / 高对比轮廓，方便后续换色：

| `icon_type` | 事件含义 | 默认象征 | 适用成就 |
| --- | --- | --- | --- |
| `new_path` | 新建学习线或新方向 | 打开的门、地图起点 | 创建学习线、开启新主题 |
| `first_step` | 完成第一步 | 脚印、第一块拼图 | 学习第一步、任务首次推进 |
| `step_chain` | 连续推进 | 串联节点、轨道 | 多步骤学习、连续执行 |
| `breakthrough` | 从卡住中突破 | 裂开的石头、破开的结 | stuck 后恢复 |
| `completion` | 完成闭环 | 闭合圆环、徽章印章 | 完成任务、完成学习线 |
| `returning` | 中断后回归 | 回旋箭头、重新点亮的灯 | 长时间后接回主线 |
| `focus_shift` | 把模糊变清楚 | 镜头对焦、指南针 | 模糊任务被改写成明确行动 |
| `echo_action` | 完成 Echo 建议任务 | 小旗、确认标记 | suggested action done |
| `memory_anchor` | 固定长期记忆 | 锚点、书签 | pin 记忆、长期锚点 |
| `memory_cleanse` | 清理旧记忆 | 整理盒、归档夹 | 归档、合并、清理冗余记忆 |
| `reflection_loop` | 完成反思闭环 | 月相环、回声波纹 | summary / reflection 触发 |
| `hidden_spark` | 隐藏特殊事件 | 闪光、锁孔、星点 | hidden / secret achievement |
| `profile_growth` | 画像稳定成长 | 年轮、树枝 | profile signal 稳定形成 |
| `resilience` | 多次尝试后完成 | 折线回升、修复痕迹 | 多次卡住后完成 |

图标生成要求：

- 每个 `icon_type` 只生成一套基础资产，不为每个成就单独生成图
- 建议输出透明背景、居中、方形比例，方便在成就墙中统一排版
- 图标应支持前端通过 CSS mask / filter / duotone overlay 换色
- 如果使用 bitmap，优先生成高分辨率原图，再导出小尺寸缓存
- 隐藏成就未解锁前使用统一 `hidden_spark` 或锁定态图标，不暴露真实图标

### 3.10.4 成就配色策略

成就颜色不直接等于事件类型，而用于表达主题和稀有度：

- `blue_warm`
  - 默认学习线和普通推进

- `gold_soft`
  - 完成闭环、重要里程碑

- `green_growth`
  - 恢复、成长、长期画像稳定

- `ink_silver`
  - 记忆整理、归档、旧线索清理

- `violet_secret`
  - 隐藏成就、特殊事件

单个成就生成时：

1. 根据触发事件选择 `icon_type`
2. 根据来源和稀有度选择 `palette_key`
3. 根据 topic 或 action 生成 `accent_color`
4. 只生成文案和 visual spec，不实时生成新图片

### 3.10.5 推荐拆分的小目标

- `ACH1` 成就数据模型与基础 API
- `ACH2` learning session 创建时生成待解锁成就
- `ACH3` learning event / action done 触发成就解锁
- `ACH4` 隐藏成就与特殊事件规则
- `ACH5` 成就墙 view model 与前端展示
- `ACH6` 成就事件图标类型库与 image generation 批量资产
- `ACH7` 成就视觉 spec 渲染与换色

---

## 4. 功能拆解与建议开发顺序

后续开发建议严格按下列顺序推进，每次只完成一个小目标，并同时补测试与文档。

### Phase 1: 稳定主业务链

1. `L1` 学习推进 gating
2. `L2` topic extraction 精修
3. `L3` learning session 完结状态处理
4. `A1` suggested action 幂等增强
5. `M1` relevant memory ranking 细化

### Phase 2: 强化结构化模块

1. `R1` summary 模板优化
2. `P1` profile signal 冲突合并
3. `A2` action 排序与主任务选择统一
4. `M2` retrieval channel 解释增强

### Phase 3: 收口前端与体验

0. `F0` 前端信息架构重设计
   - 基础版已完成，详见 `docs/FRONTEND_INFORMATION_ARCHITECTURE.md`
   - 前端交接详见 `docs/FRONTEND_DEVELOPMENT_BRIEF.md`
   - 只做页面职责、导航、模块增删和 view model 依赖设计
   - 不阻塞 G1 / ACH1 的终端/API 验证
1. `T3` TTS 交互体验补全
   - 基础版已完成
   - 后续可补播放进度、停止按钮与更细的重试策略
2. 前端错误提示一致化
3. 前端 loading / empty / partial failure 状态统一
4. state 到页面的字段映射收口

### Phase 4: 对话治理与成长记录

1. `G1` 对话治理意图识别与只读梳理
   - 基础版已完成
   - 必须支持终端/API 验证
2. `G2` 操作草案 proposal 数据模型
   - 必须支持终端/API 验证
3. `G3` 用户确认后执行安全操作
   - 必须支持终端/API 验证
4. `ACH1` 成就数据模型与基础 API
   - 必须支持终端/API 验证
5. `ACH2` learning session 创建时生成待解锁成就
   - 必须支持终端/API 验证
6. `ACH6` 成就事件图标类型库与 image generation 批量资产
7. `ACH3` learning event / action done 触发成就解锁
   - 必须支持终端/API 验证
8. `ACH4` 隐藏成就与特殊事件规则

---

## 5. 公共方法归位约定

后续 AI 开发时，新增公共逻辑必须按职责放置，不允许随手塞进现有大文件。

### 5.1 输入分析类方法

应该放：

- `src/services/inputAnalyzer.js`

适合放入的方法：

- 意图识别
- 情绪识别
- 标签识别
- 与具体业务状态无关的文本归一化、关键词识别、语言检测

不应该放：

- 数据库操作
- 回复生成
- 前端展示文案

### 5.2 学习线规则类方法

应该放：

- `src/services/learningEngine.js`

适合放入的方法：

- session 复用判断
- step 推进判断
- 学习完成判断
- 依赖 session / topic / step 的学习相关性 gating

如果文件继续变大：

- 新建 `src/services/learningProgressRules.js`
- 新建 `src/services/learningSessionFactory.js`

### 5.3 State 决策类方法

应该放：

- `src/services/behaviorDecisionEngine.js`
- `src/services/echoStateEngine.js`

职责边界：

- `behaviorDecisionEngine.js`
  - 只负责“怎么决定下一步”

- `echoStateEngine.js`
  - 只负责“怎么组装最终 state”

### 5.4 记忆摘要与优先级类方法

应该放：

- `src/services/memoryDistiller.js`
- `src/services/memoryPriorityEngine.js`
- `src/services/contextBuilder.js`

职责边界：

- `memoryDistiller.js`
  - 单轮对话如何沉淀

- `memoryPriorityEngine.js`
  - 沉淀后优先级如何算

- `contextBuilder.js`
  - 已有记忆如何被重新取回

### 5.5 ViewModel 类方法

应该放：

- `src/services/learningViewModel.js`
- `src/services/memoryViewModel.js`
- `src/services/reflectionViewModel.js`

规则：

- 面向前端页面展示的数据拼装，尽量放在 view model 文件
- 不要让 `public/app.js` 承担复杂字段转换

### 5.6 数据访问方法

应该放：

- `src/storage/memoryStore.js`

规则：

- 所有 SQL 统一收口在存储层
- service 层只调用语义化方法

如果继续扩张：

- 可拆为：
  - `src/storage/conversationStore.js`
  - `src/storage/learningStore.js`
  - `src/storage/actionStore.js`
  - `src/storage/profileStore.js`
  - `src/storage/summaryStore.js`

### 5.7 对话治理类方法

应该放：

- `src/services/managementIntentEngine.js`
- `src/services/managementOverviewEngine.js`
- `src/services/operationProposalEngine.js`
- `src/services/operationExecutor.js`
- `src/services/operationViewModel.js`

职责边界：

- `managementIntentEngine.js`
  - 只判断用户是否在请求治理后台数据，以及治理范围

- `managementOverviewEngine.js`
  - 只生成只读 overview、candidates 和 recommendations
  - 不创建 proposal，不执行写操作

- `operationProposalEngine.js`
  - 只生成草案，不执行写操作

- `operationExecutor.js`
  - 只执行已经确认的 proposal，并写操作事件

- `operationViewModel.js`
  - 只负责把 proposal / events 转成前端可展示结构

禁止：

- 在 `chatService.js` 里直接删除 memory / learning session / action
- 在 `public/app.js` 里自行判断哪些记忆应该删除
- 未经 confirmation 直接执行破坏性操作

### 5.8 成就系统类方法

应该放：

- `src/services/achievementGenerator.js`
- `src/services/achievementEngine.js`
- `src/services/achievementViewModel.js`
- `src/services/achievementIconCatalog.js`

职责边界：

- `achievementGenerator.js`
  - 根据新 learning session / action 生成成就定义和 visual spec

- `achievementEngine.js`
  - 根据事件判断是否解锁成就，保证幂等

- `achievementViewModel.js`
  - 输出成就墙、最近解锁、当前学习线成就

- `achievementIconCatalog.js`
  - 管理 `icon_type` 到资产路径、默认 symbol、默认 palette、换色规则的映射
  - 不根据单个成就实时生成图片

禁止：

- 在前端硬编码成就解锁规则
- 用积分或排行榜作为第一版核心机制
- 让成就解锁依赖不可复现的纯 LLM 判断；LLM 可参与文案生成，但触发条件必须结构化
- 每个成就单独生成一张风格不一致的图标

### 5.9 领域事件类方法

应该放：

- `src/services/domainEventEngine.js`

职责边界：

- 把 learning event、action status change、operation event、summary pattern 等事实标准化
- 给 achievement / reflection / explainability 提供统一事件输入
- 不直接决定成就是否解锁，不直接写成就表

第一版可以先不引入复杂事件总线，只提供语义化 helper：

- `buildDomainEventFromLearningEvent(event)`
- `buildDomainEventFromAction(action, previousStatus)`
- `buildDomainEventFromOperationEvent(event)`
- `normalizeDomainEvent(event)`

---

## 5A. 终端 / API 优先验证原则

在前端信息架构重新设计完成前，所有新增核心能力必须先保证可以通过终端或 API 验证。

原则：

- service 是真实能力来源
- API 返回稳定 envelope 和 view model
- 终端脚本用于本地验证、调试和演示
- 前端只在 view model 稳定后接入，不提前承载复杂业务规则

适用模块：

- 对话治理：G1 / G2 / G3 / G4 / G5 / G6
- 成就系统：ACH1 / ACH2 / ACH3 / ACH4 / ACH6 / ACH7
- 后续涉及数据修改、事件触发、成就解锁的能力

建议 API：

- `GET /management/overview?scope=learning|memory|actions|all`
  - 返回只读治理摘要、候选和建议

- `GET /management/proposals`
  - 返回待确认 operation proposals

- `POST /management/proposals`
  - 创建 proposal，不执行

- `POST /management/proposals/:id/confirm`
  - 用户确认后执行允许的操作

- `GET /achievements`
  - 返回成就墙 view model

- `GET /achievements/recent`
  - 返回最近解锁成就

- `GET /achievements/icons`
  - 返回成就图标类型 catalog

建议终端脚本：

- 已新增 `scripts/inspect-management.js --scope learning`
- 已新增 `scripts/inspect-management.js --scope memory`
- 已新增 `scripts/inspect-management.js --scope actions`
- `scripts/inspect-operation-proposals.js`
- `scripts/inspect-achievements.js`
- `scripts/inspect-achievement-icons.js`

终端脚本要求：

- 只调用 service 或 API，不复制业务规则
- 输出 JSON 或清晰的表格摘要
- 对破坏性操作默认 dry-run
- 支持 `--json`，方便后续自动化检查

前端 mock fixtures：

- `docs/frontend-mocks/management-overview-learning.json`
- `docs/frontend-mocks/management-overview-memory.json`
- `docs/frontend-mocks/management-overview-actions.json`
- `docs/frontend-mocks/operation-proposals.json`
- `docs/frontend-mocks/achievements.json`
- `docs/frontend-mocks/achievements-recent.json`
- `docs/frontend-mocks/achievement-icons.json`

---

## 6. 复杂逻辑的步骤说明

### 6.1 学习推进判断

目标：

避免“只要有 active learning session，长一点的输入就算学习推进”。

推荐步骤：

1. 先取当前 active session
2. 如果没有 active session，直接返回 `ignore`
3. 判断输入是否与当前学习 topic / step 相关
4. 如果不相关，返回 `ignore`
5. 如果相关，再判断是否为：
   - explicit completion
   - explicit stuck
   - substantive partial
6. 根据判断写 learning event
7. 再更新 step 状态

推荐新增方法：

- 已新增 `isLearningRelatedMessage(input, session)`
- 已有 `classifyLearningReply(input)`

推荐落点：

- 先放 `src/services/learningEngine.js`
- 若规则超过 120 行，拆到 `src/services/learningProgressRules.js`

### 6.1.1 最少需要覆盖的边界样例

- “我想学 JavaScript” 后接 “我今天有点累，只想聊聊”
- “完成了” 但当前上下文不是学习步骤
- “我不懂闭包” 应判为 stuck
- “我写了一个 demo” 应判为 partial 或 complete，取决于当前 step
- “嗯”“好”“收到” 应 ignore

### 6.2 建议 action 的幂等生成

目标：

在现有 `type + title + source` 基础去重之上，避免 `POST /actions/suggested` 因标题或上下文轻微变化创建重复 action。

推荐步骤：

1. 计算当前 state 的 `next_action`
2. 给建议 action 生成稳定 identity
   - 可基于 `type + title + focus + current session/topic`
3. 先查询未完成的 echo_state action
4. 若存在同 identity，直接复用
5. 若存在旧 echo_state 但 identity 不同，再决定：
   - 复用并更新
   - 或创建新 action

推荐新增方法：

- 已新增 `buildSuggestedActionIdentity(state)`
- 已新增 `findReusableSuggestedAction(identity)`
- 已新增存储层 `findActionBySuggestedIdentity(identity)`

推荐落点：

- `src/services/actionEngine.js`
- 查询方法放 `src/storage/memoryStore.js`

### 6.3 Context 聚合与记忆召回

目标：

让 context 既稳定，又不会被脏记忆淹没。

推荐步骤：

1. 拉 relevant memories
2. 拉 recent memories
3. 做去重合并
4. 统计 emotion / tags / recall channels
5. 从 user profile 取长期信号
6. 为每条 relevant memory 补充 retrieval explanation：
   - channel labels
   - score / ranking score
   - 简短 reason 文案
7. 构建 memory layers：
   - `core`：pinned 或 priority bucket 为 core 的长期锚点
   - `working`：当前 query 直接命中、学习连续性或高 ranking score 的工作记忆
   - `recent`：近期线程，主要服务短期连续性
   - `ambient`：低优先级背景信号
8. 产出：
   - `summary`
   - `injection`
9. 给 `state`、`chat prompt`、`memory page` 复用

开发要求：

- 不要在多个文件各写一套“context summary”
- 优先复用 `summarizeContext()`
- retrieval explanation 必须保持向后兼容：保留 `retrieval.channels`，新增字段只能作为增强
- memory layers 只做分层与压缩，不改变底层记忆写入或 priority_bucket 的语义

### 6.4 每日总结生成

目标：

让 summary 更像“延续性反思”，而不是死板统计。

推荐步骤：

1. 读当天 memory 和 learning event
2. 提取事实层
3. 判断 pattern
4. 生成 summary 文案
5. 生成 reflection 文案
6. 幂等保存

开发要求：

- facts / pattern / rendering 三层尽量分开
- 后续如接 LLM 总结，也必须保留当前规则链作为 fallback

### 6.5 对话治理 proposal 流程

目标：

让 Echo 可以通过对话帮助用户整理后台数据，同时避免误删、误合并和不可追踪的隐式修改。

推荐步骤：

1. `chatService` 收到用户输入
2. `managementIntentEngine` 判断：
   - 是否为治理请求
   - 治理 scope：memory / learning / actions / achievements
   - 风险级别：read_only / reversible / destructive
3. 如果是只读梳理：
   - 返回当前数据摘要和建议
   - 不创建 proposal
4. 如果需要修改：
   - `operationProposalEngine` 生成 proposal
   - proposal 写入 `operation_proposals`
   - chat 返回“建议执行哪些操作”和“等待用户确认”
5. 用户确认后：
   - route 或 chat command 调用 `operationExecutor`
   - 执行允许的操作
   - 写 `operation_events`
6. 执行结果返回给 chat / state / 前端

开发要求：

- proposal 必须包含可读 summary 和结构化 operations
- delete 类操作必须带 `risk_level: destructive`
- 第一版优先做 read-only 和 reversible 操作
- 所有执行都必须幂等，重复确认不能重复删除或重复归档

### 6.6 成就生成与解锁流程

目标：

让成就像单机游戏成就一样基于事件解锁，同时保持 Echo 的成长记录气质。

推荐步骤：

1. 创建 learning session 或 action
2. `achievementGenerator` 根据 topic / action type 生成一组待解锁成就
3. 生成时只选择 `icon_type`、`palette_key`、`accent_color` 和文案，不实时生成新图片
4. 写入 `achievements`
5. learning event / action status / operation event 发生后
6. `domainEventEngine` 将事件标准化
7. `achievementEngine` 查询相关 locked achievements
8. 用结构化 trigger 判断是否解锁
9. 如果解锁：
   - 写 `achievement_unlocks`
   - 返回最近解锁成就给 state 或对应 API
10. 前端展示轻量解锁提示和成就墙

开发要求：

- 解锁必须幂等，同一个 achievement 只能 unlock 一次
- hidden 成就在未解锁前只显示 `locked_description` 或完全隐藏
- LLM 生成文案必须有规则 fallback
- visual spec 必须结构化保存，不能只存一段不可解析 prompt
- 图标必须从 `achievementIconCatalog` 选择，不为单个成就实时生成
- 第一版不需要积分、等级、排行

### 6.7 F0 前端信息架构重设计

目标：

在不阻塞终端/API 验证的前提下，重新设计 Echo 的前端页面结构，决定哪些页面保留、合并、新增或删除。

详细方案：

- `docs/FRONTEND_INFORMATION_ARCHITECTURE.md`

当前前端导航：

- 此刻
- 学习
- 行动
- 反思
- 记忆

推荐下一版导航候选：

- 此刻
- 学习
- 行动
- 记忆
- 整理
- 成就

页面调整建议：

- `此刻`
  - 保留主入口
  - 展示当前状态、下一步、最近解锁成就、最近反思摘要

- `学习`
  - 保留
  - 展示当前学习线、步骤、学习线成就

- `行动`
  - 保留
  - 展示当前任务、队列、重复/过期任务提示

- `记忆`
  - 保留
  - 展示记忆层、画像摘要、可进入整理建议

- `反思`
  - 建议降级为模块
  - 放入 `此刻` 或 `记忆`，不一定继续占主导航

- `整理`
  - 新增
  - 展示 memory / learning / actions 的治理摘要、候选、operation proposals 和确认流

- `成就`
  - 新增
  - 展示成就墙、最近解锁、隐藏成就、按学习线或任务筛选

F0 交付物：

- 页面导航方案
- 每个页面的职责边界
- 每个页面依赖的 view model
- 哪些旧模块保留、合并或移除
- 前端接入顺序

F0 不做：

- 不急着重写 UI
- 不在前端实现治理规则
- 不在前端实现成就解锁规则
- 不阻塞 G1 / ACH1 的终端/API 实现

---

## 7. 边界条件总表

以下边界条件后续开发必须显式考虑，并优先写入测试。

### 7.1 Chat

- 空 message
- provider 返回空字符串
- provider 抛错
- memory/context 为空
- learning session 存在但本轮消息无关

### 7.2 State

- 所有模块都为空时仍返回稳定结构
- 有 learning 无 actions
- 有 actions 无 learning
- summary 缺失
- profile 缺失

### 7.3 Learning

- 同 topic 重复开启
- topic 提取失败
- 最后一步完成
- unrelated chat 混入
- 手动更新 step 越界

### 7.4 Actions

- invalid action id
- invalid status
- 重复 suggested action
- 切 active 时已有多个 active 脏数据

### 7.5 Memory

- 记忆为空
- relevant memories 为空
- pin 不存在的 memory
- priority 参数越界

### 7.6 Summary

- 当日无数据
- 重复生成
- learning event 存在但 memory 不存在

### 7.7 TTS

- 未配置 API key
- text 为空
- provider 非 2xx 响应
- provider 请求阶段失败
- provider 200 但返回 JSON
- provider 返回空音频

### 7.8 对话治理

- 用户只想“看看/梳理”，不能误执行修改
- delete 操作没有明确确认时不能执行
- proposal 目标数据已变化时必须重新校验
- 重复确认同一 proposal 不能重复执行
- 归档 / dismiss / merge 后必须保留操作事件
- 记忆为空、学习线为空、任务为空时仍要返回可讨论摘要

### 7.9 成就系统

- 同一成就重复触发不能重复解锁
- hidden 成就未解锁前不能泄露完整标题和描述
- learning session / action 删除或归档后，相关成就展示必须稳定
- 文案生成失败时必须有 fallback
- visual spec 缺字段时前端仍能渲染默认徽章
- 特殊成就触发不能依赖单条模糊文本

---

## 8. 测试补全原则

后续每完成一个小目标，至少补一类测试。

优先级：

1. `test/api.test.js`
   - 用于主业务链验收

2. 对应 service 的规则测试
   - 适合复杂纯函数
   - 如学习分类、topic extraction、priority calculation

3. 回归测试
   - 修复 bug 后必须补

推荐新增测试文件：

- `test/learningEngine.test.js`
- `test/topicExtractor.test.js`
- `test/actionEngine.test.js`
- `test/contextBuilder.test.js`
- `test/reflectionEngine.test.js`
- `test/operationProposalEngine.test.js`
- `test/achievementEngine.test.js`

---

## 9. 后续 AI 开发约束

后续 AI 必须遵守以下规则：

1. 先看本文档，再动代码
2. 一次只实现一个小目标
3. 每个小目标必须同时：
   - 改代码
   - 补测试
   - 更新必要文档
4. 不允许把复杂业务逻辑直接堆进 route 或 `public/app.js`
5. 新增公共逻辑时，优先复用已有 service / view model / store
6. 发现职责失衡时，优先小幅拆分，不做大爆炸式重构
7. 保持 API envelope 与现有前端兼容，除非明确同步修改前端

推荐每次开发输出模板：

1. 本次目标是什么
2. 修改了哪些文件
3. 为什么放在这些文件
4. 覆盖了哪些边界条件
5. 新增了哪些测试
6. 还有哪些未处理风险

---

## 10. 第一批建议立即执行的小目标

如果从现在开始继续补全，建议按这个顺序推进：

1. `L1` 学习推进 gating
   - 基础版已完成
   - 后续只做规则精修和更多边界覆盖

2. `L2` topic extraction 精修
   - 基础版已完成
   - 后续继续补更多自然语言样例

3. `L3` learning session 完结状态处理
   - 基础版已完成
   - 后续补人工回滚/重开规则

4. `L4` 学习事件标准化
   - 基础版已完成
   - 后续补前端解释映射

5. `A1` suggested action 幂等增强
   - 基础版已完成
   - 后续补旧 action 更新策略

6. `M1` relevant memory ranking 规则细化
   - 基础版已完成
   - 后续补更细的衰减/去重策略

7. `M2` retrieval channel 解释增强
   - 基础版已完成
   - 后续补前端展示映射

8. `M3` 长短期记忆分层规则补充
   - 基础版已完成
   - 后续调优 working 阈值和页面展示

9. `M4` memory calibration 测试补齐
   - 基础版已完成
   - 后续补 service 单测

10. `R1` summary 模板优化
   - 基础版已完成
   - 后续补更多 pattern 文案

11. `R2` summary 与 state 决策联动增强
   - 基础版已完成
   - 最近 reflection 已可影响 next_action，且 state explain 会说明参与或被覆盖

12. `R3` reflection 测试覆盖更多 pattern
   - 基础版已完成
   - 已覆盖更多 summary pattern，避免后续文案优化回退成机械统计

13. `P1` profile signal 冲突合并规则
   - 基础版已完成
   - 已统一同一 profile key 的新旧信号合并、置信度演化、低置信度保护与手动 override 强制覆盖

14. `P2` 长期画像稳定性增强
   - 基础版已完成
   - 已收紧 profile synthesis 对长期画像的写入阈值、样本要求与回归覆盖

15. `P3` 画像字段字典化
   - 基础版已完成
   - 已统一 profile key、value、中文展示文案与未知字段 fallback，减少散落字符串

16. `A2` action 排序与主任务选择统一
   - 基础版已完成
   - 已收口 active / pending action 的排序、主任务选择与 `/state.current_action` 规则

17. `A3` action completion 后与 learning / summary 的联动规则
   - 基础版已完成
   - 已明确 action 完成时何时推进 learning step、记录 event，并给 summary 留下可解释痕迹

18. `A4` action 测试补齐
   - 基础版已完成
   - 已补齐 action route/service 的无效 id、无效 status、状态流转与 suggested action 边界测试

19. `T1` TTS provider 配置扩展
   - 基础版已完成
   - 已收口 TTS provider 的环境变量、默认模型/声音/格式配置与测试覆盖

20. `T2` 更细致的错误码
   - 基础版已完成
   - 已区分 TTS provider HTTP 错误、JSON 非音频响应、空音频、配置不可用与请求阶段失败，并补充 route/provider 回归测试

21. `T3` TTS 前端播放状态恢复与失败提示增强
   - 基础版已完成
   - 已让 loading / playing / error / unavailable 状态集中恢复，播放结束或失败后按钮可重试，并按 TTS 稳定错误码给出更友好的提示

22. `F0` 前端信息架构重设计
   - 基础版已完成
   - 详见 `docs/FRONTEND_INFORMATION_ARCHITECTURE.md`
   - 只确定页面增删、导航、页面职责和 view model 依赖；不阻塞 G1 / ACH1 的终端/API 验证

23. 前端错误提示一致化
   - F0 后执行或随前端重设计一起执行
   - 将 chat、actions、learning、memory、summary、tts 的 toast 文案与错误码映射收口到统一前端 helper

24. `G1` 对话治理意图识别与只读梳理
   - 基础版已完成
   - 已提供 `GET /management/overview?scope=learning|memory|actions|all`
   - 已让 chat 治理请求返回 `management_overview`
   - 已提供 `scripts/inspect-management.js`

25. `G2` 操作草案 proposal 数据模型
   - 基础版已完成
   - 已建立 `operation_proposals` / `operation_events` 的基础结构，支持创建、列表过滤和 proposal 创建审计事件

26. `G3` 用户确认后执行安全操作
   - 基础版已完成
   - 已支持 action dismiss、memory archive / pin、learning session archive 和只读 no-op 操作
   - delete / remove 会被拒绝执行并写入拒绝事件；merge 仍留到后续更完整的冲突校验与回滚策略

27. `ACH1` 成就数据模型与基础 API
   - 基础版只读接口已完成
   - 已提供 `GET /achievements`、`GET /achievements/recent`、`GET /achievements/icons`
   - 当前由固定 catalog 和现有 learning / actions / memory / operation events 推导解锁状态；尚未持久化 achievements / achievement_unlocks

28. `ACH2` learning session 创建时生成待解锁成就
   - ACH1 后执行
   - 为每条学习线生成公开与隐藏成就，保存文案、触发条件和 visual spec

29. `ACH6` 成就事件图标类型库与 image generation 批量资产
   - ACH2 后执行
   - 先按 `icon_type` 统一生成小图标资产，后续成就只引用图标类型并通过 palette / accent_color 换色

30. `ACH3` learning event / action done 触发成就解锁
   - ACH6 后执行
   - 基于结构化事件幂等解锁成就，返回最近解锁给前端展示

31. `ACH4` 隐藏成就与特殊事件规则
   - ACH3 后执行
   - 增加 hidden / secret 成就触发规则，未解锁前不泄露完整信息

---

## 11. 文档维护规则

以下情况必须同步更新本文档：

- 新增一个核心业务模块
- 核心链路步骤发生变化
- 公共方法归位约定发生变化
- 小目标优先级发生变化
- 新增重要边界条件

如果代码与本文档冲突，以“当前已验证代码行为”为准，并立刻修正文档。
