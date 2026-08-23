import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { createMarginCore } from '../src/core/createMarginCore.js';
import { createTerminalPilotController } from '../src/pilot/terminalPilotController.js';
import { createPiTerminalPilotRuntime } from '../src/runtime/pi/piTerminalPilotRuntime.js';

const TOOLS = ['memory_search', 'memory_propose', 'state_update', 'action_update'];

export function sanitizePilotReport(input = {}) {
  return {
    projectId: input.projectId ?? null,
    sessions: [...new Set(input.sessions ?? [])],
    contextDigests: [...new Set(input.contextDigests ?? [])],
    resultCodes: [...new Set(input.resultCodes ?? [])],
    auditIds: [...new Set(input.auditIds ?? [])],
    tools: TOOLS,
    safety: { localOnly: true, builtinToolsDisabled: true, externalWritesDisabled: true }
  };
}

export async function runTerminalLoop({ controller, lines, write }) {
  const started = await controller.start();
  const evidence = { projectId: started.projectId, sessions: [started.sessionId], contextDigests: [], resultCodes: [], auditIds: [] };
  write('Margin 终端试点：仅本地记录，不访问招聘网站、邮箱或文件。');
  write('命令：/state  /status  /pause  /resume  /stop  /checkpoint  /memory  /new  /exit');
  try {
    for await (const line of lines) {
      const result = await controller.handle(line);
      if (result.sessionId) evidence.sessions.push(result.sessionId);
      if (result.trace?.contextDigest) evidence.contextDigests.push(result.trace.contextDigest);
      if (result.trace?.resultCodes) evidence.resultCodes.push(...result.trace.resultCodes);
      if (result.trace?.toolResults) evidence.auditIds.push(...result.trace.toolResults.map((item) => item.auditId).filter(Boolean));
      if (result.code) evidence.resultCodes.push(result.code);
      if (result.text) write(result.text);
      if (result.kind === 'exit') break;
    }
  } finally {
    await controller.close();
  }
  return evidence;
}

export async function runInteractiveLoop({ controllerPromise, input, output, signalSource }) {
  const readline = createInterface({ input, output, terminal: Boolean(input.isTTY) });
  const onSigint = () => readline.close();
  signalSource?.once?.('SIGINT', onSigint);
  try {
    const bufferedLines = input.isTTY ? null : (async () => {
      const values = [];
      for await (const line of readline) values.push(line);
      return values;
    })();
    const controller = await controllerPromise;
    const lines = bufferedLines ? await bufferedLines : readline;
    return await runTerminalLoop({ controller, lines, write: (text) => output.write(`${text}\n`) });
  } finally {
    signalSource?.off?.('SIGINT', onSigint);
    readline.close();
  }
}

async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

function registry(file) {
  return {
    async load() { try { return JSON.parse(await readFile(file, 'utf8')).projectId ?? null; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    async save(projectId) { await atomicJson(file, { projectId }); }
  };
}

export async function main({ env = process.env, stdin = process.stdin, stdout = process.stdout } = {}) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = path.join(repositoryRoot, 'data', 'terminal-pilot');
  const provider = env.MARGIN_PI_PROVIDER ?? 'yapi';
  const modelId = env.MARGIN_PI_MODEL ?? 'gpt-5.6-terra';
  const baseUrl = env.MARGIN_PI_BASE_URL ?? (provider === 'yapi' ? 'https://yapi.click/v1' : undefined);
  const api = env.MARGIN_PI_API ?? (provider === 'yapi' ? 'openai-responses' : undefined);
  const keyName = env.MARGIN_PI_API_KEY_ENV ?? (provider === 'yapi' ? 'YAPI_API_KEY' : undefined);
  const apiKey = keyName ? env[keyName] : undefined;
  if (!provider || !modelId || !baseUrl || !api || !apiKey) {
    stdout.write('pi_credentials_required\n');
    return 3;
  }
  let core;
  let runtime;
  try {
    const controllerPromise = (async () => {
      await mkdir(path.join(dataDir, 'agent'), { recursive: true });
      core = await createMarginCore({ enabled: true, dbPath: path.join(dataDir, 'margin-core.sqlite') });
      runtime = await createPiTerminalPilotRuntime({
        repositoryRoot, agentDir: path.join(dataDir, 'agent'), provider, modelId,
        customProvider: { baseUrl, api, apiKey }, tools: core.tools
      });
      return createTerminalPilotController({
        core, runtime, registry: registry(path.join(dataDir, 'project.json')),
        clock: () => new Date().toISOString(), idFactory: (prefix) => `${prefix}-${randomUUID()}`
      });
    })();
    const evidence = await runInteractiveLoop({ controllerPromise, input: stdin, output: stdout, signalSource: process });
    await atomicJson(path.join(dataDir, 'report.json'), sanitizePilotReport(evidence));
    return 0;
  } finally {
    await runtime?.close?.();
    await core?.close?.();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main();
