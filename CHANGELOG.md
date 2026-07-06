# Changelog

All notable changes to Echo will be documented in this file.

## [0.1.0-backend-mvp] - 2026-07-06

This release marks the first stabilized backend-oriented MVP for Echo.

### Added

- modular Express backend routes for chat, state, actions, learning, memory, summary, and TTS
- SQLite-backed memory store with memory notes, insight notes, salience, reinforcement, pinning, and priority buckets
- mixed memory retrieval that combines direct topic match, emotional resonance, learning continuity, core anchors, and recent thread signals
- page-ready backend view models for learning, reflection, and memory modules
- explainability blocks for `/chat` and `/state`
- local backup and export tooling:
  - `npm run backup`
  - `npm run export:data`
  - `npm run import:data`
- JSON request logging with request IDs
- runtime environment validation for provider and logging configuration
- backend-oriented release documentation:
  - `docs/API_CONTRACT.md`
  - `docs/BACKEND_STATUS.md`
  - `docs/BACKUP_AND_EXPORT.md`
  - `docs/RELEASE_CHECKLIST.md`

### Improved

- `/state` now exposes `current_action`, `current_learning`, `current_reflection`, and `current_memory`
- `/memory` now returns a page-ready `current_memory` aggregate
- `/summary/recent` now returns a page-ready `current_reflection` aggregate
- learning flow continuity is better reflected in state and action decisions
- memory retrieval is more aligned with Echo's long-term companion behavior instead of simple recency lookup

### Verified

- backend test suite status: `19/19` passing
- export flow verified locally
- import dry-run verified locally
- JSON snapshot restore tested against a fresh database

### Not In Scope Yet

- rebuilt public frontend experience
- production deployment playbooks
- long-term memory clustering beyond the current MVP retrieval strategy
- release-tag automation or CI release pipeline
