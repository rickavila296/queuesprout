/** Crockford base32 ULID: 48-bit time + 80 random bits, sortable by creation time. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now: number = Date.now(), random: () => number = Math.random): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  for (let i = 0; i < 16; i++) rand += ALPHABET.charAt(Math.floor(random() * 32));
  return time + rand;
}
