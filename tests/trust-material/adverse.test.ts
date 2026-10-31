import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { expect, it, vi } from 'vitest';
import { observe, publicPlan } from '../fixtures/tls-admission/observer.ts';
import { evidenceFlags } from '../fixtures/tls-admission/contract.ts';

const profile = process.env.LR01_PROFILE;
const roots = ['root-expired', 'root-future', 'root-nonca'];
const material = ['missing-root', 'missing-leaf', 'extra-file', 'mixed-leaf', 'wrong-key-pair'];

it('observes the fixed root/material control through the unchanged admission reader', async () => {
  expect(['positive', ...roots, ...material]).toContain(profile);
  // These spies count real driver calls; no driver method or response is replaced.
  const connections = vi.spyOn(pg.Client.prototype, 'connect');
  const queries = vi.spyOn(pg.Client.prototype, 'query');
  const endings = vi.spyOn(pg.Client.prototype, 'end');
  try {
    if (profile !== 'missing-root') {
      const pem = readFileSync('/trust/ca.crt');
      const context = JSON.parse(readFileSync('/owners/context.json', 'utf8'));
      expect(createHash('sha256').update(pem).digest('hex')).toBe(context.caSha256);
      const cert = new X509Certificate(pem);
      const now = Date.now();
      if (profile === 'root-expired') {
        expect(cert.ca).toBe(true);
        expect(Date.parse(cert.validTo)).toBeLessThan(now);
      } else if (profile === 'root-future') {
        expect(cert.ca).toBe(true);
        expect(Date.parse(cert.validFrom)).toBeGreaterThan(now);
      } else {
        expect(Date.parse(cert.validFrom)).toBeLessThan(now);
        expect(Date.parse(cert.validTo)).toBeGreaterThan(now);
        expect(cert.ca).toBe(profile !== 'root-nonca');
      }
    } else expect(existsSync('/trust/ca.crt')).toBe(false);

    const result = await observe(publicPlan());
    expect(result).toMatchObject(evidenceFlags);
    expect(result.elapsedMs).toBeLessThan(4000);
    if (profile === 'positive') {
      expect(result).toMatchObject({
        status: 'observed',
        connections: 4,
        ended: 4,
        cleanupUnknown: false,
        workUnknown: false,
      });
      expect(result.observations).toHaveLength(4);
      expect(connections).toHaveBeenCalledTimes(4);
      expect(endings).toHaveBeenCalledTimes(4);
      expect(queries.mock.calls.length).toBeGreaterThan(0);
    } else {
      expect(result).toMatchObject({
        status: 'refused',
        connections: 0,
        ended: 0,
        cleanupUnknown: false,
        workUnknown: false,
        observations: [],
      });
      expect(connections).not.toHaveBeenCalled();
      expect(queries).not.toHaveBeenCalled();
      expect(endings).not.toHaveBeenCalled();
    }
    console.log(
      'LR01_ADMISSION_EVIDENCE ' +
        JSON.stringify({
          profile,
          status: result.status,
          refusalStage:
            profile === 'positive'
              ? null
              : roots.includes(profile!)
                ? 'root-before-driver'
                : profile === 'missing-root'
                  ? 'missing-root-before-driver'
                  : 'custody-before-driver',
          driverConnectCalls: connections.mock.calls.length,
          driverQueryCalls: queries.mock.calls.length,
          driverEndCalls: endings.mock.calls.length,
          elapsedMs: result.elapsedMs,
          cleanupUnknown: result.cleanupUnknown,
          backendAbsenceClaim: false,
          rootFallback: false,
          ...evidenceFlags,
        }),
    );
  } finally {
    vi.restoreAllMocks();
  }
});
