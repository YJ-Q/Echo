# Echo 设计规范部件映射

日期：2026-07-07

## 目标

本文档用于把当前系统中已经存在的真实部件，逐步映射进 Echo 的设计规范。

它不重新定义产品方向，而是回答两个更落地的问题：

1. 当前代码里已经有哪些界面部件
2. 这些部件在新的设计规范下应该分别承担什么气质、优先级和表达方式

本文档应与以下文档一起使用：

- [PRODUCT_POSITIONING_V2.md](/D:/Echo/docs/PRODUCT_POSITIONING_V2.md)
- [NOW_PAGE_INFORMATION_ARCHITECTURE.md](/D:/Echo/docs/NOW_PAGE_INFORMATION_ARCHITECTURE.md)
- [NOW_PAGE_WIREFRAME_SPEC.md](/D:/Echo/docs/NOW_PAGE_WIREFRAME_SPEC.md)
- [DESIGN_IMAGERY.md](/D:/Echo/docs/DESIGN_IMAGERY.md)

---

## 1. 当前系统中的主要页面与部件

根据当前前端结构，系统已经存在以下页面层级：

### 一级页面

- `此刻`
- `学习`
- `行动`
- `反思`
- `记忆`

### 全局框架部件

- `Launch Screen`
- `Navigation Rail`
- `App Titlebar`
- `Center Column`
- `Status Column`
- `Toast`

### 此刻页主要部件

- `Now Arrival Card`
- `Hero Orbit Visual`
- `Arrival Focus Card`
- `Arrival Next Card`
- `Conversation Board`
- `Timeline Panel`
- `Quick Prompts`
- `Composer`
- `Status Workbench`

### 学习页主要部件

- `Learn Hero`
- `Learn Steps List`
- `Learn Current Step`

### 行动页主要部件

- `Actions Hero`
- `Current Task Card`
- `Suggested Action Form`
- `Manual Action Form`
- `Action List`

### 反思页主要部件

- `Reflection Hero`
- `Reflection Summary Cards`
- `Reflection Trend Area`
- `Reflection History`

### 记忆页主要部件

- `Memory Hero`
- `Memory Tags`
- `Memory Clusters`
- `Memory List`
- `Memory Profile Summary`

---

## 2. 映射原则

在补充设计规范时，当前所有部件都应遵守以下原则：

1. 先保证“接住”，再讨论“组织”
2. 对话相关部件优先于结构化卡片
3. 同一时刻只能有一个主线焦点
4. 右侧工作台是辅助，不是中心
5. 成长与记忆要像“被保留的痕迹”，不能像“被管理的数据”
6. 动效的任务是建立在场感，不是制造表演感

---

## 3. 全局框架映射

## 3.1 Launch Screen

当前部件：

- `#launch-screen`
- `launch-mark`
- `launch-title`
- `launch-copy`

设计定位：

> Echo 进入当前状态前的短暂过渡层

应传达：

- 正在进入一个安静、持续的空间
- 系统在准备“当前状态”，不是在炫示启动能力

设计要求：

- 时长短
- 反馈轻
- 不做强科技感启动动画
- 文案应偏“接入当前状态”，而不是“系统初始化”

不应变成：

- 品牌开场秀
- 强 AI loading

## 3.2 Navigation Rail

当前部件：

- `.nav-rail`
- `.nav-item`
- `.nav-presence`

设计定位：

> Echo 的稳定坐标轴

应传达：

- 页面结构稳定
- 用户随时可以切换，但不会被导航本身干扰

设计要求：

- 保持低噪声
- 当前页高亮清楚
- 不堆状态数字
- Presence 只做轻提示，不做系统监控感

Gemini 方向可并入的点：

- 深色侧栏可以保留，但应减少“控制台感”
- 如果整体主风格切到暖纸体系，侧栏也应从冷蓝黑转向更克制的深墨色

## 3.3 App Titlebar

当前部件：

- `.app-titlebar`
- `.titlebar-brand`
- `.titlebar-status`

设计定位：

> 桌面应用外壳，不参与主情绪竞争

应传达：

- Echo 是一个桌面陪伴体
- 但标题栏不是主视觉重点

设计要求：

- 降低存在感
- 保留轻量品牌身份
- 状态 chip 不要超过必要数量
- 不要让标题栏像后台状态中心

## 3.4 Status Column

当前部件：

- `.status-column`
- 多张 `instrument-panel`

设计定位：

> 此刻页的连续性辅助轨

应传达：

- 旁边有被轻轻保留的重要线索
- 这些信息是辅助扫读，不是操作主场

设计要求：

- 卡片数量克制
- 强弱明显
- 不能比中间对话更“像主角”
- 当前版本中更接近文字型辅助轨，而不是成组白卡工作台
- 优先通过排版、间距与细分隔线组织信息，不依赖重边框和容器阴影

当前风险：

- 如果视觉对比太强，容易重新滑回仪表盘感

---

## 4. 此刻页部件映射

## 4.1 Now Arrival Card

当前部件：

