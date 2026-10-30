import { readLifecycleRequest } from '../lifecycle-validation/reader.ts';

export type Origin = 'app' | 'cms';
export interface CoordinationPlan {
  readonly version: 1;
  readonly scope: 'disposable-readonly-coordination';
  readonly project: string;
  readonly origin: Origin;
  readonly mode: 'common' | 'per-database-control';
  readonly inputs: Readonly<
    Record<
      Origin,
      {
        readonly mode: 'local-lifecycle-proof';
        readonly phase: 'foundation';
        readonly target: Origin;
        readonly url: string;
        readonly ca: string;
      }
    >
  >;
}
export function refused(): never {
  throw Error('Read-only coordination proof refused');
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    refused();
}
export function readCoordinationPlan(
  raw: unknown,
  env: Readonly<Record<string, string | undefined>>,
): CoordinationPlan {
  try {
    const p = structuredClone(raw);
    exact(p, ['version', 'scope', 'project', 'origin', 'mode', 'inputs']);
    if (
      Buffer.byteLength(JSON.stringify(p)) > 150000 ||
      p.version !== 1 ||
      p.scope !== 'disposable-readonly-coordination' ||
      p.project !== env.ISOLATED_TEST_PROJECT ||
      !['app', 'cms'].includes(p.origin as string) ||
      !['common', 'per-database-control'].includes(p.mode as string)
    )
      refused();
    exact(p.inputs, ['app', 'cms']);
    for (const target of ['app', 'cms'] as const) {
      const admitted = readLifecycleRequest(p.inputs[target], env);
      if (
        admitted.target !== target ||
        admitted.phase !== 'foundation' ||
        admitted.connection.host !== 'postgres.preflight.test'
      )
        refused();
      Object.freeze(p.inputs[target]);
    }
    Object.freeze(p.inputs);
    return Object.freeze(p) as unknown as CoordinationPlan;
  } catch {
    return refused();
  }
}

// These flags concern lifecycle/journal authority. Actual TLS/login facts are reported separately.
export const evidenceFlags = Object.freeze({
  independentDurability: false,
  authenticated: false,
  targetFencing: false,
  runtimeAdmission: false,
  hostedAccepted: false,
  productActivation: false,
  lifecycleMutationDispatches: 0,
  providerDispatches: 0,
  actualRecipientNotifications: 0,
});
