# Echo Release Checklist

This checklist is for the first cleaner public backend-oriented release of Echo.

## Before Push

- confirm `npm test` passes
- confirm `README.md` matches the current backend behavior
- confirm `.env.example` matches the current runtime config
- confirm `docs/API_CONTRACT.md` matches current route behavior
- confirm backup/import docs are present and readable
- confirm no accidental local data files are staged

## Git Hygiene

- review `git status`
- separate backend code changes from unrelated local experiments
- avoid committing `.env`
- avoid committing SQLite files or generated exports

## Suggested Public Scope

For this release, include:

- backend MVP routes
- memory and state systems
- learning / summary / action flows
- explainability output
- config validation and request logging
- backup / export / import tooling

Avoid presenting this release as:

- finished production software
- polished multi-platform frontend
- complete long-term memory architecture

## Nice To Add With The Release

- short changelog section in the release description
- one sample local run command block
- one sample `/chat` request / response block
- note that frontend redesign is intentionally postponed
