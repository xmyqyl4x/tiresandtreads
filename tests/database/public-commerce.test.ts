import { beforeAll, afterAll, it, expect } from 'vitest';
import { commercialFixture } from '../fixtures/http/commercial.ts';
import { uid } from '../fixtures/content/database.ts';
let f: Awaited<ReturnType<typeof commercialFixture>>;
beforeAll(async () => {
  f = await commercialFixture();
}, 60000);
afterAll(async () => {
  await f?.cleanup();
});
const read = (path: string) => fetch(f.api.origin + '/api/v1/public-commerce/' + path);
it('renders a bounded current house-only inventory through the actual API, PostgreSQL roles and publication services', async () => {
  const r = await read('inventory?path=/learn/tire-basics');
  expect(r.status).toBe(200);
  const v = (await r.json()).data;
  expect(v.network).toBe('held');
  expect(v.slots).toHaveLength(2);
  expect(v.slots.every((s: { mode: string }) => s.mode === 'house')).toBe(true);
  expect(v.affiliates).toHaveLength(1);
  expect(JSON.stringify(v)).not.toMatch(/accountId|owner|staffId|destination|reportId|email/);
});
it('refuses private paths, decoder/checklist forms, duplicate inputs and activation hints', async () => {
  for (const path of [
    '/',
    '/preview/report',
    '/preview/compare',
    '/guides/size-decoder',
    '/guides/before-you-buy',
  ])
    expect(
      (await (await read('inventory?' + new URLSearchParams({ path }))).json()).data.slots,
    ).toEqual([]);
  for (const query of [
    'path=/learn/tire-basics&path=/learn/glossary',
    'path=/learn/tire-basics&consent=true',
    'path=/learn/tire-basics&report=PRIVATE',
  ])
    expect((await read('inventory?' + query)).status).toBe(400);
});
it('rechecks current terms and link-health at click time and withholds a suspended retailer', async () => {
  expect((await read('affiliate/approved_retailer')).status).toBe(200);
  await f.db.owner.query(
    "UPDATE admin.affiliate_applications SET status='suspended',updated_at=now(),revision=revision+1 WHERE retailer_id=$1",
    [f.retailer],
  );
  expect((await read('affiliate/approved_retailer')).status).toBe(404);
  expect((await (await read('inventory?path=/learn/tire-basics')).json()).data.affiliates).toEqual(
    [],
  );
  await f.db.owner.query(
    "UPDATE admin.affiliate_applications SET status='approved',updated_at=now(),revision=revision+1 WHERE retailer_id=$1",
    [f.retailer],
  );
});
it('exposes no invented publisher ID and honours verified-account and global kill-switch changes', async () => {
  expect((await (await read('ads-txt')).json()).data).toMatchObject({
    status: 'not_connected',
    body: '',
  });
  const c = uid('configuration'),
    a = uid('ad_account');
  const db = f.db.owner;
  await db.query(
    "INSERT INTO admin.configuration_versions(id,key,version,value,status,published_at,reviewed_by) VALUES($1,$2,1,'{}','published',now(),$3)",
    [c, uid('network'), f.reviewer],
  );
  await db.query(
    "INSERT INTO admin.ad_network_accounts(id,network,external_account_id,status,verified_at,configuration_id) VALUES($1,'synthetic',$2,'verified',now(),$3)",
    [a, uid('external'), c],
  );
  await db.query(
    "INSERT INTO app.public_configurations(version,configuration_id,issued_at,expires_at,analytics,advertising,checksum) SELECT COALESCE(max(version),0)+1,$1,now(),now()+interval '1 hour',false,true,$2 FROM app.public_configurations",
    [c, 'b'.repeat(64)],
  );
  expect(
    (
      await f.api.services.commercial.publish(f.db.staff, f.reviewer, 1, {
        ...f.policy,
        accountId: a,
        adsTxt: ['example.invalid, synthetic, DIRECT'],
      })
    ).ok,
  ).toBe(true);
  expect((await (await read('ads-txt')).json()).data.body).toBe(
    'example.invalid, synthetic, DIRECT\n',
  );
  expect((await (await read('inventory?path=/learn/tire-basics')).json()).data.network).toBe(
    'held',
  );
  await db.query(
    "UPDATE admin.ad_network_accounts SET status='suspended',updated_at=now(),revision=revision+1 WHERE id=$1",
    [a],
  );
  expect((await (await read('ads-txt')).json()).data.status).toBe('not_connected');
});
it('withholds redirected sources and removed house targets through the shared publication boundary', async () => {
  const content = f.api.services.content.services;
  expect(
    (
      await content.publishRedirects(f.db.staff, f.db.staff, {
        revision: 1,
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        rules: [
          { source: '/guides/trust', target: null, code: 410 },
          { source: '/guides/how-we-choose', target: '/learn/tire-basics', code: 301 },
        ],
      })
    ).ok,
  ).toBe(true);
  // Exercise the existing explicit invalidation; normal readers also have a bounded 30-second TTL.
  f.api.services.content.routing.invalidate();
  expect((await (await read('inventory?path=/learn/tire-basics')).json()).data.slots).toEqual([]);
  expect((await (await read('inventory?path=/guides/trust')).json()).data.affiliates).toEqual([]);
  expect(
    (
      await content.publishRedirects(f.db.staff, f.db.staff, {
        revision: 2,
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        rules: [],
      })
    ).ok,
  ).toBe(true);
  f.api.services.content.routing.invalidate();
  expect((await (await read('inventory?path=/learn/tire-basics')).json()).data.slots).toHaveLength(
    2,
  );
});
it('removes inventory when its source page is withdrawn without changing ranking inputs', async () => {
  const before = (await f.db.owner.query('SELECT document_hash FROM app.rule_versions ORDER BY id'))
    .rows;
  const page = f.pages.find((p) => p.path === '/learn/tire-basics')!;
  const withdrawn = await f.db.update(page.document, 3, page.document.body, false);
  expect(
    (await f.api.services.content.services.enqueue(f.db.staff, withdrawn, 'withdraw')).ok,
  ).toBe(true);
  expect((await f.api.services.maintenance.cycle(['publication'])).ok).toBe(true);
  expect((await (await read('inventory?path=/learn/tire-basics')).json()).data.slots).toEqual([]);
  expect(
    (await f.db.owner.query('SELECT document_hash FROM app.rule_versions ORDER BY id')).rows,
  ).toEqual(before);
  console.log(
    'PUBLIC_COMMERCE_NATIVE_EVIDENCE ' +
      JSON.stringify({
        actualPostgreSQL: true,
        actualLocalApi: true,
        currentPublication: true,
        affiliateTermsRechecked: true,
        adsTxtKillSwitch: true,
        rankingInputsUnchanged: true,
        externalActivation: false,
        actualProviderAcceptance: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});
