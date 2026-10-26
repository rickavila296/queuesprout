/**
 * Adapters call servers whose address comes from users or from the platform (a Bluesky
 * PDS, a Mastodon instance). Only public https hosts are allowed, so a crafted address
 * cannot point the worker or the web app at localhost or the private network. Names
 * that resolve to private addresses are not caught here; the egress network must block them.
 */
export function isPublicHttpsUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[')) return false;
  if (/(^|\.)(localhost|local|internal|lan|home\.arpa)$/.test(host)) return false;
  const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return false;
    }
  }
  return true;
}
