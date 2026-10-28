import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { request as secureRequest } from 'node:https';
import { request as plainRequest } from 'node:http';
import { expect, it } from 'vitest';
import { deploymentContext, connect, readFixture } from '../fixtures/deployment/context.ts';
const ctx = deploymentContext();
const secrets = readFixture<{ callbackKey: string }>('secrets');
const body = '{"fixture":"only"}';
function signature(key = secrets.callbackKey, data = body, t = Math.floor(Date.now() / 1000)) {
  return `t=${t}&s=${createHmac('sha256', key.replace('signkey-test-', '')).update(data).update(String(t)).digest('hex')}`;
}
function call(
  path = '/health/ready',
  o: {
    operator?: boolean;
    foreign?: boolean;
    sibling?: boolean;
    ca?: string;
    host?: string;
    method?: string;
    data?: string;
    signature?: string;
    headers?: Record<string, string>;
    plain?: boolean;
    chunked?: boolean;
    servername?: string;
  } = {},
) {
  return new Promise<{
    status: number;
    body: string;
    headers: Record<string, unknown>;
    code?: string;
  }>((resolve) => {
    const request = o.plain ? plainRequest : secureRequest;
    const data = o.data,
      req = request(
        {
          hostname: o.host ?? 'ingress.preflight.test',
          port: 9443,
          path,
          method: o.method ?? 'GET',
          ...(o.plain
            ? {}
            : {
                ca: readFileSync('/deploy-tls/' + (o.ca ?? 'ca') + '.crt'),
                rejectUnauthorized: true,
                minVersion: 'TLSv1.2',
                servername: o.servername ?? o.host ?? 'ingress.preflight.test',
                ...(o.operator || o.foreign || o.sibling
                  ? {
                      cert: readFileSync(
                        `/deploy-tls/${o.foreign ? 'foreign' : o.sibling ? 'sibling' : 'operator'}.crt`,
                      ),
                      key: readFileSync(
                        `/deploy-tls/${o.foreign ? 'foreign' : o.sibling ? 'sibling' : 'operator'}.key`,
                      ),
                    }
                  : {}),
              }),
          headers: {
            host: 'ingress.preflight.test:9443',
            ...(data !== undefined
              ? {
                  'content-type': 'application/json',
                  ...(!o.chunked ? { 'content-length': String(Buffer.byteLength(data)) } : {}),
                }
              : {}),
            ...(o.signature ? { 'x-inngest-signature': o.signature } : {}),
            ...o.headers,
          },
        },
        (res) => {
          const parts: Buffer[] = [];
          let size = 0;
          res.on('data', (b: Buffer) => {
            size += b.length;
            if (size > 8192) req.destroy();
            else parts.push(b);
          });
          res.once('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(parts).toString(),
              headers: res.headers,
            }),
          );
        },
      );
    req.setTimeout(4000, () => req.destroy());
    req.once('error', (e: NodeJS.ErrnoException) =>
      resolve({ status: 0, body: '', headers: {}, code: e.code ?? 'LOCAL_NETWORK_ERROR' }),
    );
    if (data !== undefined) req.write(data);
    req.end();
  });
}
const callback = '/internal/preflight-inngest?probe=trust';
it('access: real TLS verifies CA, hostname and expiry and requires the fixture operator certificate', async () => {
  const releaseFile = statSync('/deployment/release.json');
  expect(releaseFile.uid).toBe(process.getuid!());
  expect(releaseFile.mode & 0o777).toBe(0o600);
  const r = await call('/health/ready', { operator: true });
  expect(r.status).toBe(200);
  expect(JSON.parse(r.body)).toEqual({
    ready: true,
    scope: 'local-fixture',
    hostedAccepted: false,
    productActivation: false,
  });
  expect(r.headers['cache-control']).toBe('no-store');
  expect(r.headers['x-robots-tag']).toBe('noindex');
  expect((await call()).status).toBe(401);
  expect((await call('/health/ready', { foreign: true })).status).toBe(401);
  expect((await call('/health/ready', { sibling: true })).status).toBe(401);
  expect((await call('/health/ready', { operator: true, ca: 'wrong-ca' })).status).toBe(0);
  expect(
    (await call('/health/ready', { operator: true, host: 'ingress-mismatch.preflight.test' })).code,
  ).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
  expect(
    (
      await call('/health/ready', {
        operator: true,
        host: 'expired-ingress',
        servername: 'ingress.preflight.test',
      })
    ).code,
  ).toBe('CERT_HAS_EXPIRED');
  expect((await call('/health/ready', { plain: true })).status).toBe(0);
});
it('access: exact route/method/host policy denies products, sync and forwarding-header impersonation', async () => {
  for (const path of [
    '/',
    '/api/reports',
    '/admin',
    '/health/ready?bypass=1',
    '/internal/inngest',
    '/internal/preflight-inngest?fnId=product',
    '/%2e%2e/api/reports',
  ])
    expect((await call(path, { operator: true })).status).toBe(404);
  expect((await call('/health/ready', { operator: true, method: 'POST' })).status).toBe(404);
  expect(
    (await call('/health/ready', { operator: true, headers: { host: 'untrusted.invalid' } }))
      .status,
  ).toBe(400);
  expect(
    (
      await call('/health/ready', {
        headers: {
          'x-forwarded-for': '127.0.0.1',
          'x-forwarded-client-cert': 'operator',
          'x-forwarded-proto': 'https',
        },
      })
    ).status,
  ).toBe(401);
});
it('access: the pinned SDK verifies signed probes over TLS with no functions or external effects', async () => {
  const good = { method: 'POST', data: body, signature: signature() };
  expect((await call(callback, good)).status).toBe(200);
  expect((await call(callback, good)).status).toBe(200);
  for (const o of [
    { method: 'POST', data: body },
    { ...good, signature: signature('signkey-test-' + '0'.repeat(64)) },
    { ...good, data: '{"fixture":"changed"}' },
    {
      ...good,
      signature: signature(secrets.callbackKey, body, Math.floor(Date.now() / 1000) - 600),
    },
  ])
    expect((await call(callback, o)).status).toBe(401);
  for (const chunked of [false, true])
    expect(
      (
        await call(callback, {
          method: 'POST',
          data: 'x'.repeat(8193),
          signature: signature(),
          chunked,
        })
      ).status,
    ).toBe(413);
});
it('access: malformed or unapproved migration/selection evidence withholds both readiness and callbacks', async () => {
  const original = readFileSync('/deployment/state.json', 'utf8');
  try {
    for (const state of [
      '{invalid',
      'x'.repeat(16385),
      JSON.stringify({ ...JSON.parse(original), slot: 'remote' }),
      JSON.stringify({ ...JSON.parse(original), expansionDigest: '0'.repeat(64) }),
    ]) {
      writeFileSync('/deployment/state.json', state, { mode: 0o600 });
      expect((await call('/health/ready', { operator: true })).status).toBe(503);
      expect(
        (await call(callback, { method: 'POST', data: body, signature: signature() })).status,
      ).toBe(503);
    }
  } finally {
    writeFileSync('/deployment/state.json', original, { mode: 0o600 });
  }
  expect((await call('/health/ready', { operator: true })).status).toBe(200);
  for (const kind of ['app', 'cms'] as const) {
    const owner = await connect(ctx.url(kind)),
      runtime = await connect(ctx.url(kind, `tt_${kind}_runtime`));
    try {
      await expect(
        runtime.query('SELECT * FROM deployment_fixture.expected_history'),
      ).rejects.toMatchObject({ code: '42501' });
      const original = (
        await owner.query(
          'SELECT position,sha256 FROM migration_meta.applied ORDER BY position DESC LIMIT 1',
        )
      ).rows[0];
      try {
        await owner.query(
          "UPDATE migration_meta.applied SET sha256=repeat('0',64) WHERE position=$1",
          [original.position],
        );
        expect((await call('/health/ready', { operator: true })).status).toBe(503);
        expect(
          (await call(callback, { method: 'POST', data: body, signature: signature() })).status,
        ).toBe(503);
      } finally {
        await owner.query('UPDATE migration_meta.applied SET sha256=$2 WHERE position=$1', [
          original.position,
          original.sha256,
        ]);
      }
    } finally {
      await Promise.all([owner.end(), runtime.end()]);
    }
  }
  expect((await call('/health/ready', { operator: true })).status).toBe(200);
});
for (const phase of ['database-outage', 'candidate-loss'])
  it(`${phase}: fails closed without automatic image fallback or callback acceptance`, async () => {
    expect((await call('/health/ready', { operator: true })).status).toBe(503);
    expect(
      (await call(callback, { method: 'POST', data: body, signature: signature() })).status,
    ).toBe(503);
  });
it('rollback: explicit previous-image selection restores readiness and preserves additive schema, data and migration history', async () => {
  expect((await call('/health/ready', { operator: true })).status).toBe(200);
  const proof = readFixture<{
    serializedRefusal: boolean;
    repeatApplied: boolean;
    app: unknown;
    cms: unknown;
  }>('database-proof');
  expect(proof.serializedRefusal).toBe(true);
  expect(proof.repeatApplied).toBe(false);
  for (const kind of ['app', 'cms'] as const) {
    const c = await connect(ctx.url(kind));
    try {
      expect(
        JSON.parse(
          JSON.stringify(
            (await c.query('SELECT * FROM migration_meta.applied ORDER BY position')).rows,
          ),
        ),
      ).toEqual(proof[kind]);
      if (kind === 'app')
        expect(
          (await c.query('SELECT label,additive_probe FROM deployment_fixture.release_state')).rows,
        ).toEqual([{ label: 'survivor', additive_probe: null }]);
    } finally {
      await c.end();
    }
  }
  expect((await call('/api/reports', { operator: true })).status).toBe(404);
});
