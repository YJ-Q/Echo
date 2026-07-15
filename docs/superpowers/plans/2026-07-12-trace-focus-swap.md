# Trace Focus Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Traces subpage navigation with a fixed three-slot layout that swaps the focused content into the large left region.

**Architecture:** `TraceWorkspace` owns two independent states: `TraceFocus` (`traces`, `patterns`, `imprints`) and `TraceMode` (`recent`, `kept`). Pure slot-resolution helpers determine which panel occupies the left, right-top, and right-bottom positions; existing memory, profile, and achievement callbacks remain unchanged.

**Tech Stack:** React 19, TypeScript 5.8, CSS, Node test runner with `tsx`.

## Global Constraints

- Remove the right-edge `TraceSectionNav` from the rendered memory page.
- Keep the notebook shell as the only full-page paper surface.
- Default slots are left `traces`, right-top `patterns`, and right-bottom `imprints`.
- `recent` and `kept` are modes of the same trace slot, not separate page focus values.
- Focusing patterns or imprints swaps that panel with the current trace slot.
- No backend contract changes and no new dependency.

---

### Task 1: Pure slot resolver and trace-mode data

**Files:**
- Modify: `frontend/src/viewModels/paperWorkspace.ts`
- Modify: `frontend/src/viewModels/paperWorkspace.test.ts`

**Interfaces:**
- Produces: `resolveTraceSlots(focus: TraceFocus): { left: TracePanel; rightTop: TracePanel; rightBottom: TracePanel }`.

- [x] Write failing tests for all three focus matrices.
- [x] Run `npm run test:ui-views` and observe missing resolver failures.
- [x] Implement the exact three mappings without UI concerns.
- [x] Run `npm run test:ui-views` and expect PASS.

### Task 2: Replace subpages with slot exchange

**Files:**
- Modify: `frontend/src/components/TraceWorkspace.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`
- Modify: `test/traceWorkspace.test.js`

**Interfaces:**
- `TraceWorkspace` consumes recent trace model, kept shelf items, profile callbacks, achievement callbacks, and management callback.
- It owns `focus` and `traceMode` and renders all three panels in resolved slots.

- [x] Write a failing structural test requiring focus/mode state and forbidding `TraceSectionNav` in `App.tsx`.
- [x] Remove memory subpage state and render one `TraceWorkspace` instance.
- [x] Add recent/long-term toggle beside the trace heading.
- [x] Render compact trace, pattern, and imprint panels in their resolved right-side slots.
- [x] Preserve full profile correction and imprint collection functionality inside the left focused panel.
- [x] Run `node --test test/traceWorkspace.test.js && npm run lint:ui && npm run build:ui` and expect PASS.

### Task 3: Regression and visual verification

**Files:**
- Modify: `frontend/src/index.css`
- Test: `test/visualSystem.test.js`

- [x] Verify default, kept, patterns-focused, and imprints-focused states in the desktop app.
- [x] Verify no full-page backgrounds, right-edge tabs, clipped controls, or dead-end states.
- [x] Run `npm test && npm run test:ui-views && npm run lint:ui && npm run build:ui`.
- [x] Commit with `git commit -m "feat: swap trace focus within fixed spread"`.
