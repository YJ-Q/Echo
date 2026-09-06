import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createElectronHost } from '../electron/main.js';

class FakeWindow extends EventEmitter {
  constructor(options) { super(); this.options = options; this.visible = false; this.closed = false; this.alwaysOnTop = false; this.bounds = { x: 10, y: 20, width: options.width, height: options.height }; }
  loadURL(url) { this.url = url; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  focus() { this.focused = true; }
  isVisible() { return this.visible; }
  isDestroyed() { return this.closed; }
  isMinimized() { return false; }
  isAlwaysOnTop() { return this.alwaysOnTop; }
  setAlwaysOnTop(value) { this.alwaysOnTop = value; }
  getBounds() { return this.bounds; }
  setBounds(bounds) { this.bounds = { ...this.bounds, ...bounds }; }
  setMinimumSize(width, height) { this.minimumSize = { width, height }; }
  setMaximumSize(width, height) { this.maximumSize = { width, height }; }
  close() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; this.emit('close', event); if (!event.prevented) this.closed = true; }
}

test('Electron host owns one ephemeral loopback Surface and window/tray lifecycle only', async () => {
  const app = new EventEmitter();
  app.isPackaged = false; // app.asar fallback covers packager launch timing.
  app.getAppPath = () => 'C:\\Margin\\resources\\app.asar';
  app.getPath = (name) => { assert.equal(name, 'userData'); return 'C:\\Users\\Margin\\AppData'; };
  app.quit = () => { app.quitCalls = (app.quitCalls ?? 0) + 1; };
  const trays = [];
  const electron = {
    app,
    BrowserWindow: FakeWindow,
    Tray: class FakeTray extends EventEmitter {
      constructor(image) { super(); this.image = image; trays.push(this); }
      setToolTip(value) { this.toolTip = value; }
      setContextMenu(menu) { this.menu = menu; }
      destroy() { this.destroyed = true; }
    },
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createEmpty: () => ({ empty: true }) },
  };
  let surfaceOptions;
  let closeCalls = 0;
  const host = createElectronHost({
    electron,
    rootDir: 'ignored-when-packaged',
    staticDir: 'C:\\Margin\\resources\\web\\dist',
    createSurface: async (options) => {
      surfaceOptions = options;
      return { start: async () => ({ origin: 'http://127.0.0.1:43123' }), close: async () => { closeCalls += 1; } };
    },
  });

  await host.start();
  const window = host.window;
  assert.deepEqual(surfaceOptions, {
    rootDir: 'C:\\Users\\Margin\\AppData\\margin-runtime', staticDir: 'C:\\Margin\\resources\\web\\dist',
    host: '127.0.0.1', port: 0, env: process.env,
  });
  assert.equal(window.url, 'http://127.0.0.1:43123');
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.match(window.options.webPreferences.preload, /electron[\\/]preload\.cjs$/);
  assert.equal(window.options.width, 560);
  assert.equal(window.options.height, 44);
  assert.equal(window.options.frame, false);
  assert.equal(window.options.resizable, true);
  assert.equal(window.options.maxHeight, 44);
  assert.equal(window.isAlwaysOnTop(), false);

  host.setExpanded(true);
  assert.equal(window.bounds.height, 620);
  assert.deepEqual(window.minimumSize, { width: 360, height: 300 });
  host.setExpanded(false);
  assert.equal(window.bounds.height, 44);

  window.show();
  window.close();
  assert.equal(window.isVisible(), false, 'normal close hides the floating window');
  const menu = trays[0].menu;
  menu[0].click();
  assert.equal(window.isVisible(), true, 'tray Show/Hide restores the hidden window');
  menu[1].click({ checked: true });
  assert.equal(window.isAlwaysOnTop(), true);
  assert.equal(trays[0].menu[1].checked, true, 'tray menu is rebuilt from the same always-on-top state');
  host.setAlwaysOnTop(false);
  assert.equal(trays[0].menu[1].checked, false, 'surface-side state changes also update the tray menu');

  await host.gracefulQuit();
  assert.equal(window.closed, true);
  assert.equal(trays[0].destroyed, true);
  assert.equal(closeCalls, 1);
  assert.equal(app.quitCalls, 1);
});

test('Electron host clamps expanded floating windows to the visible display work area', async () => {
  const app = new EventEmitter();
  app.isPackaged = false; app.getAppPath = () => 'D:\\Margin'; app.getPath = () => 'D:\\Margin'; app.quit = () => {};
  const electron = {
    app, BrowserWindow: FakeWindow,
    Tray: class { setToolTip() {} setContextMenu() {} on() {} destroy() {} },
    Menu: { buildFromTemplate: (template) => template }, nativeImage: { createEmpty: () => ({}) },
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 700 } }) },
  };
  const host = createElectronHost({ electron, createSurface: async () => ({ start: async () => ({ origin: 'http://127.0.0.1:1' }), close: async () => {} }) });
  await host.start();
  host.window.bounds = { x: 10, y: 500, width: 560, height: 44 };
  host.setExpanded(true);
  assert.equal(host.window.bounds.height, 620);
  assert.equal(host.window.bounds.y, 80, 'the expanded window remains above the taskbar work area');
});
