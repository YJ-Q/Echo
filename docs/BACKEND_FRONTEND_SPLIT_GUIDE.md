# Echo Backend / Frontend Split Guide

日期：2026-07-08

本文档用于约定 Echo 接下来如何分成前端与后端并行开发。

---

## 1. 结论

当前阶段建议先做“职责分离”，不要立刻拆仓库。

后端继续在当前项目中推进核心能力：

- `src/routes`
- `src/services`
- `src/storage`
- `test`
- `scripts`
- API contracts
- terminal inspection scripts

前端可以并行做 mock-driven UI：

- `public`
- 前端 mock fixtures
- 页面骨架与交互状态
- loading / empty / error states

物理拆分仓库或 monorepo 结构可以后置，等 API contract 和页面信息架构稳定后再做。

---

## 2. 后端职责

后端拥有所有业务判断。

后端负责：

- 治理意图识别
- 治理候选生成
- operation proposal 创建、确认和执行
- 记忆、学习线、任务的真实读写
- 成就定义生成
- 成就解锁判断
- 成就图标 catalog
- API envelope
- view model
- 终端脚本验证
- 单元测试和 API 测试

后端禁止：

- 为了前端方便，把业务规则搬到 `public/app.js`
- 让前端传入“该删哪些记忆”的最终判断
- 让前端决定成就是否解锁

---

## 3. 前端职责

前端只消费稳定 view model。

前端负责：

- 页面信息架构
- 导航与布局
- 表单交互
- proposal 确认 UI
- 成就墙展示
- 最近解锁提示
- 图标 catalog 渲染与换色
- loading / empty / error states
- mock-driven 原型

前端禁止：

- 自行判断治理候选
- 自行执行数据删除、合并、归档逻辑
- 自行判断成就解锁
- 自行选择隐藏成就真实内容
- 将 mock 字段当成最终业务规则

---

## 4. 推荐开发节奏

1. F0 前端信息架构
   - 已完成基础版：`docs/FRONTEND_INFORMATION_ARCHITECTURE.md`

2. 前端 mock-driven skeleton
   - 基于 `docs/frontend-mocks`
   - 不等真实 API

3. 后端 G1
   - `GET /management/overview`
   - `scripts/inspect-management.js`

4. 前端替换 management mocks
   - `整理` 页面接真实 overview

5. 后端 G2/G3
   - operation proposal 创建、确认、执行

6. 前端接 proposal flow

7. 后端 ACH1/ACH2/ACH6/ACH3
   - 成就数据、生成、图标 catalog、解锁

8. 前端接成就墙和最近解锁

---

## 5. 文件归属建议

后端主责：

- `src/**`
- `test/**`
- `scripts/inspect-*.js`
- `docs/API_CONTRACTS.md`
- `docs/DEVELOPMENT_EXECUTION_GUIDE.md`

前端主责：

- `public/**`
- `docs/FRONTEND_INFORMATION_ARCHITECTURE.md`
- `docs/FRONTEND_DEVELOPMENT_BRIEF.md`
- `docs/frontend-mocks/**`

共享：

- `docs/API_CONTRACTS.md`
- `docs/frontend-mocks/**`

共享文件修改原则：

- API contract 变化由后端先更新
- mock fixtures 变化必须与 contract 同步
- 前端不得单独修改 contract 表达业务规则

---

## 6. 验收原则

后端能力完成至少需要：

- service 实现
- API route
- test 覆盖
- terminal script 可运行
- API contract 更新
- mock fixture 更新或确认无需更新

前端能力完成至少需要：

- mock 数据可驱动页面
- loading / empty / error 状态齐全
- 不复制后端业务规则
- 可替换为真实 API
- 页面职责符合 F0 信息架构

