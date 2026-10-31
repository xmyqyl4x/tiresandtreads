import { writeFileSync } from 'node:fs';
// Authorized, bounded, privileged synthetic setup only. Existing initializer exits
// and closes every administrative client before either observer starts.
await import('../tls-admission/setup.ts');
writeFileSync(
  '/admin/root.json',
  JSON.stringify({
    password: process.env.POSTGRES_PASSWORD,
    project: process.env.ISOLATED_TEST_PROJECT,
  }),
  { flag: 'wx', mode: 0o600 },
);
console.log('Private synthetic inspector custody prepared; observer has no admin mount');
