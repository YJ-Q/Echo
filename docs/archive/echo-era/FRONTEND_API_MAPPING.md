# Echo Frontend API Mapping

日期：2026-07-08

状态：F3 前端接入映射版

本文档说明当前 `public/` 前端页面如何消费 API / view model，以及真实 API 未完成时如何回退到 mock。它是 `docs/API_CONTRACTS.md` 和 `docs/FRONTEND_INFORMATION_ARCHITECTURE.md` 的落地映射。

核心原则：

- 前端只消费 view model，不实现治理规则、成就解锁规则、图标选择规则。
- 真实 API 优先；未实现或请求失败时，由 `public/viewModels.js` 回退到 mock view model。
- mock fallback 只用于页面验证，不代表最终业务判断。
- proposal 的真实执行必须由后端完成；当前前端的确认/取消是模拟状态。

---

## 1. 前端数据层文件

### `public/app.js`

负责：

- 页面导航
- 页面渲染
- 用户交互
- 核心现有 API 调用
- 把 `public/viewModels.js` 返回的 supplemental view model 合并进 dashboard data

核心函数：

- `fetchJson(url, options)`
- `postJson(url, body)`
- `fetchState()`
- `fetchDashboardData()`
- `hydrateFromState()`

### `public/viewModels.js`

负责：

- mock management overview
- mock operation proposals
- mock achievement wall
- mock recent achievements
- mock icon catalog
- 展示标签映射，例如 risk / rarity / proposal status
- supplemental view model 加载与 fallback

核心导出：

- `fetchSupplementalViewModels(fetchJson)`
- `MOCK_MANAGEMENT_OVERVIEWS`
- `MOCK_ACHIEVEMENTS`
- `MOCK_ACHIEVEMENT_ICONS`
- `MANAGEMENT_SCOPE_LABELS`
- `RISK_LABELS`
- `PROPOSAL_STATUS_LABELS`
- `RARITY_LABELS`

---

## 2. 全局 API Envelope

前端期望所有 JSON API 遵守统一 envelope：

```json
{
  "ok": true,
  "data": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "stable_error_code",
    "message": "Human readable message"
  }
}
```

`public/app.js` 中的 `unwrapEnvelope()` 会把成功 envelope 解成 `data`。如果接口暂时没有 envelope，前端也能直接消费裸对象，但后续应统一为 envelope。

---

## 3. 页面到 API 映射

| 页面 / 模块 | 当前前端入口 | 读取 API | fallback | 说明 |
| --- | --- | --- | --- | --- |
| 此刻 | `renderNowView()` | `GET /state` | `FALLBACK_STATE` | 当前状态、focus、next action、轻量侧栏 |
| 此刻对话流 | `renderTimeline()` | `GET /state.recent_memories` | 空 timeline | 从最近记忆构造 user/Echo 时间线 |
| 此刻最近解锁 | `renderNowContextStrip()` | `GET /achievements/recent` | `MOCK_RECENT_ACHIEVEMENTS` | 只显示最多 1 条 |
| 此刻待确认整理 | `renderNowContextStrip()` | `GET /management/proposals` | `MOCK_PROPOSALS` | 只提示，不执行 |
| 学习 | `renderLearnView()` | `GET /learning/active` | 空学习线 | 当前学习线、步骤和当前一步 |
| 学习事件 | `renderLearnView()` | `GET /learning/events?limit=12` | 空 events | 用于步骤说明和上下文 |
| 学习成就摘要 | `renderLearnAchievementSummary()` | `GET /achievements` | `MOCK_ACHIEVEMENTS` | 前端只按 `source_type` 筛选展示，不判断解锁 |
| 行动 | `renderActionsView()` | `GET /actions?limit=12` | `state.action_queue` | 当前任务和队列 |
| 行动整理提示 | `renderActionGovernanceHints()` | `GET /management/overview?scope=actions` | `MOCK_MANAGEMENT_OVERVIEWS.actions` | 只展示后端候选，不判断重复任务 |
| 记忆 | `renderMemoryView()` | `GET /memory?limit=24` | `state.recent_memories` | 记忆片段、标签和分组 |
| 记忆画像 | `ensureMemoryProfileSummary()` | `GET /memory/profile` | 空 profile | 展示长期画像摘要 |
| 记忆整理入口 | `renderMemoryManagementEntry()` | `GET /management/overview?scope=memory` | `MOCK_MANAGEMENT_OVERVIEWS.memory` | 只跳转到整理页，不直接修改记忆 |
| 近期反思模块 | `renderReflectionsView()` / `renderMemoryView()` | `GET /summary/recent?limit=5` | 空 summaries | 反思已降级为模块 |
| 整理 | `renderManagementView()` | `GET /management/overview?scope=memory|learning|actions` | `MOCK_MANAGEMENT_OVERVIEWS` | 只读摘要、候选、建议 |
| 整理草案 | `renderProposalCard()` | `GET /management/proposals` | `MOCK_PROPOSALS` | before / after、风险、状态 |
| 成就 | `renderAchievementsView()` | `GET /achievements` | `MOCK_ACHIEVEMENTS` | 成就墙 view model |
| 最近解锁 | `renderAchievementsView()` | `GET /achievements/recent` | `MOCK_RECENT_ACHIEVEMENTS` | 成就页横条和此刻页摘要 |
| 图标目录 | `renderAchievementsView()` | `GET /achievements/icons` | `MOCK_ACHIEVEMENT_ICONS` | 前端只展示 icon type，不生成图标 |
| API 能力 | `hydrateFromState()` | `GET /api` | null | 目前用于 TTS capability |

