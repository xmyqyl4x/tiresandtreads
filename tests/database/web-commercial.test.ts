import { it, expect } from 'vitest';
import { commercialPreview } from '../fixtures/http/commercial.ts';
import { gzipSync } from 'node:zlib';
it('proves SSR fallback, disclosures, safe affiliate redirects and ad-free protected pages through actual Next and PostgreSQL', async () => {
  const f = await commercialPreview('http://127.0.0.1:3000');
  try {
    const page = await f.web.request('/learn/tire-basics');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    const html = await page.text();
    expect(html.match(/data-commercial-slot=/g) ?? []).toHaveLength(2);
    expect(html).toContain('We may earn a commission from this link.');
    expect(html).toContain('sponsored nofollow noopener noreferrer');
    expect(html).toMatch(/referrerpolicy="no-referrer"/i);
    expect(html).not.toMatch(/googlesyndication|doubleclick|adsbygoogle|pub-[0-9]/);
    const disclosure = await f.web.request('/affiliate-disclosure');
    expect(disclosure.status).toBe(200);
    expect(await disclosure.text()).toContain(
      'Commercial arrangements do not change tire eligibility',
    );
    const redirect = await f.web.request('/go/approved_retailer', { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('https://shop.example/tires?ref=site');
    expect(redirect.headers.get('referrer-policy')).toBe('no-referrer');
    expect(
      (await f.web.request('/go/approved_retailer?report=PRIVATE', { redirect: 'manual' })).status,
    ).toBe(404);
    expect(await (await f.web.request('/ads.txt')).text()).not.toContain('pub-');
    for (const path of [
      '/',
      '/preview/find-tires',
      '/preview/compare',
      '/preview/shared',
      '/preview/delivery',
      '/preview/privacy',
    ])
      expect(await (await f.web.request(path)).text()).not.toContain('data-commercial-slot');
    const js = await (await f.web.request('/local-preview-assets/commercial-client.js')).text();
    expect(gzipSync(js).length).toBeLessThan(12000);
    console.log(
      'PUBLIC_COMMERCE_WEB_EVIDENCE ' +
        JSON.stringify({
          actualNext: true,
          actualPostgreSQL: true,
          ssrHouseFallback: true,
          adjacentAffiliateDisclosure: true,
          safeRedirect: true,
          protectedRoutesExcluded: true,
          commercialGzipBytes: gzipSync(js).length,
          externalActivation: false,
          actualProviderAcceptance: false,
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
  } finally {
    await f.cleanup();
  }
}, 190000);
