import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { localProviderProject } from '../../packages/config/src/provider-preflight.ts';
export const previousRevision = JSON.parse(
  readFileSync(new URL('../../infra/local/deployment-baseline.json', import.meta.url), 'utf8'),
).revision as string;
// Reviewed, synthetic, additive fixture only. This is not a SQL safety scanner or production migration.
export const expansionSQL =
  'ALTER TABLE deployment_fixture.release_state ADD COLUMN additive_probe text';
export const expansionDigest = createHash('sha256').update(expansionSQL).digest('hex');
const refused = () => new Error('Local deployment admission refused');
function exact(value: unknown, keys: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== keys
  )
    throw refused();
  return value as Record<string, unknown>;
}
type Image = { id: string; revision: string; user: 'node'; command: 'node start.mjs' };
export interface LocalRelease {
  version: 1;
  project: string;
  current: Image;
  previous: Image;
  origin: 'https://ingress.preflight.test:9443';
  access: 'fixture-mtls';
  callback: 'sdk-trust-probe-only';
  productRoutes: 'deny';
  migrationMode: 'expand-only';
  rollbackMode: 'image-only';
  hostedAccepted: false;
  productActivation: false;
}
export function admitLocalRelease(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
): LocalRelease {
  try {
    const project = localProviderProject(env),
      p = exact(
        value,
        'access,callback,current,hostedAccepted,migrationMode,origin,previous,productActivation,productRoutes,project,rollbackMode,version',
      );
    if (
      p.version !== 1 ||
      p.project !== project ||
      p.origin !== 'https://ingress.preflight.test:9443' ||
      p.access !== 'fixture-mtls' ||
      p.callback !== 'sdk-trust-probe-only' ||
      p.productRoutes !== 'deny' ||
      p.migrationMode !== 'expand-only' ||
      p.rollbackMode !== 'image-only' ||
      p.hostedAccepted !== false ||
      p.productActivation !== false
    )
      throw refused();
    for (const slot of ['current', 'previous'] as const) {
      const i = exact(p[slot], 'command,id,revision,user');
      if (
        typeof i.id !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(i.id) ||
        i.user !== 'node' ||
        i.command !== 'node start.mjs' ||
        typeof i.revision !== 'string' ||
        (slot === 'previous'
          ? i.revision !== previousRevision
          : !(i.revision === 'working' || /^[a-f0-9]{40}$/.test(i.revision)))
      )
        throw refused();
    }
    if ((p.current as Image).id === (p.previous as Image).id) throw refused();
    return structuredClone(p) as unknown as LocalRelease;
  } catch {
    throw refused();
  }
}
export function localSelection(value: unknown, plan: LocalRelease): 'current' | 'previous' {
  const s = exact(value, 'expansionDigest,project,slot,version');
  if (
    s.version !== 1 ||
    s.project !== plan.project ||
    !['current', 'previous'].includes(String(s.slot)) ||
    s.expansionDigest !== expansionDigest
  )
    throw refused();
  return s.slot as 'current' | 'previous';
}
export function localReleaseReady(
  value: unknown,
  plan: LocalRelease,
  gates: { app: boolean; cms: boolean; backend: boolean; stopping: boolean },
) {
  try {
    localSelection(value, plan);
    return (
      gates.app === true && gates.cms === true && gates.backend === true && gates.stopping === false
    );
  } catch {
    return false;
  }
}
export function admitExpansion(source: string) {
  if (
    source !== expansionSQL ||
    createHash('sha256').update(source).digest('hex') !== expansionDigest
  )
    throw refused();
  return source;
}
