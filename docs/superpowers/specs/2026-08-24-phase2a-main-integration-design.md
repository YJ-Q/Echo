# Phase 2A Main Integration Design

Date: 2026-08-24  
Status: approved by the user in the integration instruction of 2026-08-24

## Goal

Integrate the accepted Phase 1 Persistent Core and Phase 2A transport-neutral
Application Contract into local `main` while removing the obsolete React,
Electron, static UI, and UI-specific product direction.

## Authority

Commit `88df600ec30152afeb5cb82dfc0fc29672c3a8cf` is the accepted V1 product and
architecture baseline. Its Persistent Core is the only current-state Source of
Truth. The Application Gateway remains the only Surface contract and exposes
`execute`, `query`, and `events`.

`data/terminal-pilot/margin-core.sqlite` is the V1 database. The legacy
`data/echo.sqlite` remains frozen and is not a target for new V1 writes.

## Integration approach

The integration branch starts at updated local `main` commit `49da495`. Git
history shows that the accepted Phase 2A branch already contains remote history
through `18f7f13`; only `49da495` is unique to current `main`.

The integration will use a normal two-parent merge so both histories remain
visible. During conflict resolution, the accepted Phase 2A tree governs. The
unique `49da495` changes are not copied into the resulting tree because they
form one coupled React/Electron/legacy Express desktop migration. Its useful
naming and environment compatibility ideas are already implemented more fully
in the accepted V1 baseline.

After the merge, obsolete UI design artifacts still inherited by the accepted
branch will be deleted. Historical architecture, audit, migration disposition,
Phase 1, and Phase 2A evidence remain tracked.

## Deletion boundary

Delete:

- tracked `frontend/`, `electron/`, and `public/` UI implementations;
- desktop launch and build entries tied to those implementations;
- UI handoff, wireframe, preview, visual-language, and superseded product-shape
  documents that describe the removed frontend;
- tests and dependencies whose only subject is the removed UI.

Preserve:

- `src/core/`, `src/application/`, `src/contracts/`, `src/domain/`, Pi runtime
  adapters, continuity logic, terminal Surface, migrations, and their tests;
- Phase 0 audit, Phase 1 architecture and acceptance, Phase 2A ADR,
  specification and acceptance, runtime decisions, and legacy data disposition;
- legacy Express/Echo code only where it still provides frozen data inventory,
  export, compatibility, or regression-test value.

## Safety and validation

A regression test will assert the terminal-first boundary before the merge and
must fail while the old frontend is present. It must pass after the authoritative
tree is integrated. Full tests, frozen Stage 1 fixtures, Pi audit, focused Phase
1/2A tests, restart/pause/resume E2E, `git diff --check`, and a clean status are
required before and after merging the integration branch into local `main`.

No HTTP Adapter, Web Workbench, Feishu, Scheduler, Codex Worker, or Phase 2B
work is included.
