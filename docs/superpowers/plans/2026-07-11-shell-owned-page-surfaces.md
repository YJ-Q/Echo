# Shell-Owned Page Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove full-page overlays from Growth Journey and Traces so the notebook shell is the only structural paper layer.

**Architecture:** Keep all React page layouts and data flow unchanged. Make `.section-paper`, `.section-paper-learning`, `.section-paper-memory`, `.growth-path-page`, and page-level archive surfaces transparent; retain material only on bounded physical components such as `.paper-note` and imprint coins.

**Tech Stack:** React 19, TypeScript 5.8, CSS, Node test runner.

## Global Constraints

- `frontend/src/assets/notebook-shell-v1.png` exclusively owns full-page geometry, vellum, edges, and shadow.
- Growth Journey and Traces root surfaces must not load `drafting-v1.jpg` or `archive-cotton-v1.jpg`.
- Page root surfaces must have transparent backgrounds, no borders, and no box shadows.
- Local physical components keep their existing bounded materials.
- Do not change page content, interactions, data contracts, or the homepage conversation layout.

---

### Task 1: Remove full-page paper overlays

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `test/visualSystem.test.js`
- Modify: `test/growthJourney.test.js`

**Interfaces:**
- Consumes: existing `notebook-frame`, `GrowthJourney`, `ShelfView`, `TraceSections`, and `ImprintCollection` markup.
- Produces: transparent page-level surfaces that preserve the shell image at every viewport size.

- [ ] **Step 1: Write failing CSS ownership tests**

Assert that `.section-paper` has `border: 0`, `box-shadow: none`, and `background: transparent`; assert that learning and memory page selectors do not contain full-page material URLs; assert `.growth-path-page` is transparent.

- [ ] **Step 2: Run the tests and observe the overlay failure**

Run: `node --test test/visualSystem.test.js test/growthJourney.test.js`

Expected: FAIL because the existing selectors still paint paper textures and shadows.

- [ ] **Step 3: Make only page-level surfaces transparent**

Replace full-page backgrounds, borders, and shadows with transparent/no-op values. Do not edit `.paper-note`, `.imprint-coin`, or bounded record panels.

- [ ] **Step 4: Verify behavior and build**

Run: `node --test test/visualSystem.test.js test/growthJourney.test.js && npm run test:ui-views && npm run lint:ui && npm run build:ui && npm test`

Expected: all commands PASS.

- [ ] **Step 5: Reopen the desktop app and visually verify**

Check Growth Journey and Traces at the same window size. The notebook edges, center seam, right vellum, and ribbon must remain visible without rectangular overlay edges.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/index.css test/visualSystem.test.js test/growthJourney.test.js docs/superpowers/specs/2026-07-11-three-page-visual-system-design.md docs/superpowers/plans/2026-07-11-shell-owned-page-surfaces.md
git commit -m "fix: let notebook shell own page surfaces"
```
