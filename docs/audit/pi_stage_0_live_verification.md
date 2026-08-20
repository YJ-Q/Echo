# Pi Stage 0 Live Verification

Verification date: 2026-08-20.

## Configuration boundary

- Pi SDK: `@earendil-works/pi-coding-agent@0.84.2`
- Node runtime: `22.23.1`
- Provider: `yapi`
- Model: `gpt-5.6-terra`
- Wire API: `openai-responses`
- Base URL: `https://yapi.click/v1`
- Credential source: process environment via `YAPI_API_KEY`; the value was not written to the repository or verification report

## Live checks

The isolated SDK spike produced a fresh report with all checks passing:

- persisted Session created;
- in-memory Session manager created;
- new Session created;
- original Session restored;
- Session fork created with the expected parent;
- manual compaction started and ended successfully;
- exactly one `margin_spike_echo` call completed with the per-run nonce;
- no Pi built-in tools were active.

The final verification gate also checked runtime identity, package/license pinning, report freshness, provider/model binding, and the full automated test suite. Result: `212/212` tests passed.

## Claim boundary

This evidence establishes that the selected Pi SDK integration path is technically viable in an isolated development spike. It does not establish that Pi is connected to Margin's production chat path, that structured Margin State/Memory exists, that cross-Session task recovery improves user outcomes, or that any market demand has been validated.

The ignored local report and Session traces are development evidence. They may contain model conversation content and must not be committed or used as user-research data.
