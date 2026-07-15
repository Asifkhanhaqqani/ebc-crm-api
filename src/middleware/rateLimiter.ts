import rateLimit from 'express-rate-limit';
import { ApiError } from '../types';

function jsonHandler(_req: unknown, res: import('express').Response) {
  const body: ApiError = {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests — please try again later.' },
  };
  res.status(429).json(body);
}

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler,
});

export const strictRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler,
});
