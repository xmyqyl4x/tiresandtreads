import { writeFile, rename, unlink } from 'node:fs/promises';
import { startWebPreview } from './web-preview.ts';
import type { Id } from '../../../packages/domain/src/values/core.ts';
// Manual disposable browser proof only. Fixed synthetic records are not production authentication.
// Only an existing in-memory inbox port is invoked; no recipient, external mail or HTTP proof endpoint.
const preview = await startWebPreview('http://127.0.0.1:8380', 'dev', 'synthetic'),
  fixture = preview.synthetic!;
const file = '/tmp/tt-pr036-synthetic-links.json',
  links = new Map<string, unknown>(),
  delivered = new Set<string>();
let reading = false,
  pending = Promise.resolve();
const allowed = (address: string) => /^p1-pr-036-[a-z0-9-]+@example\.invalid$/.test(address);
async function observe() {
  if (reading) return;
  reading = true;
  try {
    const intents = await fixture.db.admin.query(
      'SELECT id FROM privacy.verification_challenges WHERE used_at IS NULL AND invalidated_at IS NULL AND expires_at>clock_timestamp() ORDER BY created_at DESC,id LIMIT 20',
    );
    for (const row of intents.rows) {
      const result = await fixture.contacts.verificationMessage(row.id as Id<'verification'>);
      if (result.ok && allowed(result.value.email) && links.size < 40) {
        const p = result.value;
        links.set(p.email + ':' + p.purpose, {
          email: p.email,
          purpose: p.purpose,
          verify: p.verificationToken,
          unsubscribe: p.unsubscribeToken,
        });
      }
    }
    const requests = await fixture.db.admin.query(
      "SELECT r.id,r.encrypted_reply_context FROM privacy.privacy_requests r JOIN privacy.request_work w ON w.request_id=r.id WHERE r.status='pending' AND r.encrypted_reply_context IS NOT NULL ORDER BY r.created_at DESC,r.id LIMIT 10",
    );
    for (const row of requests.rows) {
      const email = Buffer.from(row.encrypted_reply_context).toString('utf8');
      if (!allowed(email) || links.size >= 40 || delivered.size >= 40) continue;
      if (!delivered.has(row.id)) {
        const result = await fixture.privacy.dispatchVerification(row.id as Id<'privacy_request'>);
        if (!result.ok) continue;
        delivered.add(row.id);
      }
      const message = fixture.inbox.find(
        (x) => x.address === email && x.proof.split('.')[2] === row.id,
      );
      if (message)
        links.set(email + ':privacy', { email, purpose: 'privacy', proof: message.proof });
    }
    await writeFile(
      file + '.next',
      JSON.stringify({
        synthetic: true,
        actualNotifications: 0,
        syntheticInboxMessages: fixture.inbox.length,
        providerCalls: fixture.providerCalls(),
        observations: fixture.observations,
        observationsTruncated: fixture.observationsTruncated,
        records: [...links.values()],
      }) + '\n',
      { mode: 0o600 },
    );
    await rename(file + '.next', file);
  } finally {
    reading = false;
  }
}
const timer = setInterval(() => {
  if (reading) return;
  pending = observe().catch(() => console.error('Synthetic link observation unavailable'));
}, 1000);
console.log(
  'LOCAL_WEB_PREVIEW_READY ' +
    JSON.stringify({
      origin: preview.webOrigin,
      disposable: true,
      synthetic: true,
      actualNotifications: 0,
    }),
);
let lifetime: ReturnType<typeof setTimeout> | undefined;
try {
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
    lifetime = setTimeout(resolve, 1800000);
  });
} finally {
  clearInterval(timer);
  clearTimeout(lifetime);
  await pending;
  await unlink(file).catch(() => undefined);
  await unlink(file + '.next').catch(() => undefined);
  await preview.cleanup();
}
