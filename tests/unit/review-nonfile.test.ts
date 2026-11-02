import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
function cleanup(root: string, parent: string) {
  if (dirname(root) !== parent || realpathSync(root) !== root || lstatSync(root).isSymbolicLink())
    throw Error('Owned non-file directory changed');
  rmSync(root, { recursive: true });
}
it('refuses an actual native non-file before open without a blocked reader', () => {
  const parent = realpathSync(tmpdir()),
    root = mkdtempSync(join(parent, 'tt-review-nonfile-'));
  try {
    const target = join(root, 'input.json');
    if (process.platform === 'win32') mkdirSync(target);
    else {
      const created = spawnSync('mkfifo', [target], { encoding: 'utf8', timeout: 1000 });
      expect(created.error).toBeUndefined();
      expect(created.status, created.stderr).toBe(0);
    }
    const result = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=128',
        fileURLToPath(new URL('../fixtures/review-files/nonfile.mjs', import.meta.url)),
        root,
      ],
      {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 16384,
        env: { ...process.env, TMPDIR: parent, TEMP: parent },
      },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.signal).toBeNull();
    const receipt = JSON.parse(result.stdout.trim().replace(/^REVIEW_NONFILE_EVIDENCE /, ''));
    expect(receipt).toMatchObject({
      nativeControl: process.platform === 'win32' ? 'directory' : 'fifo',
      refusedBeforeRead: true,
      providerDispatches: 0,
      casesClosed: 0,
      gatesClosed: 0,
    });
    console.log('REVIEW_NONFILE_EVIDENCE ' + JSON.stringify(receipt));
  } finally {
    cleanup(root, parent);
  }
}, 10000);
