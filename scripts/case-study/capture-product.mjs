import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startCaptureBackend,
  stopBackend
} from "./capture-backend.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../..");
const outputDir = path.join(root, "case-study/assets/screenshots");
const tempDir = path.join(root, "case-study/.tmp");
const tempDb = path.join(tempDir, "margin-case-study.sqlite");
const serverEntry = path.join(root, "src/server.js");
const seedEntry = path.join(root, "scripts/case-study/seed-operation-event.mjs");
let appUrl;
const views = ["now", "learn", "actions", "memory", "management", "achievements"];
const viewTitles = {
  now: "此刻",
  learn: "学习",
  actions: "行动",
  memory: "记忆",
  management: "整理",
  achievements: "记录"
};

app.disableHardwareAcceleration();

function assertSafeTempPath(target) {
  const expectedRoot = path.resolve(root, "case-study/.tmp") + path.sep;
  const resolved = path.resolve(target);
  if (!resolved.startsWith(expectedRoot)) {
    throw new Error(`Refusing to remove unsafe path: ${resolved}`);
  }
}

async function waitForServer(attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}/health`);
      if (response.ok) return;
    } catch {
      // Wait for the isolated backend.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Isolated screenshot backend did not become ready.");
}

function sleep(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function requestJson(route, { method = "GET", body } = {}) {
  const response = await fetch(`${appUrl}${route}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();

  if (!response.ok || payload?.ok === false) {
    throw new Error(`Demo seed request failed: ${method} ${route}`);
  }

  return payload?.data ?? payload;
}

async function seedDemoData() {
  const messages = [
    "我想学 AI 产品案例叙事，但总在开始前拖延。",
    "我卡在问题定义上，不懂怎样把“功能很多”收束成一个清楚的用户矛盾。",
    "今天想到案例研究有点焦虑，但我准备先完成一张产品闭环图。"
  ];

  for (const message of messages) {
    await requestJson("/chat", {
      method: "POST",
      body: { message }
    });
  }

  const actionInputs = [
    {
      type: "manual",
      title: "把案例研究的问题定义压缩成一句话",
      detail: "只保留用户矛盾、产品判断与证据边界。",
      priority: 1
    },
    {
      type: "manual",
      title: "为产品闭环图补上证据边界",
      detail: "区分已实现、场景验证与下一步假设。",
      priority: 2
    },
    {
      type: "manual",
      title: "检查每个关键结论是否有界面或测试支持",
      detail: "没有证据的部分明确标注为假设。",
      priority: 3
    }
  ];
  const actions = [];

  for (const actionInput of actionInputs) {
    const result = await requestJson("/actions", {
      method: "POST",
      body: actionInput
    });
    actions.push(result.action);
  }

  if (actions[0]?.id) {
    await requestJson(`/actions/${actions[0].id}/status`, {
      method: "POST",
      body: { status: "active" }
    });
  }

  await requestJson("/summary", { method: "POST" });
  await seedOperationEvent();
}

async function seedOperationEvent() {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.env.CASE_STUDY_NODE || "node",
      [seedEntry, tempDb],
      {
        cwd: root,
        windowsHide: true,
        env: {
          ...process.env,
          MARGIN_LLM_PROVIDER: "local",
          MARGIN_DB_PATH: tempDb
        },
        stdio: ["ignore", "ignore", "pipe"]
      }
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Operation-event seed failed (${code}): ${stderr.trim()}`));
    });
  });
}

async function waitForSeededData(window, attempts = 60) {
  let lastState = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await window.webContents.executeJavaScript(`
      (() => ({
        learningTopic: document.querySelector("#learn-topic")?.textContent?.trim() || "",
        memoryCount: document.querySelector("#memory-total-chip")?.textContent?.trim() || "",
        actionCount: document.querySelectorAll("#action-list .action-row").length,
        syncLabel: document.querySelector("#sync-chip")?.textContent?.trim() || ""
      }))()
    `);
    lastState = state;
    const hasLearning = state.learningTopic && state.learningTopic !== "等待学习主题";
    const hasMemories = !state.memoryCount.startsWith("0 ");
    const hasActions = state.actionCount >= 2;
    const hasSynced = state.syncLabel === "后端联调";

    if (hasLearning && hasMemories && hasActions && hasSynced) {
      await window.webContents.executeJavaScript(`
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
      `);
      return;
    }

    await sleep(100);
  }

  throw new Error(`Seeded portfolio data did not finish rendering: ${JSON.stringify(lastState)}`);
}

async function waitForView(window, view, attempts = 60) {
  const title = viewTitles[view];
  await window.webContents.executeJavaScript(`
    document.querySelector('.nav-item[data-view="${view}"]')?.click();
  `);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await window.webContents.executeJavaScript(`
      (() => {
        const main = document.querySelector(".main-window");
        const nav = document.querySelector('.nav-item[data-view="${view}"]');
        const panel = document.querySelector('[data-view-panel="${view}"]');
        return {
          activeView: main?.dataset.activeView || "",
          pressed: nav?.getAttribute("aria-pressed") || "",
          panelActive: Boolean(panel?.classList.contains("active")),
          title: document.querySelector("#view-title")?.textContent?.trim() || ""
        };
      })()
    `);

    if (
      state.activeView === view
      && state.pressed === "true"
      && state.panelActive
      && state.title === title
    ) {
      await window.webContents.executeJavaScript(`
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
      `);
      await sleep(120);
      return;
    }

    await sleep(100);
  }

  throw new Error(`View ${view} did not become stable.`);
}

async function prepareNativeView(window, view) {
  await window.webContents.executeJavaScript(`
    (() => {
      const mainWindow = document.querySelector(".main-window");
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      if (mainWindow) {
        mainWindow.scrollTop = 0;
      }
      if ("${view}" === "memory") {
        document.querySelector("#memory-list")?.scrollIntoView({ block: "start" });
      }
    })()
  `);
  await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })
  `);
  await sleep(120);
}

