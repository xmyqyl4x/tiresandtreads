import { it, expect, vi } from 'vitest';
import { createStaffConsoleClient } from '../../packages/contracts/src/staff-console-client.ts';
const id = '10000000-0000-4000-8000-000000000001',
  bearer = 'a'.repeat(43),
  csrf = 'b'.repeat(64),
  reviewer = 'c'.repeat(43);
const reply = (data: unknown) => Response.json({ data, requestId: id });
it('uses header-only session and command credentials with strict masked queue decoding', async () => {
  const transport = vi.fn<typeof fetch>(async () => reply({ items: [], next: null })),
    c = createStaffConsoleClient('http://127.0.0.1:8380', { bearer, csrf }, transport);
  expect(await c.queue('mail')).toEqual({ items: [], next: null });
  expect(transport.mock.calls[0]![1]).toMatchObject({
    headers: { authorization: 'Bearer ' + bearer },
    redirect: 'error',
    cache: 'no-store',
  });
  transport.mockResolvedValueOnce(
    reply({ items: [{ id, state: 'queued', dueAt: null, email: 'PRIVATE' }], next: null }),
  );
  await expect(c.queue('mail')).rejects.toThrow();
});
it('passes independent reviewer authority only in a header and validates the returned policy version', async () => {
  const transport = vi.fn<typeof fetch>(async () => reply({ version: 2 })),
    c = createStaffConsoleClient('http://127.0.0.1:8380', { bearer, csrf }, transport),
    input = { expectedVersion: 1, policy: {} };
  expect(await c.publish(input, id, reviewer)).toEqual({ version: 2 });
  const call = transport.mock.calls[0]![1]!;
  expect(call.headers).toMatchObject({
    'x-csrf-token': csrf,
    'idempotency-key': id,
    'x-reviewer-authorization': 'Bearer ' + reviewer,
  });
  expect(call.body).toBe(JSON.stringify(input));
  expect(String(call.body)).not.toContain(reviewer);
});
it('keeps failed and unknown recovery receipts distinct from success and preserves an unchanged retry key', async () => {
  const transport = vi.fn<typeof fetch>(async () => reply({ created: true, state: 'unknown' })),
    c = createStaffConsoleClient('http://127.0.0.1:8380', { bearer, csrf }, transport),
    input = { kind: 'mail_reconcile' as const, target: id, evidence: 'd'.repeat(64) };
  expect(await c.recover(input, id)).toEqual({ created: true, state: 'unknown' });
  transport.mockResolvedValueOnce(reply({ created: false, state: 'unknown' }));
  expect(await c.recover(input, id)).toEqual({ created: false, state: 'unknown' });
  expect(
    transport.mock.calls.map((x) => (x[1]!.headers as Record<string, string>)['idempotency-key']),
  ).toEqual([id, id]);
});
