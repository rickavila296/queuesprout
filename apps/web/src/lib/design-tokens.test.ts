import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The contrast floor in DESIGN.md: text 4.5:1, control edges and marks 3:1, in both themes.
const css = readFileSync(
  fileURLToPath(new URL('../../../../packages/ui/src/tokens.css', import.meta.url)),
  'utf8',
);

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  );
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT: [string, string][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-raised'],
  ['text-muted', 'bg'],
  ['text-muted', 'surface'],
  ['text-muted', 'surface-raised'],
  ['primary-fg', 'primary'],
  ['link', 'bg'],
  ['success', 'bg'],
  ['success', 'success-tint'],
  ['info', 'bg'],
  ['attention-text', 'bg'],
  ['attention-text', 'surface'],
  ['danger', 'bg'],
  ['danger-fg', 'danger'],
  ['shell-text', 'shell'],
  ['shell-text', 'shell-hover'],
  ['shell-strong', 'shell'],
  ['accent', 'shell'],
  ['accent', 'shell-hover'],
  ['on-accent', 'accent'],
];

const MARKS: [string, string][] = [
  ['border-control', 'bg'],
  ['border-control', 'surface-raised'],
  ['attention', 'bg'],
  ['focus', 'bg'],
];

describe.each([
  ['light', ":root,\n[data-theme='light']"],
  ['dark', "[data-theme='dark']"],
])('%s tokens', (_theme, selector) => {
  const t = tokens(selector);

  it.each(TEXT)('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(contrast(t[fg] ?? '', t[bg] ?? '')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MARKS)('%s on %s reaches 3:1', (fg, bg) => {
    expect(contrast(t[fg] ?? '', t[bg] ?? '')).toBeGreaterThanOrEqual(3);
  });
});
