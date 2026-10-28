import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { custodyContext, custodySubject } from './custody-common.ts';
import { connect, readEvidence, writeEvidence } from './context.ts';
import { fingerprints } from './fingerprints.ts';
const ctx = custodyContext(),
  app = await connect(ctx.url('app'));
try {
  await app.query("INSERT INTO app.subjects(id,kind) VALUES($1,'guest')", [custodySubject]);
  await app.query(
    "INSERT INTO privacy.retention_policies(data_class,jurisdiction,version,rule,reviewed_at) VALUES('rights:delete','synthetic','custody-local',$1,now())",
    [{ responseDays: 14, escalationDays: 2, proofMinutes: 30, maxAttempts: 3 }],
  );
  for (const path of ['/custody-keys', '/custody-backup', '/custody-journal']) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  }
  const keys = Object.fromEntries(
    ['backup-old', 'backup-new', 'privacy-old', 'privacy-new', 'lookup'].map((name) => [
      name,
      randomBytes(32).toString('hex'),
    ]),
  );
  writeFileSync('/custody-keys/versions.json', JSON.stringify(keys), { mode: 0o600, flag: 'wx' });
  // Capture the complete source AFTER adding this scenario's guest and policy, BEFORE either dump.
  writeEvidence('source-fingerprints', {
    ...readEvidence<Record<string, unknown>>('source-fingerprints'),
    app: await fingerprints(app),
  });
  writeEvidence('backup-window', { project: ctx.project, startedAt: new Date().toISOString() });
} finally {
  await app.end();
}
