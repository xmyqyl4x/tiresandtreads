import { operationsApiFixture } from './operations-api.ts';
import { createStaffConsoleRuntime } from '../../../packages/integrations/src/staff-console-runtime.ts';
import { staffConsoleRoutes } from '../../../packages/integrations/src/http/staff-console.ts';
import { startWebPreview } from './web-preview.ts';
import { listenLocalApi } from '../../../packages/integrations/src/http/server.ts';
export async function staffConsoleFixture() {
  return operationsApiFixture(async ({ db, services, security }) =>
    staffConsoleRoutes({
      security,
      commercial: services.commercial,
      queries: createStaffConsoleRuntime(
        {
          report: db.scope,
          content: db.adapter('tt_content_runtime'),
          ingest: db.ingestScope,
          catalog: db.adapter('tt_catalog_runtime'),
          staff: db.adapter('tt_staff_service_runtime'),
          commercial: db.adapter('tt_commercial_runtime'),
          operations: db.adapter('tt_operations_runtime'),
        },
        () => new Date().toISOString(),
      ),
    }),
  );
}
export async function staffConsolePreview(
  origin = 'http://127.0.0.1:8380',
  options = { loseRecoveryReceipt: false },
) {
  const f = await staffConsoleFixture();
  let relay: Awaited<ReturnType<typeof listenLocalApi>> | undefined,
    lostRecoveryReceipt = false;
  try {
    const operator = await f.staff('commercial_operator'),
      reviewer = await f.staff('commercial_operator'),
      limited = await f.staff('operations_read');
    await f.db.admin.query(
      "INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code IN ('operations_read','privacy_operator','data_operator','support_operator') ON CONFLICT DO NOTHING",
      [operator.id],
    );
    await f.db.admin.query(
      "INSERT INTO admin.roles(code,permissions,policy_version) VALUES('local_console_seo','[\"seo.publish\"]','synthetic-only')",
    );
    await f.db.admin.query(
      "INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code='local_console_seo'",
      [operator.id],
    );
    const owner = await f.db.owner();
    const report = await f.db.report(owner.identity);
    // Test-support-only fault: the real service commits first; only its first HTTP receipt is lost.
    relay = await listenLocalApi(() => async (request) => {
      const url = new URL(request.url),
        headers = new Headers(request.headers);
      headers.delete('host');
      headers.set('origin', f.server.origin);
      const body = request.method === 'POST' ? await request.text() : undefined;
      const response = await fetch(f.server.origin + url.pathname + url.search, {
        method: request.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (
        options.loseRecoveryReceipt &&
        !lostRecoveryReceipt &&
        request.method === 'POST' &&
        url.pathname === '/api/v1/staff/recover' &&
        response.ok
      ) {
        lostRecoveryReceipt = true;
        await response.arrayBuffer();
        return new Response('Synthetic lost acknowledgement', { status: 503 });
      }
      return response;
    });
    const api = relay;
    const web = await startWebPreview(origin, 'dev', 'unsupported', {
      fixture: { cleanup: () => f.cleanup() },
      api: { origin: api.origin, shutdown: () => api.close() },
      env: { LOCAL_STAFF_CONSOLE: 'enabled', LOCAL_STAFF_API_ORIGIN: api.origin },
    });
    return {
      ...f,
      operator,
      reviewer,
      limited,
      report,
      web,
      lostReceipt: () => lostRecoveryReceipt,
      cleanup: () => web.cleanup(),
    };
  } catch (e) {
    await relay?.close();
    await f.cleanup();
    throw e;
  }
}
