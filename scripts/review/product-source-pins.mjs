import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { readReviewBytes } from './repository-files.mjs';
import { pinList, mergeReviewedPins } from './evidence-catalog.mjs';
export const productPinsPath =
  'docs/implementation/evidence/P1/p1-pr-037-current-source-exceptions.json';
// Exact reviewed manifest anchor; historical manifests and their original pins are not rewritten.
const manifestHash = 'bc86d5a25339bd17c3ef0dd2d9cfebae8ea0db296c9d44068a8b18e32f132581';
export function reconcileProductPins(root, rawPins) {
  const bytes = readReviewBytes(root, productPinsPath);
  if (createHash('sha256').update(bytes).digest('hex') !== manifestHash)
    throw Error('Product source review refused');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const allowed = ['package.json', 'pnpm-lock.yaml', 'scripts/review/evidence-readiness.mjs'];
  if (
    manifest.schemaVersion !== 1 ||
    manifest.scope !== 'local-template-current-source-exceptions' ||
    manifest.casesClosed !== 0 ||
    manifest.gatesClosed !== 0 ||
    JSON.stringify(manifest.exceptions.map((x) => x.path)) !== JSON.stringify(allowed)
  )
    throw Error('Product source review refused');
  const pins = pinList(rawPins),
    present = new Set(pins.map((x) => x.path));
  const entries = manifest.exceptions.filter((x) => present.has(x.path));
  const replacements = new Map(entries.map((x) => [x.path, x]));
  for (const p of pins) {
    const e = replacements.get(p.path);
    if (e && p.sha256 !== e.baselineSha256) throw Error('Product source baseline refused');
  }
  const next = pins.map((p) => ({
    path: p.path,
    sha256: replacements.get(p.path)?.currentSha256 ?? p.sha256,
  }));
  return { pins: mergeReviewedPins(pins, next, entries), exceptions: entries.length };
}
