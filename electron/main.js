import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");
const localNode = path.join(projectRoot, ".runtime", "node-v22.23.1-win-x64", "node.exe");
const backendEntry = path.join(projectRoot, "src", "server.js");
const appUrl = "http://127.0.0.1:3000";

let backendProcess = null;
let mainWindow = null;
let shuttingDown = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, attempts = 60, delayMs = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Backend is still starting.
    }

    await wait(delayMs);
  }

  throw new Error("Echo backend did not become ready in time.");
}

function startBackend() {
  if (backendProcess) {
    return;
  }

  backendProcess = spawn(localNode, [backendEntry], {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true
  });

  backendProcess.on("exit", (code, signal) => {
    backendProcess = null;

    if (!shuttingDown) {
      console.error(`Echo backend exited unexpectedly (code: ${code}, signal: ${signal}).`);
    }
  });
}

function stopBackend() {
  shuttingDown = true;

  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
}

function getWindowState() {
  return {
    isMaximized: Boolean(mainWindow?.isMaximized())
  };
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("window:state", getWindowState());
}

async function createMainWindow() {
  startBackend();
  await waitForServer(appUrl);

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1280,
    minHeight: 820,
    backgroundColor: "#f4f5f7",
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    sendWindowState();
  });

  mainWindow.on("maximize", sendWindowState);
  mainWindow.on("unmaximize", sendWindowState);
  mainWindow.on("enter-full-screen", sendWindowState);
  mainWindow.on("leave-full-screen", sendWindowState);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(appUrl);
}

ipcMain.handle("window:get-state", () => getWindowState());
ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:toggle-maximize", () => {
  if (!mainWindow) return;

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.on("window:close", () => mainWindow?.close());

app.whenReady().then(async () => {
  try {
    await createMainWindow();
  } catch (error) {
    console.error(error);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    shuttingDown = false;
    await createMainWindow();
  }
});
