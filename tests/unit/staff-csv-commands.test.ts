import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect, vi } from 'vitest';
import { runStaffCsvCommand } from '../../packages/integrations/src/staff-csv-commands.ts';
import type { createStaffCsvServices } from '../../packages/application/src/imports/staff-csv.ts';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tt-csv-command-'));
  const dir = join(root, 'managed');
  await mkdir(dir);
  const call = vi.fn().mockResolvedValue({ ok: true, value: 'synthetic' }),
    service = new Proxy({}, { get: () => call }) as ReturnType<typeof createStaffCsvServices>;
  await writeFile(
    join(dir, 'plan.json'),
    JSON.stringify({ actorId: 'synthetic', input: { command: 'fixed' } }),
  );
  return { root, dir, call, service, cleanup: () => rm(root, { recursive: true, force: true }) };
}
it('passes bounded local bytes and the exact plan to the shared upload service', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dir, 'source.csv'), 'a,b\n1,2');
    expect(
      await runStaffCsvCommand(
        ['upload', '--plan', 'plan.json', '--file', 'source.csv'],
        f.service,
        f.dir,
      ),
    ).toEqual({ ok: true, value: 'synthetic' });
    expect(f.call.mock.calls[0]?.slice(0, 2)).toEqual(['synthetic', { command: 'fixed' }]);
    expect(new TextDecoder().decode(f.call.mock.calls[0]?.[2])).toBe('a,b\n1,2');
  } finally {
    await f.cleanup();
  }
});
it.each([
  ['shell', '--plan', 'plan.json'],
  ['schema', '--plan', 'plan.json', '--url', 'https://example.invalid'],
  ['upload', '--plan', 'plan.json', '--plan', 'plan.json'],
  ['schema', '--plan', '../outside.json'],
  ['schema', '--plan', 'folder'],
  ['schema', '--plan', 'large.json'],
  ['schema', '--plan', 'bad.json'],
  ['schema', '--plan', 'extra.json'],
])(
  'refuses unsupported command, paths, nonfiles or malformed plans before service dispatch %#',
  async (...args) => {
    const f = await fixture();
    try {
      await writeFile(join(f.root, 'outside.json'), '{}');
      await mkdir(join(f.dir, 'folder'));
      await writeFile(join(f.dir, 'large.json'), 'x'.repeat(16385));
      await writeFile(join(f.dir, 'bad.json'), new Uint8Array([255]));
      await writeFile(
        join(f.dir, 'extra.json'),
        JSON.stringify({ actorId: 'a', input: {}, sql: 'SELECT 1' }),
      );
      await expect(runStaffCsvCommand(args, f.service, f.dir)).rejects.toThrow();
      expect(f.call).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  },
);
it('refuses a symlink to a file outside the managed root before dispatch', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'outside.json'), '{}');
    await symlink(join(f.root, 'outside.json'), join(f.dir, 'linked.json'));
    await expect(
      runStaffCsvCommand(['schema', '--plan', 'linked.json'], f.service, f.dir),
    ).rejects.toThrow();
    expect(f.call).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
