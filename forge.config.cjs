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
      /(^|[\\/])electron-.*\.log$/
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
