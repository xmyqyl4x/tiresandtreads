import { beforeAll, afterAll, it, expect } from 'vitest';
import { clerkStaffConsolePreview } from '../fixtures/http/clerk-staff-console.ts';
import { createStaffConsoleClient } from '../../packages/contracts/src/staff-console-client.ts';
let f: Awaited<ReturnType<typeof clerkStaffConsolePreview>>;
beforeAll(async () => {
  f = await clerkStaffConsolePreview();
}, 180000);
afterAll(async () => {
  await f?.cleanup();
}, 30000);
function client(staff: { bearer: string; csrf: string }) {
  return createStaffConsoleClient(f.web.webOrigin, staff, async (input, options = {}) => {
    const u = new URL(String(input));
    return f.web.request('/local-staff-api' + u.pathname + u.search, {
      ...options,
      headers: { ...Object.fromEntries(new Headers(options.headers)), origin: f.web.webOrigin },
    });
  });
}
it('carries a real generated Clerk session through built Next, the private proxy, SDK verification and current SQL services', async () => {
  const html = await (await f.web.request('/staff')).text();
  expect(html).toMatch(/maxLength="8185"/i);
  const operator = await f.signedStaff(),
    c = client(operator);
  expect(await c.session()).toMatchObject({ staffId: operator.id, csrf: operator.csrf });
  expect(await c.queue('mail')).toEqual({ items: [], next: null });
  expect(f.providerReads()).toBeGreaterThanOrEqual(3);
  await f.db.admin.query("UPDATE admin.staff_identities SET status='disabled' WHERE id=$1", [
    operator.id,
  ]);
  await expect(c.session()).rejects.toMatchObject({ code: 'unauthorized' });
  expect(f.providerCalls()).toBe(0);
});
it('refuses provider revocation and cannot turn a syntactically valid forged JWT into authority', async () => {
  const operator = await f.signedStaff(),
    c = client(operator);
  expect(await c.queue('mail')).toEqual({ items: [], next: null });
  operator.revoke();
  await expect(c.queue('mail')).rejects.toMatchObject({ code: 'unauthorized' });
  const before = f.providerReads(),
    forged = client({
      bearer: 'eyJhbGciOiJSUzI1NiJ9.' + 'a'.repeat(200) + '.' + 'b'.repeat(342),
      csrf: operator.csrf,
    });
  await expect(forged.session()).rejects.toMatchObject({ code: 'unauthorized' });
  expect(f.providerReads()).toBe(before);
});
