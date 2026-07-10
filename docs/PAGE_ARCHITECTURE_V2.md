# Margin Page Architecture V2

Date: 2026-07-10

Status: supporting page reference; `PRODUCT_DESIGN_BLUEPRINT_V1.md` is the approved source of truth

## 1. Correct Physical Model

Margin is not an open book with a structural center binding.

The primary scene is a stack of paper on a desk:

- one uninterrupted cotton writing sheet forms the conversation surface
- a translucent vellum sheet covers the right side of that writing sheet on the home page
- the vellum sheet's left-edge shadow creates the apparent vertical division
- the writing sheet continues underneath the vellum
- side tabs identify different top sheets or working sections, not book chapters

This distinction is important. The shadow line must move with the vellum layer and must not be baked into the base paper.

## 2. Navigation

The product keeps four sections:

1. `思考片段` - arrival and conversation
2. `学习轨迹` - the expanded active learning line
3. `留痕` - selected traces, reflections, and patterns that were kept
4. `整理计划` - review and confirm reversible cleanup work

`记忆回声` is retired because it belongs to the previous Echo identity. The internal API and persistence key `memory` remain unchanged for compatibility.

## 3. Functional Inventory

### Ready And Already Connected

- conversation and reflective replies
- optional read-aloud
- active learning session and step updates
- action status updates
- recent memories and distilled memory notes
- daily reflection generation and recent summaries
- achievement-derived change markers
- management overview, proposal drafting, confirmation, and cancellation

### Ready In The Backend But Not Properly Exposed

- state-level current action and next continuation
- learning event history
- memory pinning and priority calibration
- profile review, refresh, and manual correction
- management operation history
- manual and suggested action creation

### Contract Gaps To Fix Before UI Exposure

- management overview advertises operations such as `merge`, `rename`, and `reprioritize`
- the executor currently supports review/no-op, action dismissal, memory archive/pin, and learning archive
- unsupported suggestions must be hidden or marked unavailable until execution support exists
- destructive proposals are intentionally blocked and must not be presented as ordinary confirmable actions

## 4. Home - 思考片段

### Material

- base: uninterrupted warm cotton writing paper
- overlay: translucent warm-gray vellum occupying the right portion
- boundary: the vellum's soft cast shadow, not a center fold

### Function

- left writing area: conversation and input
- right vellum: compact current learning line
- optional read-aloud remains attached to individual passages
- no dashboard counts or management controls

### Empty State

If no learning line exists, the vellum remains quiet and invites the user to name one line worth continuing. It should not fill itself with unrelated analytics.

### Interaction

- new passages use Ink Appears
- the active learning node fills once
- the vellum may settle by 4 px when first mounted, but does not flip like a book page

## 5. Learning - 学习轨迹

### Material

- pale gray-blue drafting paper or tracing paper
- faint graphite construction lines, never a productivity grid
- the sheet covers most of the base writing paper as an independent top layer

### Layout

- upper left: topic, short context, and current step
- central body: full learning thread with completed, current, and pending steps
- right margin: one concrete next action and completion hint
- lower edge: previous or completed learning lines, visually secondary

### Function

- show active learning session and progress
- update step status
- show linked current action without creating a task dashboard
- show learning event history once the frontend client exposes it
- allow safe archive through a management proposal, not a direct destructive gesture

### Interaction

- the current step appears as fresh ink
- moving to the next step draws only the new thread segment
- completed writing dries to a softer gray rather than disappearing
- opening an older line reveals its notes in place instead of navigating to a modal

## 6. Traces - 留痕

### Material

- warm archival cotton or thin handmade paper
- slightly fibrous, more opaque than the home vellum
- irregular but restrained paper edge to suggest something intentionally kept

### Layout

- main column: recent retained traces in chronological order
- side strip: items deliberately kept for the long term
- secondary view: patterns that are slowly forming and can be corrected by the user
- bottom note: daily reflection and quiet change markers

### Function

- recent memory notes and reflections
- pin or unpin a trace
- adjust importance using human language rather than numeric salience
- review and correct profile signals
- generate or revisit the daily reflection
- show only unlocked change markers as `被看见的变化`

Locked achievements, rarity labels, scores, and completion counters should not appear. They conflict with the Traces Not Scores principle.

### Interaction

- a newly retained trace receives one brief ink wash
- pinning creates a dark corner mark or underline rather than a floating toast
- changing importance moves the trace between paper regions with a short fade
- profile correction opens an inline handwritten correction field

## 7. Organize - 整理计划

### Material

- opaque pale stone or muted gray ledger paper
- faint ruled or registration marks
- visually firmer than the other pages because decisions require clarity

### Layout

- upper area: a plain-language overview with no dashboard emphasis
- main area: proposals awaiting confirmation
- secondary area: safe suggestions grouped by learning lines, traces, and actions
- lower or side strip: recently executed or cancelled operations

### Function

- review candidates without changing data
- draft a proposal
- confirm supported reversible operations
- cancel a proposal
- inspect operation history
- clearly explain unavailable or destructive operations

### Interaction

- suggestions enter like pencil annotations
- drafting converts the pencil note into a bordered paper slip
- confirmation adds a small ink signature and settles the slip into history
- cancellation strikes through once and fades the slip
- replace browser `confirm` and `prompt` dialogs with an in-page confirmation sheet

## 8. Actions Do Not Need A Separate Page

Actions are supporting traces, not the product center.

- the home page may show one continuation on the vellum
- the learning page may show one action linked to the current step
- the organize page may review stale or duplicate actions
- a general task queue should not become a primary section

## 9. Material Asset Strategy

Use a hybrid layered system rather than one complete background or one PNG per UI element.

Image generation should provide:

- base desk and paper-stack plate without a center fold
- seamless cotton paper texture
- vellum fiber and edge texture map
- drafting-paper texture
- archival-paper texture
- ledger-paper texture
- cloth ribbon texture

Code should provide:

- paper geometry and responsive sizing
- real vellum transparency and its movable shadow
- tabs and interaction hit areas
- timelines, icons, text, and controls
- Ink Appears masks and reduced-motion behavior

The existing `notebook-shell-v1.png` remains a fallback until the layered system passes visual comparison.

## 10. Implementation Order

1. Generate and validate the base plate and material texture maps.
2. Build `PaperScene`, `PaperLayer`, and section-specific page hosts.
3. Correct the home vellum overlay without changing conversation behavior.
4. Replace the shared `ShelfView` with dedicated Learning, Traces, and Organize pages.
5. Expose missing safe API functions needed by each page.
6. Hide unsupported management operations until backend execution matches the overview.
7. Implement Ink Appears and reduced-motion fallbacks.
8. Validate at the fixed 4:3 desktop ratio and compare against the reference image.
