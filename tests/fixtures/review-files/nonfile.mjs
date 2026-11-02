import { realpathSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { readReviewJson } from '../../../scripts/review/repository-files.mjs';

const root = process.argv[2];
if (
  process.argv.length !== 3 ||
  !root ||
  !isAbsolute(root) ||
  dirname(root) !== realpathSync(tmpdir()) ||
  realpathSync(root) !== root ||
  lstatSync(root).isSymbolicLink() ||
  !/^tt-review-nonfile-[a-zA-Z0-9]+$/.test(basename(root))
)
  throw Error('Owned non-file probe refused');
const info = lstatSync(join(root, 'input.json'));
if (!(process.platform === 'win32' ? info.isDirectory() : info.isFIFO()))
  throw Error('Native non-file control refused');
let refused = false;
try {
  readReviewJson(root, 'input.json');
} catch (error) {
  refused = error?.message === 'Repository review input refused';
}
if (!refused) throw Error('Non-file input was not refused');
console.log(
  'REVIEW_NONFILE_EVIDENCE ' +
    JSON.stringify({
      nativeControl: process.platform === 'win32' ? 'directory' : 'fifo',
      refusedBeforeRead: true,
      providerDispatches: 0,
      casesClosed: 0,
      gatesClosed: 0,
    }),
);
