# Task 6 Report — NeedsOwner and Artifact panels

## Delivered

- Added first-class NeedsOwner and Artifact panels that use only `needs_owner.list`, `needs_owner.resolve`, and `artifact.list` from the browser Contract surface.
- NeedsOwner renders the authoritative reason, options, consequence, and context. Resolution uses the DTO version plus a stable per-item/version idempotency key, never removes an item optimistically, and reloads the selected list, workstream data, and Activity after every command outcome.
- Textual resolution is presented only for zero-option NeedsOwner DTOs. The UI does not create a chat entry or a Decision.
- Both panels use selection generations and request generations so an old Workstream query or resolution cannot update the current selection. Activity polling also accepts a reload token to restart safely after a resolution.
- Artifact display includes title, type, source, run, version, date, resource reference, content hash, and bounded JSON metadata. Only syntactically valid HTTPS resource references are links; file URIs, local/UNC-style paths, unknown schemes, invalid URLs, and HTTP are inert text. No file content is fetched or routed.

## TDD evidence

1. RED: `test/webNeedsOwnerArtifacts.test.js` failed because the panels did not exist.
2. GREEN: the focused test covers Contract rendering, option and no-option resolution payloads, expected versions, idempotency, authoritative re-query removal, stale-selection completion, safe links, and inert unsafe references.

## Verification

- Focused plus adjacent Web tests: 28 passing.
- `npm run build`: passing.
- `npm test`: 437 passing, 0 failing.
- `git diff --check`: clean.

## Scope and safety review

- No Conversation/composition implementation and no Decision synthesis were added.
- The browser receives only displayed DTO fields and renders metadata with React text nodes, never raw HTML.
- The only externally navigable resource scheme is HTTPS; all other references remain non-clickable display text.

## Fix round 1

- Preserved the Contract-public `idempotency_conflict` error code in the browser API envelope instead of degrading it to `storage_failure`.
- Added the stable NeedsOwner guidance: “请求标识已用于不同内容，请刷新后重试。”, shown after the required authoritative reload.
- RED/GREEN coverage now verifies sanitized API propagation and the rendered NeedsOwner conflict guidance.

### Fix verification

- Focused API and NeedsOwner tests: 9 passing.
- `npm run build`: passing.
- `npm test`: 439 passing, 0 failing.
