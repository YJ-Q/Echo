import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createSettingsStore } from "./settingsStore.js";
import {
  buildBackendCandidates as createBackendCandidates,
  resolveRuntimePaths
} from "./runtimePaths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appUrl = "http://127.0.0.1:3000";
const WINDOW_ASPECT_RATIO = 4 / 3;
const WINDOW_DEFAULT_WIDTH = 960;
const WINDOW_DEFAULT_HEIGHT = 720;
const WINDOW_MIN_WIDTH = 896;
const WINDOW_MIN_HEIGHT = 672;
const BACKEND_SHUTDOWN_TIMEOUT_MS = 2000;
const backendStartupCanceledError = new Error("Backend startup canceled.");

let backendProcess = null;
let backendStartPromise = null;
let backendStopPromise = null;
let backendStopResolve = null;
let backendStopTimer = null;
let shuttingDown = false;
let quitRequested = false;
let mainWindow = null;
let settingsStore = null;
let runtimePaths = null;

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

  throw new Error("Margin backend did not become ready in time.");
}

function buildBackendCandidates() {
  const runtimeEnv = settingsStore
    ? settingsStore.buildBackendEnv(process.env)
    : { ...process.env };
  const runtimeNodePath = path.join(
    runtimePaths.appRoot,
    ".runtime",
    "node-v22.23.1-win-x64",
    "node.exe"
  );

  return createBackendCandidates({
    isPackaged: app.isPackaged,
    processExecPath: process.execPath,
    runtimeNodePath,
    runtimeNodeExists: existsSync(runtimeNodePath),
    backendEntry: runtimePaths.backendEntry,
    databasePath: runtimePaths.databasePath,
    runtimeEnv
  });
}

