import { expect, it } from 'vitest';
import { createModel, evidenceFlags } from '../fixtures/multitarget-plan/model.ts';
import {
  environment,
  plan,
  bindings,
  json,
  allocationOrder,
  readOrder,
} from '../fixtures/multitarget-plan/samples.ts';

const refusal = /^Synthetic multi-target model refused$/;
const fresh = () => createModel(json(plan()), json(bindings()), environment(), 0);
type Model = ReturnType<typeof createModel>;
function observe(
  model: Model,
  event: unknown,
  now = 1,
  current = json(bindings()),
  env = environment(),
) {
  return model.observe(json(event), now, current, env);
}
function allocate(model: Model, current = json(bindings())) {
  for (const key of allocationOrder)
    observe(model, { type: 'acquire', key, outcome: 'held' }, 1, current);
}
function cleanup(model: Model, now = 3000) {
  for (const key of [...model.receipt().simulatedHeld].reverse())
    observe(model, { type: 'close', key, outcome: 'closed' }, now);
}
function read(model: Model, endpoint: string) {
  observe(model, { type: 'read-start', endpoint });
  observe(model, { type: 'read-complete', endpoint, outcome: 'observed' });
}

it.each([false, true])(
  'models one bounded complete canonical journey for input permutation %s',
  (reverse) => {
    const p = plan(),
      b = bindings();
    if (reverse) {
      p.domains.reverse();
      b.domains.reverse();
    }
    const model = createModel(json(p), json(b), environment(), 0);
    allocate(model);
    for (const endpoint of readOrder) read(model, endpoint);
    expect(model.receipt().disposition).toBe('awaiting_modeled_cleanup');
    cleanup(model);
    const receipt = model.receipt();
    expect(receipt.disposition).toBe('model_evidence_only');
    expect(receipt.simulatedClosed).toEqual([...allocationOrder].reverse());
    expect(receipt.simulatedObservations).toEqual(readOrder);
    expect(receipt.simulatedHeld).toEqual([]);
    expect(receipt).toMatchObject(evidenceFlags);
    expect(() =>
      observe(model, { type: 'acquire', key: allocationOrder[0], outcome: 'held' }, 5001),
    ).toThrow(refusal);
    expect(model.receipt().disposition).toBe('model_evidence_only');
  },
);

it.each(allocationOrder.slice(1))(
  'refuses acquiring %s before the complete preceding common/inner prefix',
  (key) => {
    const model = fresh();
    expect(() => observe(model, { type: 'acquire', key, outcome: 'held' })).toThrow(refusal);
    expect(model.receipt().simulatedHeld).toEqual([]);
    expect(model.receipt().disposition).toBe('model_refused');
  },
);

it.each(
  allocationOrder.flatMap((key) => ['busy', 'unavailable'].map((outcome) => ({ key, outcome }))),
)('refuses $outcome at $key and closes only the modeled acquired prefix', ({ key, outcome }) => {
  const model = fresh();
  const prefix = allocationOrder.slice(0, allocationOrder.indexOf(key));
  for (const held of prefix) observe(model, { type: 'acquire', key: held, outcome: 'held' });
  observe(model, { type: 'acquire', key, outcome });
  expect(model.receipt().simulatedHeld).toEqual(prefix);
  expect(model.receipt().simulatedObservations).toEqual([]);
  cleanup(model);
  expect(model.receipt().disposition).toBe('model_refused');
  expect(model.receipt().simulatedClosed).toEqual([...prefix].reverse());
  expect(model.receipt().simulatedClosed).not.toContain(key);
});

it('refuses an early read and repeated allocation instead of stacking a held key', () => {
  const early = fresh();
  expect(() => observe(early, { type: 'read-start', endpoint: '0/app' })).toThrow(refusal);
  const model = fresh();
  observe(model, { type: 'acquire', key: 'common:0', outcome: 'held' });
  expect(() => observe(model, { type: 'acquire', key: 'common:0', outcome: 'held' })).toThrow(
    refusal,
  );
  expect(model.receipt().simulatedHeld).toEqual(['common:0']);
  cleanup(model);
});

