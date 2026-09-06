const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs', 'validation', 'r3.2');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(window, name) {
  await delay(180);
  fs.writeFileSync(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const { createMarginSurface } = await import(pathToFileURL(path.join(root, 'src', 'core', 'handoff', 'createMarginSurface.js')).href);
  const surface = await createMarginSurface({ rootDir: root, host: '127.0.0.1', port: 0 });
  const { origin } = await surface.start();
  const window = new BrowserWindow({ width: 560, height: 44, frame: false, show: true, webPreferences: { contextIsolation: true } });
  try {
    await window.loadURL(origin);
    await delay(450);
    await capture(window, '01-collapsed');
    await window.webContents.executeJavaScript("document.querySelector('.margin-usage-toggle').click()");
    window.setSize(560, 620);
    await delay(250);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 280, y: 78 });
    await capture(window, '02-workspace');
    await window.webContents.executeJavaScript("[...document.querySelectorAll('.margin-board-modes button')].find(x => x.textContent === 'Agent').click()");
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 280, y: 78 });
    await capture(window, '03-agent');
    await window.webContents.executeJavaScript("[...document.querySelectorAll('.margin-board-modes button')].find(x => x.textContent === 'Sessions').click()");
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 280, y: 78 });
    await capture(window, '04-sessions');
    const hovered = await window.webContents.executeJavaScript("(() => { const row = document.querySelector('.margin-session-row'); if (!row) return null; const r = row.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()");
    if (hovered) window.webContents.sendInputEvent({ type: 'mouseMove', ...hovered });
    if (hovered) await capture(window, '05-session-hover');
  } finally {
    await surface.close();
    window.destroy();
  }
}

app.whenReady().then(main).then(() => app.quit(), (error) => { console.error(error); app.exitCode = 1; app.quit(); });
