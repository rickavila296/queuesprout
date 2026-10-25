import { describe, expect, it } from 'vitest';
import { workspaceSlugSchema } from '@queuesprout/shared';
import { slugify } from './slug';

describe('slugify', () => {
  it.each([
    ['Acme Coffee', 'acme-coffee'],
    ['  Café Déjà Vu!  ', 'cafe-deja-vu'],
    ['___', 'workspace'],
    ['Settings', 'settings-team'],
    ['a'.repeat(60), 'a'.repeat(48)],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('always produces a valid slug', () => {
    for (const name of ['Hello World', 'x--y', '9 Lives', 'émoji 🌱 shop', '-lead-']) {
      expect(workspaceSlugSchema.safeParse(slugify(name)).success).toBe(true);
    }
  });
});
