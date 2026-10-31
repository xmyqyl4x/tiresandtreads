import { lookup } from 'node:dns/promises';
import pg from 'pg';
import { expect, it, vi } from 'vitest';
import { observe, publicPlan } from '../fixtures/tls-admission/observer.ts';
import { evidenceFlags } from '../fixtures/tls-admission/contract.ts';

it('refuses the fixed actual routing/resource fault through the unchanged reader', async () => {
  const profile = process.env.LR02_PROFILE;
  expect([
    'positive',
    'alias-collision',
    'cross-source',
    'cross-target',
    'container',
    'tls-volume',
    'shared-tls',
  ]).toContain(profile);
  const connects = vi.spyOn(pg.Client.prototype, 'connect'),
    queries = vi.spyOn(pg.Client.prototype, 'query'),
    ends = vi.spyOn(pg.Client.prototype, 'end');
  try {
    if (['positive', 'cross-source', 'cross-target'].includes(profile!)) {
      const source = process.env.LR02_SOURCE_ADDRESS!,
        target = process.env.LR02_TARGET_ADDRESS!;
      expect(source).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(target).not.toBe(source);
      expect((await lookup('postgres.preflight.test', { family: 4 })).address).toBe(
        profile === 'cross-source' ? target : source,
      );
      expect((await lookup('recovery-postgres.preflight.test', { family: 4 })).address).toBe(
        profile === 'cross-target' ? source : target,
      );
    }
    const result = await observe(publicPlan());
    expect(result).toMatchObject({ ...evidenceFlags, cleanupUnknown: false });
    expect(result.elapsedMs).toBeLessThan(4000);
    let code: string | null = null,
      misroutedQueries = 0;
    if (profile === 'positive') {
      expect(result).toMatchObject({
        status: 'observed',
        connections: 4,
        ended: 4,
        workUnknown: false,
      });
      expect(result.observations).toHaveLength(4);
      expect(connects).toHaveBeenCalledTimes(4);
      expect(ends).toHaveBeenCalledTimes(4);
    } else {
      const routed = profile === 'cross-source' || profile === 'cross-target',
        n = profile === 'cross-target' ? 3 : routed ? 1 : 0;
      expect(result).toMatchObject({
        status: 'refused',
        connections: n,
        ended: n,
        workUnknown: routed,
        observations: [],
      });
      expect(connects).toHaveBeenCalledTimes(n);
      expect(ends).toHaveBeenCalledTimes(n);
      expect(queries).toHaveBeenCalledTimes(profile === 'cross-target' ? 8 : 0);
      if (routed) {
        const index = n - 1,
          failed = connects.mock.contexts[index];
        misroutedQueries = queries.mock.contexts.filter((x) => x === failed).length;
        expect(misroutedQueries).toBe(0);
        code = await (connects.mock.results[index]!.value as Promise<unknown>).then(
          () => 'unexpected-connect',
          (error: unknown) =>
            error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown',
        );
        expect(code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
      }
    }
    console.log(
      'RR_ADMISSION_EVIDENCE ' +
        JSON.stringify({
          profile,
          status: result.status,
          driverConnectCalls: connects.mock.calls.length,
          driverQueryCalls: queries.mock.calls.length,
          driverEndCalls: ends.mock.calls.length,
          misroutedEndpointSqlCalls: misroutedQueries,
          correctSourceEndpointsRead: profile === 'positive' || profile === 'cross-target' ? 2 : 0,
          hostnameCode: code,
          elapsedMs: result.elapsedMs,
          cleanupUnknown: result.cleanupUnknown,
          workUnknown: result.workUnknown,
          backendAbsenceClaim: false,
          rootFallback: false,
          ...evidenceFlags,
        }),
    );
  } finally {
    vi.restoreAllMocks();
  }
});
