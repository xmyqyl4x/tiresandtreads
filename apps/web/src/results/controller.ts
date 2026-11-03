import { createResultsClient } from '@tt/contracts/results';
import type { OwnerReportView, DraftView } from '@tt/contracts/report-views';
import type { AssessmentRequest } from '../../../../packages/contracts/src/report-inputs.ts';
import { ownerSession } from '../owner-session.ts';
import { assessmentInputSchema } from '../../../../packages/contracts/src/assessment-input.ts';
export interface LoadedReport {
  current: OwnerReportView;
  report: OwnerReportView;
  draft: DraftView | null;
  historical: boolean;
}
export function resultsController(
  origin: string,
  identifier: string,
  send: typeof fetch = fetch,
  key = () => crypto.randomUUID(),
) {
  const id = identifier.toLowerCase(),
    bounded: typeof fetch = (url, init) =>
      send(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) }),
    client = createResultsClient(origin, bounded);
  let loaded: LoadedReport | null = null,
    draftRevision: string | null = null,
    draftBase: number | null = null;
  let session: Promise<{ csrf: string }> | undefined;
  const csrf = () => (session ??= ownerSession(origin, bounded));
  type SaveBody = Parameters<typeof client.save>[1];
  type RefineBody = Parameters<typeof client.refine>[1];
  let saveAttempt: { body: SaveBody; key: string } | null = null,
    refineAttempt: { body: RefineBody; key: string } | null = null;
  let saving: Promise<{ revision: string; input: AssessmentRequest }> | null = null,
    refining: Promise<LoadedReport> | null = null;
  async function load(version?: number): Promise<LoadedReport> {
    const [current, draft, selected] = await Promise.all([
      client.read(id),
      client.draft(id),
      version ? client.read(id, version) : Promise.resolve(null),
    ]);
    loaded = {
      current,
      report: selected ?? current,
      draft,
      historical: !!selected && selected.version !== current.version,
    };
    session = undefined;
    draftRevision = draft?.revision ?? null;
    draftBase = draft?.baseVersion ?? null;
    saveAttempt = null;
    refineAttempt = null;
    return loaded;
  }
  function editable() {
    if (!loaded || loaded.historical) throw Error('Load the current report before editing');
  }
  function writeSave() {
    if (saving) return saving;
    if (!saveAttempt) throw Error('No pending save');
    const attempt = saveAttempt;
    saving = (async () => {
      const r = await client.save(id, attempt.body, (await csrf()).csrf, attempt.key);
      if (
        !r.result_revision ||
        r.report_version !== attempt.body.baseVersion ||
        r.status !== 'accepted'
      )
        throw Error('Invalid draft receipt');
      draftRevision = r.result_revision;
      draftBase = attempt.body.baseVersion;
      saveAttempt = null;
      return { revision: r.result_revision, input: attempt.body.input };
    })().finally(() => {
      saving = null;
    });
    return saving;
  }
  function save(input: AssessmentRequest) {
    editable();
    input = assessmentInputSchema.parse(input);
    if (refineAttempt) throw Error('Resolve the pending refinement first');
    if (saveAttempt && JSON.stringify(saveAttempt.body.input) !== JSON.stringify(input))
      throw Error('Retry or reload the unconfirmed save before changing its request');
    saveAttempt ??= {
      body: { baseVersion: loaded!.current.version, expectedRevision: draftRevision, input },
      key: key(),
    };
    return writeSave();
  }
  function refine(): Promise<LoadedReport> {
    editable();
    if (refining) return refining;
    if (saveAttempt || !draftRevision || draftBase !== loaded!.current.version)
      throw Error('Confirm the current draft before refining');
    refineAttempt ??= {
      body: {
        baseVersion: loaded!.current.version,
        draftRevision,
        expectedRevision: loaded!.current.revision,
      },
      key: key(),
    };
    const attempt = refineAttempt;
    refining = (async () => {
      const r = await client.refine(id, attempt.body, (await csrf()).csrf, attempt.key);
      if (r.status !== 'created' || r.report_version !== attempt.body.baseVersion + 1)
        throw Error('Invalid refinement receipt');
      return load(r.report_version);
    })().finally(() => {
      refining = null;
    });
    return refining;
  }
  return { load, save, retrySave: writeSave, refine };
}
export function reportRoute(search: string) {
  const q = new URLSearchParams(search),
    id = q.get('report') ?? '',
    v = q.get('version');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
    (v !== null && (!/^[1-9]\d{0,9}$/.test(v) || Number(v) > 2147483647))
  )
    return null;
  return { id: id.toLowerCase(), ...(v ? { version: Number(v) } : {}) };
}
export function reportUrl(id: string, version?: number) {
  const q = new URLSearchParams({ report: id });
  if (version !== undefined) q.set('version', String(version));
  if (!reportRoute('?' + q)) throw Error('Invalid report route');
  return '/preview/report?' + q;
}

export function assessmentSignature(input: AssessmentRequest) {
  const checked = assessmentInputSchema.safeParse(input);
  return JSON.stringify(checked.success ? checked.data : input);
}
