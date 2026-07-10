import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { findAvailablePort } from '../electron/backendPort.js';

test('uses the preferred backend port when it is free', async () => {
  const preferredPort = await listenOnRandomPort();
  const result = await findAvailablePort(preferredPort);

  assert.equal(result, preferredPort);
});

test('falls back to another port when the preferred port is occupied', async () => {
  const blocker = net.createServer();
  await listen(blocker, 0);

  try {
    const occupiedPort = blocker.address().port;
    const result = await findAvailablePort(occupiedPort);

    assert.notEqual(result, occupiedPort);
    assert.ok(Number.isInteger(result));
    assert.ok(result > 0 && result <= 65535);
  } finally {
    await close(blocker);
  }
});

test('detects a preferred port occupied by a wildcard listener', async () => {
  const blocker = net.createServer();
  await listen(blocker, 0, '::');

  try {
    const occupiedPort = blocker.address().port;
    const result = await findAvailablePort(occupiedPort);

    assert.notEqual(result, occupiedPort);
  } finally {
    await close(blocker);
  }
});

async function listenOnRandomPort() {
  const server = net.createServer();
  await listen(server, 0);
  const port = server.address().port;
  await close(server);
  return port;
}

function listen(server, port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
