import { describe, expect, it } from 'vitest';
import { REDACTED, redact } from './redact';

describe('redact', () => {
  it('removes secrets by key, at any depth, and keeps everything else', () => {
    const input = {
      did: 'did:plc:abc',
      accessJwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig',
      refreshToken: 'r-123',
      nested: [{ client_secret: 's', name: 'ok' }],
      headers: { Authorization: 'Bearer abc.def', 'content-type': 'application/json' },
      count: 3,
    };
    expect(redact(input)).toEqual({
      did: 'did:plc:abc',
      accessJwt: REDACTED,
      refreshToken: REDACTED,
      nested: [{ client_secret: REDACTED, name: 'ok' }],
      headers: { Authorization: REDACTED, 'content-type': 'application/json' },
      count: 3,
    });
  });

  it('scrubs bearer tokens and JWTs inside free text', () => {
    expect(redact({ message: 'sent Bearer abc123 and eyJa.eyJb.c' })).toEqual({
      message: `sent Bearer ${REDACTED} and ${REDACTED}`,
    });
  });
});
