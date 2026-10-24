import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadSources } from '../../../scripts/database/manifest.ts';
import {
  validateRecoveryArtifact,
  type RecoveryArtifact,
} from '../../../scripts/database/recovery-artifact.ts';
import { context, connect, lateId, readEvidence, writeEvidence } from './context.ts';
import { restrictGraph, purgeGraph, rebuildFixtureMetrics, type Journal } from './replay.ts';

const ctx = context('postgres');
const manifest: Record<string, RecoveryArtifact> = {};
for (const kind of ['app', 'cms'] as const) {
  const bytes = readFileSync(`/recovery/${kind}.dump`);
  manifest[kind] = {
    version: 1,
    kind,
    project: ctx.project,
    postgresMajor: 18,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    migrations: loadSources(kind).map(({ id, sha256 }) => ({ id, sha256 })),
  };
  validateRecoveryArtifact(manifest[kind], bytes, kind, ctx.project, loadSources(kind));
}
writeEvidence('artifacts', manifest);
const window = readEvidence<{ startedAt: string; project: string }>('backup-window');
writeEvidence('backup-window', { ...window, finishedAt: new Date().toISOString() });
const bytes = readFileSync('/recovery/app.dump');
writeFileSync('/recovery/corrupt.dump', bytes.subarray(0, Math.floor(bytes.length * 0.7)), {
  mode: 0o600,
});
// This checkpoint is captured AFTER both backups, outside their contents. It is trusted fixture control data.
const journal: Journal = {
  version: 1,
  project: ctx.project,
  capturedAt: new Date().toISOString(),
  marker: ctx.marker,
  keyVersion: 'fixture',
};
writeEvidence('current-journal', journal);
const app = await connect(ctx.url('app'));
try {
  await restrictGraph(app, journal);
  await purgeGraph(app);
  await rebuildFixtureMetrics(app);
  await app.query("INSERT INTO app.subjects(id,kind) VALUES($1,'guest')", [lateId]);
  console.log('Backups sealed; post-backup deletion and a later write recorded outside snapshots');
} finally {
  await app.end();
}
