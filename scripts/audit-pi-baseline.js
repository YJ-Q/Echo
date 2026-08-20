import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PI_BASELINE } from '../src/runtime/pi/piBaseline.js';
import { buildPiAudit } from '../src/runtime/pi/piAudit.js';

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
  return buildPiAudit({
    nodeVersion: process.versions.node,
    dependencyVersion: projectPackage?.dependencies?.[PI_BASELINE.packageName] ?? null,
    installedVersion: installedPackage?.version ?? null,
    installedLicense: installedPackage?.license ?? null,
    runtimeExists: await pathExists(runtimePath)
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
