import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMarginSurface } from '../src/core/handoff/createMarginSurface.js';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createElectronHost({
  electron,
  createSurface = createMarginSurface,
  rootDir = sourceRoot,
  staticDir,
  env = process.env,
} = {}) {
  if (!electron?.app || !electron?.BrowserWindow || !electron?.Tray || !electron?.Menu) {
    throw new TypeError('invalid_electron_dependencies');
  }

  const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = electron;
  let surface;
  let window;
  let tray;
  let quitting = false;
  let quitPromise;
  let expandedHeight = 620;
  const collapsedHeight = 44;
  const expandedMinHeight = 300;
  const expandedMaxHeight = 720;

  // Some packager launch paths report isPackaged late during startup. app.asar
  // is equally definitive and keeps asset resolution independent of cwd.
  const packaged = Boolean(app.isPackaged || /\.asar$/i.test(app.getAppPath?.() ?? ''));
  const packagedStaticDir = staticDir ?? path.join(process.resourcesPath ?? '', 'web', 'dist');
  // The existing Surface stores only regenerable captured-session snapshots
  // under rootDir. In a packaged app app.asar is read-only, so use Electron's
  // normal writable runtime location while leaving Core and UI unchanged.
  const runtimeRoot = packaged ? path.join(app.getPath('userData'), 'margin-runtime') : rootDir;

  function showWindow() {
    if (!window || window.isDestroyed?.()) return;
    if (window.isMinimized?.()) window.restore();
    window.show();
    window.focus();
  }

  function createWindow(origin) {
    window = new BrowserWindow({
      width: 560,
      height: collapsedHeight,
      minWidth: 360,
      minHeight: collapsedHeight,
      maxHeight: collapsedHeight,
      resizable: true,
      frame: false,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(sourceRoot, 'electron', 'preload.cjs') },
    });
    window.on('close', (event) => {
      if (quitting) return;
      event.preventDefault();
      window.hide();
    });
    window.once('ready-to-show', () => showWindow());
    window.loadURL(origin);
    return window;
  }

  function setExpanded(expanded) {
    if (!window || window.isDestroyed?.()) return;
    const bounds = window.getBounds?.() ?? { width: 560, height: collapsedHeight };
    if (!expanded && bounds.height > collapsedHeight) expandedHeight = Math.min(expandedMaxHeight, bounds.height);
    const height = expanded ? Math.max(expandedMinHeight, expandedHeight) : collapsedHeight;
    window.setMinimumSize?.(360, expanded ? expandedMinHeight : collapsedHeight);
    window.setMaximumSize?.(0, expanded ? expandedMaxHeight : collapsedHeight);
    // Preserve the current top edge whenever it fits, only moving upward when
    // the expanded surface would cross the display work area (taskbar included).
    const display = screen?.getDisplayMatching?.(bounds) ?? screen?.getPrimaryDisplay?.();
    const workArea = display?.workArea;
    const y = workArea ? Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)) : bounds.y;
    window.setBounds?.({ ...bounds, y, height });
    if (!window.setBounds) window.setSize?.(bounds.width, height);
  }

  function updateTrayMenu() {
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: window?.isVisible?.() ? 'Hide Margin' : 'Show Margin', click: () => window?.isVisible?.() ? window.hide() : showWindow() },
      { label: 'Always on top', type: 'checkbox', checked: Boolean(window?.isAlwaysOnTop?.()), click: (item) => setAlwaysOnTop(item.checked) },
      { type: 'separator' },
      { label: 'Quit', click: () => gracefulQuit() },
    ]));
  }

  function setAlwaysOnTop(value) {
    if (!window || window.isDestroyed?.()) return false;
    window.setAlwaysOnTop(Boolean(value));
    updateTrayMenu();
    return Boolean(window.isAlwaysOnTop?.());
  }

  function createTray() {
    tray = new Tray(nativeImage?.createEmpty?.() ?? undefined);
    tray.setToolTip('Margin');
    tray.on('click', () => window?.isVisible?.() ? window.hide() : showWindow());
    updateTrayMenu();
    return tray;
  }

  async function gracefulQuit() {
    if (quitPromise) return quitPromise;
    quitPromise = (async () => {
      quitting = true;
      tray?.destroy?.();
      if (window && !window.isDestroyed?.()) window.close();
      await surface?.close?.();
      app.quit();
    })();
    return quitPromise;
  }

  async function start() {
    surface = await createSurface({
      rootDir: runtimeRoot,
      staticDir: packaged ? packagedStaticDir : undefined,
      host: '127.0.0.1',
      port: 0,
      env,
    });
    const started = await surface.start();
    createWindow(started.origin);
    Menu.setApplicationMenu?.(null);
    ipcMain?.on?.('margin-shell:set-expanded', (_event, expanded) => setExpanded(Boolean(expanded)));
    ipcMain?.on?.('margin-shell:hide', () => window?.hide());
    ipcMain?.on?.('margin-shell:quit', () => { void gracefulQuit(); });
    ipcMain?.handle?.('margin-shell:get-always-on-top', () => Boolean(window?.isAlwaysOnTop?.()));
    ipcMain?.handle?.('margin-shell:toggle-always-on-top', () => setAlwaysOnTop(!window?.isAlwaysOnTop?.()));
    createTray();
    return started;
  }

  return Object.freeze({ start, showWindow, gracefulQuit, updateTrayMenu, setExpanded, setAlwaysOnTop, get isQuitting() { return quitting; }, get window() { return window; }, get surface() { return surface; } });
}

async function main() {
  const electron = await import('electron');
  const { app } = electron;
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  const host = createElectronHost({ electron });
  app.on('second-instance', () => host.showWindow());
  app.on('before-quit', (event) => {
    // The first OS-level quit must wait for the loopback listener to close.
    // gracefulQuit calls app.quit() again once that close has settled; the
    // second event is allowed through because the host is already quitting.
    if (host.isQuitting) return;
    event.preventDefault();
    void host.gracefulQuit();
  });
  await app.whenReady();
  await host.start();
}

if (process.versions.electron) {
  main().catch((error) => {
    console.error('margin_electron_start_failed', error);
    process.exitCode = 1;
  });
}
