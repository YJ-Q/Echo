module.exports = {
  // Keep Squirrel's staging tree below the Windows legacy MAX_PATH limit.
  outDir: 'out2',
  packagerConfig: {
    asar: true,
    // Never recursively package prior Forge outputs or local smoke logs.
    ignore: [
      /(^|[\\/])\.worktrees(?:$|[\\/])/,
      /(^|[\\/])handoff-output(?:$|[\\/])/,
      // Match only Forge's output dirs (out, out2, ...). Do NOT broaden to
      // `out[^\\/]*` — that also matches node_modules/semver/ranges/outside.js,
      // breaking prebuild-install and forcing a node-gyp rebuild (needs Python).
      /(^|[\\/])out\d*(?:$|[\\/])/,
      /(^|[\\/])electron-.*\.log$/,
      // S5A packaging hygiene. The packaged app runs on its bundled Electron
      // node and writes every mutable artifact (Core DB, captured-session
      // snapshots, telemetry) under app.getPath('userData')/margin-runtime, never
      // the repo tree (see electron/main.js `runtimeRoot`). Excluding these
      // dev/generated trees keeps the .asar small without affecting the app.
      /(^|[\\/])\.runtime(?:$|[\\/])/,
      /(^|[\\/])\.margin(?:$|[\\/])/,
      /(^|[\\/])\.superpowers(?:$|[\\/])/,
      /(^|[\\/])\.claude(?:$|[\\/])/,
      /(^|[\\/])\.agents(?:$|[\\/])/,
      /(^|[\\/])data(?:$|[\\/])/,
      /(^|[\\/])design-references(?:$|[\\/])/,
      /(^|[\\/])experiments(?:$|[\\/])/,
      /(^|[\\/])docs[\\/]validation(?:$|[\\/])/,
      /(^|[\\/])test(?:$|[\\/])/,
      /(^|[\\/])evaluation(?:$|[\\/])/
    ],
    // Copy the built surface beneath resources/web so Electron can resolve
    // resources/web/dist without relying on the shell working directory.
    extraResource: ['web'],
  },
  // Prefer maintained prebuilds; do not require a global Python/MSVC toolchain
  // just to package better-sqlite3 for this host.
  rebuildConfig: { force: false },
  makers: [
    { name: '@electron-forge/maker-squirrel', config: { name: 'margin', authors: 'Margin', description: 'Margin floating host' } },
    { name: '@electron-forge/maker-zip', platforms: ['win32'] },
  ],
  plugins: [
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
  ],
};
