const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs', 'validation', 'r3.3');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function capture(window, name) { await delay(180); fs.writeFileSync(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG()); }
async function click(window, expression) { await window.webContents.executeJavaScript(expression); await delay(100); }
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const { createMarginSurface } = await import(pathToFileURL(path.join(root, 'src/core/handoff/createMarginSurface.js')).href);
  const surface = await createMarginSurface({ rootDir: root, host: '127.0.0.1', port: 0 }); const { origin } = await surface.start();
  const window = new BrowserWindow({ width: 560, height: 44, frame: false, show: true, webPreferences: { contextIsolation: true } });
  try {
    await window.loadURL(origin); await delay(450); await capture(window, '01-collapsed');
    await click(window, "document.querySelector('.margin-usage-toggle').click()"); window.setSize(560, 620); await delay(180); await capture(window, '02-workspace');
    await click(window, "[...document.querySelectorAll('.margin-board-modes button')].find(x => x.textContent === 'Agent').click()"); await capture(window, '03-agent');
    await click(window, "[...document.querySelectorAll('.margin-board-modes button')].find(x => x.textContent === 'Sessions').click()"); await capture(window, '04-sessions');
    await click(window, "document.querySelector('.margin-settings-button').click()"); await capture(window, '05-settings');
    await click(window, "document.querySelector('.margin-settings-button').click()"); const point = await window.webContents.executeJavaScript("(() => { const r = document.querySelector('.margin-session-row')?.getBoundingClientRect(); return r && {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)}; })()"); if (point) window.webContents.sendInputEvent({ type: 'mouseMove', ...point }); await capture(window, '06-hover');
    await click(window, "document.querySelectorAll('.margin-row-actions button')[1]?.click()"); await delay(700); await capture(window, '07-save-toast');
    window.setSize(380, 620); await delay(150); await capture(window, '08-narrow');
  } finally { await surface.close(); window.destroy(); }
}
app.whenReady().then(main).then(() => app.quit(), (error) => { console.error(error); app.exitCode = 1; app.quit(); });
