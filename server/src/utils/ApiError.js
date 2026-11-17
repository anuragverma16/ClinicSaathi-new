export class ApiError extends Error {
  constructor(statusCode, message, code = 'ERROR', details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
  static badRequest(msg, code = 'BAD_REQUEST', details) { return new ApiError(400, msg, code, details); }
  static unauthorized(msg = 'Sign in to continue', code = 'UNAUTHORIZED') { return new ApiError(401, msg, code); }
  static forbidden(msg = 'You do not have access to this', code = 'FORBIDDEN') { return new ApiError(403, msg, code); }
  static notFound(msg = 'Not found', code = 'NOT_FOUND') { return new ApiError(404, msg, code); }
  static conflict(msg, code = 'CONFLICT') { return new ApiError(409, msg, code); }
}
