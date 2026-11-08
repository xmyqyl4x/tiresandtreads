import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { partnerWebFixture } from '../fixtures/phase2/partner-web.ts';
import { createP2PartnerClient } from '../../packages/contracts/src/phase2-partner-client.ts';
import { previewForwardHeaders } from '../fixtures/http/preview-headers.mjs';
import { offerDraft } from '../../apps/web/src/phase2/partner/forms.ts';
it('serves a private reseller portal through Next and real typed tenant APIs without activating production', async () => {
  const f = await partnerWebFixture();
  try {
    const page = await f.web.request('/partners'),
      html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('Your reseller workspace');
    expect(html).toContain('Connect locally');
    expect(html).toContain('noindex,nofollow');
    expect(html).not.toContain(f.company.org);
    expect(html).not.toContain(f.company.handle);
    expect(html).not.toContain('adsbygoogle');
    const asset = await f.web.request('/local-preview-assets/partner-client.js'),
      bytes = await asset.text();
    expect(asset.status).toBe(200);
    expect(gzipSync(bytes).length).toBeLessThan(250000);
    expect((await f.web.request('/local-preview-assets/partner-client.css')).status).toBe(200);
    const transport =
      (bearer: string): typeof fetch =>
      async (input, options) => {
        const u = new URL(String(input)),
          path = '/local-p2-api' + u.pathname + u.search;
        const response = await f.web.request(path, {
          ...options,
          headers: previewForwardHeaders(
            {
              ...Object.fromEntries(new Headers(options?.headers)),
              authorization: 'Bearer ' + bearer,
              origin: f.web.webOrigin,
            },
            new URL(f.web.webOrigin).host,
            path,
            options?.method ?? 'GET',
          ),
        });
        if (!response.ok)
          console.log(
            'P2_PORTAL_HTTP_REFUSAL ' +
              JSON.stringify({
                method: options?.method ?? 'GET',
                path: u.pathname,
                status: response.status,
              }),
          );
        return response;
      };
    const c = createP2PartnerClient(f.web.webOrigin, transport(f.company.handle)),
      stranger = createP2PartnerClient(f.web.webOrigin, transport(f.stranger));
    const csrf = (await c.p2PartnerSession({})).data.csrf,
      command = () => ({ key: randomUUID(), csrf }),
      path = { org: f.company.org };
    const before = (await c.p2Organization({ path })).data;
    expect(before.organization.status).toBe('active');
    await expect(stranger.p2Organization({ path })).rejects.toMatchObject({ code: 'not_found' });
    expect(before.profile.state).toBe('approved');
    await expect(
      c.p2Profile({
        path,
        body: { expected: before.profile.revision, services: ['sales', 'fitting', 'tpms'] },
        command: command(),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const applicant = createP2PartnerClient(f.web.webOrigin, transport(f.newPartner)),
      applicantCsrf = (await applicant.p2PartnerSession({})).data.csrf,
      applicantCommand = () => ({ key: randomUUID(), csrf: applicantCsrf }),
      registered = (
        await applicant.p2Register({
          body: { legalName: 'Native pending business', market: 'US' },
          command: applicantCommand(),
        })
      ).data,
      applicantPath = { org: registered.id! },
      initial = (await applicant.p2Organization({ path: applicantPath })).data;
    expect(initial.profile.state).toBe('draft');
    const profile = await applicant.p2Profile({
      path: applicantPath,
      body: { expected: initial.profile.revision, services: ['sales', 'fitting', 'tpms'] },
      command: applicantCommand(),
    });
    expect(profile.data.services).toContain('tpms');
    const current = await applicant.p2Organization({ path: applicantPath });
    expect(current.data.profile.revision).not.toBe(initial.profile.revision);
    const form = new FormData();
    for (const [k, v] of Object.entries({
      title: 'Native web offer',
      description: 'Synthetic private portal proof',
      included: 'Tires',
      terms: 'Subject to availability',
      kind: 'amount_off',
      amount: '25.00',
      minimumTires: '4',
      validFrom: new Date(Date.now() - 3600000).toISOString(),
      validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
      strategy: 'store_wide',
      version: '1',
    }))
      form.set(k, v);
    const offer = randomUUID();
    await c.p2OfferDraft({
      path: { ...path, offer },
      body: offerDraft(form, randomUUID()),
      command: command(),
    });
    expect(
      (await c.p2OfferPreview({ path: { ...path, offer }, query: { version: 1 } })).data.text,
    ).toContain('Native web offer');
    await c.p2OfferSubmit({ path: { ...path, offer }, body: { version: 1 }, command: command() });
    await expect(
      c.p2OfferPublish({
        path: { ...path, offer },
        body: { version: 1, expected: null },
        command: command(),
      }),
    ).rejects.toBeDefined();
    const report = (await c.p2Report({ path, query: { week: f.insights.week } })).data;
    expect(report.pilot).toBe('noncharging');
    expect(report.currency).toBeNull();
    for (const key of ['email', 'recipient', 'contact', 'prompt'])
      expect(report).not.toHaveProperty(key);
    const duplicate = command();
    await c.p2Location({
      path,
      body: {
        key: 'web',
        region: 'CA',
        address: { line1: '1 Test Road', city: 'Example', postal: '90001', country: 'US' },
      },
      command: duplicate,
    });
    await expect(
      c.p2Location({
        path,
        body: {
          key: 'web',
          region: 'CA',
          address: { line1: '1 Test Road', city: 'Example', postal: '90001', country: 'US' },
        },
        command: duplicate,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(
      (
        await f.web.request('/local-p2-api/api/v1/staff/recover', {
          method: 'POST',
          headers: { origin: f.web.webOrigin },
          body: '{}',
        })
      ).status,
    ).toBe(400);
    console.log(
      'P2_PARTNER_WEB_EVIDENCE ' +
        JSON.stringify({
          actualNext: true,
          actualPostgreSQL: true,
          typedPrivateProxy: true,
          currentTenantAuthority: true,
          sourceFormsUsed: true,
          independentModerationEnforced: true,
          duplicateCommandRefused: true,
          nonchargingAggregate: true,
          privateGzipBytes: gzipSync(bytes).length,
          actualBrowserInteraction: false,
          actualAuthenticationAccepted: false,
          actualS4S5Acceptance: false,
          productionActivation: false,
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
  } finally {
    await f.cleanup();
  }
}, 180000);
