import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, realpathSync, lstatSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readBounded, readCurrentFile } from '../fixtures/restore-handoff/files.ts';
import { sample } from '../fixtures/restore-handoff/samples.ts';
function cleanup(dir: string, parent: string) {
  if (dirname(dir) !== parent || realpathSync(dir) !== dir || lstatSync(dir).isSymbolicLink())
    throw Error('Owned test directory changed');
  rmSync(dir, { recursive: true });
}
function owned(test: (dir: string) => void) {
  const parent = realpathSync(tmpdir()),
    dir = mkdtempSync(join(parent, 'tt-handoff-'));
  try {
    test(dir);
  } finally {
    cleanup(dir, parent);
  }
}
it('reads actual current-checkpoint bytes and refuses an actual subsequent file change', () =>
  owned((dir) => {
    const s = sample(),
      file = join(dir, 'current.json');
    writeFileSync(file, JSON.stringify(s.current));
    expect(readCurrentFile(file, s.seal, s.now)).toEqual(s.current);
    writeFileSync(file, JSON.stringify({ ...s.current, digest: 'f'.repeat(64) }));
    expect(() => readCurrentFile(file, s.seal, s.now)).toThrow('Restore handoff refused');
  }));
it('rejects missing, oversized, non-UTF8 and non-file input without following a real link', () =>
  owned((dir) => {
    const file = join(dir, 'data.json');
    expect(() => readBounded(file, 16384, 'checkpoint')).toThrow();
    expect(() => readBounded(dir, 16384, 'checkpoint')).toThrow();
    writeFileSync(file, Buffer.alloc(16385, 32));
    expect(() => readBounded(file, 16384, 'checkpoint')).toThrow();
    writeFileSync(file, Buffer.from([255]));
    expect(() => readBounded(file, 16384, 'checkpoint')).toThrow();
    writeFileSync(file, '{}');
    symlinkSync(dir, join(dir, 'alias'), 'junction');
    expect(() => readBounded(join(dir, 'alias', 'data.json'), 16384, 'checkpoint')).toThrow();
  }));
it('refuses unknown and excessive read budgets without returning a matching prefix', () =>
  owned((dir) => {
    const file = join(dir, 'data.json');
    writeFileSync(file, '{}');
    for (const limit of [0, -1, 65537, 1.5])
      expect(() => readBounded(file, limit, 'checkpoint')).toThrow();
    expect(() => readBounded(file, 1, 'checkpoint')).toThrow();
    expect(readBounded(file, 2, 'checkpoint')).toBe('{}');
  }));
