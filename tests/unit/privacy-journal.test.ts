import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { expect, it } from 'vitest';
import { createPrivacyCrypto } from '../../packages/integrations/src/privacy-crypto.ts';
import { createFilePrivacyJournal } from '../../packages/integrations/src/privacy-journal.ts';
it('persists idempotent signed records independently and rejects corrupt/conflicting snapshots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-privacy-journal-'));
  expect(dirname(resolve(dir))).toBe(resolve(tmpdir()));
  expect(dir.includes('tt-privacy-journal-')).toBe(true);
  try {
    const c = createPrivacyCrypto('v1', { v1: new Uint8Array(32).fill(27) }),
      j = createFilePrivacyJournal(dir, c);
    const key = 'a'.repeat(64),
      entry = {
        version: 1,
        action: 'delete',
        resourceKind: 'subject',
        markers: c.markers('subject', 'synthetic-opaque-id'),
        tombstones: [],
        policy: 'fixture',
      };
    const signed = c.sign(entry);
    await j.append(key, signed);
    await j.append(key, signed);
    expect(await readdir(dir)).toHaveLength(1);
    expect(c.verify(await j.capture('2026-10-26T12:00:00.000Z'))).toEqual({
      version: 1,
      capturedAt: '2026-10-26T12:00:00.000Z',
      entries: [entry],
    });
    await expect(j.append(key, c.sign({ ...entry, policy: 'changed' }))).rejects.toThrow(
      /Conflicting/,
    );
    await expect(j.append('../outside', signed)).rejects.toThrow(/Invalid/);
    const path = join(dir, key + '.json');
    const text = await readFile(path, 'utf8');
    expect(text).not.toContain('synthetic-opaque-id');
    await writeFile(path, text.replace('"delete"', '"export"'), 'utf8');
    await expect(j.capture('2026-10-26T12:00:00.000Z')).rejects.toThrow(/signature/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
