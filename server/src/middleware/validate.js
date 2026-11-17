import { ApiError } from '../utils/ApiError.js';

/** Validates req[source] against a zod schema and replaces it with parsed output. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    return next(ApiError.badRequest('Check the highlighted fields', 'VALIDATION_ERROR', details));
  }
  req[source] = result.data;
  next();
};
