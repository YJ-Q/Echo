# Echo Now Page Information Architecture

Date: 2026-07-07

## Goal

Define what the `Now` page should prioritize, what it should de-emphasize, and how it should adapt to different user states.

The `Now` page is Echo's main doorway.

It should not feel like:
- a dashboard
- a task list
- a reporting panel

It should feel like:
- a place that receives the user
- a place that knows what line is still alive
- a place where the next step is available without pressure

## One-Line Definition

The `Now` page is where Echo receives the user's current state, keeps the relationship continuous, and gently surfaces the smallest useful continuation.

## First-Screen Questions

Within a few seconds, the page should answer:

1. What state am I in right now
2. Is Echo still with me
3. What line is currently alive
4. If I want to continue, what is the smallest next step

It should not make the user answer:

- which tab should I go to first
- which metric matters most
- which card is the real focus

## Information Priority

The `Now` page should prioritize information in this order:

1. current emotional or situational state
2. active conversation space
3. current continuation line
4. next small step
5. supporting continuity signals

This means:
- the page is state-first
- conversation is central
- structured data supports the conversation, not the other way around

## Primary Zones

The `Now` page should have five functional zones:

1. page identity
2. state receiving area
3. conversation area
4. continuation area
5. continuity support area

## 1. Page Identity

Purpose:
- tell the user they are in the main living space of Echo

Should include:
- page title
- a gentle subtitle
- a light continuity chip if useful

Should not include:
- too many status pills
- dense utility controls
- numerical summaries as the first visual emphasis

Good direction:
- calm
- spacious
- low cognitive load

## 2. State Receiving Area

Purpose:
- receive the user before asking them to do anything

This is the top emotional anchor of the page.

Should include:
- current emotional/state label
- one short state-aware sentence
- current focus if available

Examples of content:
- 焦虑 / 分散 / 平静 / 有动力
- “现在不用一下解决全部”
- “这条线还停在 JavaScript”

Should not include:
- long reports
- too many data points
- task-heavy visual language

This area should feel like:
- Echo sees where the user is

## 3. Conversation Area

Purpose:
- remain the central live interaction space

This is the core of the page.

Should include:
- recent conversation flow
- quick entry prompts
- input area
- gentle streaming behavior

Design rule:
- conversation should remain visually central
- the page must not make side cards feel more important than the dialogue itself

Behavior rule:
- user should always be able to return to speaking with minimal friction

## 4. Continuation Area

Purpose:
- surface the one most relevant line that can be continued

This is not a task queue.
It is a continuation anchor.

Should include:
- current line title
- one-sentence context
- smallest next step
- one simple “bring back to chat” or “continue here” action

Possible sources:
- active learning step
- current action
- resumed pending line
- recent reflection if no active line exists

Rules:
- only one main continuation focus at a time
- if there are many possible items, one must be promoted and the rest de-emphasized

## 5. Continuity Support Area

Purpose:
- lightly remind the user that Echo remembers and tracks growth

Should include only lightweight supporting signals such as:
- recent reflection trend
- memory hint
- growth signal
- active learning ratio

Should not:
- dominate the page
- feel like a BI dashboard
- compete with conversation or the main continuation line

## What The Page Should De-Emphasize

The `Now` page should avoid foregrounding:

- full task queues
- long memory lists
- complex history
- detailed learning management controls
- analytics-heavy summaries

These belong to their own pages.

The `Now` page should point toward them, not become them.

## Three Main Adaptive States

The `Now` page should visibly adapt to three main user states:

1. `vent`
2. `casual`
3. `action`

A bridge `reflect` state can sit between `vent` and `action`.

## State A. Vent

Meaning:
- the user is overwhelmed, tired, upset, or emotionally loaded

Page priority in this state:

1. receiving the user
2. reducing pressure
3. keeping conversation easy
4. delaying structured action

Visual behavior:
- softer emphasis
- reduced progress pressure
- continuation card can stay present but secondary

Content behavior:
- state copy becomes warmer and simpler
- quick prompts should support expression, not execution

Examples:
- “先说说现在最压你的那一块”
- “我们先不急着安排”

Should avoid:
- dominant task CTA
- obvious productivity language
- large action-oriented progress emphasis

## State B. Casual

Meaning:
- the user is chatting lightly
- they want companionship more than structure

Page priority in this state:

1. preserve comfort
2. keep chat central
3. surface continuity lightly

Visual behavior:
- balanced layout
- no heavy emotional styling
- no strong push toward action

Content behavior:
- quick prompts can be lighter
- continuity cards stay available but quiet

## State C. Reflect

Meaning:
- the user is trying to understand a pattern
- the user is reviewing themselves

Page priority in this state:

1. clarify the pattern
2. keep emotional safety
3. offer a light bridge to action

Visual behavior:
- reflection-related support card can become slightly more visible
- continuation card should suggest “one small next step” rather than a task block

## State D. Action

Meaning:
- the user is ready to continue
- the user asks for a next step
- the user is inside an active line

Page priority in this state:

1. clear current line
2. clear smallest next step
3. frictionless continuation
4. keep conversation available

Visual behavior:
- continuation area can become stronger
- progress visualization can become more visible
- state card should still remain supportive, not disappear

Content behavior:
- prompts can shift toward execution and unblock language

Examples:
- “继续这一步”
- “把当前卡点带回对话”
- “先完成这个最小动作”

## Required Home Page Behaviors

The `Now` page should always support:

- immediate talking
- visible current state
- visible active line if one exists
- one-click return to the next step
- subtle continuity cues

## Things The Home Page Must Not Become

It must not become:

- a full planner
- a full study board
- a memory explorer
- a metrics-heavy report page

If the page becomes crowded with too many useful things, it will stop receiving the user well.

## Suggested First-Screen Structure

Recommended top-to-bottom emphasis:

1. title and page identity
2. state receiving block
3. main continuation block
4. conversation block
5. light continuity side/support information

Alternative interpretation:
- if conversation is visually central, the receiving block and continuation block should frame it, not push it down too far

## Good First-Screen Signals

Good first-screen signals:
- “Echo sees my state”
- “there is one live line I can continue”
- “I can just talk if I want”
- “I am not being managed”

Bad first-screen signals:
- “I need to process this interface before I can use it”
- “I am being measured”
- “I am already behind”

## Relationship To Other Pages

The `Now` page should hand off to deeper pages:

- `Learn` for step management
- `Actions` for queue management
- `Reflections` for deeper review
- `Memory` for structured recall and profile-level reading

The `Now` page should only carry the most relevant preview of each.

## Success Standard

The `Now` page is successful when:

- a distressed user feels received
- a casual user feels comfortable staying
- a ready user can continue quickly
- the page feels alive and relational rather than operational
