import { it, expect } from 'vitest';
import { publicToolRoutes } from '../../packages/integrations/src/http/public-tools.ts';
import { createHttpApi } from '../../packages/integrations/src/http/core.ts';
const origin = 'http://127.0.0.1:8380';
it('uses the exact shared input envelope for scorecards and refuses the old fixture-only shape', async () => {
  const handler = createHttpApi({
    origin,
    routes: publicToolRoutes(),
    security: { authenticate: async () => null, quota: async () => ({ allowed: true }) },
  });
  const answers = Array.from({ length: 14 }, (_, i) => ({
    key: i + 1,
    answer: i === 0 ? 'concern' : 'unknown',
  }));
  const post = (body: unknown) =>
    handler(
      new Request(origin + '/api/v1/tools/scorecard', {
        method: 'POST',
        headers: { host: '127.0.0.1:8380', origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  const valid = await post({ input: answers });
  expect(valid.status).toBe(200);
  expect(await valid.json()).toMatchObject({
    data: { good: 0, concerns: 1, unknown: 13, safetyVerified: false },
  });
  expect((await post({ answers })).status).toBe(400);
  expect((await post({ input: answers.slice(1) })).status).toBe(400);
});
