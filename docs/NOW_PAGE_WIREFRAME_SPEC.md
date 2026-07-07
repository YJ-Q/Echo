# Echo Now Page Wireframe Spec

Date: 2026-07-07

## Goal

Translate the `Now` page information architecture into a wireframe-level structure that can guide UI design and implementation.

This document focuses on:
- modules
- layout relationships
- content priority
- adaptive state behavior
- interaction entry points

It does not define:
- final visual style
- color system
- animation polish
- typography details

## Page Role

The `Now` page is the main living surface of Echo.

It should feel like:
- the first place to return to
- the easiest place to speak
- the clearest place to continue

## Wireframe Principle

The page should be built around:

1. receiving
2. conversation
3. continuation

Everything else is supportive.

## Core Module List

The page should contain these modules:

1. global shell
2. page header
3. state hero
4. continuation card
5. conversation stream
6. quick prompt strip
7. composer
8. continuity support rail

## Module Priority

Priority order:

1. conversation stream + composer
2. state hero
3. continuation card
4. continuity support rail
5. auxiliary chips and metadata

## Recommended Layout

Desktop layout:

```text
App Shell
├─ Left Navigation
└─ Main Surface
   ├─ Header Row
   ├─ Top Zone
   │  ├─ State Hero
   │  └─ Continuation Card
   └─ Main Zone
      ├─ Conversation Column
      │  ├─ Conversation Stream
      │  ├─ Quick Prompt Strip
      │  └─ Composer
      └─ Continuity Support Rail
         ├─ Current Focus
         ├─ Learning Signal
         ├─ Reflection Hint
         └─ Memory Hint
```

Core interpretation:
- top zone sets emotional and directional context
- conversation column stays central
- support rail remains secondary

## 1. Global Shell

Purpose:
- frame the page within Echo

Should include:
- left navigation
- stable page container
- low-noise application identity

Should not include:
- too many controls
- dense system indicators

## 2. Page Header

Purpose:
- orient the user without competing with the main emotional layer

Should include:
- page title
- one short subtitle
- light presence indicator if useful
- time only if it supports atmosphere and continuity

Good examples:
- `此刻`
- `先接住此刻，再决定往哪里走`

Should avoid:
- control-heavy toolbars
- dense badge clusters

## 3. State Hero

Purpose:
- receive the user before asking anything from them

This is the emotional entry zone.

Should include:
- current state label
- one short receiving sentence
- current focus signal if present

Content shape:
- current state word
- one supportive sentence
- one lightweight context line

Examples:
- `有点乱`
- `现在不用一下理清全部`
- `最近的线还停在 JavaScript`

Wireframe structure:

```text
State Hero
├─ Kicker: 当前状态
├─ State Word
├─ State Sentence
└─ Context Hint
```

## 4. Continuation Card

Purpose:
- surface the single most alive continuation

This is not a task board.
It is the page's directional anchor.

Should include:
- what line is alive
- what the smallest next step is
- one action to bring it back into chat

Wireframe structure:

```text
Continuation Card
├─ Kicker: 下一步 / 当前线索
├─ Current Line Title
├─ One-Sentence Description
├─ Small Progress Signal (optional)
└─ CTA: 带回对话 / 继续这一步
```

Rules:
- only one primary continuation card
- no queue dump
- no multiple competing CTAs

## 5. Conversation Stream

Purpose:
- remain the true center of interaction

Should include:
- recent user and Echo turns
- support segmented replies
- support streaming behavior

Wireframe requirements:
- clear distinction between user and Echo turns
- comfortable vertical rhythm
- enough space for short multi-part Echo responses

Should support:
- quick interruption by the user
- partial output feeling natural

## 6. Quick Prompt Strip

Purpose:
- reduce activation friction

This should sit close to the composer and reflect the current state.

Examples by state:

Vent:
- `先说最压你的那一块`
- `我现在有点乱`
- `先别推任务`

