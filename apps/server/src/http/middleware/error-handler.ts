import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../../lib/errors.js';

export const notFound: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let error: AppError;

  if (err instanceof AppError) {
    error = err;
  } else if (err instanceof multer.MulterError) {
    error =
      err.code === 'LIMIT_FILE_SIZE'
        ? new AppError(413, 'PAYLOAD_TOO_LARGE', 'File exceeds the upload size limit')
        : AppError.badRequest(err.message);
  } else if (err?.type === 'entity.parse.failed') {
    error = AppError.badRequest('Malformed JSON body');
  } else {
    error = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong');
  }

  if (error.status >= 500) req.log?.error({ err }, error.message);

  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined && error.status < 500 ? { details: error.details } : {}),
      requestId: req.id,
    },
  });
};
