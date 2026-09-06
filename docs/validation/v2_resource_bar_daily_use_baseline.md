# V2 Resource Bar daily-use baseline

Date: 2026-09-07. This baseline covers CLI V1, the Electron frameless floating shell, Workspace / Agent / Sessions navigation, refresh, Copy / Save Handoff, Settings, Quit / Hide / Pin, and Codex Agent Resource Status.

## Resource semantics

- Codex subscription quota comes from the latest native local JSONL snapshot; 5h and 7d display percentage **used**, never accumulated quota.
- Refresh retains the last known good snapshot. Claude remains unavailable.
- API-token/cost/model-breakdown resource reporting is not implemented.

## Recent validation

- CLI and Electron share discovery/normalization; focused discovery, Handoff Core, CLI, Electron/UI, HTTP, and resource tests: **111 passed, 0 failed**.
- Real pipeline Copy / Save tests write the Core-generated Handoff to `.margin/HANDOFF.md`; HTTP Save verifies the exact written file.
- Native Codex quota source coverage confirms global latest-snapshot selection, 5h/7d normalization, malformed-record fail-soft behavior, and unavailable states.
- `npm run build` passed. R2 Resource Bar, R3.2, and R3.3 screenshot evidence is retained under `docs/validation/`.

## Known limitations

- Claude structured quota is unavailable.
- API resource aggregation is unavailable.
- Agent runtime state is not live source-backed.
- Existing unrelated legacy contract-version assertions remain outside this baseline.

**PASS — ready for continued daily-use evaluation**
