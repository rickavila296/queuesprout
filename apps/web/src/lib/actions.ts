import 'server-only';
import { fail, type ActionResult } from '@queuesprout/shared';
import type { z } from 'zod';

export type FormState<T = undefined> =
  (ActionResult<T> & { fieldErrors?: Record<string, string> }) | null;

/** First message per field, for showing next to inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    out[key] ??= issue.message;
  }
  return out;
}

export function invalid(error: z.ZodError): FormState<never> {
  return { ...fail('Check the highlighted fields.'), fieldErrors: fieldErrors(error) };
}

/** Logs the real error server-side and returns a generic one to the client. */
export function unexpected(scope: string, error: unknown): FormState<never> {
  console.error(`[${scope}]`, error);
  return fail('Something went wrong. Try again.');
}
