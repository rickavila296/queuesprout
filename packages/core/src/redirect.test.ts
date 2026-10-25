import { describe, expect, it } from 'vitest';
import { safeNextPath } from './redirect';

describe('safeNextPath', () => {
  it.each([
    ['/w/acme', '/w/acme'],
    ['/invite/abc?x=1', '/invite/abc?x=1'],
    [undefined, '/app'],
    ['', '/app'],
    ['https://evil.example', '/app'],
    ['//evil.example', '/app'],
    ['/\\evil.example', '/app'],
    ['javascript:alert(1)', '/app'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
