# Margin Three-Page Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved homepage-led visual system across the conversation, growth journey, and traces pages without changing the homepage's existing left-side conversation behavior.

**Architecture:** Keep `App.tsx` as the page router, replace the generic learning/memory shelves with focused page components, and put all backend-to-view transformation in a pure `paperWorkspace.ts` module. Shared visual tokens and paper primitives live in `index.css`; each page owns only its layout-specific classes.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Lucide React, CSS, Node test runner with `tsx`.

## Global Constraints

- The current `ReflectiveMargin` component and its user-right/Margin-left message behavior must not change.
- Preserve the existing notebook shell, spine, left navigation tabs, top-right ribbon, and 58% / 42% page ratio.
- Use `#34312c` primary ink, `#746d63` muted ink, `#f8f4ea` paper, `#eee7d9` deep paper, `#d8cfbf` paper edge, and `#9a7442` accent.
- Chinese uses the existing Songti stack; only the `Margin` Latin brand uses Garamond.
- Growth Journey contains no imprint or coin UI. Coins appear only in Traces.
- AI-derived observations remain read-only unless an existing confirmation callback is available; do not invent persistence.
- Keep reduced-motion support and do not add dependencies.

---

### Task 1: Pure page view models and regression tests

**Files:**
- Create: `frontend/src/viewModels/paperWorkspace.ts`
- Create: `frontend/src/viewModels/paperWorkspace.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `LearningActiveResponse`, `MemoryResponse`, `ProfileResponse`, and `AchievementResponse` from `frontend/src/lib/api.ts`.
- Produces: `buildGrowthPageModel(...)`, `buildTracePageModel(...)`, `GrowthPageModel`, and `TracePageModel` for the focused React pages.

- [ ] **Step 1: Write failing tests for three-node selection, date grouping, and recent coins**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildGrowthPageModel, buildTracePageModel } from "./paperWorkspace";

test("growth model exposes previous, current, and next only", () => {
  const model = buildGrowthPageModel({ current_learning: {
    topic: "表达观点",
    current_step_index: 1,
    step_labels: [
      { index: 0, title: "提出问题", status: "done" },
      { index: 1, title: "说完整", status: "active" },
      { index: 2, title: "回应分歧", status: "pending" },
      { index: 3, title: "主持讨论", status: "pending" },
    ],
  } });
  assert.deepEqual(model.visibleNodes.map((node) => node.title), ["提出问题", "说完整", "回应分歧"]);
});

test("traces are newest-first and grouped by actual calendar date", () => {
  const model = buildTracePageModel({ memories: [
    { id: 1, timestamp: "2026-07-09T12:00:00+08:00", memory_note: "较早" },
    { id: 2, timestamp: "2026-07-11T10:00:00+08:00", memory_note: "较新" },
  ] }, null, null);
  assert.equal(model.groups[0].dateLabel, "7 月 11 日");
  assert.equal(model.groups[0].items[0].text, "较新");
});

test("recent imprints contain unlocked records only and stop at three", () => {
  const achievements = { achievements: [1, 2, 3, 4].map((id) => ({ id, key: String(id), unlocked: id !== 4 })) };
  const model = buildTracePageModel(null, null, achievements);
  assert.equal(model.recentImprints.length, 3);
});
```

- [ ] **Step 2: Add and run the focused test command**

Add to `package.json`:

```json
"test:ui-views": "node --import tsx --test frontend/src/viewModels/paperWorkspace.test.ts"
```

Run: `npm run test:ui-views`

Expected: FAIL because `paperWorkspace.ts` does not exist.

- [ ] **Step 3: Implement the pure models**

Define explicit view types, normalize unreadable text to calm fallback copy, sort trace timestamps descending, group with `Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" })`, cap traces at ten, and select growth nodes with `slice(Math.max(0, currentIndex - 1), currentIndex + 2)`. Pending growth nodes expose `disabled: true`; unlocked achievements are sorted by `unlocked_at` and capped at three.

- [ ] **Step 4: Run model tests and UI typecheck**

Run: `npm run test:ui-views && npm run lint:ui`

Expected: both commands PASS.

- [ ] **Step 5: Commit the independently testable view-model layer**

```powershell
git add package.json frontend/src/viewModels/paperWorkspace.ts frontend/src/viewModels/paperWorkspace.test.ts
git commit -m "test: define paper workspace view models"
```

---

### Task 2: Shared visual tokens and homepage annotation sheet

