import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { executionFixture, executionSources } from './analysis-execution.ts';
import pg from 'pg';
import { disposableTargets } from '../foundation/target.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { validateSources } from '../../../scripts/database/manifest.ts';
export function photoServiceSources() {
  const dir = 'infra/database/phase-2-local/photo-services/',
    sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex'),
    prior = executionSources(),
    manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha('infra/database/app/manifest.json') ||
    manifest.priorLocalManifestSha256 !==
      sha('infra/database/phase-2-local/analysis-execution/manifest.json') ||
    manifest.priorLocalHead !== prior.sources.at(-1)!.id ||
    JSON.stringify(manifest.migrations.map((m: { id: string }) => m.id)) !==
      JSON.stringify(['0051_photo_services']) ||
    JSON.stringify(
      readdirSync(dir)
        .filter((n) => n.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(['0051_photo_services.sql'])
  )
    throw Error('Exact opt-in photo-service chain required');
  const extra = manifest.migrations.map((m: { id: string; sha256: string }) => ({
    ...m,
    source: readFileSync(dir + m.id + '.sql', 'utf8'),
  }));
  validateSources(extra);
  return { ...prior, manifest, sources: [...prior.sources, ...extra] };
}
export async function photoServiceFixture() {
  const f = await executionFixture();
  const root = new pg.Client({
    connectionString: disposableTargets(process.env).app,
    connectionTimeoutMillis: 3000,
  });
  try {
    await root.connect();
    await root.query(
      'GRANT tt_p2_photo_runtime,tt_p2_photo_worker,tt_p2_photo_assets TO tt_p2_analysis_service WITH INHERIT TRUE',
    );
    const photoServicesApplied = await migrateApplication(f.target, photoServiceSources().sources);
    return { ...f, photoServicesApplied };
  } catch (e) {
    await f.cleanup();
    throw e;
  } finally {
    await root.end();
  }
}
