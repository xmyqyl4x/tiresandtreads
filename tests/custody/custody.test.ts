import { readFileSync, writeFileSync, chmodSync, symlinkSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, it } from 'vitest';
import { createTransactions } from '../../packages/db/src/transactions.ts';
import { createPrivacyRuntime } from '../../packages/integrations/src/privacy-runtime.ts';
import { createFilePrivacyJournal } from '../../packages/integrations/src/privacy-journal.ts';
import { createContactCrypto } from '../../packages/integrations/src/contact-crypto.ts';
import { id, instant } from '../../packages/domain/src/values/core.ts';
import type { Result } from '../../packages/domain/src/values/core.ts';
import type { SignedPrivacyRecord } from '../../packages/application/src/ports/privacy-services.ts';
import {
  context,
  connect,
  readEvidence,
  writeEvidence,
  survivorId,
  cmsId,
} from '../fixtures/recovery/context.ts';
import {
  custodyContext,
  custodySubject,
  custodyKeys,
  custodyCrypto,
  privateRead,
} from '../fixtures/recovery/custody-common.ts';
import { loadSources } from '../../scripts/database/manifest.ts';
import { migrateApplication } from '../../scripts/database/migrate.ts';
import { migrateCms } from '../../scripts/database/cms.ts';
import { schemaHealth, schemaInventory } from '../../scripts/database/inventory.ts';
import { fingerprints } from '../fixtures/recovery/fingerprints.ts';
function value<R extends Result<unknown, unknown>>(r: R): Extract<R, { ok: true }>['value'] {
  if (!r.ok) throw Error('Synthetic custody service failed');
  return r.value as Extract<R, { ok: true }>['value'];
}
it('keeps product roles quarantined through encrypted restore and replays the real signed privacy journal idempotently', async () => {
  custodyContext();
  const target = context('recovery-postgres'),
    admin = await connect(target.url('app')),
    cms = await connect(target.url('cms'));
  const ring = custodyKeys(),
    crypto = custodyCrypto(),
    journal = createFilePrivacyJournal('/custody-journal', crypto);
  const pool = new pg.Pool({
    connectionString: target.url('app', 'tt_privacy_runtime'),
    max: 1,
    connectionTimeoutMillis: 3000,
  });
  let poolClosed = false;
  try {
    expect(readEvidence<{ refusals: number }>('custody-admission').refusals).toBe(7);
    expect(readFileSync('/recovery/custody-object', 'utf8')).toBe(
      'Synthetic private tire report object; not customer data.',
    );
    expect(
      (await admin.query('SELECT id FROM app.subjects WHERE id=$1', [custodySubject])).rowCount,
    ).toBe(1);
    const source = await connect(context('postgres').url('app'));
    try {
      expect(
        (await source.query('SELECT id FROM app.subjects WHERE id=$1', [custodySubject])).rowCount,
      ).toBe(0);
      const sourceIds = (await source.query('SELECT id FROM app.subjects ORDER BY id')).rows.map(
        (r) => r.id,
      );
      const restoredIds = (await admin.query('SELECT id FROM app.subjects ORDER BY id')).rows.map(
        (r) => r.id,
      );
      expect(restoredIds.filter((v) => !sourceIds.includes(v))).toEqual([custodySubject]);
      expect(sourceIds.every((v) => restoredIds.includes(v))).toBe(true);
    } finally {
      await source.end();
    }
    for (const [kind, db] of [
      ['app', admin],
      ['cms', cms],
    ] as const) {
      expect(await schemaHealth(db)).toEqual([]);
      expect(await schemaInventory(db)).toEqual(
        readEvidence<Record<string, unknown>>('source-inventory')[kind],
      );
      expect(await fingerprints(db)).toEqual(
        readEvidence<Record<string, unknown>>('source-fingerprints')[kind],
      );
    }
    expect(
      await migrateApplication(
        { url: target.url('app'), kind: 'app', database: 'tt_app_recovery' },
        loadSources('app'),
      ),
    ).toBe(0);
    expect(
      await migrateCms(
        { url: target.url('cms'), kind: 'cms', database: 'tt_cms_recovery' },
        target.secret,
      ),
    ).toBe(0);
    for (const role of ['tt_app_runtime', 'tt_privacy_runtime'])
      await expect(connect(target.url('app', role as 'tt_app_runtime'))).rejects.toMatchObject({
        code: '42501',
      });
    // Only the scoped maintenance worker receives CONNECT; all product roles stay closed.
    await admin.query('GRANT CONNECT ON DATABASE tt_app_recovery TO tt_privacy_runtime');
    const scope = createTransactions(pool, {
      transactionMs: 10000,
      statementMs: 5000,
      lockMs: 2000,
    });
    const contacts = createContactCrypto(
      'enc',
      { enc: ring.lookup },
      { fixture: ring.lookup, lookup: ring.lookup },
      ring.lookup,
    );
    const runtime = await createPrivacyRuntime({
      scope,
      crypto,
      contacts,
      policyVersion: 'custody-local',
      now: () => new Date().toISOString(),
      assetBucket: 'synthetic-private',
      assetKeyVersions: ['fixture'],
      journal,
      encryption: {
        async encrypt() {
          throw Error('Forbidden custody side effect');
        },
        async decrypt() {
          throw Error('Forbidden custody side effect');
        },
      },
      mail: {
        async verify() {
          throw Error('No send');
        },
        async erase() {
          throw Error('No provider erasure');
        },
      },
      objects: {
        async put() {
          throw Error('No object upload');
        },
        async get() {
          throw Error('No object download');
        },
        async erase() {
          throw Error('No remote object erasure');
        },
      },
    });
    const snapshot = readEvidence<SignedPrivacyRecord>('custody-snapshot'),
      window = readEvidence<{ finishedAt: string }>('backup-window');
    const input = {
      runId: value(id('restore', randomUUID())),
      backupFinishedAt: value(instant(window.finishedAt)),
      snapshot,
      expectedDigest: snapshot.digest,
      jurisdiction: 'synthetic',
    };
    const beforeRequests = (
      await admin.query('SELECT count(*)::int AS n FROM privacy.privacy_requests')
    ).rows[0].n;
    expect(value(await runtime.replay(input)).ready).toBe(false);
    const request = (
      await admin.query(
        "SELECT id FROM privacy.privacy_requests WHERE subject_id=$1 AND kind='delete'",
        [custodySubject],
      )
    ).rows[0].id;
    for (let step = 0; step < 40; step++) {
      await admin.query(
        'UPDATE privacy.request_work SET barrier_until=clock_timestamp(),next_attempt_at=clock_timestamp() WHERE request_id=$1',
        [request],
      );
      const result = value(await runtime.workOne(value(id('privacy_request', request))));
      if (result?.status === 'completed') break;
      if (result?.status === 'manual_review')
        throw Error('Custody replay unexpectedly requires manual review');
    }
    expect(
      (await admin.query('SELECT id FROM app.subjects WHERE id=$1', [custodySubject])).rowCount,
    ).toBe(0);
    let ready = false;
    for (let page = 0; page < 20; page++) {
      if (value(await runtime.replay(input)).ready) {
        ready = true;
        break;
      }
    }
    expect(ready).toBe(true);
    expect(value(await runtime.replay(input)).ready).toBe(true);
    expect(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM privacy.privacy_requests WHERE id=$1 AND kind='delete' AND status='completed' AND subject_id IS NULL",
          [request],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (await admin.query('SELECT count(*)::int AS n FROM privacy.privacy_requests')).rows[0].n,
    ).toBe(beforeRequests + 1);
    expect(
      (await admin.query("SELECT 1 FROM privacy.deletion_markers WHERE key_version='old'"))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await admin.query(
          "SELECT scope_key FROM privacy.suppression_tombstones WHERE key_version='lookup' ORDER BY scope_key",
        )
      ).rows.map((r) => r.scope_key),
    ).toEqual([
      'ads',
      'all-email',
      'all-marketing',
      'analytics',
      'identity_sharing',
      'targeted_ads',
    ]);
    expect(
      (await admin.query('SELECT id FROM app.subjects WHERE id=$1', [survivorId])).rowCount,
    ).toBe(1);
    expect((await cms.query('SELECT id FROM articles WHERE id=$1', [cmsId])).rowCount).toBe(1);
    await pool.end();
    poolClosed = true;
    await admin.query('REVOKE CONNECT ON DATABASE tt_app_recovery FROM tt_privacy_runtime');
    await expect(connect(target.url('app', 'tt_app_runtime'))).rejects.toMatchObject({
      code: '42501',
    });
    writeEvidence('result', {
      ...readEvidence<object>('custody-admission'),
      applicationReplay: true,
      snapshotDataParity: true,
      scenarioErasuresCovered: true,
      idempotent: true,
      productAccessOpened: false,
      hostedAccepted: false,
      offHostCustodyProved: false,
      pitrProved: false,
      counts: { appTables: 141, cmsTables: 28, appMigrations: 33, cmsMigrations: 3 },
    });
  } finally {
    await Promise.all([...(poolClosed ? [] : [pool.end()]), admin.end(), cms.end()]);
  }
}, 30000);
it('refuses symlinks, broad permissions, oversized files and paths outside custody', () => {
  custodyContext();
  const path = '/custody-backup/refusal.json';
  writeFileSync(path, '{}', { mode: 0o600, flag: 'wx' });
  try {
    expect(privateRead(path, 8)).toEqual({});
    expect(() => privateRead(path, 1)).toThrow();
    chmodSync(path, 0o644);
    expect(() => privateRead(path, 8)).toThrow();
    chmodSync(path, 0o600);
    expect(() => privateRead('/recovery/result.json', 8192)).toThrow();
    expect(() => privateRead('/custody-backup/../custody-keys/versions.json', 8192)).toThrow();
  } finally {
    unlinkSync(path);
  }
  symlinkSync('/custody-keys/versions.json', path);
  try {
    expect(() => privateRead(path, 8192)).toThrow();
  } finally {
    unlinkSync(path);
  }
});
