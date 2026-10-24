import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { disposableTargets } from './target.ts';

// Proof-only roles and schema: never imported by application code or applied to dev/stage.
export async function provisionProof() {
  const targets = disposableTargets(process.env);
  const connections: Record<string, string> = {};
  for (const [name, connectionString] of Object.entries(targets)) {
    const admin = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
    await admin.connect();
    try {
      const database = name === 'app' ? 'tt_app' : 'tt_cms';
      for (const purpose of ['migrator', 'runtime']) {
        const role = `proof_${name}_${purpose}`;
        const password = randomBytes(32).toString('hex');
        await admin.query(
          `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
        );
        const url = new URL(connectionString);
        url.username = role;
        url.password = password;
        connections[`${name}_${purpose}`] = url.toString();
      }
      await admin.query(`ALTER DATABASE ${database} OWNER TO proof_${name}_migrator`);
      await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${database} TO proof_${name}_runtime`);
      await admin.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await admin.query(`GRANT USAGE ON SCHEMA public TO proof_${name}_runtime`);
    } finally {
      await admin.end();
    }
  }
  return connections as Record<
    'app_migrator' | 'app_runtime' | 'cms_migrator' | 'cms_runtime',
    string
  >;
}

export const poolOptions = {
  max: 2,
  connectionTimeoutMillis: 250,
  idleTimeoutMillis: 1000,
  statement_timeout: 500,
  lock_timeout: 150,
  idle_in_transaction_session_timeout: 1000,
};
