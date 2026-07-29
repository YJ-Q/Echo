import { spawn } from "node:child_process";
import net from "node:net";

const DEFAULT_READY_TIMEOUT_MS = 20_000;
const DEFAULT_FORCE_STOP_MS = 2_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export async function allocateCapturePort() {
  const server = net.createServer();
  server.unref();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  if (!port) {
    throw new Error("Could not allocate an isolated capture port.");
  }
  return port;
}

export function waitForBackendReady(
  backend,
  { port, timeoutMs = DEFAULT_READY_TIMEOUT_MS }
) {
  const readyLine = `Margin backend listening on http://localhost:${port}`;

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      backend.stdout.off("data", onStdout);
      backend.stderr.off("data", onStderr);
      backend.off("error", onError);
      backend.off("exit", onExit);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onStdout = (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes(readyLine)) {
        finish();
      }
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
    };
    const onError = (error) => finish(error);
    const onExit = (code, signal) => {
      finish(
        new Error(
          `Spawned screenshot backend exited before readiness `
          + `(code=${code}, signal=${signal}): ${stderr.trim()}`
        )
      );
    };
    const timeout = setTimeout(() => {
      finish(
        new Error(
          `Spawned screenshot backend did not report readiness for port ${port} `
          + `within ${timeoutMs}ms.`
        )
      );
    }, timeoutMs);

    backend.stdout.on("data", onStdout);
    backend.stderr.on("data", onStderr);
    backend.once("error", onError);
    backend.once("exit", onExit);
  });
}

export async function stopBackend(
  backend,
  {
    forceAfterMs = DEFAULT_FORCE_STOP_MS,
    timeoutMs = DEFAULT_STOP_TIMEOUT_MS
  } = {}
) {
  if (backend.exitCode !== null || backend.signalCode !== null) {
    return;
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    let forceTimer;
    let failSafeTimer;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(failSafeTimer);
      backend.off("exit", onExit);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onExit = () => finish();

    backend.once("exit", onExit);
    forceTimer = setTimeout(() => backend.kill("SIGKILL"), forceAfterMs);
    failSafeTimer = setTimeout(
      () => finish(new Error("Screenshot backend did not stop after SIGKILL.")),
      timeoutMs
    );
    backend.kill();
  });
}

export async function startCaptureBackend({
  command,
  args,
  cwd,
  env = process.env,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS
}) {
  const port = await allocateCapturePort();
  const appUrl = `http://127.0.0.1:${port}`;
  const backend = spawn(command, args, {
    cwd,
    windowsHide: true,
    env: {
      ...env,
      PORT: String(port),
      MARGIN_LOG_LEVEL: "info"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  backend.stdout.on("data", (chunk) => process.stdout.write(chunk));
  backend.stderr.on("data", (chunk) => process.stderr.write(chunk));

  try {
    await waitForBackendReady(backend, {
      port,
      timeoutMs: readyTimeoutMs
    });
  } catch (error) {
    await stopBackend(backend);
    throw error;
  }

  return { appUrl, backend, port };
}
