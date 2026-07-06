import { sendError } from './apiResponse.js';

export function requireBody(...keys) {
  return (req, res, next) => {
    const missing = keys.filter((key) => {
      const val = req.body?.[key];
      return val === undefined || val === null || (typeof val === 'string' && val.trim() === '');
    });

    if (missing.length > 0) {
      return sendError(
        res,
        400,
        `缺少必要字段: ${missing.join(', ')}`,
        'validation_error'
      );
    }

    next();
  };
}

export function requireQuery(...keys) {
  return (req, res, next) => {
    const missing = keys.filter((key) => {
      const val = req.query?.[key];
      return val === undefined || val === null || val === '';
    });

    if (missing.length > 0) {
      return sendError(
        res,
        400,
        `缺少必要查询参数: ${missing.join(', ')}`,
        'validation_error'
      );
    }

    next();
  };
}

export function validateMemoryPriority(req, res, next) {
  const { salience, priority_bucket, pinned, reinforcement_count } = req.body || {};

  if (salience !== undefined && (typeof salience !== 'number' || salience < 0 || salience > 1)) {
    return sendError(res, 400, 'salience 必须在 0-1 之间', 'validation_error');
  }

  if (priority_bucket !== undefined && !['ambient', 'important', 'core'].includes(priority_bucket)) {
    return sendError(res, 400, 'priority_bucket 必须是 ambient / important / core', 'validation_error');
  }

  if (pinned !== undefined && typeof pinned !== 'boolean') {
    return sendError(res, 400, 'pinned 必须是布尔值', 'validation_error');
  }

  if (reinforcement_count !== undefined && (typeof reinforcement_count !== 'number' || reinforcement_count < 0)) {
    return sendError(res, 400, 'reinforcement_count 必须是非负数', 'validation_error');
  }

  next();
}