**Files:**
- Create: `frontend/src/components/PaperNote.tsx`
- Create: `frontend/src/components/ConversationAnnotations.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`
- Test: `test/visualSystem.test.js`

**Interfaces:**
- Consumes: current learning summary/topic and existing growth-line callbacks from `App.tsx`.
- Produces: `PaperNote({ title, children, footer })` and `ConversationAnnotations({ seen, noticed, prompt, growthSuggestion })`.

- [ ] **Step 1: Add a failing structural CSS test**

Create `test/visualSystem.test.js` that reads `frontend/src/index.css` and asserts the exact six shared color variables, `.paper-note`, `.conversation-annotations`, `.growth-workspace`, `.trace-workspace`, and the reduced-motion selector are present.

Run: `node --test test/visualSystem.test.js`

Expected: FAIL because the new shared classes do not exist.

- [ ] **Step 2: Add the shared `PaperNote` component**

```tsx
import type { ReactNode } from "react";

export default function PaperNote({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return <section className="paper-note"><h3>{title}</h3><div>{children}</div>{footer && <footer>{footer}</footer>}</section>;
}
```

- [ ] **Step 3: Replace only the homepage right sheet**

Keep `ReflectiveMargin` untouched. Replace the journal branch's `TaskOutline` with `ConversationAnnotations` containing the exact headings “我看见的”, “我注意到”, and “还可以继续看看”. Derive restrained fallback copy from the active learning summary; render a `PaperNote` growth suggestion only when a current learning topic exists.

- [ ] **Step 4: Consolidate shared CSS tokens and component styling**

Keep the current `.notebook-frame` geometry. Add shared typography variables for page title, section title, body, and metadata; style `.paper-note` with one low-opacity border and the existing soft paper shadow. The annotation sheet retains `vellum-v1.jpg`, `rgba(247,243,234,.64)`, and the existing left shadow.

- [ ] **Step 5: Verify no homepage-left regression**

Run: `git diff -- frontend/src/components/ReflectiveMargin.tsx`

Expected: no output.

Run: `node --test test/visualSystem.test.js && npm run lint:ui && npm run build:ui`

Expected: all commands PASS.

- [ ] **Step 6: Commit the shared system and homepage right sheet**

```powershell
git add frontend/src/components/PaperNote.tsx frontend/src/components/ConversationAnnotations.tsx frontend/src/App.tsx frontend/src/index.css test/visualSystem.test.js
git commit -m "feat: align homepage annotations with paper system"
```

---

### Task 3: Focused Growth Journey workspace

**Files:**
- Create: `frontend/src/components/GrowthJourney.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/viewModels/paperWorkspace.test.ts`

**Interfaces:**
- Consumes: `GrowthPageModel`, `onCompleteStep(taskIndex)`, and the shared `PaperNote`.
- Produces: the complete `section === "learning"` page; it must not import `ImprintCollection` or achievement data.

- [ ] **Step 1: Extend the failing model test for start/end boundaries**

Add assertions that the first active node returns only current/next and the final active node returns previous/current, without fabricated nodes.

Run: `npm run test:ui-views`

Expected: FAIL until boundary normalization is implemented.

- [ ] **Step 2: Implement the two-page Growth Journey layout**

Build semantic regions for current understanding, the three observation rows, weekly experiment, date strip, one-day situation record, three-node path, and other-line paper strips. Use buttons for completed nodes, `aria-current="step"` for the active node, and disabled buttons for pending nodes.

- [ ] **Step 3: Add bounded wheel navigation**

Handle `wheel` only while the pointer is over the growth path. Accumulate direction, move one node per gesture, clamp between zero and the last started node, and call `preventDefault()` only when an in-page move occurs. Keep keyboard navigation with ArrowUp/ArrowDown.

- [ ] **Step 4: Wire real workspace data in `App.tsx`**

Call `buildGrowthPageModel(workspace.learningLine)` in `useMemo`; pass the existing `updateLearningStep` callback for the active step. Do not change backend contracts and do not render coins, achievements, or unlock notices inside the learning branch.

- [ ] **Step 5: Style against the homepage master**

Use the existing 58/42 grid, Songti hierarchy, `drafting-v1.jpg`, low-opacity blue-gray labels, and 1 px hairlines. Keep the right path spacious after removing the achievement column. Reuse `.paper-note`; do not add card borders around the understanding or path regions.

- [ ] **Step 6: Verify behavior and commit**

Run: `npm run test:ui-views && npm run lint:ui && npm run build:ui`

Expected: all commands PASS; the build contains no TypeScript or Vite warnings from `GrowthJourney`.

