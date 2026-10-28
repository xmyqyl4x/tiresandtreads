import { writeFileSync, renameSync } from 'node:fs';
import {
  admitLocalRelease,
  localSelection,
  expansionDigest,
} from '../../../scripts/deployment/preflight.ts';
import { deploymentContext, readFixture } from './context.ts';
const ctx = deploymentContext(),
  plan = admitLocalRelease(readFixture('release'), process.env),
  slot = process.argv[2];
const state = { version: 1, project: ctx.project, slot, expansionDigest };
localSelection(state, plan);
writeFileSync('/deployment/state-next.json', JSON.stringify(state), { mode: 0o600, flag: 'wx' });
renameSync('/deployment/state-next.json', '/deployment/state.json');
