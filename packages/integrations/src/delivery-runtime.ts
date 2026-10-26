import type { createTransactions } from '../../db/src/transactions.ts';
import type {
  ContactCrypto,
  ContactEncryption,
  ContactPolicy,
} from '../../application/src/ports/contact-services.ts';
import type {
  DeliveryPolicy,
  ReportRenderer,
  MailProvider,
} from '../../application/src/ports/delivery-services.ts';
import type { PrivateObjects } from '../../application/src/ports/assets.ts';
import { createContactRuntime } from './contact-runtime.ts';
import { createDeliveryFiles, deliveryChecksum } from './delivery-files.ts';
import { createDeliveryServices } from '../../application/src/services/delivery.ts';
import { createDeliveryWorkRepository } from '../../db/src/repositories/delivery-work.ts';
import { createDeliveryRepository } from '../../db/src/repositories/delivery.ts';
import { createOwnerRepository } from '../../db/src/repositories/owners.ts';
import { createReportRepository } from '../../db/src/repositories/reports.ts';
import { createReliabilityRepository } from '../../db/src/repositories/reliability.ts';
import { ok } from '../../domain/src/values/core.ts';
import { rid, text } from '../../db/src/repositories/private-values.ts';
type Scope = ReturnType<typeof createTransactions>;
export async function createDeliveryRuntime(o: {
  readonly privateScope: Scope;
  readonly assetScope: Scope;
  readonly crypto: ContactCrypto;
  readonly encryption: ContactEncryption;
  readonly contactPolicy: ContactPolicy;
  readonly policy: DeliveryPolicy;
  readonly renderer: ReportRenderer;
  readonly provider: MailProvider;
  readonly objects: PrivateObjects;
  readonly bucket: string;
  readonly keyVersion: string;
  readonly now: () => string;
}) {
  for (const [scope, role] of [
    [o.privateScope, 'tt_private_runtime'],
    [o.assetScope, 'tt_asset_runtime'],
  ] as const) {
    const r = await scope.unitOfWork.run(async (tx) =>
      ok((await scope.query(tx, 'SELECT current_user AS role')).rows[0]?.role),
    );
    if (!r.ok || r.value !== role) throw Error('Invalid delivery runtime role');
  }
  const s = o.privateScope,
    contacts = await createContactRuntime({
      scope: s,
      crypto: o.crypto,
      encryption: o.encryption,
      policy: o.contactPolicy,
      now: o.now,
    });
  const reserved = await s.unitOfWork.run(async (tx) => {
    const rows = (
      await s.query(
        tx,
        `SELECT w.send_id,w.pdf_asset_id,w.payload_asset_id FROM email.delivery_work w JOIN email.email_sends e ON e.id=w.send_id WHERE e.anonymized_at IS NULL AND (SELECT count(*) FROM email.delivery_asset_reservations a WHERE a.send_id=w.send_id)<>2 ORDER BY w.send_id LIMIT 101`,
      )
    ).rows;
    if (rows.length > 100)
      throw Error('Delivery reservation backfill requires bounded operator batches');
    for (const row of rows)
      for (const [purpose, id] of [
        [
          'report_pdf',
          row.pdf_asset_id === null
            ? o.crypto.id('asset', text(row.send_id) + ':pdf')
            : rid('asset', row.pdf_asset_id),
        ],
        [
          'email_payload',
          row.payload_asset_id === null
            ? o.crypto.id('asset', text(row.send_id) + ':payload')
            : rid('asset', row.payload_asset_id),
        ],
      ] as const)
        await s.query(
          tx,
          `INSERT INTO email.delivery_asset_reservations(send_id,asset_id,purpose) VALUES($1,$2,$3) ON CONFLICT(send_id,purpose) DO NOTHING`,
          [row.send_id, id, purpose],
        );
    return ok(null);
  });
  if (!reserved.ok) throw Error('Invalid delivery reservation recovery');
  return createDeliveryServices({
    uow: s.unitOfWork,
    owners: createOwnerRepository(s),
    reports: createReportRepository(s),
    contacts,
    delivery: createDeliveryRepository(s),
    work: createDeliveryWorkRepository(s, o.contactPolicy, o.crypto.lookupVersions),
    reliability: createReliabilityRepository(s),
    crypto: o.crypto,
    encryption: o.encryption,
    files: createDeliveryFiles({
      scope: o.assetScope,
      objects: o.objects,
      bucket: o.bucket,
      keyVersion: o.keyVersion,
    }),
    renderer: o.renderer,
    provider: o.provider,
    policy: o.policy,
    checksum: deliveryChecksum,
    now: o.now,
  });
}
