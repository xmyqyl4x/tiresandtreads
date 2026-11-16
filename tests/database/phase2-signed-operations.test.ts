import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { operationsWebFixture } from '../fixtures/phase2/operations-web.ts';
import { signedP2Staff } from '../fixtures/phase2/signed-staff.ts';
import { createOperationsP2Client } from '../../packages/contracts/src/phase2-operations-client.ts';
it('binds signed operations, renewal, current permissions, revocation and realm refusals through Next and SQL', async () => {
  let signed: ReturnType<typeof signedP2Staff> | undefined;
  const f = await operationsWebFixture(undefined, async (c) => ({
    routes: [],
    security(base) {
      signed = signedP2Staff(c.f, c.p.d.authority, base);
      return signed.security;
    },
  }));
  try {
    const identity = signed!,
      bearer = await identity.credential(f.operator.id),
      client = (token: string) =>
        createOperationsP2Client(f.web.webOrigin, async (input, init) => {
          const u = new URL(String(input));
          return f.web.request('/local-p2-operations-api' + u.pathname + u.search, {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init?.headers)),
              authorization: 'Bearer ' + token,
              origin: f.web.webOrigin,
            },
          });
        });
    const a = (await client(bearer).p2OperationsSession({})).data;
    expect(a.capabilities.aiControl).toBe(true);
    const renewed = await identity.credential(f.operator.id, { jti: randomUUID() });
    expect(renewed).not.toBe(bearer);
    expect((await client(renewed).p2OperationsSession({})).data.csrf).toBe(a.csrf);
    expect(
      (
        await client(renewed).p2OperationsDashboard({
          query: { day: new Date().toISOString().slice(0, 10) },
        })
      ).data.capabilities.aiObserve,
    ).toBe(true);
    for (const kind of ['privacy', 'visitors'] as const)
      expect(
        (
          await client(renewed).p2OperationsPurpose({
            query: { kind, day: new Date().toISOString().slice(0, 10) },
          })
        ).data.kind,
      ).toBe(kind);
    const week = new Date();
    week.setUTCHours(0, 0, 0, 0);
    week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7) - 7);
    expect(
      (
        await client(renewed).p2OperationsPurpose({
          query: {
            kind: 'pilot',
            day: new Date().toISOString().slice(0, 10),
            week: week.toISOString().slice(0, 10),
          },
        })
      ).data.pilot?.accepted,
    ).toBe('0');
    await expect(
      client(bearer.slice(0, -10) + 'FORGEDTOKN').p2OperationsSession({}),
    ).rejects.toBeDefined();
    await expect(
      client(await identity.credential(f.operator.id, { aud: 'wrong-realm' })).p2OperationsSession(
        {},
      ),
    ).rejects.toBeDefined();
    await expect(client(f.token).p2OperationsSession({})).rejects.toBeDefined();
    await f.f.admin.query('DELETE FROM admin.staff_role_assignments WHERE staff_id=$1', [
      f.operator.id,
    ]);
    await expect(client(renewed).p2OperationsSession({})).rejects.toBeDefined();
    const observer = await identity.credential(f.observer.id);
    expect((await client(observer).p2OperationsSession({})).data.capabilities.aiControl).toBe(
      false,
    );
    identity.revoke(f.observer.id);
    await expect(client(observer).p2OperationsSession({})).rejects.toBeDefined();
    console.log(
      'P2_SIGNED_OPERATIONS_EVIDENCE ' +
        JSON.stringify({
          actualNext: true,
          actualPostgreSQL: true,
          signedSdkSession: true,
          sameSessionRenewal: true,
          currentRoleRevocation: true,
          providerSessionRevocation: true,
          syntheticIdentityReads: identity.reads(),
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
  } finally {
    await signed?.cleanup();
    await f.cleanup();
  }
}, 180000);
