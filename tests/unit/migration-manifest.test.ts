import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { pendingMigrations, validateSources } from '../../scripts/database/manifest.ts';

const first = { id: '0001_foundation', source: 'select 1;\n', sha256: '' };
first.sha256 = createHash('sha256').update(first.source).digest('hex');
const second = { ...first, id: '0002_identity_assets' };

it('accepts reviewed sources and returns only the unapplied suffix', () => {
  expect(() => validateSources([first, second])).not.toThrow();
  expect(pendingMigrations([first, second], [first])).toEqual([second]);
  expect(pendingMigrations([first, second], [first, second])).toEqual([]);
});

it.each(
  [
    [{ ...first, source: 'changed SQL' }],
    [first, first],
    [second, first],
    [{ ...first, id: '../redirect' }],
    [{ ...first, sha256: 'invalid' }],
  ].map((sources) => ({ sources })),
)('refuses modified, duplicate, unordered or unsafe migration sources', ({ sources }) => {
  expect(() => validateSources(sources)).toThrow();
});

it.each(
  [[second], [{ ...first, sha256: '0'.repeat(64) }], [first, second, second]].map((history) => ({
    history,
  })),
)('refuses unknown, edited or non-prefix database history', ({ history }) => {
  expect(() => pendingMigrations([first, second], history)).toThrow();
});
