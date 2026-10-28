import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { canonical } from '../../packages/application/src/services/service-records.ts';
import type {
  PrivacyCrypto,
  SignedPrivacyRecord,
} from '../../packages/application/src/ports/privacy-services.ts';
import { validateRecoveryArtifact } from './recovery-artifact.ts';
import type { MigrationSource } from './manifest.ts';

const names = ['app', 'cms', 'object', 'journal', 'metadata'] as const;
type Name = (typeof names)[number];
type Keys = Readonly<Record<string, Uint8Array>>;
type Header = { version: 1; project: string; backupFinishedAt: string; keyVersion: string };
type Envelope = Header & { items: Record<Name, { iv: string; tag: string; hex: string }> };
const refused = () => new Error('Local custody admission refused');
function record(value: unknown, fields: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== fields
  )
    throw refused();
  return value as Record<string, unknown>;
}
function header(h: Header, keys: Keys) {
  if (
    h.version !== 1 ||
    !/^tt-test-[a-f0-9]{8,32}$/.test(h.project) ||
    !/^[a-z][a-z0-9-]{0,39}$/.test(h.keyVersion) ||
    keys[h.keyVersion]?.length !== 32 ||
    !Number.isFinite(Date.parse(h.backupFinishedAt))
  )
    throw refused();
  return keys[h.keyVersion]!;
}
function aad(h: Header, name: Name) {
  return Buffer.from(canonical({ ...h, name }));
}

// Local synthetic preflight format only. Keys are supplied separately and never included in a bundle.
export function sealCustody(h: Header, bytes: Record<Name, Buffer>, keys: Keys): Envelope {
  const key = header(h, keys);
  const items = Object.fromEntries(
    names.map((name) => {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad(h, name));
      const ciphertext = Buffer.concat([cipher.update(bytes[name]), cipher.final()]);
      return [
        name,
        {
          iv: iv.toString('hex'),
          tag: cipher.getAuthTag().toString('hex'),
          hex: ciphertext.toString('hex'),
        },
      ];
    }),
  ) as Envelope['items'];
  return { ...h, items };
}

// Complete admission precedes returning ANY plaintext to the restore orchestrator.
export function openCustody(
  value: unknown,
  options: {
    project: string;
    keys: Keys;
    crypto: PrivacyCrypto;
    lookupVersions: readonly string[];
    currentJournalDigest: string;
    now: number;
    sources: Record<'app' | 'cms', readonly MigrationSource[]>;
  },
) {
  const plaintext: Partial<Record<Name, Buffer>> = {};
  try {
    const r = record(value, 'backupFinishedAt,items,keyVersion,project,version');
    const h = {
      version: r.version,
      project: r.project,
      backupFinishedAt: r.backupFinishedAt,
      keyVersion: r.keyVersion,
    } as Header;
    const key = header(h, options.keys);
    const age = options.now - Date.parse(h.backupFinishedAt);
    if (h.project !== options.project || age < 0 || age > 86400000) throw refused();
    const items = record(r.items, 'app,cms,journal,metadata,object');
    for (const name of names) {
      const item = record(items[name], 'hex,iv,tag');
      const max = name === 'app' || name === 'cms' ? 64 * 1024 * 1024 : 2 * 1024 * 1024;
      if (
        typeof item.iv !== 'string' ||
        !/^[a-f0-9]{24}$/.test(item.iv) ||
        typeof item.tag !== 'string' ||
        !/^[a-f0-9]{32}$/.test(item.tag) ||
        typeof item.hex !== 'string' ||
        !item.hex.length ||
        item.hex.length > max * 2 ||
        item.hex.length % 2 ||
        !/^[a-f0-9]+$/.test(item.hex)
      )
        throw refused();
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(item.iv, 'hex'));
      decipher.setAAD(aad(h, name));
      decipher.setAuthTag(Buffer.from(item.tag, 'hex'));
      const partial = decipher.update(Buffer.from(item.hex, 'hex'));
      try {
        plaintext[name] = Buffer.concat([partial, decipher.final()]);
      } finally {
        partial.fill(0);
      }
    }
    const metadata = record(JSON.parse(plaintext.metadata!.toString()), 'app,cms,object');
    for (const kind of ['app', 'cms'] as const)
      validateRecoveryArtifact(
        metadata[kind],
        plaintext[kind]!,
        kind,
        h.project,
        options.sources[kind],
      );
    const object = record(metadata.object, 'keyVersion,sha256,versionId');
    if (
      object.versionId !== 'synthetic-object-v1' ||
      object.keyVersion !== 'synthetic-object-key-v1' ||
      object.sha256 !== createHash('sha256').update(plaintext.object!).digest('hex')
    )
      throw refused();
    const snapshot: SignedPrivacyRecord = JSON.parse(plaintext.journal!.toString());
    const doc = record(options.crypto.verify(snapshot), 'capturedAt,entries,version');
    const journalAge = options.now - Date.parse(String(doc.capturedAt));
    if (
      doc.version !== 1 ||
      typeof doc.capturedAt !== 'string' ||
      !Number.isFinite(journalAge) ||
      journalAge < -5000 ||
      journalAge > 300000 ||
      Date.parse(doc.capturedAt) < Date.parse(h.backupFinishedAt) ||
      !Array.isArray(doc.entries) ||
      doc.entries.length < 1 ||
      doc.entries.length > 1000
    )
      throw refused();
    if (
      !/^[a-f0-9]{64}$/.test(options.currentJournalDigest) ||
      createHash('sha256').update(canonical(doc.entries, 2097152)).digest('hex') !==
        options.currentJournalDigest
    )
      throw refused();
    for (const raw of doc.entries) {
      const entry = record(raw, 'action,markers,policy,resourceKind,tombstones,version');
      if (
        entry.version !== 1 ||
        !['delete', 'restrict', 'opt_out'].includes(String(entry.action)) ||
        !['subject', 'report'].includes(String(entry.resourceKind)) ||
        typeof entry.policy !== 'string' ||
        entry.policy.length > 100
      )
        throw refused();
      for (const name of ['markers', 'tombstones'] as const) {
        if (
          !Array.isArray(entry[name]) ||
          entry[name].length > 1000 ||
          (name === 'markers' && !entry[name].length)
        )
          throw refused();
        for (const rawKey of entry[name]) {
          const k = record(rawKey, 'digest,keyVersion');
          if (
            typeof k.digest !== 'string' ||
            !/^[a-f0-9]{64}$/.test(k.digest) ||
            typeof k.keyVersion !== 'string' ||
            !(name === 'markers' ? options.crypto.versions : options.lookupVersions).includes(
              k.keyVersion,
            )
          )
            throw refused();
        }
      }
    }
    return {
      app: plaintext.app!,
      cms: plaintext.cms!,
      object: plaintext.object!,
      snapshot,
      backupFinishedAt: h.backupFinishedAt,
    };
  } catch {
    for (const bytes of Object.values(plaintext)) bytes.fill(0);
    throw refused();
  } finally {
    plaintext.journal?.fill(0);
    plaintext.metadata?.fill(0);
  }
}
