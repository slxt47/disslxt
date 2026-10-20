import type { z } from 'zod';
import { AppError, notFound, validationError } from './errors.js';

export interface FieldIssue {
  path: string;
  message: string;
}

export function formatIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

/** Parses data with a zod schema; throws AppError VALIDATION_ERROR (400) with field details. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw validationError(formatIssues(r.error));
  return r.data;
}

/** Like parse, but maps failures to 404 (used for path params such as ids). */
export function parseParam<S extends z.ZodType>(
  schema: S,
  data: unknown,
  onFail: () => AppError = () => notFound(),
): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw onFail();
  return r.data;
}
