import { describe, expect, it } from 'vitest';
import { originalKey, variantKey, workspacePrefix } from './keys';

describe('object keys', () => {
  it('nests every key under the workspace prefix', () => {
    const key = originalKey('ws1', 'm1', '.PNG');
    expect(key).toBe('ws/ws1/m1/original.png');
    expect(key.startsWith(workspacePrefix('ws1'))).toBe(true);
    expect(variantKey('ws1', 'm1', 'instagram', 'jpg')).toBe('ws/ws1/m1/instagram.jpg');
  });

  it('rejects extensions that could escape the key layout', () => {
    expect(() => originalKey('ws1', 'm1', '../../x')).toThrow();
    expect(() => originalKey('ws1', 'm1', '')).toThrow();
  });
});
