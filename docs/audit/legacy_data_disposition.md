# Legacy Echo Data Disposition

Status: Phase 1 decision, 2026-08-23. No record was exported, migrated, or deleted.

## Boundary

`data/terminal-pilot/margin-core.sqlite` is the only Source of Truth for Margin V1 Workstream, Run, Event, Decision, Artifact, Checkpoint, Memory and Action state. `data/echo.sqlite` is a frozen legacy dataset. The old Express routes remain test-covered only as a deprecated compatibility surface and must not receive new V1 behavior.

The default `npm start` entry now opens the terminal client backed by the Persistent Core. The old API is available only through the explicitly named `npm run legacy:api` transition command. Its removal gate is: export completed, table-by-table user decision recorded, and any approved migration verified against IDs/counts.

## Read-only inventory

Inventory command:

```powershell
npm run inventory:legacy
```

Observed on 2026-08-23 without reading record content into the report:

| Table | Rows | Proposed disposition |
| --- | ---: | --- |
| conversations | 19 | archive |
| summaries | 1 | archive |
| actions | 2 | migrate candidate after review |
| learning_sessions | 1 | migrate candidate after review |
| learning_events | 12 | migrate candidate after review |
| user_profile | 8 | migrate candidate after review |
| knowledge_base | 0 | delete candidate after export |
| operation_proposals | 3 | delete candidate after export |
| operation_events | 5 | delete candidate after export |
| user_states | 6 | delete candidate after export |

The inventory records column metadata, counts, per-table schema hashes, database schema hash and file hash. It never emits conversation/profile values.

## Export and migration policy

- Nothing is auto-imported as Memory, Decision, Workstream or user truth.
- A full-content export requires both `--approve` and a new output path; overwrite is refused.
- “Migrate candidate” means human review is still required. It is not approval to migrate.
- “Delete candidate” means export and explicit deletion approval are still required.
- Legacy IDs and raw records remain unchanged until a later migration decision.

Example explicit export (not run during Phase 1):

```powershell
npm run export:legacy -- data/echo.sqlite --approve --output data/exports/echo-legacy-v1.json
```
