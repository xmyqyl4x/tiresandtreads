import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { photoServiceFixture, photoServiceSources } from './photo-services.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { validateSources } from '../../../scripts/database/manifest.ts';
export function analysisLifecycleSources() {
  const dir = 'infra/database/phase-2-local/analysis-lifecycle/',
    sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex'),
    prior = photoServiceSources(),
    manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha('infra/database/app/manifest.json') ||
    manifest.priorLocalManifestSha256 !==
      sha('infra/database/phase-2-local/photo-services/manifest.json') ||
    manifest.priorLocalHead !== prior.sources.at(-1)!.id ||
    JSON.stringify(manifest.migrations.map((m: { id: string }) => m.id)) !==
      JSON.stringify(['0052_analysis_lifecycle']) ||
    JSON.stringify(
      readdirSync(dir)
        .filter((n) => n.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(['0052_analysis_lifecycle.sql'])
  )
    throw Error('Exact opt-in analysis-lifecycle chain required');
  const extra = manifest.migrations.map((m: { id: string; sha256: string }) => ({
    ...m,
    source: readFileSync(dir + m.id + '.sql', 'utf8'),
  }));
  validateSources(extra);
  return { ...prior, manifest, sources: [...prior.sources, ...extra] };
}
export async function analysisLifecycleFixture() {
  const f = await photoServiceFixture();
  try {
    const lifecycleApplied = await migrateApplication(f.target, analysisLifecycleSources().sources);
    return { ...f, lifecycleApplied };
  } catch (e) {
    await f.cleanup();
    throw e;
  }
}
