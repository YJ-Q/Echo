# Margin Naming Compatibility

This document is the single removal inventory for legacy Echo identifiers.
Margin identifiers take priority when both naming schemes are configured.
Compatibility entries must not be removed or renamed without satisfying the
listed condition and completing a separate migration review.

| Legacy identifier | Current replacement | Status | Removal condition |
|---|---|---|---|
| `ECHO_LOG_LEVEL` | `MARGIN_LOG_LEVEL` | Deprecated, supported | Separate removal spec |
| `ECHO_LLM_PROVIDER` | `MARGIN_LLM_PROVIDER` | Deprecated, supported | Separate removal spec |
| `ECHO_DB_PATH` | `MARGIN_DB_PATH` | Deprecated, supported | Migration tooling shipped |
| `data/echo.sqlite` | `data/margin.sqlite` | Auto-detected, never moved | Explicit user migration |
| `echo_response` | none | Legacy schema, retained | Versioned DB/API migration |
| `echo_reflection` | none | Legacy schema, retained | Versioned DB/API migration |
| `echo_state` | none | Legacy event value, retained | Event migration and rollback |
| `echo_interaction_style` | none | Legacy profile key, retained | Profile migration and rollback |
| `run-echo-local.cmd` | `run-margin-local.cmd` | Wrapper | Separate removal spec |
| `run-echo-desktop.cmd` | `run-margin-desktop.cmd` | Wrapper | Separate removal spec |
| `resolveEchoProvider` | `resolveMarginProvider` | Compatibility alias, retained | All callers migrated and separate removal spec |
| `exportEchoDataSnapshot` | `exportMarginDataSnapshot` | Compatibility alias, retained | All callers migrated and separate removal spec |
| `importEchoDataSnapshot` | `importMarginDataSnapshot` | Compatibility alias, retained | All callers migrated and separate removal spec |

The application never automatically moves, copies, merges, renames, or deletes
`data/echo.sqlite`. Users must opt into any future data migration explicitly.
The GitHub repository still uses its legacy Echo name, so live repository URLs
remain unchanged until the repository is actually renamed.
