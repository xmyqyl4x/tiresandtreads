import { z } from '../../../contracts/src/phase2-partners.ts';
import type { Result } from '../../../domain/src/values/core.ts';
import { ok } from '../../../domain/src/values/core.ts';
import type { ApplicationFailure } from '../../../application/src/ports/transactions.ts';
import { HttpFailure } from './core.ts';
import { p2Project } from './phase2-common.ts';
// Output schemas explicitly project nested read DTOs; internal additions do not become public fields.
export function privateAnalysisView(
  schema: z.ZodType,
  result: Result<unknown, ApplicationFailure>,
): Result<unknown, ApplicationFailure> {
  if (!result.ok) return p2Project(result, []);
  let decoded: unknown;
  try {
    const json = JSON.stringify(result.value, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    if (Buffer.byteLength(json) > 65536) throw Error('Bounded DTO required');
    decoded = JSON.parse(json);
  } catch {
    throw new HttpFailure(503, 'unavailable');
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) throw new HttpFailure(503, 'unavailable');
  return ok(parsed.data);
}
