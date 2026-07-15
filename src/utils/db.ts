import { PostgrestError } from '@supabase/supabase-js';
import { HttpError } from '../middleware/errorHandler';

/** Throws an HttpError(500) if a Supabase query returned an error. */
export function assertNoDbError(error: PostgrestError | null, context: string): void {
  if (error) {
    throw new HttpError(500, 'DATABASE_ERROR', `${context}: ${error.message}`);
  }
}
