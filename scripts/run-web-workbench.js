import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createWebWorkbench } from '../src/web/createWebWorkbench.js';

dotenv.config();

export async function main({
  argv = process.argv.slice(2), env = process.env,
  stdout = process.stdout, stderr = process.stderr, signalSource = process
} = {}) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dev = argv.includes('--dev');
  let workbench;
  let shutdownPromise;
  const shutdown = () => {
    shutdownPromise ??= workbench?.close?.() ?? Promise.resolve();
    return shutdownPromise;
  };
  const onSignal = () => {
    signalSource.off?.('SIGINT', onSignal);
    signalSource.off?.('SIGTERM', onSignal);
    shutdown().catch(() => { process.exitCode = 1; });
  };
  try {
    workbench = await createWebWorkbench({ rootDir, dev, env });
    const started = await workbench.start();
    signalSource.once?.('SIGINT', onSignal);
    signalSource.once?.('SIGTERM', onSignal);
    stdout.write(`margin_web_ready ${started.origin}\n`);
    return 0;
  } catch (error) {
    await shutdown().catch(() => {});
    const code = error?.message?.startsWith('web_assets_missing') ? error.message : (error?.code ?? 'web_start_failed');
    stderr.write(`${code}\n`);
    return 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main();
