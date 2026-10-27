import { it, expect } from 'vitest';
import { contentFixture } from '../fixtures/content/database.ts';
import { assertNoProviderData } from '../../scripts/runtime/local-provider-audit.ts';
it('refuses provider replacement when any discovered encrypted field or JSON key reference is populated', async () => {
  const f = await contentFixture(),
    key = 'arn:fixture:retired-key';
  try {
    expect(await assertNoProviderData(f.owner, key)).toBeGreaterThan(0);
    await f.owner.query(
      'CREATE TABLE public.provider_guard_probe(id integer,encrypted_payload bytea,metadata jsonb)',
    );
    await f.owner.query(
      "INSERT INTO public.provider_guard_probe VALUES(1,decode(repeat('00',32),'hex'),'{}')",
    );
    await expect(assertNoProviderData(f.owner, key)).rejects.toThrow('Stored encrypted data');
    await f.owner.query(
      'UPDATE public.provider_guard_probe SET encrypted_payload=NULL,metadata=$1',
      [{ keyRef: key }],
    );
    await expect(assertNoProviderData(f.owner, key)).rejects.toThrow('Stored key references');
    await f.owner.query("UPDATE public.provider_guard_probe SET metadata='{}'");
    expect(await assertNoProviderData(f.owner, key)).toBeGreaterThan(0);
  } finally {
    await f.cleanup();
  }
}, 30000);
