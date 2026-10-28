import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
import pg from 'pg';
import {
  admitLocalRelease,
  localReleaseReady,
  localSelection,
} from '../../../scripts/deployment/preflight.ts';
import { createLocalSignaturePreflight } from '../../../packages/integrations/src/provider-preflight-workflow.ts';
import { readFixture } from './context.ts';
import { localProviderProject } from '../../../packages/config/src/provider-preflight.ts';
function configuration() {
  try {
    localProviderProject(process.env);
    const plan = admitLocalRelease(readFixture('release'), process.env);
    const secrets = readFixture<{
      app: string;
      cms: string;
      callbackKey: string;
      operatorFingerprint: string;
    }>('secrets');
    for (const [kind, raw] of [
      ['app', secrets.app],
      ['cms', secrets.cms],
    ] as const) {
      const u = new URL(raw);
      if (
        u.protocol !== 'postgresql:' ||
        !u.password ||
        u.hostname !== 'postgres' ||
        u.port !== '5432' ||
        u.username !== `tt_${kind}_runtime` ||
        u.pathname !== `/tt_${kind}_deployment` ||
        u.search ||
        u.hash
      )
        throw Error('Local probe role refused');
    }
    const probe = createLocalSignaturePreflight(process.env, secrets.callbackKey);
    return { plan, secrets, probe };
  } catch {
    throw Error('Local deployment fixture unavailable');
  }
}
const { plan, secrets, probe } = configuration();
let stopping = false;
async function database(raw: string, role: string) {
  const c = new pg.Client({
    connectionString: raw,
    connectionTimeoutMillis: 700,
    statement_timeout: 700,
  });
  try {
    await c.connect();
    const row = (
      await c.query('SELECT current_user AS role,deployment_fixture.ready() AS verified')
    ).rows[0];
    return row?.role === role && row.verified === true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
async function ready() {
  try {
    const state = readFixture('state'),
      slot = localSelection(state, plan);
    const backend = (async () => {
      try {
        const r = await fetch(
          `http://${slot === 'current' ? 'app' : 'previous'}:3000/health/ready`,
          { redirect: 'error', signal: AbortSignal.timeout(800) },
        );
        await r.body?.cancel();
        return r.status === 200;
      } catch {
        return false;
      }
    })();
    const [app, cms, alive] = await Promise.all([
      database(secrets.app, 'tt_app_runtime'),
      database(secrets.cms, 'tt_cms_runtime'),
      backend,
    ]);
    return localReleaseReady(state, plan, { app, cms, backend: alive, stopping });
  } catch {
    return false;
  }
}
function response(res: ServerResponse, status: number, value: object = {}) {
  res
    .writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
    })
    .end(JSON.stringify(value));
}
async function body(req: IncomingMessage, res: ServerResponse): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    let size = 0,
      done = false;
    const finish = (result: Buffer | null, status?: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.removeListener('data', data);
      req.removeListener('end', end);
      req.removeListener('error', error);
      if (status) {
        res.setHeader('connection', 'close');
        res.once('finish', () => req.destroy());
        response(res, status);
      }
      resolve(result);
    };
    const data = (bytes: Buffer) => {
      size += bytes.length;
      if (size > 8192) {
        req.pause();
        finish(null, 413);
      } else parts.push(bytes);
    };
    const end = () => finish(Buffer.concat(parts));
    const error = () => finish(null, 400);
    const timer = setTimeout(() => finish(null, 408), 2000);
    req.on('data', data).once('end', end).once('error', error);
  });
}
const cert = process.env.DEPLOYMENT_CERT_MODE === 'expired' ? 'expired' : 'server';
const server = createServer(
  {
    key: readFileSync(`/deploy-tls/${cert}.key`),
    cert: readFileSync(`/deploy-tls/${cert}.crt`),
    ca: readFileSync('/deploy-tls/ca.crt'),
    minVersion: 'TLSv1.2',
    requestCert: true,
    rejectUnauthorized: false,
    maxHeaderSize: 8192,
  },
  (req, res) => {
    void (async () => {
      if (req.headers.host !== 'ingress.preflight.test:9443') {
        response(res, 400);
        return;
      }
      if (req.url === '/health/ready' && req.method === 'GET') {
        const peer = req.socket as TLSSocket;
        if (
          !peer.authorized ||
          peer.getPeerCertificate().fingerprint256 !== secrets.operatorFingerprint
        ) {
          response(res, 401);
          return;
        }
        const value = await ready();
        response(res, value ? 200 : 503, {
          ready: value,
          scope: 'local-fixture',
          hostedAccepted: false,
          productActivation: false,
        });
        return;
      }
      if (req.url !== '/internal/preflight-inngest?probe=trust' || req.method !== 'POST') {
        response(res, 404);
        return;
      }
      if (!(await ready())) {
        response(res, 503);
        return;
      }
      if (Number(req.headers['content-length'] ?? 0) > 8192) {
        res.setHeader('connection', 'close');
        response(res, 413);
        return;
      }
      const bytes = await body(req, res);
      if (!bytes) return;
      const r = await probe(
        new Request('http://test:8124/internal/preflight-inngest?probe=trust', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(typeof req.headers['x-inngest-signature'] === 'string'
              ? { 'x-inngest-signature': req.headers['x-inngest-signature'] }
              : {}),
          },
          body: new Uint8Array(bytes),
        }),
      );
      response(res, r.status, { scope: 'local-fixture', verified: r.status === 200 });
      bytes.fill(0);
      await r.body?.cancel();
    })().catch(() => {
      if (!res.headersSent) response(res, 503);
      else res.end();
    });
  },
);
server.requestTimeout = 3000;
server.headersTimeout = 3000;
server.keepAliveTimeout = 500;
server.listen(9443, '0.0.0.0', () =>
  console.log('Local TLS deployment fixture ready; product routes denied'),
);
process.once('SIGTERM', () => {
  stopping = true;
  server.close(() => process.exit(0));
  setTimeout(() => server.closeAllConnections(), 2000).unref();
});
