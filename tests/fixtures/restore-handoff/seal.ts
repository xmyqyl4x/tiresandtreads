import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { canonical } from '../../../packages/application/src/services/service-records.ts';
import { createFilePrivacyJournal } from '../../../packages/integrations/src/privacy-journal.ts';
import { databaseRoles } from '../../../packages/config/src/database-roles.ts';
import { custodyCrypto } from '../recovery/custody-common.ts';
import { context as recoveryContext, readEvidence } from '../recovery/context.ts';
import { context, publicPlan, settings } from '../multitarget-coordination/transport.ts';
import { within } from '../io-inspection/budget.ts';
import { guard, bindings, inspectFour } from './common.ts';
import { admitSeal, type Current, type Seal } from './contract.ts';

guard();
async function seal() {
  const result = readEvidence<{
    applicationReplay: boolean;
    snapshotDataParity: boolean;
    idempotent: boolean;
    productAccessOpened: boolean;
  }>('result');
  if (
    !result.applicationReplay ||
    !result.snapshotDataParity ||
    !result.idempotent ||
    result.productAccessOpened
  )
    throw Error('Actual restore/replay evidence required');
  const maintenanceClosedAt = Date.now(),
    c = context(publicPlan());
  let closed = 0,
    failedSourcePasswords = 0;
  for (const e of c.endpoints) {
    const db = new pg.Client(settings(c, e.slot, e.kind, 'tt-restore-closure'));
    try {
      await db.connect();
      const roles = Object.values(databaseRoles).flat();
      const active = (
        await db.query(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND usename=ANY($1) AND usename<>current_user',
          [roles],
        )
      ).rows[0].n;
      if (active !== 0) throw Error('Maintenance still active');
      closed++;
    } finally {
      await within(db.end(), 750);
    }
    if (e.slot === 1) {
      const bad = new pg.Client({
        ...settings(c, e.slot, e.kind, 'tt-restore-source-password'),
        password: recoveryContext('postgres').passwords[`tt_${e.kind}_migrator`],
      });
      let denied = false;
      try {
        await bad.connect();
      } catch (error) {
        denied = (error as { code?: string }).code === '28P01';
      } finally {
        await within(bad.end(), 750);
      }
      if (!denied) throw Error('Fresh target credential check refused');
      failedSourcePasswords++;
    }
  }
  const observations = await inspectFour(),
    crypto = custodyCrypto();
  const observedAt = new Date().toISOString();
  const journal = crypto.verify(
    await createFilePrivacyJournal('/custody-journal', crypto).capture(observedAt),
  ) as { entries: unknown[] };
  if (!Array.isArray(journal.entries) || !journal.entries.length)
    throw Error('Current privacy checkpoint absent');
  const checkpoint: Current = {
    version: 1,
    project: c.project,
    generation: c.generation,
    digest: createHash('sha256').update(canonical(journal.entries, 2097152)).digest('hex'),
    observedAt,
    backupFinishedAt: readEvidence<{ finishedAt: string }>('backup-window').finishedAt,
  };
  const record: Seal = {
    version: 1,
    phase: 'maintenance-closed',
    ...bindings(),
    maintenanceClosedAt,
    setup: { appRestored: true, cmsRestored: true, privacyReplayed: true, maintenanceClosed: true },
    checkpoint,
    observations,
  };
  admitSeal(JSON.stringify(record), bindings(), Date.now());
  writeFileSync('/handoff-meta/seal.json', JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  writeFileSync('/handoff-current/current.json', JSON.stringify(checkpoint), {
    mode: 0o600,
    flag: 'wx',
  });
  console.log(
    'RESTORE_HANDOFF_SEAL ' +
      JSON.stringify({
        phase: 'maintenance-closed',
        restoreExecuted: true,
        privacyReplayExecuted: true,
        maintenanceClosed: true,
        closedEndpoints: closed,
        rejectedSourcePasswords: failedSourcePasswords,
        actualAcceptance: false,
        productActivation: false,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}
seal().catch(() => {
  console.error('Restore handoff phase seal refused');
  process.exitCode = 1;
});
