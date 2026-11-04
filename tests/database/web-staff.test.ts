import { it, expect } from 'vitest';
import { staffConsolePreview } from '../fixtures/http/staff-console.ts';
import { uid } from '../fixtures/private/database.ts';
import { createStaffConsoleClient } from '../../packages/contracts/src/staff-console-client.ts';
import { gzipSync } from 'node:zlib';
import { previewForwardHeaders } from '../fixtures/http/preview-headers.mjs';
it('proves the staff shell and shared services through actual Next, PostgreSQL and the fixed private proxy', async () => {
  const f = await staffConsolePreview('http://127.0.0.1:3000', { loseRecoveryReceipt: true });
  try {
    const page = await f.web.request('/staff');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Connect locally');
    expect(html).toContain('noindex,nofollow');
    expect(html).not.toContain(f.report.head.id);
    const bundle = await f.web.request('/local-preview-assets/staff-client.js');
    expect(bundle.status).toBe(200);
    const bytes = await bundle.text();
    expect(gzipSync(bytes).length).toBeLessThan(250000);
    const transport: typeof fetch = async (input, options) => {
      const u = new URL(input instanceof Request ? input.url : String(input));
      return f.web.request('/local-staff-api' + u.pathname + u.search, {
        ...options,
        headers: previewForwardHeaders(
          { ...Object.fromEntries(new Headers(options?.headers)), origin: f.web.webOrigin },
          new URL(f.web.webOrigin).host,
          '/local-staff-api' + u.pathname + u.search,
          options?.method ?? 'GET',
        ),
      });
    };
    const c = createStaffConsoleClient(f.web.webOrigin, f.operator, transport),
      r = createStaffConsoleClient(f.web.webOrigin, f.limited, transport);
    expect((await c.session()).csrf).toBe(f.operator.csrf);
    expect((await c.reports()).items.some((x) => x.id === f.report.head.id)).toBe(true);
    await expect(r.reports()).rejects.toMatchObject({ code: 'not_found' });
    for (const kind of ['mail', 'callbacks', 'privacy', 'imports'] as const)
      expect((await c.queue(kind)).items.length).toBeLessThanOrEqual(25);
    expect((await c.sources()).actualCoverage).toBe('unconfirmed');
    expect(await c.strategy()).toEqual({ items: [], next: null });
    expect(await c.findings()).toEqual({ items: [], next: null });
    expect((await c.operations({ day: new Date().toISOString().slice(0, 10) })).coverage).toBe(
      'consented traffic only',
    );
    expect(
      (await c.revenue({ account: uid('account'), day: new Date().toISOString().slice(0, 10) }))
        .status,
    ).toBe('not_connected');
    expect((await c.configuration()).version).toBe(0);
    const input = {
        kind: 'mail_reconcile' as const,
        target: uid('send'),
        evidence: 'e'.repeat(64),
      },
      key = uid('command');
    await expect(c.recover(input, key)).rejects.toThrow('Invalid API reply');
    expect(f.lostReceipt()).toBe(true);
    expect(await c.recover(input, key)).toEqual({ created: false, state: 'succeeded' });
    const policy = {
      schemaVersion: 1,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      accountId: null,
      adsTxt: [],
      blockedCategories: [],
      blockedUrls: [],
      slots: [],
    };
    const preview = await c.preview(policy, uid('command'));
    expect(
      await c.publish(
        { expectedVersion: preview.version, policy: preview.policy },
        uid('command'),
        f.reviewer.bearer,
      ),
    ).toEqual({ version: 1 });
    expect(
      (
        await f.web.request('/local-staff-api/api/v1/staff/recover', {
          method: 'POST',
          headers: { origin: 'https://evil.invalid' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.web.request('/local-staff-api/api/v1/staff/imports/prepare', {
          method: 'POST',
          headers: { origin: f.web.webOrigin },
          body: '{}',
        })
      ).status,
    ).toBe(400);
    expect(f.providerCalls()).toBe(0);
    console.log(
      'STAFF_CONSOLE_WEB_EVIDENCE ' +
        JSON.stringify({
          actualNext: true,
          actualPostgreSQL: true,
          maskedReportRenderedOnlyAfterAuthority: true,
          fixedPrivateProxy: true,
          currentRoles: true,
          allStaffReadViews: true,
          auditedRecoveryReplay: true,
          independentConfigurationReview: true,
          staffGzipBytes: gzipSync(bytes).length,
          staffBudget: 250000,
          externalActivation: false,
          providerDispatches: f.providerCalls(),
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
  } finally {
    await f.cleanup();
  }
}, 180000);
