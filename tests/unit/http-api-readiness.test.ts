import { it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { localApiReadiness } from '../../scripts/contracts/api-readiness.mjs';
import { localApiDocument } from '../../scripts/contracts/local-api.mjs';
it('classifies every bound endpoint exactly once with explicit service, actor, schema and use case', () => {
  const r = localApiReadiness(),
    ops = Object.values(localApiDocument().paths)
      .flatMap((x) => Object.values(x))
      .map((x) => (x as { operationId: string }).operationId);
  expect(r.inventory).toHaveLength(65);
  expect(new Set(r.inventory.map((x) => x.operationId)).size).toBe(65);
  expect(r.inventory.map((x) => x.operationId).sort()).toEqual(ops.sort());
  for (const row of r.inventory) {
    expect(row.service).toBeTruthy();
    expect(row.useCases.length).toBeGreaterThan(0);
    expect(['owner', 'staff', 'public', 'capability', 'callback']).toContain(row.actor);
    expect(row.requestSchema).toBeTruthy();
    expect(row.responseSchema).toBeTruthy();
    expect(existsSync(row.databaseProof)).toBe(true);
  }
});
it('publishes reproducible local contracts, client artifacts and explicit remaining acceptance inputs', () => {
  const r = localApiReadiness();
  expect(JSON.parse(readFileSync('docs/api/local-v1.inventory.json', 'utf8'))).toEqual(r);
  expect(r.clients.every((p) => existsSync(p))).toBe(true);
  expect(r).toMatchObject({
    S3Accepted: false,
    S4Accepted: false,
    G0Accepted: false,
    publicActivation: false,
    hostedProvisioning: false,
    purchases: false,
    actualNotifications: false,
  });
  const register = JSON.parse(
    readFileSync('docs/implementation/evidence/P1/s3-service-register.json', 'utf8'),
  );
  expect(register.gates).toHaveLength(6);
  expect(
    register.gates.every(
      (g: { status: string; records: unknown[] }) =>
        g.status === 'pending' && g.records.length === 0,
    ),
  ).toBe(true);
});
it('keeps future AI, photos, partner and product-screen routes outside the Phase 1 local transport', () => {
  expect(
    localApiReadiness().inventory.every((x) => !/(photos|analyses|partners)/.test(x.path)),
  ).toBe(true);
  expect(localApiReadiness().remainingAcceptance).toHaveLength(8);
});
