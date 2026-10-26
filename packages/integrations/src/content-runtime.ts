import type { createTransactions } from '../../db/src/transactions.ts';
import type {
  PublicSnapshots,
  PublicCrawler,
  SearchProvider,
} from '../../application/src/ports/content-services.ts';
import type { PublicObjectReader } from '../../application/src/ports/publication.ts';
import { createEditorialRepository } from '../../db/src/repositories/editorial.ts';
import { createContentServiceRepository } from '../../db/src/repositories/content-services.ts';
import { createPublicReadRepository } from '../../db/src/repositories/content.ts';
import { createContentServices } from '../../application/src/services/content.ts';
import { createPublicConfigurationReader } from './public-configuration.ts';
import { createPublicRoutingReader } from './public-routing.ts';
import { contentIdentity } from './content-identity.ts';
import { ok } from '../../domain/src/values/core.ts';
type Scope = ReturnType<typeof createTransactions>;
export async function createContentRuntime(o: {
  readonly appScope: Scope;
  readonly publicScope: Scope;
  readonly cmsScope: Scope;
  readonly snapshots: PublicSnapshots & PublicObjectReader;
  readonly crawler: PublicCrawler;
  readonly search: SearchProvider;
  readonly origin: string;
  readonly production: boolean;
  readonly now: () => string;
}) {
  for (const [s, role] of [
    [o.appScope, 'tt_content_runtime'],
    [o.publicScope, 'tt_public_runtime'],
    [o.cmsScope, 'tt_cms_runtime'],
  ] as const) {
    const r = await s.unitOfWork.run(async (tx) =>
      ok((await s.query(tx, 'SELECT current_user AS role')).rows[0]?.role),
    );
    if (!r.ok || r.value !== role) throw Error('Invalid content runtime role');
  }
  const read = createContentServiceRepository(o.publicScope),
    publicRead = createPublicReadRepository(o.publicScope);
  return {
    services: createContentServices({
      appUow: o.appScope.unitOfWork,
      publicUow: o.publicScope.unitOfWork,
      cmsUow: o.cmsScope.unitOfWork,
      editorial: createEditorialRepository(o.cmsScope),
      write: createContentServiceRepository(o.appScope),
      read,
      identity: contentIdentity,
      ...o,
    }),
    configuration: createPublicConfigurationReader({
      current: async () => {
        const r = await o.publicScope.unitOfWork.run(async (tx) =>
          ok(await publicRead.configuration(tx)),
        );
        if (!r.ok) throw Error('Publication unavailable');
        return r.value;
      },
      objects: o.snapshots,
      now: () => Date.parse(o.now()),
    }),
    routing: createPublicRoutingReader({
      current: async () => {
        const r = await o.publicScope.unitOfWork.run(async (tx) =>
          ok(await read.currentRedirects(tx)),
        );
        if (!r.ok) throw Error('Publication unavailable');
        return r.value;
      },
      objects: o.snapshots,
      now: () => Date.parse(o.now()),
    }),
  };
}