it.each([0, 1])(
  'models loss of coordinator %i while a read completes, without claiming cancellation',
  (slot) => {
    const model = fresh();
    allocate(model);
    read(model, '0/app');
    observe(model, { type: 'read-start', endpoint: '0/cms' });
    observe(model, { type: 'loss', slot });
    expect(model.receipt().disposition).toBe('awaiting_modeled_read');
    expect(model.receipt().simulatedObservations).toEqual([]);
    expect(() => observe(model, { type: 'read-start', endpoint: '1/app' })).toThrow(refusal);
    observe(model, { type: 'read-complete', endpoint: '0/cms', outcome: 'observed' }, 5000);
    expect(model.receipt().lateReadCompletions).toBe(1);
    cleanup(model, 5000);
    expect(model.receipt()).toMatchObject({
      disposition: 'model_refused',
      simulatedObservations: [],
      targetFencing: false,
    });
  },
);

it('keeps an unavailable in-flight outcome distinct from a known modeled completion', () => {
  const model = fresh();
  allocate(model);
  observe(model, { type: 'read-start', endpoint: '0/app' });
  observe(model, { type: 'read-complete', endpoint: '0/app', outcome: 'unavailable' });
  cleanup(model);
  expect(model.receipt()).toMatchObject({
    disposition: 'model_refused',
    simulatedWorkUnknown: true,
    lateReadCompletions: 0,
  });
});

it('refuses foreign or out-of-order cleanup and never expands the owned set', () => {
  const model = fresh();
  observe(model, { type: 'acquire', key: 'common:0', outcome: 'held' });
  observe(model, { type: 'acquire', key: 'common:1', outcome: 'held' });
  expect(() => observe(model, { type: 'close', key: 'inner:1:cms', outcome: 'closed' })).toThrow(
    refusal,
  );
  expect(() => observe(model, { type: 'close', key: 'common:0', outcome: 'closed' })).toThrow(
    refusal,
  );
  expect(model.receipt().simulatedHeld).toEqual(['common:0', 'common:1']);
  cleanup(model);
  expect(model.receipt().simulatedClosed).toEqual(['common:1', 'common:0']);
});

it('records unknown cleanup without issuing a clean modeled result or touching a blocker', () => {
  const model = fresh();
  allocate(model);
  for (const endpoint of readOrder) read(model, endpoint);
  observe(model, { type: 'close', key: 'inner:1:cms', outcome: 'unknown' });
  cleanup(model);
  expect(model.receipt()).toMatchObject({
    disposition: 'model_refused',
    simulatedCleanupUnknown: ['inner:1:cms'],
  });
  expect(model.receipt().simulatedClosed).not.toContain('inner:1:cms');
});

it.each(['containerRef', 'volumeRef', 'credentialGeneration', 'tlsGeneration'] as const)(
  'refuses changed %s before acknowledging another modeled allocation',
  (field) => {
    const model = fresh();
    observe(model, { type: 'acquire', key: 'common:0', outcome: 'held' });
    const changed = bindings();
    changed.domains[1]![field] = field.endsWith('Ref')
      ? changed.domains[1]![field].replace(/2/g, '9')
      : '9'.repeat(32);
    expect(() =>
      observe(model, { type: 'acquire', key: 'common:1', outcome: 'held' }, 2, json(changed)),
    ).toThrow(refusal);
    expect(model.receipt().simulatedHeld).toEqual(['common:0']);
    cleanup(model);
  },
);

it('refuses environment drift before a read yet permits exact owned cleanup under that bad environment', () => {
  const model = fresh();
  allocate(model);
  const bad = { ...environment(), APP_ENV: 'stage-local' };
  expect(() =>
    observe(model, { type: 'read-start', endpoint: '0/app' }, 2, json(bindings()), bad),
  ).toThrow(refusal);
  for (const key of [...allocationOrder].reverse())
    observe(model, { type: 'close', key, outcome: 'closed' }, 3, json(bindings()), bad);
  expect(model.receipt()).toMatchObject({ disposition: 'model_refused', simulatedHeld: [] });
});

it('enforces a whole-attempt deadline without treating timeout as cancellation or forbidding cleanup', () => {
  const model = fresh();
  allocate(model);
  observe(model, { type: 'read-start', endpoint: '0/app' }, 3999);
  observe(model, { type: 'read-complete', endpoint: '0/app', outcome: 'observed' }, 4000);
  expect(model.receipt().lateReadCompletions).toBe(1);
  expect(model.receipt().simulatedObservations).toEqual([]);
  cleanup(model, 5000);
  expect(model.receipt().disposition).toBe('model_refused');
});

