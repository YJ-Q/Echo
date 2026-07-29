import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const currentProductFiles = [
  'src/app.js',
  'src/server.js',
  'electron/main.js',
  'src/services/echoStateEngine.js',
  'src/services/llm/echoPrompt.js',
  'src/services/toneProfile.js',
  'src/services/llm/providers/localProvider.js',
  'src/services/profileDictionary.js',
  'public/viewModels.js'
];

test('current runtime copy uses Margin rather than Echo', async () => {
  for (const file of currentProductFiles) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /(?:name:\s*['"]Echo['"]|Echo backend|Echo API|Invalid Echo configuration|Unhandled Echo error|You are Echo|Echo is not an assistant|Echo is the user's second self|Reply as Echo|Echo interaction style|echo-local-reflective|ECHO_TONE_PROFILE)/u,
      file
    );
  }
});

test('package and deployment entry points use Margin defaults', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const envExample = await readFile('.env.example', 'utf8');
  const compose = await readFile('docker-compose.yml', 'utf8');
  const dockerfile = await readFile('Dockerfile', 'utf8');
  const license = await readFile('LICENSE', 'utf8');

  assert.equal(packageJson.name, 'margin');
  assert.equal(packageJson.scripts.test, 'node --test test');
  assert.match(envExample, /MARGIN_DB_PATH=\.\/data\/margin\.sqlite/u);
  assert.match(envExample, /MARGIN_LLM_PROVIDER=local/u);
  assert.match(compose, /services:\s*\n\s*margin:/u);
  assert.match(compose, /MARGIN_DB_PATH=\/app\/data\/margin\.sqlite/u);
  assert.match(dockerfile, /ENV MARGIN_DB_PATH=\/app\/data\/margin\.sqlite/u);
  assert.match(license, /Copyright \(c\) 2026 Margin contributors/u);
});

test('legacy launchers delegate to Margin launchers', async () => {
  const oldLocal = await readFile('run-echo-local.cmd', 'utf8');
  const oldDesktop = await readFile('run-echo-desktop.cmd', 'utf8');
  assert.match(oldLocal, /deprecated.*run-margin-local\.cmd/iu);
  assert.match(oldDesktop, /deprecated.*run-margin-desktop\.cmd/iu);
});

test('backup and import CLI errors identify Margin and direct users to Margin configuration', async () => {
  const backupService = await readFile('src/services/backupService.js', 'utf8');
  const backupScript = await readFile('scripts/backup-data.js', 'utf8');
  const importScript = await readFile('scripts/import-data.js', 'utf8');

  assert.match(backupService, /Invalid Margin snapshot/u);
  assert.match(backupScript, /Margin database not found\. Start the app once or set MARGIN_DB_PATH\./u);
  assert.match(importScript, /Missing --file=\.\.\. for Margin import\./u);
});

test('current operational docs use Margin and compatibility examples', async () => {
  const readme = await readFile('README.md', 'utf8');
  const backupDoc = await readFile('docs/BACKUP_AND_EXPORT.md', 'utf8');

  assert.match(readme, /^# Margin/mu);
  assert.match(readme, /MARGIN_DB_PATH=\.\/data\/margin\.sqlite/u);
  assert.match(readme, /ECHO_DB_PATH.*deprecated.*supported/iu);
  assert.match(backupDoc, /margin-export-/u);
  assert.match(backupDoc, /legacy.*echo-export-/iu);
});

test('historical design documents declare their Echo-era status', async () => {
  for (const file of [
    'docs/CURRENT_UI_DESIGN_SPEC.md',
    'docs/DESIGN_IMAGERY.md',
    'docs/DESIGN_SPEC_COMPONENT_MAPPING.md'
  ]) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /历史材料.*Echo.*旧名称/u, file);
  }
});

test('local SDD reports are ignored instead of tracked as product artifacts', async () => {
  const gitignore = await readFile('.gitignore', 'utf8');

  assert.match(gitignore, /^\.superpowers\/sdd\/$/mu);
});

test('Margin compatibility documentation lists retained legacy API aliases', async () => {
  const compatibility = await readFile('docs/MARGIN_NAMING_COMPATIBILITY.md', 'utf8');

  for (const alias of [
    'resolveEchoProvider',
    'exportEchoDataSnapshot',
    'importEchoDataSnapshot'
  ]) {
    assert.match(compatibility, new RegExp(`\\b${alias}\\b`, 'u'));
  }
});