- `.now-arrival-card`
- `#hero-emotion`
- `#hero-copy`

设计定位：

> 此刻页的“接住区”

这是当前系统中最需要与新设计规范对齐的部件。

应传达：

- 你现在处于什么状态
- Echo 已经接到你了
- 这里不会立刻要求你行动

设计要求：

- 首屏先看到状态，再看到任务
- 文案短，语气稳
- 留白充足
- 不使用强操作型视觉语言
- 当前版本中，这个部件应缩成页首引子，而不是占据过大高度的首屏主块
- 不允许再引入百分比、进度条、学习比率、统计标签等推进性量化元素

Gemini 方向可并入的点：

- 更暖的背景与更柔的边界
- 更像纸面上的接住，而不是蓝色效率卡

## 4.2 Hero Orbit Visual

当前部件：

- `.hero-orbit`
- `.hero-orbit-core`

设计定位：

> Echo 的轻量在场感

应传达：

- Echo 在
- 但它不是主角角色

设计要求：

- 只能是 presence，不应长成 mascot
- 动效应接近“呼吸”
- 不应太像进度仪表或能量核心

当前风险：

- 现在的环形视觉容易带一点“科技状态仪”意味

建议方向：

- 如果延续 Gemini 的暖纸方向，这个视觉需要从冷蓝环形收束成更柔和、更低科技感的在场标记
- 当前实现中，它更适合作为小体积微光存在物，不能重新膨胀成主视觉中心
- 后续若继续收敛，应优先减少几何仪表感，而不是增加动画戏剧性

## 4.3 Arrival Focus Card

当前部件：

- `#hero-focus-topic`
- `#hero-focus-context`

设计定位：

> 活着的那条线的上下文提示

应传达：

- 最近真正还在继续的主题是什么

设计要求：

- 更像“线索仍在”
- 不像“项目状态”
- 使用文字化连续性说明，不使用比分、步数、完成度或量化学习信号

## 4.4 Arrival Next Card

当前部件：

- `#hero-next-action`
- `#hero-next-copy`
- `#hero-next-context`
- `#hero-start-action`

设计定位：

> 此刻页的主 continuation card

应传达：

- 现在最值得继续的一步是什么
- 这一步足够小
- 可以把它带回对话，而不是马上执行

设计要求：

- 全页唯一主推进点
- CTA 清楚但不强压
- 进度提示文字化
- 行动入口更接近邀请式文字按钮，而不是高压 CTA

当前风险：

- 如果重新引入进度条和百分比，会让它立刻滑回任务推进卡

## 4.5 Conversation Board

当前部件：

- `.conversation-board`
- `#timeline-panel`
- `.quick-prompt`
- `#composer-form`

设计定位：

> Echo 的主关系面

这是整个产品最核心的部件。

应传达：

- 这里最容易开口
- 这里最容易继续
- 这里不是消息工具，而是陪伴中的对话流

设计要求：

- 视觉中心必须足够稳
- 气泡节奏舒适
- 快捷提示贴近输入，不抢主注意力
- 输入框保持持续可用
- 当前版本中，对话区应去盒子化，避免被感知为客服聊天组件
- 结构化边框与厚重阴影必须退后，让“关系空间”而不是“组件容器”成为主感受

Gemini 方向可并入的点：

- “对话即中心”的判断可以正式写入规范
- 视觉上让结构化卡片退后，让对话面真正成为主场

## 4.6 Timeline Panel

当前部件：

- `.timeline-row`
- `.timeline-copy`
- `.typing-line`

设计定位：

> 当前关系正在发生的地方

应传达：

- Echo 的回复是正在形成的，不是一次性抛出的
- 用户可以中途继续表达

设计要求：

- Echo 与用户有清楚区分
- Echo 的回复更像排版返还，允许仅靠细线、缩进与留白区分
- 用户消息比 Echo 更接近输入动作，可保留极淡底色但不做硬边框
- typing 反馈应非常轻，并保持文字化

建议补入规范：

- 支持分段式回复
- Echo 可先短句出现，再继续展开
- 正在回应状态不应制造等待焦虑
- 回合间距应明显大于传统 IM 界面

## 4.7 Quick Prompts

当前部件：

- `.quick-prompt`

设计定位：

> 降低继续说话门槛的低压入口

应传达：

- 我可以从这里轻轻接上

设计要求：

- 像邀请，不像快捷命令
- 根据状态变化文案
- 数量控制在 2 到 4 个

## 4.8 Composer

当前部件：

- `#composer-input`
- `#composer-submit`
- `#play-latest-echo`

设计定位：

> 用户发出信号的主入口

应传达：

- 我随时能继续说
- 系统不会因为正在回应而封住我

设计要求：

- 输入优先级高于辅助按钮
- 主按钮稳定明确
- placeholder 保持柔和，不命令

---

## 5. 右侧工作台部件映射

## 5.1 当前状态卡

当前部件：

- `#emotion-label`
- `#emotion-copy`
- `#emotion-note`

设计定位：

> 对主状态的轻量复述

