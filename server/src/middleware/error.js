import db from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';

export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let e = err;

  if (err instanceof db.Error.ValidationError) {
    e = ApiError.badRequest('Check the highlighted fields', 'VALIDATION_ERROR',
      Object.values(err.errors).map((x) => ({ field: x.path, message: x.message })));
  } else if (err instanceof db.Error.CastError) {
    e = ApiError.badRequest(`Invalid ${err.path}`, 'INVALID_ID');
  } else if (err?.code === 11000) {
    // The slot-lock index surfaces here. Translate it into something a patient understands.
    const isSlot = Object.keys(err.keyPattern || {}).includes('slotKey');
    e = isSlot
      ? ApiError.conflict('That slot was just taken. Pick another time.', 'SLOT_UNAVAILABLE')
      : ApiError.conflict('That record already exists', 'DUPLICATE_KEY');
  } else if (err?.name === 'MulterError') {
    e = ApiError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'Files must be 10 MB or smaller' : 'Upload failed', 'UPLOAD_ERROR');
  } else if (err?.type === 'entity.parse.failed') {
    e = ApiError.badRequest('Malformed JSON body', 'BAD_JSON');
  } else if (!(err instanceof ApiError)) {
    e = new ApiError(500, 'Something broke on our end', 'INTERNAL_ERROR');
  }

  if (e.statusCode >= 500 && env.nodeEnv !== 'test') console.error(err);

  res.status(e.statusCode).json({
    success: false,
    message: e.message,
    code: e.code,
    ...(e.details ? { details: e.details } : {}),
    ...(env.nodeEnv === 'development' && e.statusCode >= 500 ? { stack: err.stack } : {}),
  });
}
