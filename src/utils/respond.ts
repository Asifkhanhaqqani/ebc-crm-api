import { Response } from 'express';
import { ApiSuccess, PaginationMeta } from '../types';

export function ok<T>(res: Response, data: T, meta?: PaginationMeta, status = 200) {
  const body: ApiSuccess<T> = { success: true, data, ...(meta ? { meta } : {}) };
  return res.status(status).json(body);
}
