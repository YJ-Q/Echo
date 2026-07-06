# Echo API Contract

本文件用于约束 Echo 当前后端接口能力、返回格式、字段含义与状态流转，作为前后端联调与后端后续开发的统一基准。

## 1. 通用规则

### 1.1 返回包结构

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
    "code": "request_error",
    "message": "..."
  }
}
```

规则：

- 前端统一先判断 `ok`
- 成功数据都放在 `data`
- 错误统一从 `error.code` 与 `error.message` 读取

### 1.2 状态与空值

- 缺省字符串尽量返回空字符串，不返回不存在字段
- 列表接口尽量返回空数组
- 前端不应假设某字段永远存在

## 2. 基础接口

### 2.1 `GET /health`

用途：

- 服务健康检查

成功返回：

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "name": "Echo"
  }
}
```

### 2.2 `GET /api`

用途：

- API 能力概览

关键字段：

- `name`
- `status`
- `message`
- `endpoints`

## 3. State 模块

### 3.1 `GET /state`

用途：

- 拉取主页面与多个模块共享的全局聚合状态

查询参数：

- `query` 可选，字符串，用于带上下文地生成当前状态

返回核心结构：

```json
{
  "name": "Echo",
  "mode": "backend-only",
  "timestamp": "2026-07-06T00:00:00.000Z",
  "current_state": {
    "emotion": "focused",
    "focus": "JavaScript",
    "pattern": "starting friction",
    "context_note": "...",
    "profile_note": "..."
  },
  "next_action": {},
  "decision": {},
  "explain": {},
  "action_queue": [],
  "active_learning": [],
  "recent_memories": [],
  "recent_reflections": [],
  "profile": {
    "raw": [],
    "summary": {}
  },
  "user_states": []
}
```

前端依赖说明：

- `current_state` 用于当前状态主视觉、状态卡、Focus 卡
- `next_action` 用于下一步行动卡、行动页主任务卡
- `action_queue` 用于行动页队列
- `active_learning` 用于学习页和学习线卡
- `recent_memories` 用于对话流 fallback、记忆页概览
- `recent_reflections` 用于反思页概览
- `profile` 用于画像与辅助解释

注意：

- `/state` 是聚合接口，不建议在前端替代所有明细接口
- 页面需要细化数据时，优先使用对应模块接口

## 4. Chat 模块

### 4.1 `POST /chat`

用途：

- 用户发送消息，获取 Echo 回复，并推动状态变化

请求体：

```json
{
  "message": "..."
}
```

错误：

- `message_required`

前端用途：

- 此刻页输入框提交
- 对话流更新
- 提交后应触发一次 `/state` 或相关模块刷新

## 5. Action 模块

### 5.1 `GET /actions`

用途：

- 拉取任务队列

查询参数：

- `status` 可选
- `limit` 可选

返回：

```json
{
  "actions": []
}
```

Action 字段：

- `id`
- `type`
- `title`
- `detail`
- `source`
- `priority`
- `status`
- `due_at`
- `metadata`
- `created_at`
- `updated_at`

状态枚举：

- `pending`
- `active`
- `done`
- `dismissed`

### 5.2 `POST /actions`

用途：

- 手动创建任务

当前后端应保证：

- 至少支持任务标题与基础信息创建
- 返回新建 action

### 5.3 `POST /actions/suggested`

用途：

- 根据 query 生成建议任务

请求体：

```json
{
  "query": "..."
}
```

### 5.4 `POST /actions/:id/status`

用途：

- 更新任务状态

请求体：

```json
{
  "status": "active"
}
```

状态要求：

- `pending`
- `active`
- `done`
- `dismissed`

错误：

- `invalid_action_id`
- `invalid_action_status`
- `action_not_found`

前端用途：

- 行动页任务状态切换
- 此刻页下一步行动推进

## 6. Learning 模块

### 6.1 `GET /learning`

用途：

- 拉取学习会话列表

查询参数：

- `status`
- `limit`

返回：

```json
{
  "sessions": []
}
```

Session 字段：

- `id`
- `topic`
- `status`
- `current_step`
- `steps`
- `created_at`
- `updated_at`

`steps` 内每一步至少应包含：

- `title`
- `status`

### 6.2 `GET /learning/active`

用途：

- 拉取激活中的学习任务线

前端用途：

- 学习页主数据
- 此刻页学习线卡

### 6.3 `GET /learning/events`

用途：

- 拉取学习事件流

查询参数：

- `sessionId`
- `limit`

事件字段：

- `id`
- `session_id`
- `topic`
- `event_type`
- `step_index`
- `step_title`
- `note`
- `user_input`
- `created_at`

### 6.4 `POST /learning/:id/steps/:stepIndex`

