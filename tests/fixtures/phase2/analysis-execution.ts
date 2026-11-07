import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { analysisServiceFixture, analysisServiceSources } from './report-analysis.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { validateSources } from '../../../scripts/database/manifest.ts';
export function executionSources() {
  const dir = 'infra/database/phase-2-local/analysis-execution/',
    sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex'),
    prior = analysisServiceSources(),
    manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha('infra/database/app/manifest.json') ||
    manifest.priorLocalManifestSha256 !==
      sha('infra/database/phase-2-local/report-analysis/manifest.json') ||
    manifest.priorLocalHead !== prior.sources.at(-1)!.id ||
    JSON.stringify(manifest.migrations.map((m: { id: string }) => m.id)) !==
      JSON.stringify(['0050_analysis_execution']) ||
    JSON.stringify(
      readdirSync(dir)
        .filter((n) => n.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(['0050_analysis_execution.sql'])
  )
    throw Error('Exact opt-in execution chain required');
  const extra = manifest.migrations.map((m: { id: string; sha256: string }) => ({
    ...m,
    source: readFileSync(dir + m.id + '.sql', 'utf8'),
  }));
  validateSources(extra);
  return { ...prior, manifest, sources: [...prior.sources, ...extra] };
}
export async function executionFixture() {
  const f = await analysisServiceFixture();
  try {
    const executionApplied = await migrateApplication(f.target, executionSources().sources);
    return { ...f, executionApplied };
  } catch (e) {
    await f.cleanup();
    throw e;
  }
}
