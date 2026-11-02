import { createHash } from 'node:crypto';
import { readReviewBytes } from './repository-files.mjs';
import { pinList, reviewPath } from './evidence-catalog.mjs';

export function verifyReviewFiles(root, rawPins, rawReferences) {
  const pins = pinList(rawPins);
  if (!Array.isArray(rawReferences) || rawReferences.length > 512)
    throw Error('Evidence review input refused');
  const references = rawReferences.map(reviewPath);
  if (new Set(references).size !== references.length) throw Error('Evidence review input refused');
  const expected = new Map(pins.map((pin) => [pin.path, pin.sha256]));
  const files = [...new Set([...expected.keys(), ...references])].sort();
  if (files.length > 512) throw Error('Evidence review input refused');
  let bytesRead = 0,
    matchedPins = 0,
    filesChecked = 0;
  const issues = [];
  for (const path of files) {
    const remaining = 16_777_216 - bytesRead;
    if (remaining <= 0) throw Error('Evidence review input refused');
    filesChecked++;
    let bytes;
    try {
      bytes = readReviewBytes(root, path, Math.min(2_000_000, remaining));
    } catch {
      issues.push({ path, code: 'unreadable' });
      continue;
    }
    bytesRead += bytes.length;
    if (expected.has(path)) {
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expected.get(path)) issues.push({ path, code: 'digest-mismatch' });
      else matchedPins++;
    }
  }
  return { filesChecked, bytesRead, matchedPins, issues };
}
