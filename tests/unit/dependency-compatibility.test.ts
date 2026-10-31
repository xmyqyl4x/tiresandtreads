import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, realpathSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function removeOwnedDirectory(directory: string, parent: string) {
  // Verify the absolute owned target before recursive removal on Windows or Linux.
  if (
    dirname(directory) !== parent ||
    lstatSync(directory).isSymbolicLink() ||
    realpathSync(directory) !== directory
  )
    throw Error('Owned dependency fixture path changed');
  rmSync(directory, { recursive: true });
}

for (const mode of [
  'resolution',
  'matching',
  'amplification',
  'glob-compatibility',
  'glob-abort',
  'rimraf-compatibility',
  'merge-null',
  'merge-null-prototype',
  'merge-target',
  'merge-compatibility',
  'merge-getter',
])
  it(`validates actual dependency consumers: ${mode}`, () => {
    const parent = realpathSync(tmpdir());
    const directory = mkdtempSync(join(parent, 'tt-dependency-'));
    try {
      const result = spawnSync(
        process.execPath,
        [
          '--max-old-space-size=128',
          fileURLToPath(new URL('../fixtures/dependency-compatibility/probe.mjs', import.meta.url)),
          mode,
          directory,
        ],
        {
          encoding: 'utf8',
          timeout: 5000,
          maxBuffer: 65536,
          env: { ...process.env, TMPDIR: parent, TEMP: parent },
        },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.signal).toBeNull();
      const receipt = JSON.parse(
        result.stdout.trim().replace(/^DEPENDENCY_COMPATIBILITY_EVIDENCE /, ''),
      );
      expect(receipt).toMatchObject({
        mode,
        passed: true,
        externalCalls: 0,
        productActivation: false,
      });
      console.log('DEPENDENCY_COMPATIBILITY_EVIDENCE ' + JSON.stringify(receipt));
    } finally {
      removeOwnedDirectory(directory, parent);
    }
  });
