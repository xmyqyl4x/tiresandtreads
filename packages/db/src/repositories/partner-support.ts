import { id, type Result } from '../../../domain/src/values/core.ts';
import type { IntegrityError } from '../mappers.ts';
import type { PartnerScope } from '../../../domain/src/entities/partner.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { stop, type WriteScope } from './mutations.ts';
import { text } from './private-values.ts';
import { reject } from './bounds.ts';
export function identifier<K extends string>(kind: K, input: unknown) {
  const r = id(kind, input);
  return r.ok ? r.value : reject();
}
export function mapped<T>(result: Result<T, IntegrityError>): T {
  return result.ok ? result.value : stop('integrity');
}
export async function partnerContext(s: WriteScope, tx: Tx, scope: PartnerScope) {
  const organization = identifier('organization', scope.organizationId),
    actor = text(scope.actor, 200);
  await s.query(tx, "SELECT set_config('tt.p2_org',$1,true),set_config('tt.p2_actor',$2,true)", [
    organization,
    actor,
  ]);
  return organization;
}
