export const PI_BASELINE = Object.freeze({
  repository: 'https://github.com/earendil-works/pi',
  tag: 'v0.84.2',
  packageName: '@earendil-works/pi-coding-agent',
  packageVersion: '0.84.2',
  license: 'MIT',
  minimumNode: '22.19.0',
  runtimeNode: '22.23.1'
});

export function parseNodeVersion(version) {
  const match = String(version).match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Invalid Node version: ${version}`);
  }
  return match.slice(1).map(Number);
}

export function isSupportedNodeVersion(version) {
  const actual = parseNodeVersion(version);
  const minimum = parseNodeVersion(PI_BASELINE.minimumNode);
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

export function assertSupportedNodeVersion(version = process.versions.node) {
  if (!isSupportedNodeVersion(version)) {
    throw new Error(
      `Pi requires Node >=${PI_BASELINE.minimumNode}; received ${version}. ` +
      `Use .runtime/node-v${PI_BASELINE.runtimeNode}-win-x64/node.exe.`
    );
  }
}
