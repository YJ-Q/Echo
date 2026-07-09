# Echo Frontend Information Architecture

日期：2026-07-08

状态：F0 基础版

本文档用于约定 Echo 下一版前端的信息架构。它不要求立刻重写 UI，而是先决定页面增删、模块边界、view model 依赖和迁移顺序，避免在治理与成就能力尚未稳定前反复重做页面。

---

## 1. 设计结论

前端需要重新设计，但不阻塞后端能力推进。

短期策略：

- 当前前端继续作为验证壳
- 新增核心能力优先通过 service / API / 终端脚本验证
- 前端只消费稳定 view model
- 不在前端实现治理规则、成就解锁规则或图标选择规则

推荐下一版主导航：

`此刻 / 学习 / 行动 / 记忆 / 整理 / 成就`

调整：

- 保留：`此刻`、`学习`、`行动`、`记忆`
- 新增：`整理`、`成就`
- 降级：`反思` 从主导航降级为模块，放入 `此刻` 和 `记忆`

---

## 2. 当前前端问题

当前导航：

`此刻 / 学习 / 行动 / 反思 / 记忆`

它适合 MVP，但继续加入以下能力会变得拥挤：

- 对话式后台治理
- 操作草案确认
- 记忆清理候选
- 学习线整理
- 任务去重
- 成就墙
- 最近解锁
- 隐藏成就
- 成就图标资产库

核心问题不是视觉，而是信息架构：

- `反思` 更像状态回顾，不一定需要长期占主导航
- `记忆` 会承载记忆浏览，但不适合承载所有清理/确认流程
- `行动` 适合执行任务，不适合管理 proposal
- `成就` 是独立成长记录，不应塞进学习页或此刻页的角落
- `整理` 是高风险操作入口，需要独立空间展示建议、风险、确认和历史

---

## 3. 页面地图

### 3.1 此刻

定位：

当前状态和主对话入口。

保留内容：

- 当前情绪 / focus / next action
- 主对话时间线
- quick prompts
- 当前主任务和学习线的轻量摘要

新增模块：

- 最近解锁成就，最多 1-3 条
- 最近反思摘要
- 有待确认治理 proposal 时的轻量提醒

不放：

- 完整成就墙
- 完整记忆清理流程
- 复杂历史分析

依赖 view model：

- `/state`
- `/achievements/recent`
- `/management/proposals?status=awaiting_confirmation`

### 3.2 学习

定位：

当前学习线和学习步骤推进。

保留内容：

- 当前学习线
- step list
- 当前一步
- learning events 摘要

新增模块：

- 当前学习线待解锁成就
- 当前学习线已解锁成就
- stale learning line 提醒，但不在这里执行整理

不放：

- 全部历史学习线管理
- 删除/合并确认流

依赖 view model：

- `/learning/active`
- `/learning/events`
- `/achievements?source_type=learning_session`

### 3.3 行动

定位：

当前任务和任务队列执行。

保留内容：

- current action
- action queue
- manual action
- suggested action
- status update

新增模块：

- 重复任务提示
- 过期任务提示
- 完成 Echo 建议任务后的成就提示

不放：

- 批量任务治理执行
- proposal 历史

依赖 view model：

- `/actions`
- `/state.current_action`
- `/management/overview?scope=actions`
- `/achievements/recent`

### 3.4 记忆

定位：

记忆浏览、画像摘要和记忆层展示。

保留内容：

- memory overview
- memory layers
- key memories
- tags / clusters
- profile summary

新增模块：

- 记忆整理建议入口
- pinned / core memory 强调
- 最近反思历史入口

不放：

- 直接删除记忆按钮
- 批量清理确认流

依赖 view model：

- `/memory`
- `/memory/context`
- `/memory/profile`
- `/management/overview?scope=memory`

### 3.5 整理

定位：

对话式后台治理的工作台。

核心内容：

- governance overview
- memory / learning / actions 三个 scope 的整理摘要
- cleanup candidates
- stale learning lines
- duplicate / stale actions
- operation proposals
- proposal confirmation
- operation history

第一版页面结构：

1. 顶部 scope tabs
   - 记忆
   - 学习线
   - 任务
   - 全部 proposal

2. 只读摘要区
   - 当前数据规模
   - 可能需要整理的候选
   - 风险提示

3. 建议操作区
   - 建议归档
   - 建议合并
   - 建议 dismiss
   - 建议调整 priority

