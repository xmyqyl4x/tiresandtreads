import type pg from 'pg';
import { schemaInventory, digest } from '../../../scripts/database/inventory.ts';

// Bounded synthetic drill only. Never export table contents or use this on live workloads.
export async function fingerprints(db: pg.Client) {
  const inventory = await schemaInventory(db);
  const result: Record<string, { count: number; sha256: string }> = {};
  for (const table of inventory.relations ?? []) {
    if (table.kind !== 'r') continue;
    const name = String(table.name);
    const qualified = name
      .split('.')
      .map((part) => {
        if (!/^[a-z_][a-z0-9_]*$/.test(part)) throw new Error('Unexpected catalogue name');
        return `"${part}"`;
      })
      .join('.');
    const rows = (await db.query(`SELECT to_jsonb(t) AS row FROM ${qualified} t LIMIT 1001`)).rows;
    if (rows.length > 1000) throw new Error('Recovery fixture exceeds the synthetic row budget');
    result[name] = {
      count: rows.length,
      sha256: digest(rows.map((row) => JSON.stringify(row.row)).sort()),
    };
  }
  return result;
}