设计要求：

- 比 hero 弱
- 不是监测仪
- 当前状态说明以文字复述为主
- 不使用波形、心电、声纹或设备型状态反馈

## 5.2 专注卡

当前部件：

- `#focus-title`
- `#focus-note`

设计定位：

> 当前主线的轻量聚焦提示

设计要求：

- 保留“当前主线”感觉
- 弱化“百分比管理”
- 用一句轻量说明表达“这条线仍在”，不再使用完成度信号

## 5.3 下一步行动卡

当前部件：

- `#action-title`
- `#action-copy`
- `#start-next-action`

设计定位：

> 旁侧的 continuation 锚点

设计要求：

- 只能辅助 hero，不可与 hero 抢主位

## 5.4 学习线卡

当前部件：

- `#learning-topic`
- `#learning-step-copy`
- `#learning-note`

设计定位：

> 当前学习线仍然活着的证据

设计要求：

- 只显示当前主线
- 不展开完整学习结构
- 不使用分段格、步数比分或阶段进度条
- 更像“当前学习还活着的证据”，而不是课程流程追踪器

## 5.5 连续性卡

当前部件：

- `#reflection-side-trend`
- `#reflection-side-copy`

设计定位：

> 最近成长与反思的轻量痕迹

设计要求：

- 更像痕迹
- 更像提示
- 不能像报告摘要

---

## 6. 其他页面映射

## 6.1 学习页

当前部件：

- `#learn-topic`
- `#learn-steps-list`
- `#learn-current-step-title`
- `#learn-current-step-copy`

设计定位：

> 把“继续学习”压缩成当前一步的地方

设计重点：

- 当前一步
- 线性推进
- 不做课程平台感

## 6.2 行动页

当前部件：

- `#actions-current-task`
- `#action-list`
- `#suggested-action-form`
- `#manual-action-form`

设计定位：

> 从噪声里守住一个当前主任务

设计重点：

- 主任务前置
- 队列弱化
- 手动与建议入口清楚但不过多

## 6.3 反思页

当前部件：

- `#reflection-summary-copy`
- `#reflection-echo-copy`
- `#reflection-pattern-copy`
- `#reflection-history`

设计定位：

> 已发生内容中的模式慢慢浮现

设计重点：

- 命名模式
- 历史轻量堆叠
- 不做复杂分析大屏

## 6.4 记忆页

当前部件：

- `#memory-tags`
- `#memory-clusters`
- `#memory-list`
- `#memory-profile-summary`

设计定位：

> 只保留真正重要的连续性片段

设计重点：

- 标签与片段应像“保留的痕迹”
- 避免数据库感
- 避免监控感

---

## 7. 当前最值得优先补进规范的部分

如果我们按优先级逐步补，我建议先从下面 5 个部件开始：

1. `Now Arrival Card`
2. `Hero Orbit Visual`
3. `Conversation Board`
4. `Timeline Panel`
5. `Status Column`

原因是：

- 这 5 个部件最直接决定 Echo 第一眼像不像 Echo
- 它们同时也是当前系统里最容易受旧风格影响的区域
- Gemini 这次给出的新方向，主要也是在这几块上最有价值

---

## 8. 下一步建议

接下来可以按下面顺序继续补全：

1. 先补 `此刻页` 的详细视觉规范
2. 再补右侧工作台的强弱与降噪规则
3. 再补 `学习 / 行动 / 反思 / 记忆` 四页的页面级气质差异
4. 最后统一整理成完整的视觉规范文档
---

## Material Mapping Addendum

This addendum records the now-confirmed tactile direction for the current Echo system so later component refinements do not drift back toward dashboard or tool-console language.

### Global Material Decision

- Primary material family: warm cotton paper
- Secondary overlay family: translucent vellum / tracing paper
- Micro-state accent family: matte ceramic / diffused frosted glow
- Explicitly avoid as global language: plaster + raw wood, heavy object blocks, glossy glass, metallic control surfaces

### Component Notes

#### `Now Arrival Card`

- Map to a slightly lifted paper sheet, not a task slab
- Reinforce emotional holding and current-line continuity through typography and soft paper depth

#### `Hero Orbit Visual`

- Map to embedded warm glow under frosted / paper-like surface
- Never map to ring gauge, radar, or energy-core visual logic

#### `Conversation Board`

- Map to the main paper ground itself
- Echo responses should feel printed / returned on the surface, not boxed as equal-strength message cards

#### `Timeline Panel`

- Map continuity to a pressed trace, faint line, or fiber-like continuation mark
- Do not map continuity to progress rails or illuminated process tracks

#### `Status Column`

- Map to side-layered vellum / note-overlay logic
- Do not map to a white-card workbench or instrument cluster

#### `Learn / Actions`

- Keep within the same paper family
- Allow slightly more structured paper segmentation, but not heavier object metaphors

#### `Reflections / Memory`

- Lean further into retained traces, fragments, overlays, and named patterns
- Avoid archive furniture, drawers, binders, or database-object metaphors
