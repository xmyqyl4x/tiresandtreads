import { verifyRecovery } from './recovery.mjs';
if (process.argv.length !== 2) throw Error('Local custody preflight takes no arguments');
verifyRecovery({ custody: true });
