import { access, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PI_BASELINE } from '../src/runtime/pi/piBaseline.js';
import { buildPiAudit } from '../src/runtime/pi/piAudit.js';

const execFileAsync = promisify(execFile);

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readNodeVersion(runtimePath) {
  try {
    const { stdout } = await execFileAsync(runtimePath, ['--version'], {
      windowsHide: true,
      timeout: 10_000
    });
    return stdout.trim().replace(/^v/, '');
  } catch {
    return null;
  }
}

export async function collectPiAudit(rootDir) {
  const projectPackage = await readJsonOrNull(path.join(rootDir, 'package.json'));
  const installedPackage = await readJsonOrNull(
    path.join(rootDir, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json')
  );
  const runtimePath = path.join(
    rootDir,
    '.runtime',
    `node-v${PI_BASELINE.runtimeNode}-win-x64`,
    'node.exe'
  );
  const runtimeExists = await pathExists(runtimePath);
  return buildPiAudit({
    nodeVersion: process.versions.node,
    dependencyVersion: projectPackage?.dependencies?.[PI_BASELINE.packageName] ?? null,
    installedVersion: installedPackage?.version ?? null,
    installedLicense: installedPackage?.license ?? null,
    runtimeExists,
    runtimeVersion: runtimeExists ? await readNodeVersion(runtimePath) : null
  });
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const report = await collectPiAudit(rootDir);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Pi audit failed: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
