import { it, expect, vi } from 'vitest';
import { assessmentController } from '../../apps/web/src/assessment/controller.ts';
it('uses the already connected owner session and original key when a report submission outcome is uncertain', async () => {
  const report = '11111111-1111-4111-8111-111111111111',
    requestId = '22222222-2222-4222-8222-222222222222';
  const send = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(Error('connection lost'))
    .mockResolvedValueOnce(
      Response.json({
        data: {
          schema_version: 1,
          resource_id: report,
          status: 'created',
          report_id: report,
          report_version: 1,
        },
        requestId,
      }),
    );
  const session = vi.fn(async () => ({ csrf: 'a'.repeat(64) })),
    key = vi.fn(() => report),
    api = assessmentController('http://localhost:3000', send, key, session),
    input = {
      market: 'US' as const,
      regionKey: 'SYNTHETIC_US',
      configurationId: null,
      wheelPackage: 'checked',
      sizes: { front: '225/45R18', rear: '255/40R18' },
      strategy: 'year_round' as const,
      winterUse: 'none' as const,
      replace: ['front_left' as const, 'front_right' as const],
      priorities: ['wet' as const],
      budget: null,
    };
  await expect(api.submit(input)).rejects.toThrow();
  expect((await api.submit(input)).report_id).toBe(report);
  expect(key).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(2);
  for (const [url, init] of send.mock.calls) {
    expect(String(url)).toBe('http://localhost:3000/api/v1/reports');
    expect(new Headers(init?.headers).get('x-csrf-token')).toBe('a'.repeat(64));
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(report);
  }
});
