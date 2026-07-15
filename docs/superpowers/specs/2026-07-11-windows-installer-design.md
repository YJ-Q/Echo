# Margin Windows Installer Design

Date: 2026-07-11

## Goal

Ship a reproducible Windows x64 installer that launches Margin without a separately installed Node.js runtime, preserves user data across upgrades and uninstall, and exposes the same React, Express, SQLite, settings, TTS, and STT behavior as development mode.

## Selected Approach

Use `electron-builder` with the NSIS target. Package application code in `app.asar`, unpack the native `sqlite3` binary, and launch the Express backend through the packaged Electron executable with `ELECTRON_RUN_AS_NODE=1`.

This avoids shipping and maintaining a second Node distribution. A portable ZIP alone would not provide an install/upgrade/uninstall lifecycle, while embedding the Express server into the Electron main process would make the packaging change much larger and couple backend failures to the desktop shell.

The first release targets Windows x64 and is explicitly unsigned. Signing is a later release-security milestone; the build must publish a SHA-256 checksum and accurately disclose the SmartScreen warning.

## Runtime Boundaries

`electron/runtimePaths.js` owns all development-versus-packaged path decisions:

- development code and SQLite remain under the checkout;
- packaged code is read from `app.getAppPath()`;
- packaged backend working directory is `app.getPath("userData")`;
- packaged SQLite is always `%APPDATA%/Margin/data/echo.sqlite`;
- the existing database filename remains unchanged for compatibility;
- API keys remain in the existing `safeStorage`-backed settings file.

`electron/main.js` passes the absolute database path through `MARGIN_DB_PATH`. The backend continues serving `frontend/dist`, so renderer API URLs and the existing health wait remain unchanged.

## Package Contents

The package includes only the Electron shell, Express source, built frontend, runtime dependencies, and package metadata. Development documents, tests, local databases, `.env`, exports, design references, and generated release artifacts are excluded.

The NSIS installer is per-user, allows choosing an installation directory, creates Start Menu and desktop shortcuts, and does not delete application data during uninstall.

## Icon And Metadata

A deterministic paper-and-margin `M` icon is stored as an SVG source and converted to Windows ICO assets during the build. Package metadata uses product name `Margin`, app id `cn.margin.desktop`, semantic version from `package.json`, and artifact name `Margin-Setup-<version>-x64.exe`.

## Failure Handling

- Packaging fails before NSIS generation if tests, TypeScript checking, UI build, or icon generation fails.
- Desktop startup exits with the existing logged error if the packaged backend cannot spawn or become healthy.
- Mutable files are never written inside `Program Files` or `app.asar`.
- The smoke script tracks only the process it starts and cleans it up in `finally`.
- Uninstall removes application files while intentionally retaining user data.

## Verification

Automated tests first cover runtime path resolution. The release gate then runs:

1. `npm run lint:ui`
2. `npm run build:ui`
3. `npm test`
4. unpacked x64 packaging
5. packaged application launch and `/health` readiness
6. NSIS installer generation
7. clean install, relaunch, persistence, and uninstall smoke checks
8. SHA-256 generation

Acceptance requires launch without system Node.js, a writable user-data database, preserved data after reinstall, an exact 4:3 desktop window, and no secrets or local data in the artifact.

## Deferred Scope

- ARM64 and 32-bit Windows packages
- code-signing certificate acquisition and signed release publication
- auto-update delivery
- macOS and Linux packages
- changing the SQLite filename or migrating existing development databases
