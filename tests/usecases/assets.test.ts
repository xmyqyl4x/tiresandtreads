import { it, expect, vi } from 'vitest';
import { createAssetService } from '../../packages/application/src/services/assets.ts';
import type {
  AssetLocation,
  AssetRepository,
  AssetInput,
  PrivateObjects,
} from '../../packages/application/src/ports/assets.ts';
import type { AssetGrant } from '../../packages/application/src/ports/private-records.ts';
import type {
  UnitOfWork,
  TransactionContext,
} from '../../packages/application/src/ports/transactions.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import { id, revision, fail } from '../../packages/domain/src/values/core.ts';
function uid<K extends string>(kind: K) {
  const v = id(kind, '11111111-1111-4111-8111-111111111111');
  if (!v.ok) throw Error('fixture');
  return v.value;
}
const rev = revision('1');
if (!rev.ok) throw Error('fixture');
const input: AssetInput = {
  id: uid('asset'),
  purpose: 'report_pdf',
  mime: 'application/pdf',
  sha256: 'a'.repeat(64),
  size: 3,
};
const asset: AssetLocation = {
  id: input.id,
  revision: rev.value,
  key: 'assets/' + input.id,
  mime: input.mime,
  sha256: input.sha256,
  size: input.size,
  version: 'v1',
  state: 'ready',
};
const grant: AssetGrant = {
  assetId: input.id,
  reportId: uid('report'),
  version: 1,
  scope: 'owner',
  sha256: input.sha256,
  sizeBytes: 3n,
  mimeType: input.mime,
};
const tx = {} as TransactionContext;
function fixture() {
  const uow: UnitOfWork = {
    async run(work) {
      try {
        return await work(tx);
      } catch {
        return fail(failure('unavailable'));
      }
    },
  };
  const assets: AssetRepository = {
    register: vi.fn(async () => ({ ...asset, state: 'pending' as const })),
    get: vi.fn(async () => asset),
    ready: vi.fn(),
    deleting: vi.fn(async () => ({ ...asset, state: 'deleting' as const })),
    deleted: vi.fn(),
    cleanup: vi.fn(async () => [input.id]),
  };
  const objects: PrivateObjects = {
    put: vi.fn(async () => 'v1'),
    get: vi.fn(async () => new Uint8Array([1, 2, 3])),
    erase: vi.fn(),
  };
  const capabilities = { download: vi.fn(async (): Promise<AssetGrant | null> => grant) };
  return {
    assets,
    objects,
    capabilities,
    service: createAssetService({ uow, assets, objects, authority: uow, capabilities }),
  };
}
it('uploads outside SQL, reuses only the verified ready version and completes deletion', async () => {
  const f = fixture();
  expect(await f.service.upload(input, new Uint8Array(3))).toBe(input.id);
  expect(f.assets.ready).toHaveBeenCalled();
  vi.mocked(f.assets.register).mockResolvedValue(asset);
  expect(await f.service.upload(input, new Uint8Array(3))).toBe(input.id);
  vi.mocked(f.objects.put).mockResolvedValue('different');
  await expect(f.service.upload(input, new Uint8Array(3))).rejects.toThrow('Asset unavailable');
  expect(await f.service.reconcile()).toEqual([input.id]);
  await f.service.erase(input.id);
  expect(f.assets.deleted).toHaveBeenCalled();
});
it('cannot authorize a failed registration, deleting asset, or uncommitted ready transition', async () => {
  const f = fixture();
  vi.mocked(f.assets.register).mockRejectedValue(Error('canary'));
  await expect(f.service.upload(input, new Uint8Array(3))).rejects.toThrow('Asset unavailable');
  vi.mocked(f.assets.register).mockResolvedValue({ ...asset, state: 'deleted' });
  await expect(f.service.upload(input, new Uint8Array(3))).rejects.toThrow('Asset unavailable');
  vi.mocked(f.assets.register).mockResolvedValue({ ...asset, state: 'pending' });
  vi.mocked(f.assets.ready).mockRejectedValue(Error('canary'));
  await expect(f.service.upload(input, new Uint8Array(3))).rejects.toThrow('Asset unavailable');
});
it('requires current authority before storage access and rechecks it after retrieval', async () => {
  const f = fixture();
  expect(await f.service.download([])).toEqual({
    bytes: new Uint8Array([1, 2, 3]),
    mime: input.mime,
  });
  f.capabilities.download.mockResolvedValue(null);
  await expect(f.service.download([])).rejects.toThrow('Asset unavailable');
  f.capabilities.download.mockRejectedValue(Error('canary'));
  await expect(f.service.download([])).rejects.toThrow('Asset unavailable');
  expect(f.objects.get).toHaveBeenCalledTimes(1);
});
it.each([
  null,
  { ...asset, state: 'deleting' as const },
  { ...asset, sha256: 'b'.repeat(64) },
  { ...asset, size: 4 },
])('refuses a missing or mismatched private object before I/O', async (changed) => {
  const f = fixture();
  vi.mocked(f.assets.get).mockResolvedValue(changed);
  await expect(f.service.download([])).rejects.toThrow('Asset unavailable');
  expect(f.objects.get).not.toHaveBeenCalled();
});
it('fails closed on storage metadata errors and changed authority at the final check', async () => {
  const f = fixture();
  vi.mocked(f.assets.get).mockRejectedValue(Error('canary'));
  await expect(f.service.download([])).rejects.toThrow('Asset unavailable');
  vi.mocked(f.assets.get).mockResolvedValue(asset);
  f.capabilities.download
    .mockResolvedValueOnce(grant)
    .mockResolvedValueOnce({ ...grant, sha256: 'b'.repeat(64) });
  await expect(f.service.download([])).rejects.toThrow('Asset unavailable');
  const other = id('asset', '22222222-2222-4222-8222-222222222222');
  if (!other.ok) throw Error('fixture');
  f.capabilities.download
    .mockResolvedValueOnce(grant)
    .mockResolvedValueOnce({ ...grant, assetId: other.value });
  await expect(f.service.download([])).rejects.toThrow('Asset unavailable');
});
it('retains failed deletion and reconciliation work for recovery', async () => {
  const f = fixture();
  vi.mocked(f.assets.deleting).mockRejectedValue(Error('canary'));
  await expect(f.service.erase(input.id)).rejects.toThrow('Asset unavailable');
  vi.mocked(f.assets.deleting).mockResolvedValue({ ...asset, state: 'deleting' });
  vi.mocked(f.assets.deleted).mockRejectedValue(Error('canary'));
  await expect(f.service.erase(input.id)).rejects.toThrow('Asset unavailable');
  vi.mocked(f.assets.cleanup).mockRejectedValue(Error('canary'));
  await expect(f.service.reconcile()).rejects.toThrow('Asset unavailable');
});
