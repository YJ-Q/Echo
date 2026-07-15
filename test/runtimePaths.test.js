import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildBackendCandidates, resolveRuntimePaths } from '../electron/runtimePaths.js';

test('development paths keep code and data in the checkout', () => {
  const paths = resolveRuntimePaths({
    isPackaged: false,
    appPath: 'D:\\Echo',
    userDataPath: 'C:\\Users\\tester\\AppData\\Roaming\\Margin'
  });

  assert.equal(paths.appRoot, 'D:\\Echo');
  assert.equal(paths.backendEntry, path.join('D:\\Echo', 'src', 'server.js'));
  assert.equal(paths.backendCwd, 'D:\\Echo');
  assert.equal(paths.databasePath, path.join('D:\\Echo', 'data', 'echo.sqlite'));
});

test('packaged paths read code from app.asar and write data under userData', () => {
  const appPath = 'C:\\Program Files\\Margin\\resources\\app.asar';
  const userDataPath = 'C:\\Users\\tester\\AppData\\Roaming\\Margin';
  const paths = resolveRuntimePaths({
    isPackaged: true,
    appPath,
    userDataPath
  });

  assert.equal(paths.appRoot, appPath);
  assert.equal(paths.backendEntry, path.join(appPath, 'src', 'server.js'));
  assert.equal(paths.backendCwd, userDataPath);
  assert.equal(paths.databasePath, path.join(userDataPath, 'data', 'echo.sqlite'));
});

test('packaged backend uses Electron as Node with the writable database path', () => {
  const candidates = buildBackendCandidates({
    isPackaged: true,
    processExecPath: 'C:\\Program Files\\Margin\\Margin.exe',
    runtimeNodePath: 'unused-node.exe',
    runtimeNodeExists: true,
    backendEntry: 'C:\\Program Files\\Margin\\resources\\app.asar\\src\\server.js',
    databasePath: 'C:\\Users\\tester\\AppData\\Roaming\\Margin\\data\\echo.sqlite',
    runtimeEnv: { MARGIN_LLM_PROVIDER: 'local' }
  });

  assert.deepEqual(candidates, [{
    command: 'C:\\Program Files\\Margin\\Margin.exe',
    args: ['C:\\Program Files\\Margin\\resources\\app.asar\\src\\server.js'],
    env: {
      MARGIN_LLM_PROVIDER: 'local',
      MARGIN_DB_PATH: 'C:\\Users\\tester\\AppData\\Roaming\\Margin\\data\\echo.sqlite',
      ELECTRON_RUN_AS_NODE: '1'
    }
  }]);
});

test('development backend keeps system Node fallbacks', () => {
  const candidates = buildBackendCandidates({
    isPackaged: false,
    processExecPath: 'D:\\Echo\\node_modules\\electron\\dist\\electron.exe',
    runtimeNodePath: 'D:\\Echo\\.runtime\\node.exe',
    runtimeNodeExists: false,
    backendEntry: 'D:\\Echo\\src\\server.js',
    databasePath: 'D:\\Echo\\data\\echo.sqlite',
    runtimeEnv: {}
  });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].command, 'node');
  assert.equal(candidates[0].env.MARGIN_DB_PATH, 'D:\\Echo\\data\\echo.sqlite');
  assert.equal(candidates[1].command, 'D:\\Echo\\node_modules\\electron\\dist\\electron.exe');
  assert.equal(candidates[1].env.ELECTRON_RUN_AS_NODE, '1');
});
