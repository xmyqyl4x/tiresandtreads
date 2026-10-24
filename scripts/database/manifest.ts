export interface MigrationSource {
  readonly id: string;
  readonly sha256: string;
  readonly source: string;
}

export function validateSources(sources: readonly MigrationSource[]): void {
  let previous = '';
  for (const entry of sources) {
    if (
      !/^\d{4}_[a-z0-9_]+$/.test(entry.id) ||
      entry.id <= previous ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      createHash('sha256').update(entry.source).digest('hex') !== entry.sha256
    ) {
      throw new Error('Invalid migration order, identity or checksum');
    }
    previous = entry.id;
  }
}

export function pendingMigrations(
  sources: readonly MigrationSource[],
  applied: readonly { id: string; sha256: string }[],
): readonly MigrationSource[] {
  validateSources(sources);
  for (const [index, row] of applied.entries()) {
    if (sources[index]?.id !== row.id || sources[index]?.sha256 !== row.sha256)
      throw new Error('Database migration history differs from reviewed sources');
  }
  return sources.slice(applied.length);
}
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function loadSources(target: 'app' | 'cms'): readonly MigrationSource[] {
  const directory = path.resolve('infra/database', target);
  const extension = target === 'app' ? '.sql' : '.ts';
  const manifest: unknown = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest)) throw new Error('Invalid migration manifest');
  const sources = manifest.map((value: unknown) => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('id' in value) ||
      !('sha256' in value) ||
      typeof value.id !== 'string' ||
      !/^\d{4}_[a-z0-9_]+$/.test(value.id) ||
      typeof value.sha256 !== 'string'
    )
      throw new Error('Invalid migration manifest entry');
    return {
      id: value.id,
      sha256: value.sha256,
      source: readFileSync(path.join(directory, value.id + extension), 'utf8'),
    };
  });
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(extension))
    .sort();
  if (JSON.stringify(files) !== JSON.stringify(sources.map((entry) => entry.id + extension)))
    throw new Error('Unlisted or missing migration file');
  validateSources(sources);
  return sources;
}
