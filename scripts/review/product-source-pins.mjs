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
  // The photo backend declares an already locked native codec explicitly. Only these
  // two exact source digests advance; old execution receipts and admission stay unchanged.
  const staffResult = mergeReviewedPins(editorialResult, result, staffOverlay),
    photoOverlay = photoDependencyPins.filter((e) => present.has(e.path)),
    photoResult = staffResult.map((p) => ({
      path: p.path,
      sha256: photoOverlay.find((e) => e.path === p.path)?.currentSha256 ?? p.sha256,
    }));
  const afterPhoto = mergeReviewedPins(staffResult, photoResult, photoOverlay),
    apiOverlay = apiContractPins.filter((e) => present.has(e.path)),
    apiResult = afterPhoto.map((p) => ({
      path: p.path,
      sha256: apiOverlay.find((e) => e.path === p.path)?.currentSha256 ?? p.sha256,
    }));
  const afterApi = mergeReviewedPins(afterPhoto, apiResult, apiOverlay),
    ciOverlay = ciValidationPins.filter((e) => present.has(e.path)),
    ciResult = afterApi.map((p) => ({
      path: p.path,
      sha256: ciOverlay.find((e) => e.path === p.path)?.currentSha256 ?? p.sha256,
    }));
  return {
    pins: mergeReviewedPins(afterApi, ciResult, ciOverlay),
    exceptions: new Set(
      [...entries, ...overlay, ...staffOverlay, ...photoOverlay, ...apiOverlay, ...ciOverlay].map(
        (e) => e.path,
      ),
    ).size,
  };
}
export const photoDependencyPins = Object.freeze(
  [
    {
      path: 'package.json',
      baselineSha256: '6c73ff4729672ee2a60221b905d54c0b6b7ced30ab3c9f19b5be7aee0a5bf3f6',
      currentSha256: '84e7ae89cc0e804b64f4b02abc5273b6152399bbb21791e9de40e06d92f0964b',
      reason:
        'Explicit pinned local Sharp0.35.5 tooling dependency with existing peer/native resolutions; frozen historical execution and all acceptance holds retained.',
    },
    {
      path: 'pnpm-lock.yaml',
      baselineSha256: '8f784e4bcd1555139d363fdae9a339b8379cb1c80dc4118f863600cc02b2ea3c',
      currentSha256: 'd0ed0cf9f1b6469150d1ae0a7eb4527bc37d2000327613d69262fc03c6cba97a',
      reason:
        'Explicit pinned local Sharp0.35.5 tooling dependency with existing peer/native resolutions; frozen historical execution and all acceptance holds retained.',
    },
  ].map((p) => Object.freeze(p)),
);

// Only the two normal contract scripts advance to generate/check the opt-in API.
// Dependency pins, old execution receipts and actual acceptance remain unchanged.
export const apiContractPins = Object.freeze(
  [
    {
      path: 'package.json',
      baselineSha256: '84e7ae89cc0e804b64f4b02abc5273b6152399bbb21791e9de40e06d92f0964b',
      currentSha256: '695486b5da6baa31ccb9a4b02386a508e788f7edc8ea56933ae5e2c8c52d1098',
      reason:
        'Only contracts:generate and contracts:check include the opt-in Phase2 artifact; dependencies, lockfile, historical execution and all acceptance holds retained.',
    },
  ].map((p) => Object.freeze(p)),
);

// The full Linux job outgrew its old 25-minute budget. Only this exact CI file
// advances; historical digests, verification commands and acceptance stay unchanged.
export const ciValidationPins = Object.freeze(
  [
    {
      path: '.github/workflows/ci.yml',
      baselineSha256: '3ae81ef5a983948dffb7d5beed26006c4c151d308424cf835ec5e04a5643e99f',
      currentSha256: '494d8afd76ec4ca8195db6863e4288ac522df9861570b67e483838b13b3f65f3',
      reason:
        'Only the bounded bootstrap CI job budget increases from 25 to 40 minutes so the complete unchanged verification command can finish. Historical manifests, individual proof limits and all acceptance holds remain unchanged.',
    },
  ].map((p) => Object.freeze(p)),
);