```powershell
git add frontend/src/components/GrowthJourney.tsx frontend/src/App.tsx frontend/src/index.css frontend/src/viewModels/paperWorkspace.test.ts frontend/src/viewModels/paperWorkspace.ts
git commit -m "feat: build focused growth journey workspace"
```

---

### Task 4: Unified Traces workspace and exclusive coin placement

**Files:**
- Create: `frontend/src/components/TraceWorkspace.tsx`
- Modify: `frontend/src/components/TraceSections.tsx`
- Modify: `frontend/src/components/ImprintCollection.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/viewModels/paperWorkspace.test.ts`

**Interfaces:**
- Consumes: `TracePageModel`, profile correction/refresh callbacks, imprint acknowledgement callbacks, and `MemorySubpage` navigation.
- Produces: the default recent-traces spread, smaller right-edge secondary indexes, compact `RecentImprintCoins`, and the existing full collection entry.

- [ ] **Step 1: Add failing tests for trace caps and readable fallbacks**

Test that only ten memories are returned, missing `memory_note` falls back to readable `insight_note` then `user_input`, invalid timestamps go into an “日期未记录” group, and coin total uses the unlocked count.

Run: `npm run test:ui-views`

Expected: FAIL until fallbacks and caps are complete.

- [ ] **Step 2: Build the default Traces spread**

Render actual-date groups on the left. One selected item may expand inline with original context and a single text action. On the right, render two “慢慢形成” signals with existing confirmation/correction controls and the compact recent-imprint stack beneath them.

- [ ] **Step 3: Convert navigation into secondary paper-edge indexes**

Keep the four existing subpage IDs. Render them at the right paper edge with `aria-current="page"`, a smaller hit target and lower contrast than `.notebook-tab`; do not change the main left navigation.

- [ ] **Step 4: Convert imprint visuals from seals to metal coins**

Create a reusable `.imprint-coin` visual used by the three-coin preview and full collection. Use a warm charcoal face, thin muted-gold rings, icon-only faces, and no adjacent labels in the preview. The full collection may retain title/description below each coin for accessibility and history browsing.

- [ ] **Step 5: Enforce exclusive placement**

Search: `Select-String -Path frontend/src/**/*.tsx -Pattern 'imprint-coin|RecentImprintCoins'`

Expected: references only in `TraceWorkspace.tsx` and `ImprintCollection.tsx`; none in `GrowthJourney.tsx` or `ConversationAnnotations.tsx`.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:ui-views && node --test test/visualSystem.test.js && npm run lint:ui && npm run build:ui`

Expected: all commands PASS.

```powershell
git add frontend/src/components/TraceWorkspace.tsx frontend/src/components/TraceSections.tsx frontend/src/components/ImprintCollection.tsx frontend/src/App.tsx frontend/src/index.css frontend/src/viewModels
git commit -m "feat: unify traces and imprint presentation"
```

---

### Task 5: Three-page visual regression and desktop verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-11-three-page-visual-system-design.md` only if implementation reveals an approved clarification.
- Create: `docs/visual-review/three-page-checklist.md`
- Create: `docs/visual-review/home.png`
- Create: `docs/visual-review/growth.png`
- Create: `docs/visual-review/traces.png`

**Interfaces:**
- Consumes: the completed React pages and the approved design spec.
- Produces: reproducible evidence that the three pages share one system and remain usable at desktop and narrow widths.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test && npm run test:ui-views && npm run lint:ui && npm run build:ui`

Expected: every command exits zero.

- [ ] **Step 2: Launch the desktop UI and capture the three pages at one viewport**

Run: `npm run desktop`

Capture homepage, Growth Journey, and Traces at the same application size. Do not resize between captures; save them under `docs/visual-review/` with the filenames above.

- [ ] **Step 3: Complete the visual checklist**

Record pass/fail for: identical shell crop, tab position, ribbon size, 58/42 split, content insets, title scale, body scale, hairline opacity, paper shadow, reduced-motion behavior, no Growth coins, and exactly three overlapping recent coins in Traces.

- [ ] **Step 4: Verify responsive behavior**

At widths near 800 px and 620 px, verify that content remains reachable, wheel navigation does not trap page scrolling at its bounds, secondary trace indexes do not cover text, and no horizontal overflow hides controls.

- [ ] **Step 5: Commit visual evidence**

```powershell
git add docs/visual-review docs/superpowers/specs/2026-07-11-three-page-visual-system-design.md
git commit -m "docs: verify unified three-page visual system"
```
