import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPiAudit } from '../src/runtime/pi/piAudit.js';

test('audit passes only when dependency, installation, license, and Node match', () => {
  const report = buildPiAudit({
    nodeVersion: '22.23.1',
    dependencyVersion: '0.84.2',
    installedVersion: '0.84.2',
    installedLicense: 'MIT',
    runtimeExists: true
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
});

test('audit reports every mismatch without hiding additional failures', () => {
  const report = buildPiAudit({
    nodeVersion: '20.19.6',
    dependencyVersion: '^0.84.2',
    installedVersion: null,
    installedLicense: null,
    runtimeExists: false
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.failures.map((item) => item.code), [
    'unsupported_node',
    'dependency_not_exactly_pinned',
    'package_not_installed',
    'license_not_verified',
    'bundled_runtime_missing'
  ]);
});

test('audit treats malformed Node versions as unsupported evidence', () => {
  const report = buildPiAudit({
    nodeVersion: 'nightly',
    dependencyVersion: '0.84.2',
    installedVersion: '0.84.2',
    installedLicense: 'MIT',
    runtimeExists: true
  });
  assert.equal(report.ok, false);
  assert.equal(report.failures[0].code, 'unsupported_node');
});
