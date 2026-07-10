# Margin Release Checklist

This checklist covers the current desktop-first Margin release.

## Before Push

- confirm `npm test` passes
- confirm `README.md` matches the current backend behavior
- confirm `.env.example` matches the current runtime config
- confirm `docs/API_CONTRACT.md` matches current route behavior
- confirm `npm run build:ui` passes and the desktop shell loads the built frontend
- confirm `npm run dist:win` produces `release/Margin-Setup-<version>-x64.exe`
- confirm `scripts/smoke-win-installer.ps1` passes clean install, relaunch, persistence, and uninstall checks
- confirm the installer SHA-256 is published beside the artifact
- confirm the unsigned-build and SmartScreen warning are disclosed
- confirm reinstall preserves SQLite data and encrypted settings in the user-data directory
- confirm uninstall removes application files without deleting user data
- confirm the 4:3 window ratio and minimum size behave correctly
- confirm the left paper tabs align with the generated notebook background
- confirm backup/import docs are present and readable
- confirm no accidental local data files are staged

## Git Hygiene

- review `git status`
- separate backend code changes from unrelated local experiments
- avoid committing `.env`
- avoid committing SQLite files or generated exports

## Suggested Public Scope

For this release, include:

- the React notebook interface and Electron desktop shell
- backend MVP routes
- memory and state systems
- learning / summary / action flows
- explainability output
- config validation and request logging
- backup / export / import tooling

Avoid presenting this release as:

- finished production software
- polished multi-platform support beyond the desktop target
- complete long-term memory architecture

## Nice To Add With The Release

- short changelog section in the release description
- one sample local run command block
- one sample `/chat` request / response block
- a note describing the Margin brand migration and legacy compatibility aliases