---

## 4. Core API 详情

### 4.1 `GET /state`

当前消费者：

- `fetchState()`
- `renderNowView()`
- `renderTimeline()`
- `renderBadges()`
- `renderLearnView()`
- `renderActionsView()`
- `renderMemoryView()`

前端使用字段：

- `current_state.emotion`
- `current_state.focus`
- `current_state.pattern`
- `current_state.context_note`
- `next_action.label`
- `next_action.detail`
- `current_action`
- `current_learning`
- `current_reflection`
- `current_memory`
- `active_learning`
- `recent_memories`
- `action_queue`
- `profile.summary`

后端负责：

- 判断当前状态
- 选择 next action
- 选择 current action
- 选择 current learning
- 构造 current reflection / memory

前端不得：

- 根据 memories 自己推断用户状态
- 自己选择下一步行动
- 自己判断学习进度是否完成

### 4.2 `GET /actions?limit=12`

当前消费者：

- `fetchDashboardData()`
- `renderActionsView()`

前端使用字段：

- `actions[].id`
- `actions[].title`
- `actions[].detail`
- `actions[].status`
- `actions[].metadata.reason`
- `actions[].completion_hint`

后端负责：

- action 排序
- action 去重
- action 状态合法性
- current action 选择逻辑

前端允许：

- 按已有 `status` 做显示分组
- 触发状态更新按钮

前端不得：

- 判断哪个任务重复
- 批量 dismiss / merge 任务

### 4.3 `GET /learning/active`

当前消费者：

- `fetchDashboardData()`
- `renderLearnView()`

前端使用字段：

- `sessions`
- `current_learning`
- `topic`
- `summary`
- `total_steps`
- `current_step_index`
- `current_step`
- `step_labels`
- `next_step`

后端负责：

- 学习线是否 active
- 当前 step index
- 每一步状态
- 学习事件写入

前端不得：

- 判断学习线 stale
- 判断学习线应该归档
- 自动生成学习成就

### 4.4 `GET /learning/events?limit=12`

当前消费者：

- `renderLearnView()`

前端使用字段：

- `events[].step_index`
- `events[].note`

用途：

- 为当前步骤列表补充最近推进说明。

### 4.5 `GET /memory?limit=24`

当前消费者：

- `renderMemoryView()`
- `buildTimelineEntries()`

前端使用字段：

- `memories`
- `current_memory`
- `memory_note`
- `user_input`
- `echo_response`
- `insight_note`
- `tags`
- `pinned`
- `priority_bucket`
- `current_memory.overview`
- `current_memory.tag_heatmap`

后端负责：

- 记忆蒸馏
- 记忆分层
- 画像相关字段
- pinned / priority 的业务含义

前端不得：

- 判断记忆该删除、合并或归档
- 根据标签自动改 priority

### 4.6 `GET /memory/profile`

当前消费者：

- `renderMemoryView()`
- `ensureMemoryProfileSummary()`

前端使用字段：

- `profile`
- `summary`

用途：

- 展示长期画像摘要。

### 4.7 `GET /summary/recent?limit=5`

当前消费者：

- `renderReflectionsView()`
- `renderNowView()` 侧栏
- `renderMemoryView()` 近期反思模块

前端使用字段：

- `summaries[].date`
- `summaries[].summary`
- `summaries[].echo_reflection`
- `summaries[].behavioral_pattern`
- `summaries[].emotional_trend`

前端职责：

- 轻量展示和带回对话。

前端不得：

- 将反思重新扩展为主导航页职责。

---

## 5. Management API 详情

### 5.1 `GET /management/overview?scope=memory|learning|actions`

当前消费者：

- `fetchSupplementalViewModels()`
- `renderManagementView()`
- `renderActionGovernanceHints()`
- `renderMemoryManagementEntry()`

前端使用字段：

