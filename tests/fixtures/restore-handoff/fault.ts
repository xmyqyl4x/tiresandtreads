import { chmodSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonical } from '../../../packages/application/src/services/service-records.ts';
import { createFilePrivacyJournal } from '../../../packages/integrations/src/privacy-journal.ts';
import { context, connect } from '../recovery/context.ts';
import { custodyCrypto, custodySubject } from '../recovery/custody-common.ts';
import { subjectId } from '../populated-preservation/contract.ts';
import { guard, profile, inspectFour } from './common.ts';
import { readBounded } from './files.ts';
import type { Seal, Current } from './contract.ts';
guard();
async function fault() {
  const p = profile(),
    seal = JSON.parse(readBounded('/handoff-meta/seal.json', 65536, 'metadata')) as Seal;
  if (['app-history', 'cms-history', 'target-row', 'source-row', 'quarantine'].includes(p)) {
    const kind = p === 'cms-history' ? 'cms' : 'app',
      host = p === 'source-row' ? 'postgres' : 'recovery-postgres';
    const db = await connect(context(host).url(kind));
    try {
      if (p === 'app-history')
        await db.query("UPDATE migration_meta.applied SET sha256=repeat('0',64) WHERE position=1");
      if (p === 'cms-history') await db.query('UPDATE public.payload_migrations SET batch=-1');
      if (p === 'target-row' || p === 'source-row')
        await db.query("UPDATE app.subjects SET status='active' WHERE id=$1", [subjectId]);
      if (p === 'quarantine')
        await db.query('GRANT CONNECT ON DATABASE tt_app_recovery TO tt_app_runtime');
    } finally {
      await db.end();
    }
  }
  if (p === 'checkpoint-missing') unlinkSync('/handoff-current/current.json');
  if (p === 'inspection-loss') chmodSync('/handoff-current', 0);
  if (p === 'checkpoint-stale')
    writeFileSync(
      '/handoff-current/current.json',
      JSON.stringify({
        ...seal.checkpoint,
        observedAt: new Date(seal.maintenanceClosedAt - 1).toISOString(),
      }),
      { mode: 0o600 },
    );
  if (p === 'checkpoint-changed') {
    const crypto = custodyCrypto(),
      journal = createFilePrivacyJournal('/custody-journal', crypto);
    await journal.append(
      'b'.repeat(64),
      crypto.sign({
        version: 1,
        action: 'restrict',
        resourceKind: 'subject',
        markers: crypto.markers('subject', custodySubject),
        tombstones: [],
        policy: 'custody-local',
      }),
    );
    const observedAt = new Date().toISOString(),
      current = crypto.verify(await journal.capture(observedAt)) as { entries: unknown };
    const checkpoint: Current = {
      ...seal.checkpoint,
      observedAt,
      digest: createHash('sha256').update(canonical(current.entries, 2097152)).digest('hex'),
    };
    if (checkpoint.digest === seal.checkpoint.digest)
      throw Error('Actual journal head did not change');
    writeFileSync('/handoff-current/current.json', JSON.stringify(checkpoint), { mode: 0o600 });
  }
  if (p === 'image-binding' || p === 'config-binding') {
    const key = p === 'image-binding' ? 'image' : 'config';
    seal[key] = seal[key].slice(0, -1) + (seal[key].endsWith('a') ? 'b' : 'a');
    writeFileSync('/handoff-meta/seal.json', JSON.stringify(seal), { mode: 0o600 });
  }
  // A separate post-fault baseline, never substituted into positive phase admission.
  writeFileSync('/handoff-meta/before.json', JSON.stringify(await inspectFour()), {
    mode: 0o600,
    flag: 'wx',
  });
  console.log(
    'RESTORE_HANDOFF_FAULT ' +
      JSON.stringify({
        profile: p,
        fixedSetupOnly: true,
        postFaultBaselineCaptured: true,
        providerDispatches: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}
fault().catch(() => {
  console.error('Restore handoff fixed adverse setup refused');
  process.exitCode = 1;
});
