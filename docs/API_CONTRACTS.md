# Echo API Contracts

日期：2026-07-08

本文档约定前端即将使用、后端逐步实现的 API contract。真实接口未完成前，前端应使用 `docs/frontend-mocks` 中的 mock JSON。

---

## 1. Envelope

所有 API 使用统一 envelope。

成功：

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

---

## 2. Management Overview

Endpoint:

`GET /management/overview?scope=learning|memory|actions|all`

状态：

基础版已实现。

用途：

返回只读治理摘要、候选和建议。不执行修改。

Response data:

```json
{
  "scope": "learning",
  "summary": "当前有 2 条学习线，其中 1 条可能已经停滞。",
  "stats": {
    "total": 2,
    "active": 1,
    "stale": 1
  },
  "candidates": [
    {
      "id": "learning:1",
      "target_type": "learning_session",
      "target_id": 1,
      "title": "Node.js 入门",
      "reason": "最近没有推进，但仍有未完成步骤。",
      "suggested_operation": "review",
      "risk_level": "read_only"
    }
  ],
  "recommendations": [
    {
      "operation_type": "review",
      "label": "先回看这条学习线",
      "reason": "它仍然有进行价值，不建议直接删除。"
    }
  ],
  "risk_level": "read_only",
  "available_operations": ["review", "archive", "rename"]
}
```

Mock files:

- `docs/frontend-mocks/management-overview-learning.json`
- `docs/frontend-mocks/management-overview-memory.json`
- `docs/frontend-mocks/management-overview-actions.json`

说明：

- `scope=all` 返回 `{ scope: "all", scopes: [...] }`
- 该接口只读，不创建 proposal，不修改任何数据

---

## 3. Operation Proposals

Endpoint:

`GET /management/proposals`

状态：

基础版已实现。

用途：

返回待确认、已执行或已取消的治理草案。

Response data:

```json
{
  "proposals": [
    {
      "id": 1,
      "scope": "memory",
      "status": "awaiting_confirmation",
      "summary": "建议归档 2 条重复记忆。",
      "risk_level": "reversible",
      "operations": [
        {
          "operation_type": "archive",
          "target_type": "memory",
          "target_id": 12,
          "reason": "这条记忆已被更完整的记录覆盖。"
        }
      ],
      "preview": {
        "before": [],
        "after": []
      },
      "created_at": "2026-07-08T00:00:00.000Z"
    }
  ]
}
```

Mock file:

- `docs/frontend-mocks/operation-proposals.json`

---

## 4. Create Proposal

Endpoint:

`POST /management/proposals`

状态：

基础版已实现。

用途：

创建 operation proposal，但不执行。

Request:

```json
{
  "scope": "memory",
  "operation_intent": "cleanup",
  "target_ids": [12, 14]
}
```

Response data:

```json
{
  "proposal": {
    "id": 1,
    "status": "awaiting_confirmation",
    "risk_level": "reversible"
  }
}
```

备注：

- 创建 proposal 只写入 `operation_proposals` 和 `operation_events` 审计记录。
- 第一版不会执行 archive / dismiss / merge / delete 等修改操作。
- 可通过 `GET /management/operation-events?proposalId=1` 查询 proposal 相关事件。

---

## 5. Confirm Proposal

Endpoint:

`POST /management/proposals/:id/confirm`

状态：

基础版已实现。

用途：

用户确认后执行 proposal 中允许的操作。

Request:

```json
{
  "confirmation_text": "确认执行"
}
```

Response data:

```json
{
  "proposal": {
    "id": 1,
    "status": "executed"
  },
  "events": []
}
```

备注：

- 第一版只执行明确支持的安全操作：`dismiss action`、`archive memory`、`pin memory`、`archive learning_session`，以及 `review / keep` 类 no-op 操作。
- `delete / remove` 类 destructive proposal 会被拒绝执行并写入拒绝事件。
- `merge` 暂不执行，后续需要更完整的冲突校验与回滚策略。

---

## 6. Achievement Wall

Endpoint:

`GET /achievements`

状态：

基础版已实现。

用途：

返回成就墙 view model。

Response data:

```json
{
  "summary": {
    "total": 12,
    "unlocked": 4,
    "hidden": 3
  },
  "recent_unlocks": [],
  "groups": [
    {
      "key": "learning",
      "label": "学习线",
      "count": 6
    }
  ],
  "achievements": [
    {
      "id": 1,
      "key": "learning:first_step",
      "title": "第一步已经落地",
      "description": "你把一个模糊主题推进成了可继续的一步。",
      "locked_description": "完成学习线的第一步后解锁。",
      "unlocked": true,
      "hidden": false,
      "rarity": "common",
      "source_type": "learning_session",
      "source_id": 1,
      "icon_type": "first_step",
      "palette_key": "blue_warm",
      "accent_color": "#6f74b8",
      "unlocked_at": "2026-07-08T00:00:00.000Z"
    }
  ]
}
```

Mock file:

- `docs/frontend-mocks/achievements.json`

备注：

- 第一版由后端固定 achievement definitions 和现有 learning / actions / memory / operation events 推导解锁状态。
- 暂不持久化 `achievements` / `achievement_unlocks`，后续 ACH2/ACH3 再补生成与事件解锁落库。

---

## 7. Recent Achievements

Endpoint:

`GET /achievements/recent`

状态：

基础版已实现。

用途：

返回最近解锁成就，用于此刻页和轻量 toast。

Mock file:

- `docs/frontend-mocks/achievements-recent.json`

---

## 8. Achievement Icon Catalog

Endpoint:

`GET /achievements/icons`

状态：

基础版已实现。

用途：

返回可复用成就图标 catalog。

Response data:

```json
{
  "icons": [
    {
      "icon_type": "new_path",
      "label": "新路径",
      "asset_path": "/assets/achievements/new_path.png",
      "default_palette": "blue_warm",
      "supports_tint": true
    }
  ]
}
```

Mock file:

- `docs/frontend-mocks/achievement-icons.json`
