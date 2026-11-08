import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
let result: { connected: string; receipts: string[] } | undefined;
function probe() {
  if (!result) {
    const child = spawnSync(process.execPath, ['tests/fixtures/phase2/portal-render.mjs'], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 65536,
    });
    expect(child.status, child.stderr).toBe(0);
    result = JSON.parse(child.stdout);
  }
  return result!;
}
it('lets an authenticated invitee supply the intended business before loading any membership-gated status', () => {
  const html = probe().connected;
  expect(html).toContain('Accept an invitation');
  expect(html).toContain('Invitation business reference');
  expect(html).toContain('One-time invitation');
  expect(html).not.toContain('Business status');
});
it('shows scalar location references and membership revisions including zero rather than an empty receipt', () => {
  for (const [index, value] of ['11111111-1111-4111-8111-111111111111', 0, false].entries()) {
    const html = probe().receipts[index]!;
    expect(html).toContain('<dt>Result</dt>');
    expect(html).toContain('<dd>' + String(value) + '</dd>');
  }
});
