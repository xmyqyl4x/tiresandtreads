import assert from 'node:assert/strict';

const base = new URL(process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3200');
if (!['127.0.0.1', 'localhost', 'app'].includes(base.hostname) || base.protocol !== 'http:')
  throw new Error('HTTP smoke is restricted to the local harness');
for (const route of ['/health/live', '/health/ready']) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', scope: 'bootstrap' });
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/);
}
assert.equal((await fetch(new URL('/', base), { signal: AbortSignal.timeout(5000) })).status, 404);
assert.equal(
  (
    await fetch(new URL('/health/live', base), {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    })
  ).status,
  405,
);
console.log(
  'HTTP smoke passed: health contracts, no-store/noindex, root 404, unsupported method 405',
);
