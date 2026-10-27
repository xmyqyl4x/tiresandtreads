import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { contentFixture } from '../fixtures/content/database.ts';
import { id } from '../../packages/domain/src/values/core.ts';
import { createServiceHealth } from '../../packages/application/src/services/service-health.ts';
import { createServiceHealthRepository } from '../../packages/db/src/repositories/service-health.ts';
import { createOperationsRepository } from '../../packages/db/src/repositories/operations.ts';
import { createLocalObserver } from '../../packages/integrations/src/local-observer.ts';
import { localHttpReady } from '../../packages/integrations/src/local-probe.ts';
import { proveObservability } from '../../scripts/runtime/local-observer-proof.ts';
it('detects real SQL backlog/lag, refuses revoked access and requires fresh authorized evidence after operator withdrawal of synthetic input', async () => {
  const f = await contentFixture();
  try {
    const scope = f.adapter('tt_operations_runtime');
    const health = createServiceHealth({
      uow: scope.unitOfWork,
      health: createServiceHealthRepository(scope),
      operations: createOperationsRepository(scope),
    });
    const proof = await proveObservability(f.owner, (actor) => {
      const parsed = id('staff', actor);
      if (!parsed.ok) throw Error();
      return {
        ...createLocalObserver({
          review: () =>
            health.review(parsed.value, {
              backlog: 100,
              lagSeconds: 300,
              capacityBasisPoints: 8000,
            }),
          checks: {
            host_readiness: async () => true,
            storage_fixture: async () => true,
            workflow_freshness: async () => true,
          },
          now: Date.now,
        }),
        close: async () => {},
      };
    });
    expect(proof.finalHealthy).toBe(true);
    expect(proof.revokedAccessRetainedAlarm).toBe(true);
    expect(
      (
        await f.owner.query(
          "SELECT 1 FROM admin.staff_identities WHERE provider_subject LIKE 'synthetic-observer-%'",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await f.owner.query(
          "SELECT 1 FROM app.webhook_inbox WHERE provider_event_id LIKE 'synthetic-observer-%'",
        )
      ).rows,
    ).toEqual([]);
    console.log('LOCAL_OBSERVER_EVIDENCE', JSON.stringify(proof));
  } finally {
    await f.cleanup();
  }
}, 30000);
it('observes actual HTTP loss/recovery, refuses redirects and hosted destinations, and times out a stalled local endpoint', async () => {
  let status = 200,
    calls = 0;
  const server = createServer((req, res) => {
    calls++;
    if (req.url === '/health/ready') {
      if (status === 0) return;
      res.writeHead(status, { location: 'http://example.invalid/' }).end('private body');
    } else res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error();
  const url = `http://127.0.0.1:${address.port}/health/ready`;
  try {
    expect(await localHttpReady(url)).toBe(true);
    status = 503;
    expect(await localHttpReady(url)).toBe(false);
    status = 302;
    expect(await localHttpReady(url)).toBe(false);
    status = 200;
    expect(await localHttpReady(url)).toBe(true);
    const before = calls;
    await expect(localHttpReady('https://example.com/health/ready')).rejects.toThrow(
      'Invalid local probe',
    );
    await expect(localHttpReady(url + '?private=token')).rejects.toThrow('Invalid local probe');
    expect(calls).toBe(before);
    status = 0;
    const began = Date.now();
    expect(await localHttpReady(url)).toBe(false);
    expect(Date.now() - began).toBeLessThan(4500);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}, 10000);
