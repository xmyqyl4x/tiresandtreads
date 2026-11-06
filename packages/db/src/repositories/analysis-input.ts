import type { AIManifest, AIPolicy, AIScope } from '../../../domain/src/entities/analysis.ts';
import { boundedJson, reject } from './bounds.ts';
import { object, hash, uid } from './analysis-values.ts';
const codes: Readonly<Record<string, readonly string[]>> = {
  climate_category: ['cold', 'mild', 'hot', 'wet', 'mixed'],
  usage: ['commute', 'highway', 'offroad', 'mixed'],
  tire_category: [
    'all_season',
    'all_weather',
    'winter',
    'summer',
    'touring',
    'performance',
    'light_truck',
  ],
  market: ['US', 'CA'],
  locale: ['en-US', 'en-CA', 'fr-CA'],
  season: ['spring', 'summer', 'autumn', 'winter', 'all'],
  question_code: ['tradeoffs', 'installer_questions', 'care'],
};
export function manifestValue(input: unknown): AIManifest {
  const v = object(input),
    keys = Object.keys(v);
  if (
    keys.some(
      (k) =>
        ![
          'parameters',
          'bundle_id',
          'authoritative_hash',
          'rule_version',
          'advice_revision',
          'sanitized_sha256',
        ].includes(k),
    )
  )
    return reject();
  object(v.parameters);
  for (const k of ['bundle_id', 'rule_version', 'advice_revision'])
    if (k in v && uid(k, v[k]) !== v[k]) return reject();
  for (const k of ['authoritative_hash', 'sanitized_sha256']) if (k in v) hash(v[k]);
  return v as unknown as AIManifest;
}
export function canonicalManifest(input: AIManifest, policy: AIPolicy, scope: AIScope): string {
  const v = manifestValue(input);
  if (policy.id !== scope.policyId || policy.status !== 'active') return reject();
  if ((policy.task === 'photo_extraction') !== 'sanitized_sha256' in v) return reject();
  if (scope.kind === 'shared') {
    if (
      !policy.sharedAllowed ||
      policy.task !== 'generic_explanation' ||
      'bundle_id' in v ||
      'authoritative_hash' in v ||
      'sanitized_sha256' in v
    )
      return reject();
    for (const [k, value] of Object.entries(v.parameters))
      if (
        !policy.sharedParameters.includes(k) ||
        !codes[k] ||
        (value !== null && (typeof value !== 'string' || !codes[k]!.includes(value)))
      )
        return reject();
  }
  return boundedJson(v, 65536);
}
