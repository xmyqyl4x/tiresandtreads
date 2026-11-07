import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { analysisLifecycleFixture, analysisLifecycleSources } from './analysis-lifecycle.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { validateSources } from '../../../scripts/database/manifest.ts';
export function staffCsvSources() {
  const dir = 'infra/database/phase-2-local/staff-csv-services/',
    sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex'),
    prior = analysisLifecycleSources(),
    manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha('infra/database/app/manifest.json') ||
    manifest.priorLocalManifestSha256 !==
      sha('infra/database/phase-2-local/analysis-lifecycle/manifest.json') ||
    manifest.priorLocalHead !== prior.sources.at(-1)!.id ||
    JSON.stringify(manifest.migrations.map((m: { id: string }) => m.id)) !==
      JSON.stringify(['0053_staff_csv_services']) ||
    JSON.stringify(
      readdirSync(dir)
        .filter((n) => n.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(['0053_staff_csv_services.sql'])
  )
    throw Error('Exact opt-in staff-csv-services chain required');
  const extra = manifest.migrations.map((m: { id: string; sha256: string }) => ({
    ...m,
    source: readFileSync(dir + m.id + '.sql', 'utf8'),
  }));
  validateSources(extra);
  return { ...prior, manifest, sources: [...prior.sources, ...extra] };
}
export async function staffCsvFixture() {
  const f = await analysisLifecycleFixture();
  try {
    const csvServicesApplied = await migrateApplication(f.target, staffCsvSources().sources);
    return { ...f, csvServicesApplied };
  } catch (e) {
    await f.cleanup();
    throw e;
  }
}
