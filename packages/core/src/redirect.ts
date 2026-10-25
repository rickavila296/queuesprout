/** Only same-site relative paths, so a ?next= parameter cannot become an open redirect. */
export function safeNextPath(next: string | undefined | null, fallback = '/app'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return fallback;
  }
  return next;
}
