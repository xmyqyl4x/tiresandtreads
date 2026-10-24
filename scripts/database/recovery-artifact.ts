import { createHash } from 'node:crypto';
import type { MigrationSource } from './manifest.ts';

export interface RecoveryArtifact {
  version: 1;
  kind: 'app' | 'cms';
  project: string;
  postgresMajor: 18;
  sha256: string;
  bytes: number;
  migrations: { id: string; sha256: string }[];
}

export function validateRecoveryArtifact(
  value: unknown,
  bytes: Buffer,
  kind: 'app' | 'cms',
  project: string,
  sources: readonly MigrationSource[],
): void {
  const expected = {
    version: 1,
    kind,
    project,
    postgresMajor: 18,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    migrations: sources.map(({ id, sha256 }) => ({ id, sha256 })),
  };
  if (
    !/^tt-test-[a-f0-9]{8,32}$/.test(project) ||
    bytes.length < 6 ||
    bytes.length > 64 * 1024 * 1024 ||
    bytes.subarray(0, 5).toString('ascii') !== 'PGDMP' ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  )
    throw new Error('Recovery artifact boundary mismatch');
  const fields = value as Record<string, unknown>;
  if (
    Object.keys(fields).length !== Object.keys(expected).length ||
    Object.entries(expected).some(
      ([key, field]) => JSON.stringify(fields[key]) !== JSON.stringify(field),
    )
  )
    throw new Error('Recovery artifact boundary mismatch');
}
