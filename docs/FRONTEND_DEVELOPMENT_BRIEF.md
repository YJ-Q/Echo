# Echo Frontend Development Brief

日期：2026-07-08

这份文档给负责前端开发的 AI 使用。请先读完本文，再读：

- `docs/FRONTEND_INFORMATION_ARCHITECTURE.md`
- `docs/API_CONTRACTS.md`
- `docs/BACKEND_FRONTEND_SPLIT_GUIDE.md`
- `docs/frontend-mocks/*.json`

---

## 1. 你的任务范围

你负责前端，不负责后端业务规则。

主要工作目录：

- `public/index.html`
- `public/app.js`
- `public/styles.css`

可以读取：

- `docs/frontend-mocks`
- `docs/API_CONTRACTS.md`
- `docs/FRONTEND_INFORMATION_ARCHITECTURE.md`

不要修改：

- `src/services`
- `src/routes`
- `src/storage`
- `test`

除非用户明确要求你同时改后端。

---

## 2. 产品方向

下一版主导航：

`此刻 / 学习 / 行动 / 记忆 / 整理 / 成就`

处理方式：

- 保留：`此刻`、`学习`、`行动`、`记忆`
- 新增：`整理`、`成就`
- 降级：`反思`
  - 从主导航移除
  - 做成 `此刻` 或 `记忆` 中的模块

---

## 3. 当前允许做的事情

你可以先做 mock-driven frontend：

- 新导航骨架
- `整理` 页面骨架
- `成就` 页面骨架
- `反思` 模块降级
- mock data loader
- loading / empty / error states
- proposal confirmation UI 的静态/模拟交互
- achievement grid
- recent unlocks strip
- achievement icon catalog preview

---

## 4. 当前不要做的事情

不要实现这些业务规则：

- 判断哪些记忆该删除
- 判断哪些学习线该归档
- 判断哪些任务重复
- 执行 proposal
- 判断成就是否解锁
- 生成成就文案
- 生成成就图标

这些都由后端 service 提供。

---

## 5. API 状态

以下接口是设计目标，部分真实后端已经实现：

- 已实现：`GET /management/overview?scope=learning|memory|actions|all`
- 已实现：`GET /management/proposals`
- 已实现：`POST /management/proposals`
- 已实现：`POST /management/proposals/:id/confirm`
- 已实现：`GET /achievements`
- 已实现：`GET /achievements/recent`
- 已实现：`GET /achievements/icons`

未实现接口请继续使用：

- 暂无。mock 仍可用于离线 UI 开发。

`management overview` 的 mock 仍可用于离线 UI 开发：

- `docs/frontend-mocks/management-overview-learning.json`
- `docs/frontend-mocks/management-overview-memory.json`
- `docs/frontend-mocks/management-overview-actions.json`

---

## 6. UI 设计原则

Echo 是桌面陪伴体，不是通用管理后台。

界面应该：

- 安静
- 清楚
- 可扫描
- 有轻微成长记录感
- 不像营销页
- 不像游戏大厅
- 不用积分、排行榜、夸张动效

`整理` 页面要更像安全工作台：

- 明确风险
- 明确确认状态
- 明确 before / after
- 破坏性操作需要更强提示

`成就` 页面可以更像单机游戏成就墙：

- 有收藏感
- 有隐藏成就
- 有稀有度
- 有最近解锁
- 但不要引入积分压力

---

## 7. 推荐实现顺序

1. 新增导航结构
2. 新增 mock data loader
3. 新增 `整理` 页面
4. 新增 `成就` 页面
5. 把 `反思` 降级成模块
6. 补 loading / empty / error states
7. 把 mock loader 封装成未来可切真实 API 的接口

---

## 8. 验收清单

前端初版完成时应满足：

- 新导航存在
- `反思` 不再是主导航
- `整理` 页面可用 mock 展示 overview 和 proposals
- `成就` 页面可用 mock 展示成就墙、最近解锁和图标 catalog
- 没有把治理/成就业务规则写进前端
- 文案和布局符合 Echo 的安静、可扫描风格
