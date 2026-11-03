import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import tokens from '../../docs/design-tokens.json';
const css = readFileSync('apps/web/app/globals.css', 'utf8');
function light(hex: string) {
  const c = hex
    .slice(1)
    .match(/../g)!
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const x = light(a),
    y = light(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
it.each(['ink', 'mutedText', 'primary', 'success', 'warning', 'danger'] as const)(
  'keeps %s text at WCAG AA contrast on its approved light surface',
  (name) => {
    expect(contrast(tokens.colors[name], tokens.colors.surface)).toBeGreaterThanOrEqual(4.5);
  },
);
it('keeps dark-surface focus, control outlines, minimum sizes, breakpoints and reduced motion in the shared stylesheet', () => {
  expect(contrast(tokens.colors.accent, tokens.colors.ink)).toBeGreaterThanOrEqual(3);
  expect(contrast(tokens.colors.controlBorder, tokens.colors.surface)).toBeGreaterThanOrEqual(3);
  for (const color of Object.values(tokens.colors))
    expect(css.toLowerCase()).toContain(color.toLowerCase());
  expect(css).toMatch(/prefers-reduced-motion\s*:\s*reduce/);
  expect(css).toMatch(/min-width\s*:\s*640px/);
  expect(css).toMatch(/min-width\s*:\s*1024px/);
  expect(css).not.toMatch(/font-size\s*:\s*(?:[0-9]|1[0-3])px/);
  expect(css).not.toMatch(/@import|url\(https?:/);
});
