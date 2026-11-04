import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { getPayload, buildConfig, type Payload } from 'payload';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { contentFixture, uid, time } from '../content/database.ts';
import { disposableTargets } from '../foundation/target.ts';
import { editorialCollections } from '../../../scripts/database/cms-collections.ts';
import { editorialPayloadAccess } from '../../../packages/integrations/src/editorial-payload.ts';
import { createEditorialService } from '../../../packages/application/src/services/editorial.ts';
import { createContentRuntime } from '../../../packages/integrations/src/content-runtime.ts';
import { createContentServiceRepository } from '../../../packages/db/src/repositories/content-services.ts';
import { contentIdentity } from '../../../packages/integrations/src/content-identity.ts';
import { editorialHttp } from '../../../packages/integrations/src/editorial-http.ts';
import { id, ok } from '../../../packages/domain/src/values/core.ts';
import type {
  EditorialActor,
  EditorialRole,
  EditorialDraft,
} from '../../../packages/domain/src/editorial.ts';
import seeds from '../../../content/education/en-US.drafts.json';

// Disposable support only. Fixed synthetic credentials do not represent a production identity issuer.
export async function editorialFixture(origin = 'http://127.0.0.1:8380') {
  if (process.env.TT_EDITORIAL_TRACE) console.log('EDITORIAL_TRACE foundation');
  const f = await contentFixture(),
    admin = new pg.Client({ connectionString: disposableTargets(process.env).cms }),
    role = 'tt_cms_editorial_fixture',
    password = randomBytes(32).toString('hex');
  await admin.connect();
  if (process.env.TT_EDITORIAL_TRACE) console.log('EDITORIAL_TRACE fixture-databases');
  let payload: Payload | undefined;
  let reservedClient: pg.PoolClient | undefined,
    ownedPool: pg.Pool | undefined,
    payloadClosed = false;
  // Pinned adapter 3.92 retains its initial reconnect-listener client. Capture only that
  // owned first connection so disposable shutdown can release it before pool.end().
  class FixturePool extends pg.Pool {
    constructor(
      options?: Pick<pg.PoolConfig, 'connectionString' | 'max' | 'connectionTimeoutMillis'>,
    ) {
      super(options);
      // Retain this exact disposable adapter-owned instance to close its pinned reconnect client.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      ownedPool = this;
      this.once('connect', (client: pg.PoolClient) => {
        reservedClient = client;
      });
    }
  }
  async function stopPayload() {
    if (payloadClosed) return;
    payloadClosed = true;
    for (const key of Object.keys(payload?.db.sessions ?? {}))
      await payload!.db.rollbackTransaction(key);
    reservedClient?.release();
    reservedClient = undefined;
    await ownedPool?.end();
    await payload?.destroy();
  }
  const actors = {} as Record<EditorialRole, EditorialActor>,
    credentials = { author: 'a'.repeat(43), reviewer: 'b'.repeat(43), publisher: 'c'.repeat(43) },
    revoked = new Set<string>();
  try {
    if ((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
      throw Error('Disposable editorial role already exists');
    await admin.query(
      "CREATE ROLE tt_cms_editorial_fixture LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '" +
        password +
        "'",
    );
    await f.cmsAdmin.query('GRANT CONNECT ON DATABASE tt_cms_content TO tt_cms_editorial_fixture');
    await f.cmsAdmin.query('GRANT USAGE ON SCHEMA public TO tt_cms_editorial_fixture');
    await f.cmsAdmin.query('GRANT SELECT ON public.cms_staff TO tt_cms_editorial_fixture');
    await f.cmsAdmin.query(
      'GRANT SELECT,INSERT,UPDATE ON public.articles,public.glossary_terms,public.articles_rels,public.glossary_terms_rels,public.editorial_reviews TO tt_cms_editorial_fixture',
    );
    await f.cmsAdmin.query(
      'GRANT DELETE ON public.articles_rels,public.glossary_terms_rels TO tt_cms_editorial_fixture',
    );
    await f.cmsAdmin.query(
      'GRANT SELECT,INSERT,UPDATE,DELETE ON public._articles_v,public._articles_v_rels,public._glossary_terms_v,public._glossary_terms_v_rels TO tt_cms_editorial_fixture',
    );
    await f.cmsAdmin.query(
      'GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO tt_cms_editorial_fixture',
    );
    for (const name of ['author', 'reviewer', 'publisher'] as const) {
      const staff = uid('staff'),
        cms = uid('cms_staff');
      await f.owner.query(
        "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$2,'active',now())",
        [staff, 'local-editorial-' + name],
      );
      await f.owner.query(
        'INSERT INTO admin.staff_role_assignments(staff_id,role_id) VALUES($1,$2)',
        [staff, f.role],
      );
      await f.cmsAdmin.query('INSERT INTO public.cms_staff(id,app_staff_id) VALUES($1,$2)', [
        cms,
        staff,
      ]);
      actors[name] = { id: staff, cmsId: cms, name: 'Synthetic ' + name, roles: [name] };
    }
    const url = new URL(f.cmsConnectionUrl('tt_cms_runtime'));
    url.username = role;
    url.password = password;
    const denied = () => false;
    const access = editorialPayloadAccess({
      secret: randomBytes(32).toString('hex'),
      telemetry: false,
      logger: { options: { level: 'silent' } },
      admin: { disable: true, user: 'cms-staff' },
      graphQL: { disable: true },
      typescript: { autoGenerate: false },
      collections: [
        ...editorialCollections,
        {
          slug: 'cms-staff',
          auth: {
            disableLocalStrategy: true,
            strategies: [
              { name: 'verified-identity-required', authenticate: async () => ({ user: null }) },
            ],
          },
          access: { read: denied, create: denied, update: denied, delete: denied, admin: denied },
          fields: [{ name: 'appStaffId', type: 'text', required: true, unique: true }],
        },
      ],
      email: () => ({
        name: 'disabled',
        defaultFromAddress: 'disabled@example.invalid',
        defaultFromName: 'Disabled',
        sendEmail: async () => {
          throw Error('No notifications permitted');
        },
      }),
      db: postgresAdapter({
        // Adapter declarations retain @types/pg 8.20; this bounded fixture uses the
        // installed pg 8.23 implementation, whose runtime compatibility is proved below.
        pg: { ...pg, Pool: FixturePool } as unknown as NonNullable<
          Parameters<typeof postgresAdapter>[0]['pg']
        >,
        pool: { connectionString: url.toString(), max: 3, connectionTimeoutMillis: 3000 },
        push: false,
        disableCreateDatabase: true,
        idType: 'uuid',
        allowIDOnCreate: true,
      }),
    });
    if (process.env.TT_EDITORIAL_TRACE) console.log('EDITORIAL_TRACE payload-init');
    payload = await getPayload({
      key: 'editorial-fixture-' + randomUUID(),
      config: buildConfig(access.config),
    });
    if (process.env.TT_EDITORIAL_TRACE) console.log('EDITORIAL_TRACE payload-ready');
    const bytes = new Map<string, Uint8Array>();
    const content = await createContentRuntime({
      appScope: f.appScope,
      publicScope: f.publicScope,
      cmsScope: f.cmsScope,
      snapshots: {
        put: async (k, b) => {
          bytes.set(k, b);
        },
        get: async (k) => {
          const b = bytes.get(k);
          if (!b) throw Error('missing');
          return b;
        },
      },
      crawler: {
        observe: async () => {
          throw Error('No external crawler permitted');
        },
      },
      search: {
        enabled: false,
        daily: async () => [],
        notify: async () => {
          throw Error('No search notifications permitted');
        },
      },
      origin: 'https://example.test',
      production: false,
      now: () => time(),
    });
    const authorization = {
      async require(credential: string, permission: EditorialRole | 'read') {
        const name = (Object.keys(credentials) as EditorialRole[]).find(
          (k) => credentials[k] === credential,
        );
        if (!name || revoked.has(credential)) throw Error('unauthenticated');
        const actor = actors[name];
        if (permission !== 'read' && !actor.roles.includes(permission)) throw Error('forbidden');
        const active = await f.owner.query(
          "SELECT 1 FROM admin.staff_identities WHERE id=$1 AND status='active'",
          [actor.id],
        );
        if (!active.rowCount) throw Error('forbidden');
        return actor;
      },
    };
    const jobs: string[] = [];
    if (process.env.TT_EDITORIAL_TRACE) console.log('EDITORIAL_TRACE service-ready');
    const service = createEditorialService({
      store: access.store(payload),
      authorization,
      digest: contentIdentity.checksum,
      now: () => time(),
      redirects: {
        read: async (actor) => {
          const a = id('staff', actor);
          if (!a.ok) throw Error('invalid_input');
          const repository = createContentServiceRepository(f.appScope);
          const result = await f.appScope.unitOfWork.run(async (tx) => {
            await repository.authorize(tx, a.value, 'seo.publish');
            return ok((await repository.currentRedirects(tx))?.value ?? null);
          });
          if (!result.ok) throw Error(result.error.code);
          return result.value;
        },
        publish: async (actor, reviewer, value) => {
          const a = id('staff', actor),
            r = id('staff', reviewer);
          if (!a.ok || !r.ok) throw Error('invalid_input');
          const result = await content.services.publishRedirects(a.value, r.value, value);
          if (!result.ok) throw Error(result.error.code);
          return result.value;
        },
      },
      enqueue: async (actor, ref, action) => {
        const a = id('staff', actor),
          doc = id('cms_document', ref.id);
        if (!a.ok || !doc.ok) throw Error('invalid_input');
        const job = await content.services.enqueue(a.value, { ...ref, id: doc.value }, action);
        if (!job.ok) throw Error(job.error.code);
        jobs.push(job.value.id);
        const applied = await content.services.dispatch(job.value.id);
        if (!applied.ok) throw Error(applied.error.code);
        return job.value;
      },
    });
    async function seed(publish = false) {
      const records: { id: string; path: string }[] = [];
      for (const draft of seeds.records) {
        const documentId = randomUUID();
        await service.execute(credentials.author, {
          id: documentId,
          expectedRevision: 0,
          key: randomUUID(),
          action: 'save',
          draft,
        });
        if (publish) {
          await service.execute(credentials.author, {
            id: documentId,
            expectedRevision: 1,
            key: randomUUID(),
            action: 'submit',
          });
          await service.execute(credentials.reviewer, {
            id: documentId,
            expectedRevision: 2,
            key: randomUUID(),
            action: 'approve',
            expiresAt: time(86400000),
          });
          await service.execute(credentials.publisher, {
            id: documentId,
            expectedRevision: 3,
            key: randomUUID(),
            action: 'publish',
          });
        }
        records.push({ id: documentId, path: draft.path });
      }
      return records;
    }
    return {
      f,
      payload,
      actors,
      credentials,
      revoked,
      service,
      content,
      jobs,
      seed,
      handler: editorialHttp({ origin, service }),
      draft: seeds.records[0] as EditorialDraft,
      async cleanup() {
        if (process.env.TT_EDITORIAL_TRACE) console.log('EDITORIAL_TRACE cleanup');
        try {
          await stopPayload();
        } finally {
          try {
            await f.cleanup();
          } finally {
            await admin.query('DROP ROLE tt_cms_editorial_fixture');
            await admin.end();
          }
        }
      },
    };
  } catch (e) {
    await stopPayload();
    try {
      await f.cleanup();
    } finally {
      await admin.query('DROP ROLE IF EXISTS tt_cms_editorial_fixture');
      await admin.end();
    }
    throw e;
  }
}
