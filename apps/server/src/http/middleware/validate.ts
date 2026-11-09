import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';
import { AppError } from '../../lib/errors.js';

/** Validates and replaces `req.body` with the parsed (typed, defaulted) value. */
export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(
        AppError.badRequest(
          'Invalid request body',
          result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      );
    }
    req.body = result.data;
    next();
  };
}
