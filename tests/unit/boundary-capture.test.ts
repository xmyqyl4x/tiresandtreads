import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
it('captures graphs over 1 MiB while still rejecting an actual boundary violation', () => {
  const root = realpathSync(tmpdir()),
    directory = mkdtempSync(join(root, 'tt-boundary-')),
    cli = join(directory, 'pnpm-fixture.mjs');
  function cleanup() {
    if (realpathSync(directory) !== directory || !directory.startsWith(root + sep + 'tt-boundary-'))
      throw Error('Owned fixture directory mismatch');
    rmSync(directory, { recursive: true, force: true });
  }
  try {
    for (const violation of [false, true]) {
      const graph = {
        modules: [],
        summary: {
          violations: violation
            ? [
                {
                  rule: { name: 'pure-domain' },
                  from: 'packages/domain/a.ts',
                  to: 'packages/db/b.ts',
                },
              ]
            : [],
        },
        syntheticPadding: 'x'.repeat(1100000),
      };
      writeFileSync(
        cli,
        'process.stdout.write(' + JSON.stringify(JSON.stringify(graph)) + ');',
        'utf8',
      );
      const r = spawnSync(process.execPath, ['scripts/verify/boundaries.mjs'], {
        encoding: 'utf8',
        env: { ...process.env, npm_execpath: cli },
        timeout: 10000,
      });
      expect(r.error).toBeUndefined();
      expect(r.status).toBe(violation ? 1 : 0);
      if (violation)
        expect(r.stderr).toContain('pure-domain: packages/domain/a.ts -> packages/db/b.ts');
      else
        expect(r.stdout).toContain('Layer, cycle and transitive client/server boundaries passed');
    }
  } finally {
    cleanup();
  }
});
