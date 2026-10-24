import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  validateRecoveryArtifact,
  type RecoveryArtifact,
} from '../../scripts/database/recovery-artifact.ts';

const bytes = Buffer.from('PGDMP synthetic artifact, never a real backup');
const source = {
  id: '0001_fixture',
  source: 'SELECT 1;',
  sha256: createHash('sha256').update('SELECT 1;').digest('hex'),
};
const project = 'tt-test-12345678';
const manifest: RecoveryArtifact = {
  version: 1,
  kind: 'app',
  project,
  postgresMajor: 18,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
  migrations: [{ id: source.id, sha256: source.sha256 }],
};

it('recovery accepts only a matching artifact and reviewed migration history', () => {
  expect(() => validateRecoveryArtifact(manifest, bytes, 'app', project, [source])).not.toThrow();
});
it.each([
  { ...manifest, kind: 'cms' },
  { ...manifest, project: 'tt-dev' },
  { ...manifest, sha256: '0'.repeat(64) },
  { ...manifest, bytes: bytes.length + 1 },
  { ...manifest, postgresMajor: 17 },
  { ...manifest, migrations: [] },
  { ...manifest, migrations: [{ id: source.id, sha256: '0'.repeat(64) }] },
])('recovery refuses a mismatched archive boundary %#', (value) => {
  expect(() => validateRecoveryArtifact(value, bytes, 'app', project, [source])).toThrow(
    /artifact/i,
  );
});
it('recovery refuses malformed metadata and an empty or corrupt archive', () => {
  for (const value of [null, [], {}, { ...manifest, migrations: 'invalid' }])
    expect(() => validateRecoveryArtifact(value, bytes, 'app', project, [source])).toThrow(
      /artifact/i,
    );
  expect(() =>
    validateRecoveryArtifact(manifest, Buffer.alloc(0), 'app', project, [source]),
  ).toThrow(/artifact/i);
});
