import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
);

test('legacy repository directories are absent', () => {
  for (const directory of ['frontend', 'electron', 'public']) {
    assert.equal(
      fs.existsSync(path.join(repositoryRoot, directory)),
      false,
      `legacy repository directory must not exist: ${directory}`,
    );
  }

});

test('package.json has no Electron main entry', () => {
  assert.equal(packageJson.main, undefined, 'package.json must not define an Electron main entry');
});

test('legacy frontend scripts are absent', () => {
  for (const script of ['desktop', 'dev:ui', 'build:ui']) {
    assert.equal(
      packageJson.scripts?.[script],
      undefined,
      `legacy frontend script must be absent: ${script}`,
    );
  }

});

test('legacy frontend dependencies are absent', () => {
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  for (const dependency of ['react', 'react-dom', 'vite', 'electron']) {
    assert.equal(
      dependencies[dependency],
      undefined,
      `legacy frontend dependency must be absent: ${dependency}`,
    );
  }

});

test('start script launches the terminal pilot', () => {
  assert.equal(
    packageJson.scripts?.start,
    'npm run pilot:terminal',
    'package.json.scripts.start must equal npm run pilot:terminal',
  );
});

for (const obsoleteDocumentPath of [
  'docs/CURRENT_UI_DESIGN_SPEC.html',
  'docs/CURRENT_UI_DESIGN_SPEC.md',
  'docs/DESIGN_IMAGERY.md',
  'docs/DESIGN_SPEC_COMPONENT_MAPPING.md',
  'docs/DEVELOPMENT_EXECUTION_GUIDE.md',
  'docs/DIALOGUE_RHYTHM.md',
  'docs/GEMINI_NOW_PAGE_HTML_RELAY.md',
  'docs/NOW_PAGE_INFORMATION_ARCHITECTURE.md',
  'docs/NOW_PAGE_WIREFRAME_SPEC.md',
  'docs/current-ui-preview.png',
  'docs/gemini-design-preview.html',
  'docs/gemini-design-preview.png',
  'docs/margin-component-ui-spec.html',
  'docs/MARGIN_DESIGN_LANGUAGE.md',
  'docs/PRODUCT_POSITIONING_V2.md',
  'docs/VOICE_AND_GUARDRAILS.md',
]) {
  test(`obsolete UI product document is absent: ${obsoleteDocumentPath}`, () => {
    assert.equal(
      fs.existsSync(path.join(repositoryRoot, obsoleteDocumentPath)),
      false,
      `obsolete UI product document must not exist: ${obsoleteDocumentPath}`,
    );
  });
}