Reflect:
- `我发现自己又卡在开始`
- `帮我看清这次卡点`

Action:
- `继续这一步`
- `把当前卡点带回对话`
- `我做完上一步了`

Rules:
- 2 to 4 prompts
- dynamic by state
- should not feel like command shortcuts

## 7. Composer

Purpose:
- make speaking easy

Should include:
- text input
- send action
- optional lightweight voice/TTS entry later if needed

Behavior:
- user should never feel blocked from typing
- Echo should not monopolize the floor while responding

Placeholder direction:
- softer than a standard command prompt

Good examples:
- `继续说说你现在最想先理清的一件事`
- `如果你想继续 我在这里接着听`

## 8. Continuity Support Rail

Purpose:
- remind the user that Echo remembers and tracks growth

This rail is supportive, not primary.

Suggested cards:

1. Current Focus
2. Learning Signal
3. Reflection Hint
4. Memory Hint

### Current Focus Card

Purpose:
- summarize the current line in one glance

Should include:
- focus topic
- one-line focus summary

### Learning Signal Card

Purpose:
- show whether a learning line is alive

Should include:
- topic
- current step or progress ratio

Should avoid:
- full step management

### Reflection Hint Card

Purpose:
- lightly expose the most recent insight or pattern

Should include:
- one reflection phrase
- one short summary line

Should avoid:
- long reflection text

### Memory Hint Card

Purpose:
- show that Echo remembers something important

Should include:
- one compact memory anchor
- no dense list

## State Variants

## Variant A. Vent State

Layout behavior:
- state hero becomes visually strongest
- continuation card stays visible but softened
- support rail becomes quieter

Conversation behavior:
- stream should dominate
- prompts should support expression

Prompt examples:
- `先说说最压你的那一块`
- `我现在有点乱`
- `先陪我理一理`

CTA behavior:
- avoid hard action CTAs

## Variant B. Casual State

Layout behavior:
- balanced weight between state hero and conversation
- continuation card stays available but not pushy

Conversation behavior:
- prompts can be lighter and more open

Prompt examples:
- `我来和你说一句`
- `继续刚才的话`
- `记下这个小细节`

## Variant C. Reflect State

Layout behavior:
- reflection hint can become slightly more prominent
- continuation card should shift from “do this” to “see this clearly”

Prompt examples:
- `我是不是又卡在同一个地方`
- `帮我看清这次的模式`
- `把它缩成一句话`

## Variant D. Action State

Layout behavior:
- continuation card becomes stronger
- learning signal becomes more relevant
- state hero still remains warm and present

Prompt examples:
- `继续这一步`
- `我做完上一步了`
- `把这个卡点拆小一点`

CTA behavior:
- one clear action-oriented continuation CTA is appropriate

## Module Behavior Rules

### If there is an active learning line

Show:
- continuation card sourced from learning
- learning signal card with topic and current step

Do not:
- dump the full learning structure on the home page

### If there is an active action but no learning line

Show:
- continuation card sourced from action
- focus card tied to that task

### If there is no active line

Show:
- stronger state hero
- lighter reflection or memory hint
- conversation-first orientation

## Mobile / Narrow Width Behavior

On narrower layouts:

Recommended order:

1. header
2. state hero
3. continuation card
4. conversation stream
5. quick prompts
6. composer
7. continuity support cards

Support rail should collapse into stacked cards below the conversation column.

## Interaction Checklist

The `Now` page should support these actions without friction:

- start talking immediately
- continue the current line
- bring a suggested step into chat
- notice recent growth lightly
- return from another page and immediately know where things stand

## Things To Exclude From The Now Page

Do not place these as main modules:

- full task queue editor
- full learning step board
- deep memory browser
- long reflection history
- analytics dashboard

## Success Criteria

The wireframe is correct when:

- the user can understand the page in a glance
- the conversation remains central
- the continuation line is singular and clear
- emotional arrival is supported before execution
- the page adapts meaningfully to user state
