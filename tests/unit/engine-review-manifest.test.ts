import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { engineFixture, uuid } from '../fixtures/engine/base.ts';
import { goldenScenarios } from '../fixtures/engine/scenarios.ts';
it('keeps the pending specialist packet tied to authored inputs, versions and expected outcomes', () => {
  const packet = JSON.parse(
    readFileSync('docs/implementation/evidence/P1/p1-pr-017-golden-review.json', 'utf8'),
  );
  expect(packet.reviewStatus).toBe('pending');
  expect(packet.scenarioCount).toBeGreaterThanOrEqual(50);
  expect(packet.scenarioCount).toBe(goldenScenarios.length);
  goldenScenarios.forEach((s, i) => {
    const f = engineFixture();
    s.change(f);
    const row = packet.scenarios[i];
    const hash = createHash('sha256')
      .update(JSON.stringify(f, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)))
      .digest('hex');
    expect(row).toMatchObject({
      id: 'G' + String(i + 1).padStart(3, '0'),
      name: s.name,
      fixtureSha256: hash,
      engineVersion: '1.0.0',
      ruleVersionId: f.snapshot.policy.id,
      policyVersion: f.snapshot.policy.version,
      scoringVersion: f.snapshot.policy.scoringVersion,
      specialistReview: { status: 'pending', reviewer: null, reviewedAt: null },
    });
    expect(row.expected.status).toBe(s.status ?? 'eligible');
    expect(row.expected.primaryPlanId).toBe(uuid(101));
    expect(row.expected.picks).toEqual(
      s.picks ?? ((s.status ?? 'eligible') === 'eligible' ? [uuid(101)] : []),
    );
  });
});
