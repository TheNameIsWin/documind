export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static notFound(message: string) {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static unsupported(message: string) {
    return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message);
  }

  static upstream(message: string, details?: unknown) {
    return new AppError(502, 'UPSTREAM_ERROR', message, details);
  }
}
