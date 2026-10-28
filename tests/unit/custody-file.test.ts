import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  bytes: Buffer.from('{"syntheticKey":unquoted-generated-key-material}'),
  offset: 0,
  missing: false,
}));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  openSync: vi.fn(() => {
    if (fixture.missing) throw Error('Synthetic private filesystem context');
    return 42;
  }),
  fstatSync: vi.fn(() => ({ isFile: () => true, size: fixture.bytes.length, mode: 0o600 })),
  readSync: vi.fn((_fd: number, target: Buffer, offset: number) => {
    const count = fixture.bytes.copy(target, offset, fixture.offset);
    fixture.offset += count;
    return count;
  }),
  closeSync: vi.fn(),
}));
import { closeSync } from 'node:fs';
import { privateRead } from '../fixtures/recovery/custody-common.ts';
beforeEach(() => {
  fixture.offset = 0;
  fixture.missing = false;
  vi.clearAllMocks();
});
it('masks malformed custody key JSON and still closes its file descriptor', () => {
  expect(() => privateRead('/custody-keys/versions.json', 8192)).toThrow(
    /^Local custody file refused$/,
  );
  expect(closeSync).toHaveBeenCalledExactlyOnceWith(42);
});
it('masks filesystem errors without closing an unowned descriptor', () => {
  fixture.missing = true;
  expect(() => privateRead('/custody-keys/versions.json', 8192)).toThrow(
    /^Local custody file refused$/,
  );
  expect(closeSync).not.toHaveBeenCalled();
});
