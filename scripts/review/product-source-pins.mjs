import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { readReviewBytes } from './repository-files.mjs';
import { pinList, mergeReviewedPins } from './evidence-catalog.mjs';
export const productPinsPath =
  'docs/implementation/evidence/P1/p1-pr-037-current-source-exceptions.json';
export const staffPinsPath =
  'docs/implementation/evidence/P1/p1-pr-039-current-source-exceptions.json';
export const editorialPinsPath =
  'docs/implementation/evidence/P1/p1-pr-038-current-source-exceptions.json';
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
  const prior = mergeReviewedPins(pins, next, entries);
  // A second exact transition advances the lockfile and service inventory, preserving old receipts.
  const editorialBytes = readReviewBytes(root, editorialPinsPath);
  if (
    createHash('sha256').update(editorialBytes).digest('hex') !==
    '5fc39ba5b8919504eabeeb66a5872e22d09cf0f2d05632227f4fcd659665f733'
  )
    throw Error('Editorial source review refused');
  const editorial = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(editorialBytes));
  if (
    editorial.schemaVersion !== 1 ||
    editorial.scope !== 'local-editorial-current-source-exceptions' ||
    editorial.baseMerge !== 'e0511f6e943556911dbcac32277f4bf250a35bac' ||
    editorial.previousManifestSha256 !== manifestHash ||
    editorial.casesClosed !== 0 ||
    editorial.gatesClosed !== 0 ||
    JSON.stringify(editorial.exceptions.map((e) => e.path)) !==
      JSON.stringify([
        'pnpm-lock.yaml',
        'docs/implementation/evidence/P1/s3-service-register.json',
        'scripts/review/evidence-readiness.mjs',
        'scripts/review/restore-evidence.mjs',
      ])
  )
    throw Error('Editorial source review refused');
  const overlay = editorial.exceptions.filter((e) => present.has(e.path));
  const final = prior.map((p) => ({
    path: p.path,
    sha256: overlay.find((e) => e.path === p.path)?.currentSha256 ?? p.sha256,
  }));
  const editorialResult = mergeReviewedPins(prior, final, overlay);
  const staffBytes = readReviewBytes(root, staffPinsPath);
  if (
    createHash('sha256').update(staffBytes).digest('hex') !==
    'f1d325c4027ae57ad0f29e79085bf7c85445cc21f05282b232b27b15be11c5af'
  )
    throw Error('Staff source review refused');
  const staff = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(staffBytes));
  if (
    staff.schemaVersion !== 1 ||
    staff.scope !== 'local-staff-console-current-source-exceptions' ||
    staff.previousManifestSha256 !==
      '5fc39ba5b8919504eabeeb66a5872e22d09cf0f2d05632227f4fcd659665f733' ||
    staff.casesClosed !== 0 ||
    staff.gatesClosed !== 0 ||
    JSON.stringify(staff.exceptions.map((e) => e.path)) !==
      JSON.stringify([
        'package.json',
        'scripts/review/evidence-readiness.mjs',
        'scripts/review/restore-evidence.mjs',
      ])
  )
    throw Error('Staff source review refused');
  const staffOverlay = staff.exceptions.filter((e) => present.has(e.path));
  const result = editorialResult.map((p) => ({
    path: p.path,
    sha256: staffOverlay.find((e) => e.path === p.path)?.currentSha256 ?? p.sha256,
  }));
  return {
    pins: mergeReviewedPins(editorialResult, result, staffOverlay),
    exceptions: new Set([...entries, ...overlay, ...staffOverlay].map((e) => e.path)).size,
  };
}
