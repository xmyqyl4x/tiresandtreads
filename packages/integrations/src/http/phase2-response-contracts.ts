import { presentationP2Operations } from '../../../contracts/src/phase2-presentation-client.ts';
import { reviewP2Operations } from '../../../contracts/src/phase2-review-client.ts';
import { ownerP2Operations } from '../../../contracts/src/phase2-owner-client.ts';
import { partnerP2Operations } from '../../../contracts/src/phase2-partner-client.ts';
import { staffP2Operations } from '../../../contracts/src/phase2-staff-client.ts';
import { HttpFailure, HttpSuccess, type HttpRoute } from './core.ts';
import { ok } from '../../../domain/src/values/core.ts';
const definitions = {
  ...ownerP2Operations,
  ...partnerP2Operations,
  ...staffP2Operations,
  ...reviewP2Operations,
  ...presentationP2Operations,
};
// Explicit local composition helper; never installs routes or changes the default host.
// Contract drift fails at composition; malformed private output fails before serialization.
export function validateP2Routes(routes: readonly HttpRoute[]): readonly HttpRoute[] {
  const seen = new Set<string>();
  return routes.map((r) => {
    if (seen.has(r.operationId)) throw Error('Duplicate operation');
    seen.add(r.operationId);
    if (!r.operationId.startsWith('p2')) return r;
    const d = definitions[r.operationId as keyof typeof definitions];
    if (
      !d ||
      ['path', 'method', 'access', 'command', 'bodyMode', 'bodyContentType', 'maxBodyBytes'].some(
        (key) => r[key as keyof HttpRoute] !== d.contract[key as keyof typeof d.contract],
      )
    )
      throw Error('Phase2 route contract drift');
    return {
      ...r,
      handle: async (context) => {
        const result = await r.handle(context);
        if (!result.ok) return result;
        const data = result.value instanceof HttpSuccess ? result.value.data : result.value;
        try {
          const json = JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
          if (Buffer.byteLength(json) > 2097152) throw Error('Bounded private reply required');
          const parsed = d.output.parse(JSON.parse(json));
          return ok(
            result.value instanceof HttpSuccess
              ? new HttpSuccess(result.value.status, parsed)
              : parsed,
          );
        } catch {
          throw new HttpFailure(503, 'unavailable');
        }
      },
    };
  });
}
