import { ok } from '../../../domain/src/values/core.ts';
import type { SourceAdapter, SourceSpec } from '../../../application/src/ports/sources.ts';
import { createNhtsaAdapter, sourceLocation } from './nhtsa.ts';
import { sourceUuid } from './identity.ts';
export async function probeSource(spec: SourceSpec, adapter: SourceAdapter = createNhtsaAdapter()) {
  const pulled = await adapter.pull({
    id: sourceUuid('source_connector', 'compatibility-only'),
    providerId: sourceUuid('provider', 'compatibility-only'),
    licenseId: sourceUuid('license', 'compatibility-only'),
    token: sourceUuid('lease', 'compatibility-only'),
    fence: 1n,
    forceFull: true,
    previous: null,
    spec,
    ...sourceLocation(spec),
  });
  if (!pulled.ok) return pulled;
  if (!pulled.value.changed) throw Error('Unbased source probe');
  const value = pulled.value;
  const families: Record<string, number> = {};
  let rows = 0,
    unknownSummaries = 0,
    maxRowBytes = 0;
  try {
    for await (const frame of value.snapshot.frames()) {
      if ('end' in frame) continue;
      const row = frame.row as { kind: string; record: Record<string, unknown> };
      families[row.kind] = (families[row.kind] ?? 0) + 1;
      rows++;
      if (row.kind === 'recalls' && row.record.summary === null) unknownSummaries++;
      maxRowBytes = Math.max(maxRowBytes, Buffer.byteLength(JSON.stringify(row) + '\n'));
    }
    return ok({
      observedAt: value.snapshot.registration.fetchedAt,
      spec,
      rawFingerprint: value.checksum,
      normalizedChecksum: value.snapshot.registration.checksum,
      rows,
      families,
      unknownSummaries,
      maxRowBytes,
      scope: 'read-only compatibility; no database import, rights or coverage acceptance',
    });
  } finally {
    await value.cleanup();
  }
}