用途：

- 更新某个学习步骤状态

请求体：

```json
{
  "status": "done"
}
```

允许状态：

- `pending`
- `active`
- `done`

错误：

- `invalid_learning_identifiers`
- `invalid_learning_status`
- `learning_session_not_found`

前端用途：

- 学习页推进步骤
- 学习任务线视觉更新

## 7. Memory 模块

### 7.1 `GET /memory`

用途：

- 拉取记忆列表

查询参数：

- `limit`

Memory 字段：

- `id`
- `timestamp`
- `user_input`
- `echo_response`
- `emotion`
- `tags`
- `memory_note`
- `insight_note`
- `salience`
- `reinforcement_count`
- `priority_bucket`
- `last_accessed_at`
- `pinned`

### 7.2 `GET /memory/states`

用途：

- 拉取用户状态记录

前端用途：

- 趋势辅助
- 二期成长页 / 画像页

### 7.3 `GET /memory/profile`

用途：

- 拉取用户画像和画像总结

返回：

```json
{
  "profile": [],
  "summary": "..."
}
```

### 7.4 `POST /memory/profile/refresh`

用途：

- 根据记忆刷新画像

### 7.5 `POST /memory/profile/override`

用途：

- 手动覆盖画像信号

请求体：

```json
{
  "key": "...",
  "value": "...",
  "confidence": 0.92
}
```

错误：

- `profile_override_required`

### 7.6 `GET /memory/calibration`

用途：

- 拉取记忆校准快照

### 7.7 `GET /memory/context`

用途：

- 拉取上下文构建结果

查询参数：

- `query`

### 7.8 `POST /memory/:id/pin`

用途：

- 置顶记忆

错误：

- `invalid_memory_id`
- `memory_not_found`

### 7.9 `POST /memory/:id/priority`

用途：

- 调整记忆优先级 / 提升重要性

请求体示例：

```json
{
  "salience": 0.96,
  "priorityBucket": "core",
  "pinned": true
}
```

错误：

- `invalid_memory_id`
- `memory_not_found`

## 8. Summary 模块

### 8.1 `POST /summary`

用途：

- 生成或刷新每日总结

前端用途：

- 反思页刷新

### 8.2 `GET /summary/recent`

用途：

- 获取近期总结

查询参数：

- `limit`

Summary 字段：

- `id`
- `date`
- `summary`
- `emotional_trend`
- `behavioral_pattern`
- `echo_reflection`
- `created_at`

## 9. TTS 模块

### 9.1 `POST /tts`

用途：

- 将文本转为语音

请求体：

```json
{
  "text": "..."
}
```

成功返回：

```json
{
  "text": "...",
  "audio": {
    "mime_type": "audio/...",
    "data": "base64...",
    "size_bytes": 12345
  }
}
```

错误：

- `text_required`
- `tts_not_configured`

前端建议：

- 作为增强功能，不作为主流程阻塞依赖
- 首版可以后置接入

## 10. 状态流转约束

### 10.1 Action 状态

推荐前端理解为：

- `pending`：未开始
- `active`：当前进行中
- `done`：已完成
- `dismissed`：已放弃 / 已移除

### 10.2 Learning 状态

Session：

- `active`
- `completed`

Step：

- `pending`
- `active`
- `done`

### 10.3 Memory 优先级

重要字段：

- `salience`
- `priority_bucket`
- `reinforcement_count`
- `pinned`

前端展示时应以“重要性 / 热度 / 置顶状态”理解，不直接暴露技术细节

## 11. 前端刷新策略

推荐策略：

### 11.1 主页面

提交消息后：

1. 更新本地对话流
2. 调 `/chat`
3. 成功后刷新 `/state`
4. 必要时刷新 `/actions`、`/learning/active`、`/memory`、`/summary/recent`

### 11.2 各模块操作

任务状态变更后：

- 刷新 `/actions`
- 轻量刷新 `/state`

学习步骤变更后：

- 刷新 `/learning/active`
- 轻量刷新 `/state`

记忆置顶 / 提升后：

- 刷新 `/memory`
- 必要时刷新 `/memory/profile`

总结刷新后：

- 刷新 `/summary/recent`
- 必要时刷新 `/state`

## 12. 后端后续开发约束

后端新增功能时，优先原则：

1. 先明确服务哪个页面模块
2. 先明确前端需要哪些字段
3. 不轻易改动已有字段语义
4. 如需新增字段，尽量增量兼容
5. 如需新增复杂系统，先写入 `PRODUCT_MAP.md`

不要默认整仓代码覆盖。

推荐流程：

1. 先同步最新远端
2. 对照本文件确认接口变化
3. 明确本次修改范围
4. 再进行代码修改与提交
