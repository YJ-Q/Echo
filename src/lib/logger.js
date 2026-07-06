import crypto from 'node:crypto';

const LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3
};

export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  return {
    error(message, meta) {
      writeLog('error', threshold, message, meta);
    },
    warn(message, meta) {
      writeLog('warn', threshold, message, meta);
    },
    info(message, meta) {
      writeLog('info', threshold, message, meta);
    }
  };
}

export function createRequestLogger(logger) {
  return (req, res, next) => {
    const startedAt = Date.now();
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      logger.info(`${req.method} ${req.originalUrl}`, {
        request_id: requestId,
        status: res.statusCode,
        duration_ms: Date.now() - startedAt
      });
    });

    next();
  };
}

function writeLog(level, threshold, message, meta) {
  if ((LEVELS[level] ?? LEVELS.info) > threshold) {
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {})
  };

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}
