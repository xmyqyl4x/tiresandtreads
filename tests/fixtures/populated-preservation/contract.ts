import { digest, must } from '../tls-admission/contract.ts';
import { loadSources } from '../../../scripts/database/manifest.ts';

export const profiles = [
  'positive',
  'app-row',
  'cms-row',
  'missing-row',
  'app-history',
  'cms-history',
  'inventory',
  'quarantine',
  'source-row',
] as const;
export type Profile = (typeof profiles)[number];
export const phase = 'populated-quarantined' as const;
export const subjectId = '11111111-1111-4111-8111-111111111191';
export const articleId = '11111111-1111-4111-8111-111111111192';
export const versionId = '11111111-1111-4111-8111-111111111193';
export const flags = {
  runtimeAdmission: false,
  hostedAccepted: false,
  productActivation: false,
  independentDurability: false,
  authenticated: false,
  targetFencing: false,
  restoreExecuted: false,
  lifecycleEffectDispatch: false,
  providerDispatch: false,
  casesClosed: 0,
  gatesClosed: 0,
} as const;
export function profile(): Profile {
  must(profiles.includes(process.env.POPULATED_PROFILE as Profile));
  return process.env.POPULATED_PROFILE as Profile;
}
export function sourceDigest() {
  return digest(['app', 'cms'].map((kind) => loadSources(kind as 'app' | 'cms')));
}
export interface Observation {
  slot: number;
  kind: 'app' | 'cms';
  catalog: string;
  rows: string;
  sequences: string;
  security: string;
  history: string;
  populated: boolean;
  historiesValid: boolean;
  quarantined: boolean;
  tables: number;
}
export interface Baseline {
  version: 1;
  phase: typeof phase;
  project: string;
  generation: string;
  sourceDigest: string;
  observations: Observation[];
}
export function admitBaseline(raw: unknown, project: string, generation: string): Baseline {
  must(typeof raw === 'string' && Buffer.byteLength(raw) <= 16384);
  const b = JSON.parse(raw) as Baseline;
  must(
    Object.keys(b).sort().join(',') ===
      'generation,observations,phase,project,sourceDigest,version' &&
      b.version === 1 &&
      b.phase === phase &&
      b.project === project &&
      b.generation === generation &&
      b.sourceDigest === sourceDigest() &&
      Array.isArray(b.observations) &&
      b.observations.length === 4,
  );
  must(b.observations.map((o) => `${o.slot}/${o.kind}`).join(',') === '0/app,0/cms,1/app,1/cms');
  for (const o of b.observations) {
    must(
      Object.keys(o).sort().join(',') ===
        'catalog,historiesValid,history,kind,populated,quarantined,rows,security,sequences,slot,tables' &&
        o.populated === true &&
        o.historiesValid === true &&
        o.quarantined === true &&
        Number.isSafeInteger(o.tables) &&
        o.tables > 0 &&
        o.tables <= 200,
    );
    for (const key of ['catalog', 'rows', 'sequences', 'security', 'history'] as const)
      must(/^[a-f0-9]{64}$/.test(o[key]));
  }
  return structuredClone(b);
}
export function compare(baseline: Baseline, observed: Observation[]) {
  const findings: string[] = [];
  for (const expected of baseline.observations) {
    const actual = observed.find((o) => o.slot === expected.slot && o.kind === expected.kind);
    if (!actual) {
      findings.push(`${expected.slot}/${expected.kind}:missing`);
      continue;
    }
    for (const key of ['catalog', 'rows', 'sequences', 'security', 'history'] as const)
      if (actual[key] !== expected[key]) findings.push(`${actual.slot}/${actual.kind}:${key}`);
    for (const key of ['populated', 'historiesValid', 'quarantined'] as const)
      if (actual[key] !== true) findings.push(`${actual.slot}/${actual.kind}:${key}`);
  }
  must(observed.length === 4 && new Set(observed.map((o) => `${o.slot}/${o.kind}`)).size === 4);
  return findings;
}
