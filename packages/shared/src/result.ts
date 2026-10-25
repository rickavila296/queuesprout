/**
 * The shape every Server Action returns. Actions never throw to the client;
 * expected failures are values, unexpected ones are logged and mapped to a generic error.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = (error: string): ActionResult<never> => ({ ok: false, error });
