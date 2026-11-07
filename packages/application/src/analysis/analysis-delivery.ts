import { createDeliveryServices } from '../services/delivery.ts';
import { demand, serviceFailure } from '../services/service-work.ts';
import { canonical, exact } from '../services/service-records.ts';
import { fail, revision } from '../../../domain/src/values/core.ts';
import type { AnalysisFallback, FrozenAnalysis } from '../../../domain/src/analysis-delivery.ts';
import type { AnalysisDeliveryRepository } from '../ports/analysis-lifecycle.ts';
import type { DeliveryDocument, DeliveryWorkRepository } from '../ports/delivery-services.ts';
type Base = Parameters<typeof createDeliveryServices>[0];
function identity(s: FrozenAnalysis) {
  return s.mode === 'none'
    ? { schema: 1, mode: s.mode, fallback: s.fallback }
    : {
        schema: 1,
        mode: s.mode,
        attachmentRevision: s.attachmentRevision,
        artifactHash: s.artifactHash,
      };
}
// Opt-in composition. The P1 snapshot stores selection identity; the separate immutable
// private binding owns AI content and can be purged without altering retained report facts.
export function createAnalysisDeliveryServices(
  d: Base & { readonly analysis: AnalysisDeliveryRepository },
) {
  function dispatchWork(): DeliveryWorkRepository {
    return {
      ...d.work,
      async acquire(tx, id) {
        const l = await d.work.acquire(tx, id);
        if (!l) return null;
        const selected = await d.analysis.selection(tx, id);
        const meta = (l.document as DeliveryDocument & { analysisIdentity?: unknown })
          .analysisIdentity;
        demand(canonical(meta, 4096) === canonical(identity(selected), 4096), 'integrity');
        const document = { ...l.document, analysis: selected };
        demand(
          new TextEncoder().encode(JSON.stringify(document)).length <= 524288,
          'invalid_input',
        );
        return { ...l, document };
      },
      async permission(tx, l) {
        const r = await d.work.permission(tx, l);
        demand(await d.analysis.permitted(tx, l.id), 'forbidden');
        return r;
      },
    };
  }
  const base = createDeliveryServices({ ...d, work: dispatchWork() });
  return Object.freeze({
    ...base,
    async request(
      keys: Parameters<typeof base.request>[0],
      command: string,
      raw: Parameters<typeof base.request>[2] & { readonly analysis: unknown },
    ) {
      try {
        const { analysis, ...input } = raw;
        const selected = exact(analysis, 'attachmentRevision,fallback');
        const parsed =
          selected.attachmentRevision === null ? null : revision(selected.attachmentRevision);
        demand(parsed === null || (parsed.ok && parsed.value > 0n));
        const rev = parsed?.ok ? parsed.value.toString() : null;
        demand((rev === null) !== (selected.fallback === null));
        demand(
          selected.fallback === null ||
            ['not_requested', 'unavailable', 'declined', 'expired'].includes(
              String(selected.fallback),
            ),
        );
        const choice = Object.freeze({
          revision: rev,
          fallback: selected.fallback as AnalysisFallback | null,
        });
        const contacts: Base['contacts'] = {
          request: (...args) => {
            const [k, c, body, hooks] = args;
            demand(hooks, 'integrity');
            return d.contacts.request(k, c, body, {
              ...hooks,
              fingerprint: canonical({ legacy: hooks.fingerprint, analysis: choice }, 8192),
            });
          },
        };
        const work: DeliveryWorkRepository = {
          ...dispatchWork(),
          async capture(tx, i) {
            demand(i.send.reportId && i.send.reportVersion, 'integrity');
            const frozen = await d.analysis.capture(tx, {
              sendId: i.send.id,
              ownerId: i.owner.subjectId,
              reportId: i.send.reportId,
              version: i.send.reportVersion,
              revision: choice.revision,
              fallback: choice.fallback,
            });
            const document = { ...i.document, analysisIdentity: identity(frozen) };
            demand(
              new TextEncoder().encode(JSON.stringify({ ...document, analysis: frozen })).length <=
                524288,
              'invalid_input',
            );
            await d.work.capture(tx, { ...i, document });
          },
        };
        return createDeliveryServices({ ...d, contacts, work }).request(keys, command, input);
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
  });
}
