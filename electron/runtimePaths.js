import path from 'node:path';

export function resolveRuntimePaths({ isPackaged, appPath, userDataPath }) {
  const appRoot = path.resolve(appPath);

  return {
    appRoot,
    backendEntry: path.join(appRoot, 'src', 'server.js'),
    backendCwd: isPackaged ? path.resolve(userDataPath) : appRoot,
    databasePath: isPackaged
      ? path.join(path.resolve(userDataPath), 'data', 'echo.sqlite')
      : path.join(appRoot, 'data', 'echo.sqlite')
  };
}

export function buildBackendCandidates({
  isPackaged,
  processExecPath,
  runtimeNodePath,
  runtimeNodeExists,
  backendEntry,
  databasePath,
  runtimeEnv
}) {
  const env = {
    ...runtimeEnv,
    MARGIN_DB_PATH: databasePath
  };
  const electronCandidate = {
    command: processExecPath,
    args: [backendEntry],
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: '1'
    }
  };

  if (isPackaged) {
    return [electronCandidate];
  }

  const candidates = [];
  if (runtimeNodeExists) {
    candidates.push({
      command: runtimeNodePath,
      args: [backendEntry],
      env
    });
  }

  candidates.push({
    command: 'node',
    args: [backendEntry],
    env
  });
  candidates.push(electronCandidate);
  return candidates;
}
