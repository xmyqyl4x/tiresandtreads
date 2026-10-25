import { createHash } from 'node:crypto';
import { instant } from '../../../domain/src/values/core.ts';
import type { SourceIdentity } from '../../../application/src/ports/sources.ts';
import type { ImportFact } from '../../../application/src/ports/import-service.ts';
function date(x: string, required = false) {
  if (!x.trim() && !required) return null;
  if (!/^\d{8}$/.test(x)) throw Error('Recall date');
  const value = x.slice(0, 4) + '-' + x.slice(4, 6) + '-' + x.slice(6);
  if (!instant(value + 'T00:00:00.000Z').ok) throw Error('Recall date');
  return value;
}
export async function* recallFacts(
  lines: AsyncIterable<string>,
  identity: SourceIdentity,
): AsyncGenerator<ImportFact> {
  const campaigns = new Map<string, string>(),
    targets = new Set<string>();
  let scanned = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (++scanned > 1000000) throw Error('Recall row bound');
    const c = line.split('\t').map((v) => v.trim());
    if (c.length !== 29) throw Error('Recall schema');
    if (!['V', 'E', 'C', 'T', 'I', 'X'].includes(c[10]!)) throw Error('Recall product type');
    if (c[10] !== 'T') continue;
    if (
      !/^[0-9]{1,9}$/.test(c[0]!) ||
      !/^[A-Z0-9]{1,12}$/.test(c[1]!) ||
      targets.has(c[0]!) ||
      targets.size >= 45000
    )
      throw Error('Recall identity');
    targets.add(c[0]!);
    const campaign = c[1]!,
      recallId = identity.record('recall', campaign);
    if (
      c[19]!.length > 6000 ||
      c[20]!.length > 2000 ||
      c[21]!.length > 6000 ||
      !['Yes', 'No', ''].includes(c[27]!) ||
      !['Yes', 'No', ''].includes(c[28]!)
    )
      throw Error('Recall safety schema');
    const count = c[11] ? (/^\d{1,9}$/.test(c[11]) ? BigInt(c[11]) : null) : null;
    if (c[11] && count === null) throw Error('Recall count');
    const announced = date(c[15]!, true)!,
      from = date(c[8]!),
      to = date(c[9]!);
    if (from && to && from > to) throw Error('Recall interval');
    const signature = createHash('sha256')
      .update(JSON.stringify([campaign, announced, c[5], c[19], c[20], c[21], c[11]]))
      .digest('hex');
    if (campaigns.has(campaign) && campaigns.get(campaign) !== signature)
      throw Error('Conflicting recall campaign');
    if (!campaigns.has(campaign)) {
      campaigns.set(campaign, signature);
      yield {
        kind: 'recalls',
        record: {
          id: recallId,
          authority: 'NHTSA',
          recallNumber: campaign,
          announcedOn: null,
          reportReceivedOn: announced,
          status: 'reported',
          sourceUrl: 'https://www.nhtsa.gov/recalls?nhtsaId=' + campaign,
          summary: c[19] || null,
          productType: 'tire',
          manufacturerEntityId: null,
          componentCode: null,
          consequence: c[20] || null,
          remedy: c[21] || null,
          manufacturerCampaignNumber: c[5] || null,
          affectedCount: count,
          sourceUpdatedAt: null,
          sourceRecordKey: 'recall:' + campaign,
        },
      };
    }
    yield {
      kind: 'recallSourceTargets',
      record: {
        id: identity.record('recall_source_target', c[0]!),
        recallId,
        targetKey: c[0]!,
        brandName: c[2] || null,
        productName: c[3] || null,
        sizeText: null,
        dotPattern: null,
        manufacturedFrom: from,
        manufacturedTo: to,
        matchStatus: 'unresolved',
        schemaVersion: 1,
        doNotDrive: c[27] ? c[27] === 'Yes' : null,
        parkOutside: c[28] ? c[28] === 'Yes' : null,
        sourceDetails: {
          recordId: c[0]!,
          modelYear: c[4]!,
          manufacturer: c[7]!,
          manufacturerText: c[14]!,
          component: c[6]!,
          componentId: c[23]!,
          componentName: c[24]!,
          componentDescription: c[25]!,
          componentPartNumber: c[26]!,
          reportReceivedOn: announced,
        },
      },
    };
  }
  if (targets.size === 0) throw Error('Empty tire recall coverage');
}
