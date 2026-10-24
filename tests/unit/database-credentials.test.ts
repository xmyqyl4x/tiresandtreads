import { expect, it } from 'vitest';
import { addRoleCredentials } from '../../scripts/database/credentials.mjs';
it('adds only new role credentials without rotating existing database or CMS secrets', () => {
  const old = 'EXISTING=' + 'a'.repeat(64) + '\n';
  const value = addRoleCredentials(old, ['EXISTING', 'NEW'], ['NEW'], () => 'b'.repeat(64));
  expect(value).toBe(old + 'NEW=' + 'b'.repeat(64) + '\n');
  expect(
    addRoleCredentials(value, ['EXISTING', 'NEW'], ['NEW'], () => {
      throw new Error('rotation');
    }),
  ).toBe(value);
});
it('refuses missing legacy keys, unexpected keys, duplicate keys and malformed credentials', () => {
  for (const text of [
    '',
    'EXTRA=' + 'a'.repeat(64),
    'EXISTING=bad',
    ('EXISTING=' + 'a'.repeat(64) + '\n').repeat(2),
  ])
    expect(() =>
      addRoleCredentials(text, ['EXISTING', 'NEW'], ['NEW'], () => 'b'.repeat(64)),
    ).toThrow();
});
