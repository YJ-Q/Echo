import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { loadRuntimeConfig } from '../src/config/env.js';
import {
  configureProviderRegistry,
  resolveEchoProvider,
  resolveMarginProvider
} from '../src/services/llm/providerRegistry.js';
import { configureMemoryStore, getMemoryStorePaths } from '../src/storage/memoryStore.js';

const rootDir = path.resolve('C:/margin-test-root');

test.after(() => {
  configureMemoryStore({ dbPath: '' });
});

test('memory store consumes the resolved Margin database path', () => {
  const dbPath = path.join(rootDir, 'data', 'configured-margin.sqlite');
  configureMemoryStore({ dbPath });

  assert.equal(getMemoryStorePaths().dbPath, dbPath);
});

test('provider registry consumes the configured Margin provider', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    configureProviderRegistry({ requestedProvider: 'openai' });

    assert.equal(resolveMarginProvider().name, 'openai');
    assert.equal(resolveEchoProvider().name, 'openai');
  } finally {
    configureProviderRegistry({ requestedProvider: 'local' });
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  }
});

test('Margin variables take priority over legacy Echo variables', () => {
  const config = loadRuntimeConfig({
    MARGIN_LOG_LEVEL: 'debug',
    ECHO_LOG_LEVEL: 'error',
    MARGIN_LLM_PROVIDER: 'local',
    ECHO_LLM_PROVIDER: 'openai',
    MARGIN_DB_PATH: './data/custom-margin.sqlite',
    ECHO_DB_PATH: './data/custom-echo.sqlite'
  }, {
    rootDir,
    pathExists: () => false
  });

  assert.equal(config.logLevel, 'debug');
  assert.equal(config.llmProvider, 'local');
  assert.equal(config.dbPath, path.resolve(rootDir, 'data/custom-margin.sqlite'));
  assert.match(config.warnings.join('\n'), /ECHO_LOG_LEVEL.*ignored/u);
  assert.match(config.warnings.join('\n'), /ECHO_LLM_PROVIDER.*ignored/u);
  assert.match(config.warnings.join('\n'), /ECHO_DB_PATH.*ignored/u);
});

test('legacy Echo variables remain supported with deprecation warnings', () => {
  const config = loadRuntimeConfig({
    ECHO_LOG_LEVEL: 'warn',
    ECHO_LLM_PROVIDER: 'local',
    ECHO_DB_PATH: './data/echo.sqlite'
  }, {
    rootDir,
    pathExists: () => false
  });

  assert.equal(config.logLevel, 'warn');
  assert.equal(config.llmProvider, 'local');
  assert.equal(config.dbPath, path.resolve(rootDir, 'data/echo.sqlite'));
  assert.match(config.warnings.join('\n'), /ECHO_LOG_LEVEL is deprecated/u);
  assert.match(config.warnings.join('\n'), /ECHO_LLM_PROVIDER is deprecated/u);
  assert.match(config.warnings.join('\n'), /ECHO_DB_PATH is deprecated/u);
});

test('a new installation defaults to margin.sqlite', () => {
  const config = loadRuntimeConfig({}, {
    rootDir,
    pathExists: () => false
  });

  assert.equal(config.dbPath, path.join(rootDir, 'data', 'margin.sqlite'));
});

test('an existing echo.sqlite remains the fallback when margin.sqlite is absent', () => {
  const legacyPath = path.join(rootDir, 'data', 'echo.sqlite');
  const config = loadRuntimeConfig({}, {
    rootDir,
    pathExists: (candidate) => candidate === legacyPath
  });

  assert.equal(config.dbPath, legacyPath);
  assert.match(config.warnings.join('\n'), /legacy database.*echo\.sqlite/u);
});

test('margin.sqlite wins when both default databases exist', () => {
  const config = loadRuntimeConfig({}, {
    rootDir,
    pathExists: () => true
  });

  assert.equal(config.dbPath, path.join(rootDir, 'data', 'margin.sqlite'));
  assert.match(config.warnings.join('\n'), /legacy database.*not merged/u);
});

test('OpenAI fallback warning uses the Margin product name', () => {
  const config = loadRuntimeConfig({ MARGIN_LLM_PROVIDER: 'openai' }, {
    rootDir,
    pathExists: () => false
  });

  assert.match(config.warnings.join('\n'), /Margin will fall back to the local provider/u);
  assert.doesNotMatch(config.warnings.join('\n'), /Echo will fall back/u);
});

test('Anthropic fallback warning uses the Margin product name', () => {
  const config = loadRuntimeConfig({ MARGIN_LLM_PROVIDER: 'anthropic' }, {
    rootDir,
    pathExists: () => false
  });

  assert.match(config.warnings.join('\n'), /Margin will fall back to the local provider/u);
  assert.doesNotMatch(config.warnings.join('\n'), /Echo will fall back/u);
});

test('SiliconFlow fallback warning uses the Margin product name', () => {
  const config = loadRuntimeConfig({ MARGIN_LLM_PROVIDER: 'siliconflow' }, {
    rootDir,
    pathExists: () => false
  });

  assert.match(config.warnings.join('\n'), /Margin will fall back to the local provider/u);
  assert.doesNotMatch(config.warnings.join('\n'), /Echo will fall back/u);
});

test('invalid runtime configuration uses the Margin product name', () => {
  assert.throws(
    () => loadRuntimeConfig({ MARGIN_LLM_PROVIDER: 'unsupported' }, {
      rootDir,
      pathExists: () => false
    }),
    (error) => {
      assert.match(error.message, /Invalid Margin configuration/u);
      assert.doesNotMatch(error.message, /Invalid Echo configuration/u);
      return true;
    }
  );
});

test('invalid legacy provider configuration identifies ECHO_LLM_PROVIDER as the source', () => {
  assert.throws(
    () => loadRuntimeConfig({ ECHO_LLM_PROVIDER: 'unsupported' }, {
      rootDir,
      pathExists: () => false
    }),
    (error) => {
      assert.match(error.message, /Invalid Margin configuration/u);
      assert.match(error.message, /Unsupported ECHO_LLM_PROVIDER: unsupported/u);
      return true;
    }
  );
});