- `scope`
- `summary`
- `stats`
- `candidates[]`
- `candidates[].id`
- `candidates[].target_type`
- `candidates[].target_id`
- `candidates[].title`
- `candidates[].description`
- `candidates[].reason`
- `candidates[].suggested_operation`
- `candidates[].risk_level`
- `recommendations[]`
- `recommendations[].operation_type`
- `recommendations[].label`
- `recommendations[].reason`
- `risk_level`
- `available_operations`

后端负责：

- 识别治理候选
- 判断 risk level
- 给出 suggested operation
- 给出 recommendations
- 计算 stats

前端允许：

- 按 scope 切换展示
- 展示 candidates / recommendations
- 跳转到整理页对应 scope

前端不得：

- 自行判断 stale learning line
- 自行判断 duplicate actions
- 自行判断 duplicate memories
- 自行生成 operation proposal

### 5.2 `GET /management/proposals`

当前消费者：

- `fetchSupplementalViewModels()`
- `renderProposalCard()`
- `renderNowContextStrip()`
- `renderMemoryManagementEntry()`

前端使用字段：

- `proposals[].id`
- `proposals[].scope`
- `proposals[].status`
- `proposals[].summary`
- `proposals[].risk_level`
- `proposals[].operations`
- `proposals[].operations[].operation_type`
- `proposals[].operations[].target_type`
- `proposals[].operations[].target_id`
- `proposals[].operations[].target_ids`
- `proposals[].operations[].reason`
- `proposals[].preview.before`
- `proposals[].preview.after`
- `proposals[].created_at`

后端负责：

- proposal 生成
- proposal 状态
- proposal risk
- before / after preview
- operations 合法性

前端当前行为：

- 展示草案
- 展示 before / after
- 用 `proposalSimulationStatus` 做前端模拟确认/取消

前端不得：

- 直接执行 proposal
- 直接写 memory / learning / action 修改
- 在真实确认 API 未接入前伪装成真实执行成功

### 5.3 `POST /management/proposals`

当前状态：

- contract 已存在
- 当前前端尚未调用

未来用途：

- 从整理候选中创建 proposal。

接入前提：

- 后端必须返回稳定 `proposal.id`
- 后端必须保证创建 proposal 不执行修改

### 5.4 `POST /management/proposals/:id/confirm`

当前状态：

- contract 已存在
- 当前前端尚未调用
- 当前 UI 的确认/取消为模拟状态

未来用途：

- 用户明确确认后由后端执行 proposal。

接入前提：

- 后端返回执行后的 proposal status
- 后端返回 operation events
- destructive 操作需要更强确认文案

---

## 6. Achievement API 详情

### 6.1 `GET /achievements`

当前消费者：

- `fetchSupplementalViewModels()`
- `renderAchievementsView()`
- `renderLearnAchievementSummary()`

前端使用字段：

- `summary.total`
- `summary.unlocked`
- `summary.hidden`
- `recent_unlocks`
- `groups[]`
- `groups[].key`
- `groups[].label`
- `groups[].count`
- `achievements[]`
- `achievements[].id`
- `achievements[].key`
- `achievements[].title`
- `achievements[].description`
- `achievements[].locked_description`
- `achievements[].unlocked`
- `achievements[].hidden`
- `achievements[].rarity`
- `achievements[].source_type`
- `achievements[].source_id`
- `achievements[].icon_type`
- `achievements[].palette_key`
- `achievements[].accent_color`
- `achievements[].unlocked_at`

后端负责：

- 成就是否解锁
- hidden 成就是否揭示
- 成就文案
- rarity
- source_type / source_id
- icon_type / palette_key / accent_color

前端允许：

- 按 `source_type` 和 `rarity` 筛选展示
- 对 locked / hidden 做视觉降级
- 展示最近解锁摘要

前端不得：

- 判断成就是否解锁
- 生成成就文案
- 自己选择 icon_type
- 用积分、排行或压力式成长反馈替代 view model

### 6.2 `GET /achievements/recent`

当前消费者：

- `renderNowContextStrip()`
- `renderAchievementsView()`

前端使用字段：

- `recent_unlocks[]`
- `title`
- `description`
- `rarity`
- `icon_type`
- `palette_key`
- `accent_color`
- `unlocked_at`

展示规则：

- 此刻页最多显示 1 条。
- 成就页可显示多条。
- 前端不生成 toast 解锁逻辑，只消费后端 recent unlocks。

### 6.3 `GET /achievements/icons`

当前消费者：

- `renderAchievementsView()`

前端使用字段：

- `icons[].icon_type`
- `icons[].label`
- `icons[].asset_path`
- `icons[].default_palette`
- `icons[].supports_tint`

当前 UI：

- 暂用文字 glyph 和 palette color 预览。

后续接真实资源时：

