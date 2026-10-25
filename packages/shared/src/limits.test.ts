import { describe, expect, it } from 'vitest';
import { PROVIDER_IDS } from './providers';
import { PLATFORM_LIMITS, countChars } from './limits';

describe('countChars', () => {
  it.each([
    ['hello', 'graphemes', 5],
    ['hello', 'code_points', 5],
    // Family emoji: 1 grapheme, 7 code points (4 people + 3 joiners).
    ['👨‍👩‍👧‍👦', 'graphemes', 1],
    ['👨‍👩‍👧‍👦', 'code_points', 7],
    // é as e + combining accent.
    ['é', 'graphemes', 1],
    ['é', 'code_points', 2],
    ['', 'graphemes', 0],
  ] as const)('counts %j as %s = %d', (text, mode, expected) => {
    expect(countChars(text, mode)).toBe(expected);
  });
});

describe('PLATFORM_LIMITS', () => {
  it('has limits for every provider', () => {
    expect(Object.keys(PLATFORM_LIMITS).sort()).toEqual([...PROVIDER_IDS].sort());
  });
});
