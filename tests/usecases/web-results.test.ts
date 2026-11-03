import { it, expect } from 'vitest';
import { resultsController } from '../../apps/web/src/results/controller.ts';
import { engineFixture, uuid } from '../fixtures/engine/base.ts';
import { normalizeAssessment } from '../../packages/engine/src/input.ts';
import { evaluate } from '../../packages/engine/src/evaluate.ts';
import { ownerReport } from '../../packages/application/src/services/report-records.ts';
const id = uuid(700),
  requestId = uuid(1);
function fixture(
  options: { lostSave?: boolean; lostRefine?: boolean; conflict?: boolean; draft?: boolean } = {},
) {
  const f = engineFixture(),
    n = normalizeAssessment(f.request);
  if (!n.ok) throw Error('fixture');
  const e = evaluate(n.value, f.snapshot);
  if (!e.ok) throw Error('fixture');
  const output = ownerReport(
    JSON.parse(
      JSON.stringify({ result: e.value, evidence: f.snapshot, prices: [], products: [] }, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    ),
  );
  let version = 1,
    draft = options.draft
      ? {
          baseVersion: 1,
          schemaVersion: 1,
          revision: '1',
          input: f.request,
          expiresAt: '2200-01-01T00:00:00.000Z',
        }
      : null,
    saves = 0,
    refinements = 0,
    lostSave = options.lostSave,
    lostRefine = options.lostRefine;
  const keys: { operation: string; key: string; body: unknown }[] = [],
    seen = new Map<string, unknown>();
  const send: typeof fetch = async (u, init = {}) => {
    const url = new URL(String(u)),
      reply = (data: unknown) => Response.json({ data, requestId });
    if (url.pathname.endsWith('/sessions/current')) return reply({ csrf: 'a'.repeat(64) });
    if (!init.method && url.pathname.endsWith('/draft')) return reply({ reportId: id, draft });
    if (!init.method)
      return reply({
        reportId: id,
        version: Number(url.searchParams.get('version') ?? version),
        revision: String(version),
        input: draft?.input ?? f.request,
        output,
        diff: null,
        safety: {
          checkedAt: f.snapshot.asOf,
          status: 'review_required',
          matched: [],
          unresolved: true,
        },
      });
    const operation = url.pathname.split('/').at(-1)!,
      key = new Headers(init.headers).get('idempotency-key')!,
      body = JSON.parse(String(init.body));
    keys.push({ operation, key, body });
    if (seen.has(key)) return reply(seen.get(key));
    if (options.conflict)
      return Response.json(
        {
          code: 'conflict',
          messageKey: 'errors.conflict',
          fieldErrors: {},
          retryable: false,
          requestId,
        },
        { status: 409 },
      );
    const receipt = {
      schema_version: 1,
      resource_id: id,
      report_id: id,
      status: operation === 'draft' ? 'accepted' : 'created',
      report_version: operation === 'draft' ? version : version + 1,
      ...(operation === 'draft' ? { result_revision: String(saves + 1) } : {}),
    };
    seen.set(key, receipt);
    if (operation === 'draft') {
      saves++;
      draft = {
        baseVersion: version,
        schemaVersion: 1,
        revision: String(saves),
        input: body.input,
        expiresAt: '2200-01-01T00:00:00.000Z',
      };
      if (lostSave) {
        lostSave = false;
        throw Error('lost save ack');
      }
    } else {
      refinements++;
      version++;
      draft = null;
      if (lostRefine) {
        lostRefine = false;
        throw Error('lost refine ack');
      }
    }
    return reply(receipt);
  };
  return { send, keys, counts: () => ({ saves, refinements }), request: f.request };
}
it('loads independent views, restores saved drafts and keeps historical versions read-only', async () => {
  const f = fixture({ draft: true }),
    c = resultsController('http://127.0.0.1:8380', id, f.send);
  expect((await c.load()).draft?.revision).toBe('1');
  await c.save({ ...f.request, priorities: ['noise'] });
  await c.refine();
  const historical = await c.load(1);
  expect(historical.historical).toBe(true);
  expect(() => c.save(f.request)).toThrow();
});
it('retries an uncertain save with the original key and expected revision before accepting changed answers', async () => {
  const f = fixture({ lostSave: true }),
    c = resultsController('http://127.0.0.1:8380', id, f.send, () => uuid(f.keys.length + 800));
  await c.load();
  await expect(c.save({ ...f.request, priorities: ['comfort'] })).rejects.toThrow();
  expect(() => c.save({ ...f.request, priorities: ['noise'] })).toThrow();
  await c.retrySave();
  expect(f.counts().saves).toBe(1);
  expect(f.keys[0]).toEqual(f.keys[1]);
  await c.save({ ...f.request, priorities: ['noise'] });
  expect((f.keys.at(-1)!.body as { expectedRevision: string }).expectedRevision).toBe('1');
});
it('retries refinement exactly once after a lost committed acknowledgment', async () => {
  const f = fixture({ lostRefine: true }),
    c = resultsController('http://127.0.0.1:8380', id, f.send);
  await c.load();
  await c.save(f.request);
  await expect(c.refine()).rejects.toThrow();
  const v = await c.refine();
  expect(v.report.version).toBe(2);
  expect(f.counts().refinements).toBe(1);
  const calls = f.keys.filter((x) => x.operation === 'refine');
  expect(calls[0]).toEqual(calls[1]);
});
it('surfaces a conflict without issuing a blind overwrite or refinement', async () => {
  const f = fixture({ conflict: true }),
    c = resultsController('http://127.0.0.1:8380', id, f.send);
  await c.load();
  await expect(c.save(f.request)).rejects.toMatchObject({ code: 'conflict' });
  expect(() => c.refine()).toThrow();
  expect(f.counts()).toEqual({ saves: 0, refinements: 0 });
  expect(f.keys).toHaveLength(1);
});
