import { constants, openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import pg from 'pg';
import { disposableTargets } from '../foundation/target.ts';
import { localProviderProject } from '../../../packages/config/src/provider-preflight.ts';
import {
  databaseRoles,
  type RolePasswords,
  type DatabaseRole,
} from '../../../scripts/database/bootstrap.ts';
export function deploymentContext() {
  const project = localProviderProject(process.env),
    target = disposableTargets(process.env),
    root = new URL(target.app);
  root.pathname = '/postgres';
  const passwords = Object.fromEntries(
    Object.values(databaseRoles)
      .flat()
      .map((role) => [
        role,
        createHmac('sha256', root.password)
          .update('deployment:' + role)
          .digest('hex'),
      ]),
  ) as RolePasswords;
  return {
    project,
    admin: root.toString(),
    passwords,
    secret: createHmac('sha256', root.password).update('deployment:cms').digest('hex'),
    url(kind: 'app' | 'cms', role: DatabaseRole = `tt_${kind}_migrator`) {
      const u = new URL(root);
      u.pathname = `/tt_${kind}_deployment`;
      u.username = role;
      u.password = passwords[role];
      return u.toString();
    },
  };
}
export async function connect(url: string) {
  const c = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 1500,
    statement_timeout: 3000,
  });
  try {
    await c.connect();
    return c;
  } catch {
    await c.end();
    throw Error('Local deployment database unavailable');
  }
}
export function readFixture<T>(name: 'release' | 'state' | 'secrets' | 'database-proof'): T {
  try {
    const fd = openSync(
      '/deployment/' + name + '.json',
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size < 1 ||
        stat.size > 16384 ||
        (name === 'secrets' && stat.mode & 0o077)
      )
        throw Error();
      const bytes = Buffer.alloc(stat.size + 1);
      try {
        let size = 0,
          count = 0;
        do {
          count = readSync(fd, bytes, size, bytes.length - size, null);
          size += count;
        } while (count && size < bytes.length);
        if (size !== stat.size) throw Error();
        return JSON.parse(bytes.subarray(0, size).toString()) as T;
      } finally {
        bytes.fill(0);
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    throw Error('Local deployment fixture unavailable');
  }
}
