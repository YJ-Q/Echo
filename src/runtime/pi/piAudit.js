import { PI_BASELINE, isSupportedNodeVersion } from './piBaseline.js';

export function buildPiAudit(input) {
  const failures = [];
  let supportedNode = false;
  try {
    supportedNode = isSupportedNodeVersion(input.nodeVersion);
  } catch {
    supportedNode = false;
  }
  if (!supportedNode) {
    failures.push({ code: 'unsupported_node', actual: input.nodeVersion });
  }
  if (input.dependencyVersion !== PI_BASELINE.packageVersion) {
    failures.push({ code: 'dependency_not_exactly_pinned', actual: input.dependencyVersion });
  }
  if (input.installedVersion !== PI_BASELINE.packageVersion) {
    failures.push({ code: 'package_not_installed', actual: input.installedVersion });
  }
  if (input.installedLicense !== PI_BASELINE.license) {
    failures.push({ code: 'license_not_verified', actual: input.installedLicense });
  }
  if (!input.runtimeExists) {
    failures.push({ code: 'bundled_runtime_missing', actual: false });
  }
  return {
    baseline: PI_BASELINE,
    observed: input,
    failures,
    ok: failures.length === 0
  };
}