async function assertSafeView(window, view) {
  const snapshot = await window.webContents.executeJavaScript(`
    (() => {
      const viewportText = Array.from(document.querySelectorAll("body *"))
        .filter((element) => {
          if (element.children.length > 0) return false;
          const rect = element.getBoundingClientRect();
          return rect.bottom > 0
            && rect.right > 0
            && rect.top < window.innerHeight
            && rect.left < window.innerWidth;
        })
        .map((element) => element.textContent || "")
        .join("\\n");
      return {
        activeView: document.querySelector(".main-window")?.dataset.activeView || "",
        pressed: document.querySelector('.nav-item[data-view="${view}"]')?.getAttribute("aria-pressed") || "",
        title: document.querySelector("#view-title")?.textContent?.trim() || "",
        viewportText
      };
    })()
  `);
  const unsafeText = ["正在铺开这一页", "[object Object]", "Node.js"]
    .find((text) => snapshot.viewportText.includes(text));

  if (
    unsafeText
    || snapshot.activeView !== view
    || snapshot.pressed !== "true"
    || snapshot.title !== viewTitles[view]
  ) {
    throw new Error(`Unsafe screenshot state for ${view}: ${unsafeText || "route mismatch"}`);
  }
}

async function capture() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  assertSafeTempPath(tempDb);
  await fs.rm(tempDb, { force: true });
  await fs.rm(`${tempDb}-shm`, { force: true });
  await fs.rm(`${tempDb}-wal`, { force: true });

  const started = await startCaptureBackend({
    command: process.env.CASE_STUDY_NODE || "node",
    args: [serverEntry],
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      MARGIN_LOG_LEVEL: "info",
      MARGIN_LLM_PROVIDER: "local",
      MARGIN_DB_PATH: tempDb
    }
  });
  const { backend } = started;
  appUrl = started.appUrl;

  try {
    await waitForServer();
    await seedDemoData();
    const window = new BrowserWindow({
      width: 1440,
      height: 1000,
      useContentSize: true,
      frame: false,
      show: false,
      backgroundColor: "#f5f2ea",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    window.webContents.on("console-message", (event) => {
      if (event?.level === "error") {
        console.error(`[renderer] ${event.message}`);
      }
    });
    await window.webContents.session.clearCache();
    await window.loadURL(appUrl);
    await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const done = () => {
          document.querySelector("#launch-screen")?.remove();
          resolve();
        };
        document.readyState === "complete"
          ? setTimeout(done, 1200)
          : window.addEventListener("load", () => setTimeout(done, 1200), { once: true });
      })
    `);
    await waitForSeededData(window);
    await window.webContents.insertCSS(`
      #launch-screen {
        display: none !important;
      }
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `);

    for (const view of views) {
      await waitForView(window, view);
      await prepareNativeView(window, view);
      await assertSafeView(window, view);
      await window.webContents.capturePage();
      await sleep(80);
      const image = await window.webContents.capturePage();
      const portfolioImage = image.resize({
        width: 1440,
        height: 1000,
        quality: "best"
      });
      await fs.writeFile(path.join(outputDir, `${view}.png`), portfolioImage.toPNG());
    }
    window.destroy();
  } finally {
    await stopBackend(backend);
  }
}

app.whenReady()
  .then(capture)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
