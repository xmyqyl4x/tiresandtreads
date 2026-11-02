import pg from 'pg';
import { context, publicPlan, settings } from '../multitarget-coordination/transport.ts';
import { capture } from '../populated-preservation/reader.ts';
import { sourceDigest } from '../populated-preservation/contract.ts';
import { within } from '../io-inspection/budget.ts';
import {
  HandoffRefusal,
  profiles,
  type Profile,
  type Bindings,
  type Observation,
} from './contract.ts';

export function guard() {
  if (
    process.argv.length !== 2 ||
    process.env.APP_ENV !== 'test-local' ||
    process.env.PROVIDER_MODE !== 'fixtures' ||
    !/^tt-test-[a-f0-9]{16}$/.test(process.env.ISOLATED_TEST_PROJECT ?? '')
  )
    throw new HandoffRefusal('fixture');
}
export function profile(): Profile {
  const p = process.env.HANDOFF_PROFILE;
  if (!profiles.includes(p as Profile)) throw new HandoffRefusal('profile');
  return p as Profile;
}
export function bindings(): Bindings {
  const c = context(publicPlan());
  const image = process.env.HANDOFF_IMAGE ?? '',
    config = process.env.HANDOFF_CONFIG ?? '';
  if (!/^sha256:[a-f0-9]{64}$/.test(image) || !/^[a-f0-9]{64}$/.test(config))
    throw new HandoffRefusal('bindings');
  return {
    project: c.project,
    generation: c.generation,
    image,
    config,
    sourceDigest: sourceDigest(),
  };
}
export class ReadFault extends HandoffRefusal {
  constructor(
    code: string,
    readonly nativeEndObserved: boolean,
  ) {
    super(code);
  }
}
async function endpoint(
  slot: number,
  kind: 'app' | 'cms',
  probe: boolean,
): Promise<Observation | null> {
  const c = context(publicPlan());
  const db = new pg.Client(
    settings(c, slot, kind, probe ? 'tt-restore-write-denial' : 'tt-restore-readonly'),
  );
  db.on('error', () => {});
  let ended = false,
    result: Observation | null = null,
    error: unknown;
  db.once('end', () => {
    ended = true;
  });
  const started = performance.now();
  try {
    await db.connect();
    await db.query(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL transaction_timeout='5s'",
    );
    const facts = (
      await db.query(
        "SELECT current_user AS actor,session_user AS session_actor,current_database() AS database,current_setting('server_version_num')::int AS version,current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()",
      )
    ).rows[0];
    const actor = `tt_${kind}_migrator`;
    if (
      facts.actor !== actor ||
      facts.session_actor !== actor ||
      facts.owner !== actor ||
      facts.database !== `tt_${kind}_recovery` ||
      facts.version !== 180006 ||
      facts.readonly !== 'on' ||
      facts.isolation !== 'repeatable read' ||
      facts.tls !== true
    )
      throw new HandoffRefusal('identity');
    if (probe) {
      let refused = false;
      try {
        await db.query(
          kind === 'app'
            ? "UPDATE app.subjects SET status='active' WHERE false"
            : "UPDATE public.articles SET title='forbidden' WHERE false",
        );
      } catch (e) {
        if ((e as { code?: string }).code !== '25006') throw new HandoffRefusal('write-probe');
        refused = true;
      }
      if (!refused) throw new HandoffRefusal('write-probe');
    } else result = await capture(db, slot, kind);
    await db.query('ROLLBACK');
    if (performance.now() - started >= 6000) throw new HandoffRefusal('elapsed');
  } catch (e) {
    error = e;
  }
  try {
    await within(db.end(), 750);
  } catch {
    error = new HandoffRefusal('end-unobserved');
  }
  if (!ended) error = new HandoffRefusal('end-unobserved');
  if (error)
    throw new ReadFault(error instanceof HandoffRefusal ? error.code : 'read-unavailable', ended);
  return result;
}
export const inspectEndpoint = (slot: number, kind: 'app' | 'cms') =>
  endpoint(slot, kind, false) as Promise<Observation>;
export const writeDenial = (slot: number, kind: 'app' | 'cms') => endpoint(slot, kind, true);
export async function inspectFour() {
  const result: Observation[] = [];
  for (const e of context(publicPlan()).endpoints)
    result.push(await inspectEndpoint(e.slot, e.kind));
  return result;
}
