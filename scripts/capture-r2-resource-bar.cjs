const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs', 'validation', 'r2-resource-bar');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function capture(window, name) { fs.writeFileSync(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG()); }
async function waitForQuota(window) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await window.webContents.executeJavaScript("document.querySelector('[data-agent=codex]')?.textContent.includes('%')")) return;
    await delay(100);
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const { createMarginSurface } = await import(pathToFileURL(path.join(root, 'src/core/handoff/createMarginSurface.js')).href);
  const surface = await createMarginSurface({ rootDir: root, host: '127.0.0.1', port: 0 });
  const { origin } = await surface.start();
  const window = new BrowserWindow({ width: 560, height: 44, frame: false, show: true, webPreferences: { contextIsolation: true } });
  try {
    await window.loadURL(origin); window.show(); await waitForQuota(window); await capture(window, '01-collapsed');
    await window.webContents.executeJavaScript("document.querySelector('.margin-usage-toggle').click()"); window.setSize(560, 620); await delay(350); await capture(window, '02-expanded-board');
    window.setSize(380, 620); await delay(200); await capture(window, '03-narrow');
  } finally { await surface.close(); window.destroy(); }
}
app.whenReady().then(main).then(() => app.quit(), (error) => { console.error(error); app.exitCode = 1; app.quit(); });
