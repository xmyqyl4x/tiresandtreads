import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
  lstatSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { verifyReviewFiles } from '../../scripts/review/evidence-files.mjs';
import { readReviewBytes, readReviewFile } from '../../scripts/review/repository-files.mjs';
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function cleanup(root: string, parent: string) {
  if (dirname(root) !== parent || realpathSync(root) !== root || lstatSync(root).isSymbolicLink())
    throw Error('Owned evidence directory changed');
  rmSync(root, { recursive: true });
}
function owned(test: (root: string) => void) {
  const parent = realpathSync(tmpdir()),
    root = mkdtempSync(join(parent, 'tt-evidence-'));
  try {
    test(root);
  } finally {
    cleanup(root, parent);
  }
}
it('checks actual bytes once when an evidence reference overlaps a pinned file', () =>
  owned((root) => {
    writeFileSync(join(root, 'data.json'), '{}');
    expect(
      verifyReviewFiles(root, [{ path: 'data.json', sha256: hash('{}') }], ['data.json']),
    ).toEqual({ filesChecked: 1, bytesRead: 2, matchedPins: 1, issues: [] });
  }));
it('detects actual content drift without emitting content or an unrelated submitted value', () =>
  owned((root) => {
    writeFileSync(join(root, 'data.json'), '{"token":"SYNTHETIC_SECRET"}');
    const result = verifyReviewFiles(root, [{ path: 'data.json', sha256: hash('{}') }], []);
    expect(result.issues).toEqual([{ path: 'data.json', code: 'digest-mismatch' }]);
    expect(result.matchedPins).toBe(0);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');
  }));
it('hashes a UTF-8 BOM as real bytes while retaining the existing text-reader behavior', () =>
  owned((root) => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello')]);
    writeFileSync(join(root, 'data@v1.txt'), bytes);
    expect(readReviewBytes(root, 'data@v1.txt')).toEqual(bytes);
    expect(readReviewFile(root, 'data@v1.txt')).toBe('hello');
    const changed = verifyReviewFiles(root, [{ path: 'data@v1.txt', sha256: hash('hello') }], []);
    expect(changed.issues).toHaveLength(1);
    expect(
      verifyReviewFiles(root, [{ path: 'data@v1.txt', sha256: hash(bytes) }], []).issues,
    ).toEqual([]);
  }));
it('reports missing files and actual junction aliases as unreadable without following them', () =>
  owned((root) => {
    mkdirSync(join(root, 'actual'));
    writeFileSync(join(root, 'actual', 'data.txt'), 'hello');
    symlinkSync(join(root, 'actual'), join(root, 'alias'), 'junction');
    expect(verifyReviewFiles(root, [], ['alias/data.txt', 'missing.txt']).issues).toEqual([
      { path: 'alias/data.txt', code: 'unreadable' },
      { path: 'missing.txt', code: 'unreadable' },
    ]);
  }));
it('refuses duplicate references, traversal and an oversized unique-file inventory', () =>
  owned((root) => {
    for (const references of [
      ['data.txt', 'data.txt'],
      ['../outside'],
      Array.from({ length: 513 }, (_, i) => i + '.txt'),
    ])
      expect(() => verifyReviewFiles(root, [], references)).toThrow(
        'Evidence review input refused',
      );
  }));
it('refuses oversized file contents without truncating them into a matching prefix', () =>
  owned((root) => {
    const bytes = Buffer.alloc(2_000_001, 1);
    writeFileSync(join(root, 'data.txt'), bytes);
    const result = verifyReviewFiles(
      root,
      [{ path: 'data.txt', sha256: hash(bytes.subarray(0, 2_000_000)) }],
      [],
    );
    expect(result).toMatchObject({
      matchedPins: 0,
      bytesRead: 0,
      issues: [{ path: 'data.txt', code: 'unreadable' }],
    });
  }));
it('bounds aggregate bytes and reports an unreadable remainder rather than claiming parity', () =>
  owned((root) => {
    const bytes = Buffer.alloc(1_900_000, 1),
      sha256 = hash(bytes);
    const pins = Array.from({ length: 9 }, (_, index) => ({ path: index + '.txt', sha256 }));
    for (const pin of pins) writeFileSync(join(root, pin.path), bytes);
    const result = verifyReviewFiles(root, pins, []);
    expect(result.bytesRead).toBeLessThanOrEqual(16_777_216);
    expect(result.matchedPins).toBe(8);
    expect(result.issues).toEqual([{ path: '8.txt', code: 'unreadable' }]);
  }));
