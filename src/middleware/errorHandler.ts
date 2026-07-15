import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../config';
import { logger } from '../logger';
import { ApiError } from '../types';

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  logger.error('unhandled error', { err, path: req.originalUrl });

  if (err instanceof ZodError) {
    const body: ApiError = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    };
    return res.status(400).json(body);
  }

  if (err instanceof HttpError) {
    const body: ApiError = { success: false, error: { code: err.code, message: err.message } };
    return res.status(err.status).json(body);
  }

  const message =
    config.NODE_ENV === 'production'
      ? 'Internal server error'
      : err instanceof Error
        ? err.message
        : 'Internal server error';

  const body: ApiError = { success: false, error: { code: 'INTERNAL_ERROR', message } };
  return res.status(500).json(body);
}