- 如果 `asset_path` 可用，前端可改为加载图像。
- 如果 `supports_tint` 为 false，前端不应强行 tint。

---

## 7. Mutation API 映射

这些接口当前已由现有 UI 调用：

| 操作 | Endpoint | 当前入口 | 说明 |
| --- | --- | --- | --- |
| 发送消息 | `POST /chat` | composer form | 成功后刷新 state/dashboard |
| 创建手动任务 | `POST /actions` | 行动页手动创建 | 前端只传 title/detail/priority |
| 生成建议任务 | `POST /actions/suggested` | 行动页建议任务 | 后端负责 dedupe |
| 更新任务状态 | `POST /actions/:id/status` | 任务按钮 | 后端负责状态合法性 |
| 更新学习步骤 | `POST /learning/:id/steps/:stepIndex` | 学习步骤按钮 | 后端负责 step 范围和事件记录 |
| 刷新总结 | `POST /summary` | 反思模块按钮 | 后端负责幂等 |
| 记忆置顶 | `POST /memory/:id/pin` | 记忆卡片按钮 | 后端负责 memory 存在性 |
| 提升记忆优先级 | `POST /memory/:id/priority` | 记忆卡片按钮 | 当前传 fixed salience / priorityBucket / pinned |
| TTS | `POST /tts` | 朗读按钮 | 依赖 `/api.capabilities.tts` |

注意：

- 当前 `POST /memory/:id/priority` 前端仍传固定值，属于现有校准能力，不是治理 proposal 执行。
- 治理类 merge / archive / dismiss 不应复用这些按钮直接执行。

---

## 8. Mock Fallback 行为

`public/viewModels.js` 中的 `fetchSupplementalViewModels(fetchJson)` 会并行请求：

- `/management/overview?scope=learning`
- `/management/overview?scope=memory`
- `/management/overview?scope=actions`
- `/management/proposals`
- `/achievements`
- `/achievements/recent`
- `/achievements/icons`

任何一个 supplemental endpoint 请求失败时：

- 对应数据回退到 mock。
- `viewModelMode` 变为 `"mock"`。
- 标题栏 `#data-chip` 显示 `Mock 视图`。

全部 supplemental endpoint 成功时：

- `viewModelMode` 为 `"api"`。
- 标题栏显示 `已同步`。

限制：

- mock fallback 不覆盖核心 API，例如 `/state`、`/actions`、`/memory`。
- 核心 API 失败时仍使用 `FALLBACK_STATE` / `FALLBACK_DASHBOARD` 的空状态。

---

## 9. 页面状态要求

当前已具备：

- 基础 loading：`body[data-dashboard-loading="true"]`
- 基础 empty：各列表的 `.empty-state`
- mock fallback：标题栏 `Mock 视图`
- mutation error：toast

后续应补齐：

- 每个 supplemental 模块的局部 error 状态
- 每个 supplemental 模块的局部 loading skeleton
- proposal confirm API 接入后的 pending / success / failure 状态
- destructive proposal 的强确认输入

建议优先级：

1. 整理页 proposal 确认状态
2. 此刻页 context strip 的 loading / empty
3. 成就页 achievement grid 的 loading / empty
4. 图标资源加载失败 fallback

---

## 10. 后端稳定字段清单

后端优先保证这些字段稳定，前端即可平滑切换真实 API：

### Management

- `scope`
- `summary`
- `stats`
- `candidates[].id`
- `candidates[].title`
- `candidates[].reason`
- `candidates[].risk_level`
- `candidates[].suggested_operation`
- `recommendations[].label`
- `risk_level`
- `available_operations`

### Proposals

- `id`
- `scope`
- `status`
- `summary`
- `risk_level`
- `operations[].operation_type`
- `operations[].target_type`
- `operations[].reason`
- `preview.before`
- `preview.after`
- `created_at`

### Achievements

- `summary.total`
- `summary.unlocked`
- `summary.hidden`
- `groups[].key`
- `groups[].label`
- `achievements[].id`
- `achievements[].title`
- `achievements[].locked_description`
- `achievements[].unlocked`
- `achievements[].hidden`
- `achievements[].rarity`
- `achievements[].source_type`
- `achievements[].icon_type`
- `achievements[].accent_color`

### Achievement Icons

- `icon_type`
- `label`
- `asset_path`
- `default_palette`
- `supports_tint`

---

## 11. 明确不由前端负责的规则

前端不得实现：

- 判断哪些记忆该删除、合并、归档
- 判断哪些学习线 stale 或应归档
- 判断哪些任务重复或过期
- 生成 proposal
- 执行 proposal
- 判断成就是否解锁
- 生成成就文案
- 选择成就图标
- 计算 rarity
- 推断 hidden achievement 的真实内容

这些必须来自后端 service / API view model。