function spawnBackend(candidate) {
  return new Promise((resolve, reject) => {
    const child = spawn(candidate.command, candidate.args, {
      cwd: runtimePaths.backendCwd,
      env: {
        ...process.env,
        ...candidate.env
      },
      stdio: "inherit",
      windowsHide: true
    });

    let settled = false;

    const onSpawn = () => {
      settled = true;
      child.removeListener("error", onError);
      resolve(child);
    };

    const onError = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      child.removeListener("spawn", onSpawn);
      reject(error);
    };

    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

function finalizeBackendStop() {
  if (backendStopTimer) {
    clearTimeout(backendStopTimer);
    backendStopTimer = null;
  }

  if (backendStopResolve) {
    const resolve = backendStopResolve;
    backendStopResolve = null;
    backendStopPromise = null;
    resolve();
  }
}

function handleBackendExit(child, code, signal) {
  if (backendProcess === child) {
    backendProcess = null;
  }

  finalizeBackendStop();

  if (!shuttingDown) {
    console.error(`Margin backend exited unexpectedly (code: ${code}, signal: ${signal}).`);
  }
}

function attachBackendLifecycle(child) {
  child.once("exit", (code, signal) => {
    handleBackendExit(child, code, signal);
  });
}

async function startBackend() {
  if (backendProcess) {
    return backendProcess;
  }

  if (backendStartPromise) {
    return backendStartPromise;
  }

  if (backendStopPromise) {
    await backendStopPromise.catch(() => {});
  }

  shuttingDown = false;
  backendStartPromise = (async () => {
    let lastError = null;

    for (const candidate of buildBackendCandidates()) {
      if (shuttingDown) {
        throw backendStartupCanceledError;
      }

      try {
        const child = await spawnBackend(candidate);

        if (shuttingDown) {
          try {
            child.kill();
          } catch {
            // Ignore shutdown races while the backend is still booting.
          }

          throw backendStartupCanceledError;
        }

        backendProcess = child;
        attachBackendLifecycle(child);

        if (child.exitCode !== null || child.signalCode !== null) {
          handleBackendExit(child, child.exitCode, child.signalCode);
        }

        return child;
      } catch (error) {
        if (error === backendStartupCanceledError) {
          throw error;
        }

        lastError = error;
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Unable to start the Margin backend. Last error: ${message}`);
  })();

  try {
    return await backendStartPromise;
  } finally {
    backendStartPromise = null;
  }
}

async function stopBackend() {
  shuttingDown = true;

  if (backendStartPromise) {
    await backendStartPromise.catch(() => {});
  }

  if (backendStopPromise) {
    return backendStopPromise;
  }

  if (!backendProcess) {
    return Promise.resolve();
  }

  backendStopPromise = new Promise((resolve) => {
    backendStopResolve = resolve;
  });

  const child = backendProcess;

  child.once("exit", () => {
    finalizeBackendStop();
  });

  backendStopTimer = setTimeout(() => {
    if (backendProcess === child && !child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        finalizeBackendStop();
      }
    }
  }, BACKEND_SHUTDOWN_TIMEOUT_MS);

  try {
    if (!child.killed) {
      child.kill();
    }
  } catch {
    finalizeBackendStop();
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    finalizeBackendStop();
  }

  return backendStopPromise;
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

function isSecureStorageAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function defaultModelForProvider(provider) {
  const defaults = {
    local: "margin-local",
    openai: "gpt-4.1-mini",
    anthropic: "claude-3-5-sonnet-latest",
    siliconflow: "deepseek-ai/DeepSeek-V3.2"
  };
  return defaults[provider] || defaults.local;
}

function rendererSettingsSnapshot() {
  if (!settingsStore) {
    throw new Error("Margin settings are not ready yet.");
  }

  const snapshot = settingsStore.getSnapshot();
  const apiKeys = snapshot.conversation.apiKeys;
  const envKeyNames = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    siliconflow: "SILICONFLOW_API_KEY"
  };
  const keys = Object.fromEntries(Object.entries(envKeyNames).map(([provider, envName]) => {
    const configured = Boolean(apiKeys[provider]?.configured || process.env[envName]);
    return [provider, { configured, masked: configured ? "********" : "" }];
  }));

  return {
    conversation: {
      provider: snapshot.conversation.provider,
      model: snapshot.conversation.model || defaultModelForProvider(snapshot.conversation.provider)
    },
    speech: {
      provider: snapshot.speech.provider,
      ttsModel: snapshot.speech.tts.model,
      voice: snapshot.speech.tts.voice,
      speed: snapshot.speech.tts.speed,
      sttModel: snapshot.speech.stt.model,
      language: snapshot.speech.stt.language
    },
    preferences: {
      lightReadingEnabled: snapshot.lightReadingEnabled,
      fontScale: snapshot.appearance.fontScale,
      lineHeight: snapshot.appearance.lineHeight,
      motion: snapshot.appearance.motion
    },
    keys,
    secureStorageAvailable: isSecureStorageAvailable(),
    dataDirectory: app.getPath("userData")
  };
}

function sanitizeSettingsPatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Settings update must be an object.");
  }

  const patch = {};
  if (input.conversation && typeof input.conversation === "object") {
    patch.conversation = {};
    if (input.conversation.provider !== undefined) patch.conversation.provider = input.conversation.provider;
    if (input.conversation.model !== undefined) patch.conversation.model = input.conversation.model;
  }

  if (input.preferences && typeof input.preferences === "object") {
    if (input.preferences.lightReadingEnabled !== undefined) {
      patch.lightReadingEnabled = Boolean(input.preferences.lightReadingEnabled);
    }
    patch.appearance = {};
    if (input.preferences.fontScale !== undefined) patch.appearance.fontScale = input.preferences.fontScale;
    if (input.preferences.lineHeight !== undefined) patch.appearance.lineHeight = input.preferences.lineHeight;
    if (input.preferences.motion !== undefined) patch.appearance.motion = input.preferences.motion;
  }

  if (input.speech && typeof input.speech === "object") {
    patch.speech = { provider: "siliconflow", tts: {}, stt: {} };
    if (input.speech.ttsModel !== undefined) patch.speech.tts.model = input.speech.ttsModel;
    if (input.speech.voice !== undefined) patch.speech.tts.voice = input.speech.voice;
    if (input.speech.speed !== undefined) patch.speech.tts.speed = input.speech.speed;
    if (input.speech.sttModel !== undefined) patch.speech.stt.model = input.speech.sttModel;
    if (input.speech.language !== undefined) patch.speech.stt.language = input.speech.language;
  }

  if (input.secrets && typeof input.secrets === "object") {
    if (!isSecureStorageAvailable()) {
      throw new Error("系统安全存储当前不可用，API Key 未保存。");
    }
    patch.conversation ??= {};
    patch.conversation.apiKeys = {};
    for (const provider of ["openai", "anthropic", "siliconflow"]) {
      const value = input.secrets[provider];
      if (typeof value === "string" && value.trim()) {
        patch.conversation.apiKeys[provider] = value.trim();
      }
    }
  }

  return patch;
}

function patchNeedsBackendRestart(patch) {
  return Boolean(
    patch.conversation?.provider !== undefined ||
    patch.conversation?.model !== undefined ||
    patch.conversation?.apiKeys !== undefined ||
    patch.speech !== undefined
  );
}

function assertRuntimeConfiguration() {
  const env = settingsStore.buildBackendEnv(process.env);
  const provider = env.MARGIN_LLM_PROVIDER;
  const requiredKeys = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    siliconflow: "SILICONFLOW_API_KEY"
  };
  const requiredKey = requiredKeys[provider];
  if (requiredKey && !env[requiredKey]) {
    throw new Error(`${provider} 尚未配置 API Key。`);
  }
}

async function updateDesktopSettings(input) {
  if (!settingsStore) {
    throw new Error("Margin settings are not ready yet.");
  }

  const patch = sanitizeSettingsPatch(input);
  const needsRestart = patchNeedsBackendRestart(patch);
  await settingsStore.updateSettings(patch);

  try {
    assertRuntimeConfiguration();
    if (needsRestart) {
      await stopBackend();
      await startBackend();
      await waitForServer(appUrl, 30, 350);
    }
  } catch (error) {
    await stopBackend().catch(() => {});
    await settingsStore.rollbackLastUpdate();
    await startBackend();
    await waitForServer(appUrl, 30, 350);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`新设置未能通过验证，已恢复上一份配置：${message}`);
  }

  return {
    ok: true,
    settings: rendererSettingsSnapshot(),
    restarted: needsRestart,
    message: needsRestart ? "设置已保存，服务已按新配置重新连接。" : "纸页偏好已经保存。"
  };
}

async function createMainWindow() {
  await startBackend();
  await waitForServer(appUrl);

  mainWindow = new BrowserWindow({
    width: WINDOW_DEFAULT_WIDTH,
    height: WINDOW_DEFAULT_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    backgroundColor: "#f4f5f7",
    center: true,
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

  mainWindow.setAspectRatio(WINDOW_ASPECT_RATIO);

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

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
ipcMain.handle("settings:get", () => rendererSettingsSnapshot());
ipcMain.handle("settings:update", (_event, patch) => updateDesktopSettings(patch));
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
    const userDataPath = app.getPath("userData");
    runtimePaths = resolveRuntimePaths({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      userDataPath
    });
    settingsStore = createSettingsStore({
      userDataPath,
      safeStorage
    });
    await settingsStore.load();
    await createMainWindow();
  } catch (error) {
    if (!shuttingDown) {
      console.error(error);
      app.quit();
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitRequested) {
    return;
  }

  event.preventDefault();
  quitRequested = true;

  void stopBackend().finally(() => {
    app.quit();
  });
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});
