import { describe, expect, it } from 'vitest';
import { isPublicHttpsUrl } from './net';

describe('isPublicHttpsUrl()', () => {
  it.each([
    ['https://bsky.social', true],
    ['https://pds.example.com:8443/xrpc/x', true],
    ['https://8.8.8.8', true],
    ['http://bsky.social', false],
    ['https://user:pw@bsky.social', false],
    ['https://localhost', false],
    ['https://pds.localhost', false],
    ['https://printer.local', false],
    ['https://metadata.google.internal', false],
    ['https://intranet', false],
    ['https://127.0.0.1', false],
    ['https://10.1.2.3', false],
    ['https://172.20.0.1', false],
    ['https://192.168.1.10', false],
    ['https://169.254.169.254', false],
    ['https://100.100.1.1', false],
    ['https://[::1]', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isPublicHttpsUrl(url)).toBe(expected);
  });
});
