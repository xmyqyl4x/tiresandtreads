import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { disposableTargets } from '../foundation/target.ts';
import {
  databaseRoles,
  type DatabaseRole,
  type RolePasswords,
} from '../../../scripts/database/bootstrap.ts';

export const subjectId = '88888888-8888-4888-8888-000000000001';
export const survivorId = '88888888-8888-4888-8888-000000000002';
export const reportId = '88888888-8888-4888-8888-000000000010';
export const cmsId = '88888888-8888-4888-8888-000000000080';
export const lateId = '88888888-8888-4888-8888-000000000090';

export function context(host: 'postgres' | 'recovery-postgres') {
  const harness = disposableTargets(process.env);
  const root = new URL(harness.app);
  root.hostname = host;
  root.pathname = '/postgres';
  // Deterministic only within one isolated run, so separate fixture CLI processes can reconnect.
  const key = root.password;
  const passwords = Object.fromEntries(
    Object.values(databaseRoles)
      .flat()
      .map((role) => [role, createHmac('sha256', key).update(`${host}:${role}`).digest('hex')]),
  ) as RolePasswords;
  return {
    project: process.env.ISOLATED_TEST_PROJECT!,
    admin: root.toString(),
    passwords,
    secret: createHmac('sha256', key).update(`${host}:cms`).digest('hex'),
    marker: createHmac('sha256', key).update(`subject:${subjectId}`).digest('hex'),
    url(kind: 'app' | 'cms', role: DatabaseRole = `tt_${kind}_migrator`, bad = false) {
      const url = new URL(root);
      url.pathname = `/tt_${kind}_recovery${bad ? '_bad' : ''}`;
      url.username = role;
      url.password = passwords[role];
      return url.toString();
    },
  };
}
export async function connect(url: string) {
  const db = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 3000,
    statement_timeout: 15000,
  });
  try {
    await db.connect();
    return db;
  } catch (error) {
    await db.end();
    throw error;
  }
}
export function readEvidence<T>(name: string): T {
  if (!/^[a-z-]+$/.test(name)) throw new Error('Invalid recovery evidence name');
  return JSON.parse(readFileSync(`/recovery/${name}.json`, 'utf8')) as T;
}
export function writeEvidence(name: string, value: unknown) {
  if (!/^[a-z-]+$/.test(name)) throw new Error('Invalid recovery evidence name');
  writeFileSync(`/recovery/${name}.json`, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