4. 待确认草案区
   - proposal summary
   - risk level
   - before / after 摘要
   - confirm / cancel

5. 操作记录区
   - operation events
   - 执行时间
   - 执行原因

依赖 view model：

- `/management/overview?scope=memory`
- `/management/overview?scope=learning`
- `/management/overview?scope=actions`
- `/management/proposals`

### 3.6 成就

定位：

成长记录和成就墙。

核心内容：

- 最近解锁
- 成就墙
- 隐藏成就
- 按来源筛选
  - learning session
  - action
  - memory governance
  - global
- 按稀有度筛选
  - common
  - rare
  - secret
  - core

第一版页面结构：

1. 最近解锁横条
2. 成就统计摘要
3. 成就筛选器
4. 成就网格
5. 图标类型预览

依赖 view model：

- `/achievements`
- `/achievements/recent`
- `/achievements/icons`

---

## 4. 模块保留与迁移

| 现有模块 | 下一版处理 | 说明 |
| --- | --- | --- |
| Now hero | 保留 | 仍然是主入口 |
| Conversation timeline | 保留 | 继续作为对话入口 |
| Quick prompts | 保留并重写文案 | 后续增加治理类 prompt |
| Learn page | 保留 | 增加学习线成就摘要 |
| Actions page | 保留 | 增加重复/过期提示 |
| Reflections page | 降级 | 改为此刻/记忆中的模块 |
| Memory page | 保留 | 增加整理入口，但不承载确认流 |
| Status column | 保留但减负 | 展示轻量状态、当前 action、最近成就 |
| TTS button | 保留 | 不影响信息架构 |

---

## 5. View Model 约定

前端不得拼业务规则，只消费后端 view model。

建议新增 view model：

### 5.1 management overview

```json
{
  "scope": "memory",
  "summary": "有 3 条旧记忆可能可以归档。",
  "stats": {},
  "candidates": [],
  "recommendations": [],
  "risk_level": "read_only",
  "available_operations": []
}
```

### 5.2 operation proposal

```json
{
  "id": 1,
  "scope": "memory",
  "status": "awaiting_confirmation",
  "summary": "建议归档 2 条重复记忆。",
  "risk_level": "reversible",
  "operations": [],
  "preview": {
    "before": [],
    "after": []
  }
}
```

### 5.3 achievement wall

```json
{
  "summary": {
    "total": 12,
    "unlocked": 4,
    "hidden": 3
  },
  "recent_unlocks": [],
  "groups": [],
  "achievements": []
}
```

### 5.4 achievement icon catalog

```json
{
  "icons": [
    {
      "icon_type": "new_path",
      "asset_path": "/assets/achievements/new_path.png",
      "default_palette": "blue_warm",
      "supports_tint": true
    }
  ]
}
```

---

## 6. 终端优先验证

在前端重写前，必须先能用终端验证核心输出。

建议脚本：

```bash
node scripts/inspect-management.js --scope learning
node scripts/inspect-management.js --scope memory
node scripts/inspect-management.js --scope actions
node scripts/inspect-operation-proposals.js --json
node scripts/inspect-achievements.js --json
node scripts/inspect-achievement-icons.js --json
```

这些脚本输出稳定后，再接前端。

---

## 7. 前端接入顺序

1. 信息架构定稿
   - 本文档即 F0 基础版

2. G1 输出 management overview
   - 基础版已完成，可通过终端/API 验证
   - 前端只在 `记忆` / `行动` / `学习` 中放轻量提醒

3. G2/G3 输出 proposal
   - 前端新增 `整理` 页面
   - 加确认流

4. ACH1/ACH2 输出 achievement wall
   - 前端新增 `成就` 页面骨架
   - `此刻` 和 `学习` 只展示摘要

5. ACH6 输出 icon catalog
   - 成就页接图标库
   - 支持换色

6. ACH3/ACH4 输出 unlocks
   - 此刻页展示最近解锁
   - 成就页展示隐藏成就揭示

7. 最后重做视觉细节
   - 再统一 nav、layout、empty/loading/error states

---

## 8. 验收标准

F0 完成标准：

- 已明确下一版导航
- 已明确每个页面职责
- 已明确哪些旧页面降级或合并
- 已明确新增页面依赖的 view model
- 已明确终端/API 优先验证策略
- 已明确前端接入顺序

后续真正改前端时，必须先满足：

- G1 或 ACH1 至少一个 view model 已稳定
- 对应终端脚本可运行
- 页面只接 view model，不复制 service 规则
