# Margin Case Study 最终审阅

审阅日期：2026-07-27

## 交付物

- [x] 中文母版完整
- [x] 英文适配稿完整
- [x] 双语网页可离线打开
- [x] 中文 PDF 共 18 页
- [x] 英文 PDF 共 18 页

## 证据与诚实性

- [x] 所有事实结论可回溯到 `evidence-map.md`
- [x] Implemented / Scenario-validated / Hypothesis 边界清楚
- [x] 没有虚构用户研究、指标或用户原话
- [x] 测试数字按三个口径分别记录，未将 Case Study 测试混入 E011
- [x] Echo → Margin 的定位变化有上下文

E011 固定表示 Case Study 制作前的核心产品自动化测试基线：
**108/108 通过**。本次新增的 Case Study 合同与质量测试另行统计。

## 隐私

- [x] 所有产品截图来自临时空白数据库
- [x] 未出现真实对话、记忆、路径、密钥或凭据
- [x] `check-privacy.mjs` 通过

截图脚本仅使用 `case-study/.tmp/echo-case-study.sqlite`，并通过
`ECHO_DB_PATH` 显式传入临时库。真实库只做只读哈希复核：
SHA-256 为
`1F565309275899FE9BC366086E8BBB8A148FD368B4E7A6D575C6D0028778A9F1`，
长度 126,976 字节，UTC 修改时间为
`2026-07-09T03:11:38.9342727Z`。

## 网页

- [x] 1440×1000 无溢出
- [x] 精确 390×844 无横向滚动，`scrollWidth = 390`
- [x] 中文/英文切换保持章节位置
- [x] 关闭网络后可完整阅读
- [x] 键盘焦点、替代文本和 reduced-motion 可用

真实 Microsoft Edge/CDP QA 覆盖 1440×1000 与精确 390×844 渲染、
移动端 `scrollWidth`、标题与语言开关边界，以及中英文切换。章节定位、
file-protocol 可移植性与无外部依赖由源码和契约测试覆盖；相关 JavaScript
另经 `node --check` 语法检查。

## PDF

- [x] 两种语言均渲染 18 张 QA 页面
- [x] 每页只有一个主要判断
- [x] 无文字裁切、图片缺失或低对比内容
- [x] 图表与界面在常见阅读尺寸下可辨认

两份 PDF 共 36 页，已使用 Poppler 按 144 DPI 逐页渲染并验收：
中文 18 页、英文 18 页。

## 验证记录

- 核心产品制作前基线：108/108（E011 固定口径，不含 Case Study 测试）
- 当前 Case Study 测试：34/34
- 当前项目全部测试：142/142（`npm test`，108 项核心产品测试 + 34 项 Case Study 测试）
- 隐私扫描：`Case Study privacy scan passed.`，0 项发现
- 网页检查尺寸：1440×1000；精确 390×844，移动端 `scrollWidth = 390`
- 产品截图资产：6/6，均为 1440×1000
- 自包含 SVG 图表：4/4
- PDF 渲染页数：36 页（中文 18 页 + 英文 18 页），Poppler 144 DPI
- 构建：`build-web.mjs` 与 `build-pdf-html.mjs` 均成功
- Git 检查：工作副本 `git diff --check` 通过，Task 8 三个新增文件的
  尾随空格检查通过；本轮按平台限制不暂存、不提交。上一阶段已暂存的旧
  PDF HTML 快照仍含尾随空格，当前工作副本已由构建器清理并通过 PDF 测试，
  待允许更新索引时需重新暂存 Task 7 工作副本
- 已知局限：外部用户验证与市场验证仍待进行。当前沙箱中 Electron 的
  `file://` PDF 导出不可用；Microsoft Edge fallback 生成的产物已通过
  自动化检查与 Poppler 逐页验收。当前证据只能支持实现完整性和场景级验证，
  不能替代真实使用、留存或市场需求证据。

## Recruiter delivery edition — 2026-07-29

- Added bilingual recruiter quick read before the existing ten chapters.
- Added current-language PDF, full-case, and GitHub actions in the hero.
- Added both PDF editions and GitHub actions in the footer.
- Added Chinese resume and interview material without raising any evidence classification.
- Recruiter content contract: passed.
- Focused Case Study tests: 35/35 passed.
- Echo full test suite: 151/151 passed.
- Privacy scan: passed with zero findings.
- Desktop browser review: 1440×1000, Chinese and English.
- Mobile browser review: exact 390×844 CSS viewport, Chinese and English,
  `documentElement.scrollWidth = 390`, `body.scrollWidth = 390`, and all
  four hero actions at least 44px high.
- Both PDF delivery URLs returned HTTP 200 from the local static build.
- External user validation remains pending.
