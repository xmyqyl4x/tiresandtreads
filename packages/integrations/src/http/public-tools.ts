import { toolInputSchema } from '../../../contracts/src/http.ts';
import { ok, fail } from '../../../domain/src/values/core.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import { decodeSize, checklist, scorecard } from '../../../domain/src/public-policy.ts';
import type { HttpRoute } from './core.ts';
// Shared unchanged public tool controller; local website proofs use this exact wire boundary.
export function publicToolRoutes(): readonly HttpRoute[] {
  return (['size', 'checklist', 'scorecard'] as const).map((kind) => ({
    operationId: 'tool' + kind,
    path: '/api/v1/tools/' + kind,
    method: 'POST',
    access: 'public',
    command: false,
    handle: async (c) => {
      const parsed = toolInputSchema.safeParse(c.body);
      if (!parsed.success) return fail(failure('invalid_input'));
      try {
        return ok(
          kind === 'size'
            ? decodeSize(parsed.data.input)
            : kind === 'checklist'
              ? checklist(parsed.data.input as Parameters<typeof checklist>[0])
              : scorecard(parsed.data.input as Parameters<typeof scorecard>[0]),
        );
      } catch {
        return fail(failure('invalid_input'));
      }
    },
  }));
}