it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'refuses an invalid synthetic clock %s',
  (now) => {
    const model = fresh();
    expect(() =>
      observe(model, { type: 'acquire', key: 'common:0', outcome: 'held' }, now),
    ).toThrow(refusal);
  },
);

it('refuses clock regression and mismatched/duplicate read completion', () => {
  const clock = fresh();
  observe(clock, { type: 'acquire', key: 'common:0', outcome: 'held' }, 100);
  expect(() => observe(clock, { type: 'acquire', key: 'common:1', outcome: 'held' }, 99)).toThrow(
    refusal,
  );
  cleanup(clock);
  const model = fresh();
  allocate(model);
  observe(model, { type: 'read-start', endpoint: '0/app' });
  expect(() =>
    observe(model, { type: 'read-complete', endpoint: '1/app', outcome: 'observed' }),
  ).toThrow(refusal);
  observe(model, { type: 'read-complete', endpoint: '0/app', outcome: 'observed' });
  expect(() =>
    observe(model, { type: 'read-complete', endpoint: '0/app', outcome: 'observed' }),
  ).toThrow(refusal);
  cleanup(model);
});

it('refuses extra commands and caps diagnostic growth while leaving exact owned cleanup available', () => {
  const model = fresh();
  observe(model, { type: 'acquire', key: 'common:0', outcome: 'held' });
  for (let i = 0; i < 100; i++)
    expect(() => observe(model, { type: 'execute', sql: 'private', token: 'secret' })).toThrow(
      refusal,
    );
  cleanup(model);
  const receipt = model.receipt();
  expect(receipt.trace.length).toBeLessThanOrEqual(64);
  expect(JSON.stringify(receipt)).not.toMatch(/private|secret/);
  expect(receipt.disposition).toBe('model_refused');
});

it('keeps independent supplied contexts and concurrent model grants explicitly synthetic', () => {
  const first = fresh(),
    second = fresh();
  allocate(first);
  allocate(second); // Negative control: supplied outcomes do not implement actual exclusion.
  expect(first.receipt().simulatedHeld).toEqual(second.receipt().simulatedHeld);
  const suppliedDifferent = bindings();
  suppliedDifferent.domains[0]!.containerRef = 'synthetic-container:' + '9'.repeat(64);
  const third = createModel(json(plan()), json(suppliedDifferent), environment(), 0);
  allocate(third, json(suppliedDifferent));
  for (const model of [first, second, third]) {
    expect(model.receipt()).toMatchObject(evidenceFlags);
    expect(model.receipt().actualSqlConnections).toBe(0);
  }
  console.log(
    'MULTITARGET_PLAN_EVIDENCE ' +
      JSON.stringify({
        scope: 'synthetic-multitarget-plan',
        inputPermutations: 2,
        modeledDomains: 2,
        modeledEndpoints: 4,
        concurrentModelGrants: 2,
        suppliedBindingsAreNotAttestation: true,
        ...evidenceFlags,
      }),
  );
});

it('discards a completed read when its acknowledgment carries a changed binding', () => {
  const model = fresh();
  allocate(model);
  observe(model, { type: 'read-start', endpoint: '0/app' });
  const changed = bindings();
  changed.domains[1]!.tlsGeneration = '9'.repeat(32);
  observe(
    model,
    { type: 'read-complete', endpoint: '0/app', outcome: 'observed' },
    2,
    json(changed),
  );
  expect(model.receipt()).toMatchObject({
    reason: 'binding',
    lateReadCompletions: 1,
    simulatedObservations: [],
  });
  cleanup(model);
  expect(model.receipt().disposition).toBe('model_refused');
});

it('bounds repeated modeled loss events while preserving exact owned cleanup', () => {
  const model = fresh();
  allocate(model);
  for (let i = 0; i < 100; i++) observe(model, { type: 'loss', slot: 0 });
  expect(model.receipt().trace).toHaveLength(64);
  cleanup(model);
  expect(model.receipt()).toMatchObject({
    disposition: 'model_refused',
    simulatedHeld: [],
    simulatedClosed: [...allocationOrder].reverse(),
  });
  expect(model.receipt().trace).toHaveLength(64);
});
