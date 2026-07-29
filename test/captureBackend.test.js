import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const helperUrl = new URL(
  "../scripts/case-study/capture-backend.mjs",
  import.meta.url
);

async function loadCaptureBackend() {
  try {
    return await import(helperUrl);
  } catch {
    return {};
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function waitForProcessExit(pid, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`capture backend process ${pid} remained alive`);
}

const healthyChildScript = `
  const http = require("node:http");
  const port = Number(process.env.PORT);
  const server = http.createServer((request, response) => response.end("spawned"));
  server.listen(port, "127.0.0.1", () => {
    if (process.env.MARGIN_LOG_LEVEL === "info") {
      console.log("Margin backend listening on http://localhost:" + port);
    }
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;

test("capture backend avoids occupied port 3197 and forces info-level owned readiness", async () => {
  const helpers = await loadCaptureBackend();
  assert.equal(typeof helpers.startCaptureBackend, "function");
  assert.equal(typeof helpers.stopBackend, "function");

  const unrelated = http.createServer((request, response) => response.end("unrelated"));
  let ownsLegacyPort = false;
  try {
    await listen(unrelated, 3197);
    ownsLegacyPort = true;
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
  }

  let started;
  try {
    started = await helpers.startCaptureBackend({
      command: process.execPath,
      args: ["-e", healthyChildScript],
      cwd: process.cwd(),
      env: { ...process.env, MARGIN_LOG_LEVEL: "silent" },
      readyTimeoutMs: 2_000
    });

    assert.notEqual(started.port, 3197);
    assert.equal(await fetch(started.appUrl).then((response) => response.text()), "spawned");
    if (ownsLegacyPort) {
      assert.equal(
        await fetch("http://127.0.0.1:3197").then((response) => response.text()),
        "unrelated"
      );
    }
  } finally {
    if (started) await helpers.stopBackend(started.backend);
    if (ownsLegacyPort) await close(unrelated);
  }
});

test("capture backend times out wrong-port readiness and cleans up the child", async () => {
  const helpers = await loadCaptureBackend();
  assert.equal(typeof helpers.startCaptureBackend, "function");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "margin-capture-test-"));
  const pidPath = path.join(tempDir, "child.pid");
  const wrongReadyChildScript = `
    const fs = require("node:fs");
    const http = require("node:http");
    const port = Number(process.env.PORT);
    fs.writeFileSync(process.env.CAPTURE_TEST_PID_PATH, String(process.pid));
    const server = http.createServer((request, response) => response.end("wrong-owner"));
    server.listen(port, "127.0.0.1", () => {
      console.log("Margin backend listening on http://localhost:" + (port + 1));
    });
    setInterval(() => {}, 1000);
  `;

  try {
    await assert.rejects(
      helpers.startCaptureBackend({
        command: process.execPath,
        args: ["-e", wrongReadyChildScript],
        cwd: process.cwd(),
        env: { ...process.env, CAPTURE_TEST_PID_PATH: pidPath },
        readyTimeoutMs: 500
      }),
      /did not report readiness for port \d+ within 500ms/u
    );

    const pid = Number(await fs.readFile(pidPath, "utf8"));
    await waitForProcessExit(pid);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
