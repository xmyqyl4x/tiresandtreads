import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  reconcileProductPins,
  photoDependencyPins,
  apiContractPins,
} from '../../scripts/review/product-source-pins.mjs';
const manifest = JSON.parse(
  readFileSync('docs/implementation/evidence/P1/p1-pr-037-current-source-exceptions.json', 'utf8'),
) as { exceptions: { path: string; baselineSha256: string; currentSha256: string }[] };
const editorial = JSON.parse(
  readFileSync('docs/implementation/evidence/P1/p1-pr-038-current-source-exceptions.json', 'utf8'),
) as typeof manifest;
const staff = JSON.parse(
  readFileSync('docs/implementation/evidence/P1/p1-pr-039-current-source-exceptions.json', 'utf8'),
) as typeof manifest;
it('retains every unrelated pin and explicitly replaces only reviewed current dependency/tool inputs', () => {
  const before = manifest.exceptions.map((x) => ({ path: x.path, sha256: x.baselineSha256 }));
  const extra = { path: 'tests/fixtures/restore-handoff/observe.ts', sha256: 'a'.repeat(64) };
  const result = reconcileProductPins(process.cwd(), [...before, extra]);
  expect(result.exceptions).toBe(3);
  expect(result.pins).toContainEqual(extra);
  for (const e of manifest.exceptions)
    expect(result.pins).toContainEqual({
      path: e.path,
      sha256:
        apiContractPins.find((x) => x.path === e.path)?.currentSha256 ??
        photoDependencyPins.find((x) => x.path === e.path)?.currentSha256 ??
        staff.exceptions.find((x) => x.path === e.path)?.currentSha256 ??
        editorial.exceptions.find((x) => x.path === e.path)?.currentSha256 ??
        e.currentSha256,
    });
  expect(before[0]!.sha256).toBe(manifest.exceptions[0]!.baselineSha256);
});
it('refuses a changed baseline instead of laundering arbitrary current bytes into history', () => {
  expect(() =>
    reconcileProductPins(process.cwd(), [{ path: 'pnpm-lock.yaml', sha256: 'f'.repeat(64) }]),
  ).toThrow('Product source baseline refused');
});
it('keeps earlier catalog subsets bounded and leaves original manifest bytes untouched', () => {
  const bytes = readFileSync(
    'docs/implementation/evidence/P1/p1-pr-037-current-source-exceptions.json',
  );
  const result = reconcileProductPins(
    process.cwd(),
    manifest.exceptions.slice(0, 2).map((x) => ({ path: x.path, sha256: x.baselineSha256 })),
  );
  expect(result.exceptions).toBe(2);
  expect(
    readFileSync('docs/implementation/evidence/P1/p1-pr-037-current-source-exceptions.json'),
  ).toEqual(bytes);
});
