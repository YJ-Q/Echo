import net from 'node:net';

export async function findAvailablePort(preferredPort = 3000) {
  if (await isPortListening(preferredPort)) {
    return probePort(0);
  }

  try {
    return await probePort(preferredPort);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') {
      throw error;
    }
    return probePort(0);
  }
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (listening) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };

    socket.setTimeout(250, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function probePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const selectedPort = typeof address === 'object' && address ? address.port : port;
      server.close((error) => error ? reject(error) : resolve(selectedPort));
    });
  });
}
