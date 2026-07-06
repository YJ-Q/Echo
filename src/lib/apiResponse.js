export function sendData(res, data, status = 200) {
  return res.status(status).json({
    ok: true,
    data
  });
}

export function sendError(res, status, message, code = 'request_error') {
  return res.status(status).json({
    ok: false,
    error: {
      code,
      message
    }
  });
}
