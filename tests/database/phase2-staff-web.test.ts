import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { staffWebFixture } from '../fixtures/phase2/staff-web.ts';
import { createP2StaffClient } from '../../packages/contracts/src/phase2-staff-client.ts';
import { createP2PartnerClient } from '../../packages/contracts/src/phase2-partner-client.ts';
import { createP2ReviewClient } from '../../packages/contracts/src/phase2-review-client.ts';
import { offerBody, target, value } from '../fixtures/phase2/compose-partner-services.ts';
import { p2Id } from '../../packages/integrations/src/http/phase2-common.ts';
import { csvMetadata } from '../../apps/web/src/phase2/staff/forms.ts';
it('runs staff publication and independent partner review through actual Next, private typed APIs and PostgreSQL', async () => {
  const f = await staffWebFixture();
  try {
    const page = await f.web.request('/staff/data'),
      html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('Data and partner review');
    expect(html).not.toContain(f.company.org);
    expect(html).not.toContain(f.uploader);
    const asset = await f.web.request('/local-preview-assets/p2-staff-client.js'),
      gzip = gzipSync(await asset.text()).length;
    expect(asset.status).toBe(200);
    expect(gzip).toBeLessThan(250000);
    const transport =
      (token: string): typeof fetch =>
      async (input, init) => {
        const u = new URL(String(input));
        const response = await f.web.request('/local-p2-staff-api' + u.pathname + u.search, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            authorization: 'Bearer ' + token,
            origin: f.web.webOrigin,
          },
        });
        if (!response.ok)
          console.log(
            'P2_STAFF_WEB_REFUSAL ' + JSON.stringify({ path: u.pathname, status: response.status }),
          );
        return response;
      };
    const clients = async (token: string) => {
      const send = transport(token),
        review = createP2ReviewClient(f.web.webOrigin, send),
        csrf = (await review.p2StaffSession({})).data.csrf;
      return {
        csv: createP2StaffClient(f.web.webOrigin, send),
        review,
        partner: createP2PartnerClient(f.web.webOrigin, send),
        command: () => ({ key: randomUUID(), csrf }),
      };
    };
    const uploader = await clients(f.uploader),
      reviewer = await clients(f.reviewer),
      publisher = await clients(f.publisher),
      verifier = await clients(f.p.verifier),
      moderator = await clients(f.p.moderator),
      tenant = createP2ReviewClient(f.web.webOrigin, transport(f.company.handle));
    await expect(
      tenant.p2BusinessQueue({ query: { after: null, limit: 25 } }),
    ).rejects.toBeDefined();
    await expect(
      uploader.review.p2OfferQueue({ query: { after: null, limit: 25 } }),
    ).rejects.toBeDefined();
    const businessQueue = (
      await verifier.review.p2BusinessQueue({ query: { after: null, limit: 25 } })
    ).data;
    expect(businessQueue.items.map((r) => r.org)).toContain(f.pending.org);
    const context = (await verifier.review.p2BusinessReview({ path: { org: f.pending.org } })).data;
    expect(context.profile.state).toBe('submitted');
    expect(context.agreements).toHaveLength(3);
    expect(context.locations).toHaveLength(1);
    const evidence = context.assets.find((a) => a.purpose === 'agreement')!;
    expect(
      (
        await verifier.review.p2ReviewEvidence({
          path: { org: f.pending.org, asset: evidence.id },
          query: { purpose: 'agreement' },
        })
      ).data.text,
    ).toContain('agreement');
    await expect(
      moderator.review.p2ReviewEvidence({
        path: { org: f.company.org, asset: evidence.id },
        query: { purpose: 'agreement' },
      }),
    ).rejects.toBeDefined();
    const offer = randomUUID();
    value(
      await f.p.offers.draft(
        f.company.handle,
        f.company.org,
        p2Id('partner_offer', offer),
        1,
        offerBody(),
        [target()],
      ),
    );
    value(
      await f.p.offers.submit(f.company.handle, f.company.org, p2Id('partner_offer', offer), 1),
    );
    expect(
      (await moderator.review.p2OfferQueue({ query: { after: null, limit: 25 } })).data.items.some(
        (r) => r.resource === offer,
      ),
    ).toBe(true);
    const detail = (
      await moderator.review.p2OfferReviewDetail({
        path: { org: f.company.org, offer, version: '1' },
      })
    ).data;
    expect(detail.state).toBe('pending_review');
    expect(detail.text).toContain('USD 25.00');
    expect(detail.targets[0]?.strategy).toBe('store_wide');
    expect(detail).not.toHaveProperty('partnerAuthor');
    await moderator.partner.p2OfferReview({
      path: { org: f.company.org, offer },
      body: { version: 1, approved: true, reason: 'local_independent_review' },
      command: moderator.command(),
    });
    expect(
      (
        await moderator.review.p2OfferReviewDetail({
          path: { org: f.company.org, offer, version: '1' },
        })
      ).data.state,
    ).toBe('reviewed');
    const form = new FormData();
    for (const [k, v] of Object.entries({
      template: f.example.template.id,
      provider: f.example.input.providerId,
      license: f.example.input.licenseId,
      effective: f.example.input.effectiveAt,
      externalVersion: f.example.input.externalVersion,
    }))
      form.set(k, v);
    const schema = (await uploader.csv.p2CsvSchema({ path: { template: f.example.template.id } }))
      .data;
    expect(schema.template.columns.some((c) => c.name === 'model_id')).toBe(true);
    const uploaded = (
      await uploader.csv.p2CsvUpload({
        query: csvMetadata(form),
        bytes: f.example.bytes,
        command: uploader.command(),
      })
    ).data;
    expect(uploaded.phase).toBe('registered');
    const path = { intake: uploaded.id! };
    expect(
      (await uploader.csv.p2CsvValidate({ path, body: {}, command: uploader.command() })).data
        .phase,
    ).toBe('prepared');
    const preview = (
      await uploader.csv.p2CsvPreview({ path, body: {}, command: uploader.command() })
    ).data;
    expect(preview.complete).toBe(true);
    await expect(
      uploader.csv.p2CsvReview({
        path,
        body: { previewId: preview.id, decision: 'approved', reason: 'self_review' },
        command: uploader.command(),
      }),
    ).rejects.toBeDefined();
    await expect(publisher.csv.p2CsvStatus({ path })).rejects.toBeDefined();
    const approved = (
      await reviewer.csv.p2CsvReview({
        path,
        body: { previewId: preview.id, decision: 'approved', reason: 'local_review' },
        command: reviewer.command(),
      })
    ).data;
    await publisher.csv.p2CsvPublish({
      path,
      body: { reviewId: approved.id },
      command: publisher.command(),
    });
    expect((await publisher.csv.p2CsvReceipt({ path })).data.publicationBundleId).toBeTruthy();
    const invalid = (
      await uploader.csv.p2CsvUpload({
        query: { ...csvMetadata(form), externalVersion: randomUUID() },
        bytes: new TextEncoder().encode('wrong,header\nprivate,cell\n'),
        command: uploader.command(),
      })
    ).data;
    expect(invalid.phase).toBe('invalid');
    expect(invalid.errors).not.toContain('private');
    console.log(
      'P2_STAFF_WEB_EVIDENCE ' +
        JSON.stringify({
          actualNext: true,
          actualPostgreSQL: true,
          actualEncryptedLocalCsv: true,
          independentReviewPublisher: true,
          permissionScopedQueues: true,
          currentEvidenceRead: true,
          sourceFormsUsed: true,
          privateGzipBytes: gzip,
          actualBrowserInteraction: false,
          actualS4S5Acceptance: false,
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
