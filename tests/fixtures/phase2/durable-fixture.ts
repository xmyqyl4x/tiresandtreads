import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { httpAdmissionFixture } from './http-admission.ts';
import { operationsSources } from './operations-web.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { composePartnerServices } from './compose-partner-services.ts';
import { composeReportAnalysis } from './compose-report-analysis.ts';
import { composeGenericAnalysis } from './compose-generic-analysis.ts';
import { composeAnalysisDelivery } from './compose-analysis-delivery.ts';
import { composeStaffCsv } from './compose-staff-csv.ts';
import type { DurableHostConfig } from './durable-host.ts';
export async function durablePhase2Fixture() {
  const f = await httpAdmissionFixture(),
    root = await mkdtemp(join(tmpdir(), 'tt-p2-durable-'));
  let delivery: Awaited<ReturnType<typeof composeAnalysisDelivery>> | undefined,
    csv: Awaited<ReturnType<typeof composeStaffCsv>> | undefined;
  const cleanup = async () => {
    await csv?.cleanup();
    await delivery?.cleanup();
    await f.cleanup();
    await rm(root, { recursive: true, force: true });
  };
  try {
    await migrateApplication(f.target, operationsSources().sources);
    const p = await composePartnerServices(f),
      r = await composeReportAnalysis(f),
      g = await composeGenericAnalysis(f, r);
    delivery = await composeAnalysisDelivery(f);
    csv = await composeStaffCsv(f);
    const materialFile = join(root, 'keys.json'),
      objectsDirectory = join(root, 'objects'),
      journalDirectory = join(root, 'journal'),
      privacyJournalDirectory = join(root, 'p1-journal'),
      configFile = join(root, 'host.json');
    await mkdir(objectsDirectory);
    await mkdir(journalDirectory);
    await mkdir(privacyJournalDirectory);
    for (const kind of ['delete', 'restrict'])
      await f.admin.query(
        "INSERT INTO privacy.retention_policies(data_class,jurisdiction,version,rule,reviewed_at) VALUES($1,'synthetic','p2-recovery',$2,clock_timestamp())",
        [
          'rights:' + kind,
          { responseDays: 14, escalationDays: 2, proofMinutes: 30, maxAttempts: 3 },
        ],
      );
    await writeFile(
      materialFile,
      JSON.stringify({
        current: 'v1',
        keys: { v1: randomBytes(32).toString('hex') },
        lookup: randomBytes(32).toString('hex'),
      }),
      { mode: 0o600 },
    );
    const roleUrl = (role: Parameters<typeof f.connectionUrl>[0]) => f.connectionUrl(role),
      config: DurableHostConfig = {
        urls: {
          partner: String(f.servicePool('tt_p2_partner_service', 1).options.connectionString),
          coupon: String(f.servicePool('tt_p2_coupon_worker', 1).options.connectionString),
          analysis: f.analysisServiceUrl,
          insights: f.insightsUrl,
          pilot: f.pilotUrl,
          private: roleUrl('tt_private_runtime'),
          privacy: roleUrl('tt_privacy_runtime'),
          asset: roleUrl('tt_asset_runtime'),
          staff: String(f.analysisPool('tt_p2_csv_staff', 1).options.connectionString),
          ingest: roleUrl('tt_ingest_runtime'),
          publish: roleUrl('tt_publish_runtime'),
        },
        materialFile,
        objectsDirectory,
        journalDirectory,
        privacyJournalDirectory,
        privacyPolicyVersion: 'p2-recovery',
        policy: { ...p.policy, assetBucket: 'local-private-phase2', assetKeyVersion: 'v1' },
        contactPolicy: delivery.contactPolicy,
        deliveryPolicy: delivery.policy,
        pilotPolicy: {
          version: 'local-pilot-v1',
          consentPolicy: 'synthetic',
          offersNotice: delivery.contactPolicy.notices.offers,
          reportNotice: delivery.contactPolicy.notices.report,
          timeZone: 'UTC',
          provider: 'fixture',
          fixture: true,
          creditUnits: '1',
        },
        rendererHash: delivery.renderer.hash,
        parserRevision: csv.options.parserRevision,
        sessions: Object.fromEntries(p.sessions),
      };
    const save = () =>
      writeFile(
        configFile,
        JSON.stringify({ ...config, sessions: Object.fromEntries(p.sessions) }),
        { mode: 0o600 },
      );
    await save();
    return {
      f,
      root,
      p,
      r,
      g,
      delivery,
      csv,
      configFile,
      config,
      save,
      materialFile,
      objectsDirectory,
      journalDirectory,
      privacyJournalDirectory,
      cleanup,
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
