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

// Deliberately more lenient than strictRateLimiter — the one-time admin
// bootstrap flow can legitimately take a few tries (typo'd email, employee
// record not linked yet, etc.) without anyone being malicious about it.
export const setupRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many setup attempts. Please wait 15 minutes.',
    },
  },
});
