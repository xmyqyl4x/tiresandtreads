import { composedApiFixture } from './composed-host.ts';
import { createLocalPublicApi } from '../../../packages/integrations/src/http/local-runtime.ts';
import { createCommercialRuntime } from '../../../packages/integrations/src/commercial-runtime.ts';
import { uid } from '../content/database.ts';
import { ok } from '../../../packages/domain/src/values/core.ts';
import { startWebPreview } from './web-preview.ts';
export async function commercialFixture() {
  const f = await composedApiFixture();
  let api: Awaited<ReturnType<typeof createLocalPublicApi>> | undefined;
  try {
    api = await createLocalPublicApi({ ...f.env, LOCAL_COMMERCIAL_UI: 'enabled' });
    const pages: {
      path: string;
      ref: Awaited<ReturnType<typeof f.f.document>>['ref'];
      document: Awaited<ReturnType<typeof f.f.document>>;
    }[] = [];
    for (const path of [
      '/learn/tire-basics',
      '/learn/glossary',
      '/guides/trust',
      '/guides/how-we-choose',
    ]) {
      const d = await f.f.document('articles', path);
      const ref = await f.f.update(d, 2, {
        ...d.body,
        summary: 'A synthetic learning page for local placement validation.',
        paragraphs: Array.from(
          { length: 10 },
          (_, i) =>
            `Section ${i + 1}. Tire choices depend on supported vehicle fitment, reliable source data and the limits of the evidence. Read the sidewall, confirm the manufacturer requirements and ask an installer when a detail is uncertain. A preference score is not a safety clearance. Stored costs remain estimates and unavailable information remains unknown.`,
        ),
      });
      const r = await api.services.content.services.enqueue(f.f.staff, ref);
      if (!r.ok) throw Error('Synthetic content enqueue refused');
      pages.push({ path, ref, document: d });
    }
    const cycle = await api.services.maintenance.cycle(['publication']);
    if (!cycle.ok) throw Error('Synthetic publication refused');
    const reviewer = uid('staff');
    await f.f.owner.query(
      "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$2,'active',now())",
      [reviewer, reviewer],
    );
    for (const actor of [f.f.staff, reviewer])
      await f.f.owner.query(
        "INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code='commercial_operator' ON CONFLICT DO NOTHING",
        [actor],
      );
    const policy = {
      schemaVersion: 1 as const,
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      accountId: null as string | null,
      adsTxt: [] as string[],
      blockedCategories: [] as string[],
      blockedUrls: [] as string[],
      slots: [
        {
          key: 'learning_one',
          route: 'education' as const,
          width: 300,
          height: 100,
          housePath: '/guides/trust',
          houseLabel: 'Understand the evidence',
        },
        {
          key: 'learning_two',
          route: 'education' as const,
          width: 300,
          height: 100,
          housePath: '/guides/how-we-choose',
          houseLabel: 'How we compare tires',
        },
      ],
    };
    const configured = await api.services.commercial.publish(f.f.staff, reviewer, 0, policy);
    if (!configured.ok) throw Error('Synthetic commercial review refused');
    const retailer = uid('retailer'),
      terms = uid('asset');
    await f.f.owner.query(
      "INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type,state,sha256,size_bytes,object_version) VALUES($1,'report_pdf','synthetic-private',$2,'application/pdf','ready',$3,12345,'v1')",
      [terms, 'assets/' + terms, 'a'.repeat(64)],
    );
    await f.f.owner.query(
      "INSERT INTO app.retailers(id,code,name,market,approved_origin,status) VALUES($1,$2,'Synthetic retailer','US','https://shop.example','active')",
      [retailer, retailer],
    );
    await f.f.owner.query(
      "INSERT INTO admin.affiliate_applications(retailer_id,network,status,submitted_at,approved_terms_asset_id) VALUES($1,'synthetic','approved',now(),$2)",
      [retailer, terms],
    );
    const affiliate = await api.services.commercial.setAffiliate(f.f.staff, reviewer, {
      key: 'approved_retailer',
      retailerId: retailer,
      destination: 'https://shop.example/tires?ref=site',
      market: 'US',
    });
    if (!affiliate.ok) throw Error('Synthetic affiliate review refused');
    const checker = await createCommercialRuntime({
      scopes: {
        staff: f.f.adapter('tt_staff_service_runtime'),
        commercial: f.f.adapter('tt_commercial_runtime'),
        public: f.f.adapter('tt_public_runtime'),
      },
      mail: { reconcile: async () => ok(null), replay: async () => ok(null) },
      privacy: { retry: async () => ok(null) },
      checker: { check: async () => 'valid' as const },
      externalActivationApproved: false,
      now: () => new Date().toISOString(),
    });
    const checked = await checker.commercial.checkAffiliate(f.f.staff, 'approved_retailer');
    if (!checked.ok) throw Error('Synthetic link-health check refused');
    const host = api;
    return {
      f,
      db: f.f,
      api: host,
      policy,
      pages,
      reviewer,
      retailer,
      async cleanup() {
        await host.shutdown();
        await f.cleanup();
      },
    };
  } catch (e) {
    await api?.shutdown();
    await f.cleanup();
    throw e;
  }
}
export async function commercialPreview(origin = 'http://127.0.0.1:8380') {
  const f = await commercialFixture();
  const web = await startWebPreview(origin, 'dev', 'unsupported', {
    fixture: { cleanup: () => f.cleanup() },
    api: { origin: f.api.origin, shutdown: async () => {} },
    env: { LOCAL_COMMERCIAL_UI: 'enabled' },
  });
  return { ...f, web, cleanup: () => web.cleanup() };
}
