import { it, expect } from 'vitest';
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
import { readReviewFile, readReviewJson } from '../../scripts/review/repository-files.mjs';

function cleanup(root: string, parent: string) {
  if (dirname(root) !== parent || realpathSync(root) !== root || lstatSync(root).isSymbolicLink())
    throw Error('Owned review directory changed');
  rmSync(root, { recursive: true });
}
function owned(test: (root: string) => void) {
  const parent = realpathSync(tmpdir()),
    root = mkdtempSync(join(parent, 'tt-review-'));
  try {
    test(root);
  } finally {
    cleanup(root, parent);
  }
}
it('reads exact-case bounded UTF-8 JSON from a local repository tree', () =>
  owned((root) => {
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'Input.json'), '{"value":"é"}\n');
    expect(readReviewJson(root, 'docs/Input.json')).toEqual({ value: 'é' });
    expect(readReviewFile(root, 'docs/Input.json', 15)).toBe('{"value":"é"}\n');
    expect(() => readReviewFile(root, 'docs/input.json')).toThrow();
  }));
it('refuses traversal, absolute paths, URL syntax and alternate separators', () =>
  owned((root) => {
    for (const path of [
      '../private.json',
      '/private.json',
      'C:/private.json',
      'docs\\private.json',
      'https://private.json',
      'docs//file.json',
      './file.json',
      'docs/../file.json',
    ])
      expect(() => readReviewFile(root, path)).toThrow('Repository review input refused');
  }));
it('refuses directory aliases and junctions without following them', () =>
  owned((root) => {
    mkdirSync(join(root, 'actual'));
    writeFileSync(join(root, 'actual', 'input.json'), '{}');
    symlinkSync(join(root, 'actual'), join(root, 'alias'), 'junction');
    expect(() => readReviewFile(root, 'alias/input.json')).toThrow(
      'Repository review input refused',
    );
    expect(readReviewJson(root, 'actual/input.json')).toEqual({});
  }));
it('does not truncate oversized bytes or accept invalid UTF-8 or malformed JSON', () =>
  owned((root) => {
    writeFileSync(join(root, 'input.json'), '{"value":"é"}');
    expect(() => readReviewFile(root, 'input.json', 13)).toThrow('Repository review input refused');
    writeFileSync(join(root, 'input.json'), Buffer.from([0xff, 0xfe]));
    expect(() => readReviewFile(root, 'input.json')).toThrow();
    writeFileSync(join(root, 'input.json'), '{bad');
    expect(() => readReviewJson(root, 'input.json')).toThrow();
    writeFileSync(join(root, 'input.json'), '{}');
    expect(readReviewJson(root, 'input.json')).toEqual({});
  }));
it('rejects non-file inputs and invalid byte budgets', () =>
  owned((root) => {
    mkdirSync(join(root, 'docs'));
    expect(() => readReviewFile(root, 'docs')).toThrow('Repository review input refused');
    for (const limit of [0, -1, NaN, 1.5, 2_000_001])
      expect(() => readReviewFile(root, 'docs', limit)).toThrow('Repository review input refused');
  }));
