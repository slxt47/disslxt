/**
 * Length of a string in Unicode code points ("characters"), e.g. one emoji counts as 1.
 * This is the single length definition for user text: the zod schemas (server), the frontend
 * counters and PostgreSQL's `char_length` all count code points.
 */
export function textLength(s: string): number {
  return [...s].length;
}

/** C0 control characters except tab, line feed and carriage return, plus DEL. */
// eslint-disable-next-line no-control-regex
export const MESSAGE_DISALLOWED_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Any control character (C0, DEL, C1); names are single-line. */
// eslint-disable-next-line no-control-regex
export const NAME_DISALLOWED_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
