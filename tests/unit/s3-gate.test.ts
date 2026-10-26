import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { evaluateServiceGate, inspectServiceRegister } from '../../scripts/verify/s3.mjs';
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const register = () => read('docs/implementation/evidence/P1/s3-service-register.json'),
  packet = () => read('docs/implementation/evidence/P1/p1-pr-017-golden-review.json');
it('validates every service module while keeping actual provider/specialist and host acceptance open', () => {
  const report = inspectServiceRegister();
  expect(report).toMatchObject({
    accepted: false,
    endpointImplementationAllowed: false,
    publicActivation: false,
    draftGoldenScenarios: 98,
    actualSpecialistReviews: 0,
  });
  expect(report.modules.length).toBeGreaterThan(20);
  expect(report.pendingGates).toContain('S3-service-host');
});
it('rejects a CI-green or owner deferral being substituted for actual S3 acceptance', () => {
  for (const key of ['acceptanceRequested', 'endpointImplementationAllowed', 'publicActivation'])
    expect(() => evaluateServiceGate({ ...register(), [key]: true }, packet())).toThrow();
  const r = register();
  r.gates[0].status = 'accepted';
  r.gates[0].records = [{ kind: 'human_review', reviewer: 'placeholder', path: 'synthetic' }];
  expect(() => evaluateServiceGate(r, packet())).toThrow('specialist');
});
it('rejects missing/duplicate gates and accepted provider rows with synthetic or absent evidence', () => {
  const r = register();
  expect(() => evaluateServiceGate({ ...r, gates: r.gates.slice(1) }, packet())).toThrow();
  r.gates[1].status = 'accepted';
  r.gates[1].records = [{ kind: 'fixture', reviewer: 'fixture', path: 'synthetic' }];
  expect(() => evaluateServiceGate(r, packet())).toThrow('scoped evidence');
  expect(() => evaluateServiceGate(r, { ...packet(), scenarioCount: 1 })).toThrow('packet');
});
it('makes the strict acceptance command fail while the valid inventory command succeeds', () => {
  const result = spawnSync(process.execPath, ['scripts/verify/s3.mjs', '--require-accepted'], {
    encoding: 'utf8',
  });
  expect(result.status).toBe(2);
  expect(result.stdout).toContain('"accepted":false');
  expect(result.stderr).toBe('');
});
it('can accept a fully evidenced in-memory predicate without altering any real review record', () => {
  const r = register(),
    p = packet();
  r.acceptanceRequested = true;
  r.endpointImplementationAllowed = true;
  for (const gate of r.gates) {
    gate.status = 'accepted';
    gate.records = [
      { kind: gate.kind, reviewer: 'Synthetic predicate only', path: 'not-a-real-proof' },
    ];
  }
  p.reviewStatus = 'accepted';
  for (const scenario of p.scenarios.slice(0, 50))
    scenario.specialistReview = {
      status: 'accepted',
      reviewer: 'Synthetic predicate only',
      reviewedAt: '2026-10-26T00:00:00.000Z',
    };
  expect(evaluateServiceGate(r, p)).toMatchObject({
    accepted: true,
    endpointImplementationAllowed: true,
    actualSpecialistReviews: 50,
  });
  for (const reviewedAt of ['', 'not-a-date', '2026-02-30T00:00:00.000Z']) {
    const malformed = structuredClone(p);
    malformed.scenarios[0].specialistReview.reviewedAt = reviewedAt;
    expect(() => evaluateServiceGate(r, malformed)).toThrow('specialist');
  }
  const duplicate = structuredClone(p);
  duplicate.scenarios[1].id = duplicate.scenarios[0].id;
  expect(() => evaluateServiceGate(r, duplicate)).toThrow('packet');
  const relabeled = structuredClone(r);
  relabeled.gates[1].kind = 'fixture';
  relabeled.gates[1].records[0].kind = 'fixture';
  expect(() => evaluateServiceGate(relabeled, p)).toThrow('evidence state');
  const unnamed = structuredClone(r);
  unnamed.gates[1].records[0].reviewer = '  ';
  expect(() => evaluateServiceGate(unnamed, p)).toThrow('scoped evidence');
  expect(() => evaluateServiceGate({ ...r, acceptanceRequested: 'true' as never }, p)).toThrow();
  expect(inspectServiceRegister().actualSpecialistReviews).toBe(0);
});
