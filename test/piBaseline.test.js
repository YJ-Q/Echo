import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PI_BASELINE,
  parseNodeVersion,
  isSupportedNodeVersion,
  assertSupportedNodeVersion
} from '../src/runtime/pi/piBaseline.js';

test('Pi baseline is pinned to the audited upstream release', () => {
  assert.deepEqual(PI_BASELINE, {
    repository: 'https://github.com/earendil-works/pi',
    tag: 'v0.84.2',
    packageName: '@earendil-works/pi-coding-agent',
    packageVersion: '0.84.2',
    license: 'MIT',
    minimumNode: '22.19.0',
    runtimeNode: '22.23.1'
  });
});

test('Node support comparison handles patch and major versions', () => {
  assert.deepEqual(parseNodeVersion('v22.23.1'), [22, 23, 1]);
  assert.equal(isSupportedNodeVersion('22.18.0'), false);
  assert.equal(isSupportedNodeVersion('22.19.0'), true);
  assert.equal(isSupportedNodeVersion('22.23.1'), true);
  assert.equal(isSupportedNodeVersion('23.0.0'), true);
});

test('invalid or old Node versions produce an actionable error', () => {
  assert.throws(() => assertSupportedNodeVersion('20.19.6'), /Node >=22\.19\.0/);
  assert.throws(() => parseNodeVersion('nightly'), /Invalid Node version/);
});
