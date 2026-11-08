import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createTransactions } from '../../../packages/db/src/transactions.ts';
import { createPartnerInsightsServices } from '../../../packages/application/src/partners/partner-insights.ts';
import { createPartnerInsightsRepository } from '../../../packages/db/src/repositories/partner-insights.ts';
import { createInsightsTokens } from '../../../packages/integrations/src/insights-tokens.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { httpAdmissionSources } from './http-admission.ts';
import { composeGenericAnalysis } from './compose-generic-analysis.ts';
import { ownerWebFixture } from './owner-web.ts';
import { composePartnerServices, uuid } from './compose-partner-services.ts';
import { withPartnerSessions } from '../../../packages/integrations/src/http/partner-security.ts';
import { createAnalysisOperationsService } from '../../../packages/application/src/analysis/analysis-operations.ts';
import { createAnalysisOperationsRepository } from '../../../packages/db/src/repositories/analysis-operations.ts';
import { analysisOperationsRoutes } from '../../../packages/integrations/src/http/phase2-operations.ts';
import { createStaffServices } from '../../../packages/application/src/services/staff.ts';
import { createStaffRepository } from '../../../packages/db/src/repositories/staff-services.ts';
import { createOperationsServices } from '../../../packages/application/src/services/analytics.ts';
import { createOperationsRepository } from '../../../packages/db/src/repositories/operations.ts';
import { createHealthRepository } from '../../../packages/db/src/repositories/analytics-maintenance.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { validateSources } from '../../../scripts/database/manifest.ts';
import { fail } from '../../../packages/domain/src/values/core.ts';
import { failure } from '../../../packages/application/src/ports/transactions.ts';
import { p2Id } from '../../../packages/integrations/src/http/phase2-common.ts';
export function operationsSources() {
  const dir = 'infra/database/phase-2-local/analysis-operations/',
    prior = httpAdmissionSources(),
    sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex'),
    manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
  if (
    manifest.kind !== 'opt-in-disposable-local' ||
    manifest.promoted !== false ||
    manifest.baseAppManifestSha256 !== sha('infra/database/app/manifest.json') ||
    manifest.priorLocalManifestSha256 !==
      sha('infra/database/phase-2-local/http-admission/manifest.json') ||
    manifest.priorLocalHead !== prior.sources.at(-1)!.id ||
    JSON.stringify(manifest.migrations.map((m: { id: string }) => m.id)) !==
      JSON.stringify(['0055_analysis_operations']) ||
    JSON.stringify(
      readdirSync(dir)
        .filter((n) => n.endsWith('.sql'))
        .sort(),
    ) !== JSON.stringify(['0055_analysis_operations.sql'])
  )
    throw Error('Exact local operations chain required');
  const extra = manifest.migrations.map((m: { id: string; sha256: string }) => ({
    ...m,
    source: readFileSync(dir + m.id + '.sql', 'utf8'),
  }));
  validateSources(extra);
  return { sources: [...prior.sources, ...extra], manifest };
}
export async function operationsWebFixture(origin = 'http://127.0.0.1:3000') {
  let context:
    | {
        service: ReturnType<typeof createAnalysisOperationsService>;
        p: Awaited<ReturnType<typeof composePartnerServices>>;
        generic: Awaited<ReturnType<typeof composeGenericAnalysis>>;
        operator: { id: string; handle: string };
        observer: { id: string; handle: string };
        photoObserver: { id: string; handle: string };
        unassigned: { id: string; handle: string };
        executeCalls: string[];
      }
    | undefined;
  const pools: pg.Pool[] = [];
  const base = await ownerWebFixture(origin, async (c) => {
    const scope = (role: Parameters<typeof c.f.connectionUrl>[0]) => {
      const pool = new pg.Pool({
        connectionString: c.f.connectionUrl(role),
        max: 2,
        connectionTimeoutMillis: 3000,
      });
      pools.push(pool);
      return createTransactions(pool, { transactionMs: 15000, statementMs: 8000, lockMs: 3000 });
    };
    c.onCleanup(async () => {
      await Promise.all(pools.map((p) => p.end()));
    });
    await migrateApplication(c.f.target, operationsSources().sources);
    const generic = await composeGenericAnalysis(c.f, c.analysis);
    const p = await composePartnerServices(c.f),
      adapter = c.analysis.adapter,
      repository = createAnalysisOperationsRepository(adapter),
      staffScope = scope('tt_staff_service_runtime'),
      operationScope = scope('tt_operations_runtime'),
      executeCalls: string[] = [];
    const service = createAnalysisOperationsService({
      uow: adapter.unitOfWork,
      repository,
      authority: p.d.authority,
      clock: p.d.clock,
      digest: p.d.crypto.digest,
      execute: async (task, request) => {
        executeCalls.push(request);
        return task === 'report_analysis'
          ? c.runtime.execute(p2Id('ai_request', request))
          : task === 'photo_extraction'
            ? c.photo.service.execute(p2Id('ai_request', request))
            : generic.service.execute(p2Id('ai_request', request));
      },
    });
    const staff = createStaffServices({
      uow: staffScope.unitOfWork,
      repo: createStaffRepository(staffScope),
      identity: { checksum: p.d.crypto.digest },
      recovery: { execute: async () => fail(failure('forbidden')) },
    });
    const insightsScope = c.f.insightsAdapter(),
      pilot = createPartnerInsightsServices({
        uow: insightsScope.unitOfWork,
        repository: createPartnerInsightsRepository(insightsScope, p.d.crypto.digest),
        authority: p.d.authority,
        clock: p.d.clock,
        crypto: p.d.crypto,
        tokens: createInsightsTokens(randomBytes(32)),
        encryption: {
          encrypt: async () => {
            throw Error('Not exposed by read-only operations');
          },
          decrypt: async () => {
            throw Error('Not exposed by read-only operations');
          },
        },
      });
    const operations = createOperationsServices({
      uow: operationScope.unitOfWork,
      operations: createOperationsRepository(operationScope),
      health: createHealthRepository(operationScope),
    });
    async function who(roles: string[]) {
      const id = uuid('staff'),
        subject = 'local-ops-' + id;
      await c.f.admin.query(
        "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$2,'active',clock_timestamp())",
        [id, subject],
      );
      for (const role of roles)
        await c.f.admin.query(
          'INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code=$2',
          [id, role],
        );
      return { id, handle: p.session(subject, id) };
    }
    const operator = await who([
        'ai_operator',
        'photo_observer',
        'privacy_operator',
        'support_operator',
        'operations_read',
        'delivery_operator',
      ]),
      observer = await who(['ai_observer']),
      photoObserver = await who(['photo_observer']),
      unassigned = await who([]);
    context = { service, p, generic, operator, observer, photoObserver, unassigned, executeCalls };
    return {
      routes: analysisOperationsRoutes({
        service,
        staff,
        operations,
        pilot,
        secret: c.secret,
        admission: c.admission,
      }),
      security: (security) => withPartnerSessions(security, p.d.authority, c.secret),
    };
  });
  if (!context) {
    await base.cleanup();
    throw Error('Operations composition missing');
  }
  return {
    ...base,
    ...context,
    operationsMigrationHead: operationsSources().sources.at(-1)!.id,
  };
}
