import { describe, expect, it } from 'vitest';
import {
  partnerApiInputs,
  csvApiInputs,
  partnerApiContracts,
} from '../../packages/contracts/src/phase2-partners.ts';
describe('Phase2 private HTTP admission contracts', () => {
  it('refuses caller identity and executable upload locations', () => {
    expect(
      partnerApiInputs.register.safeParse({ legalName: 'Example', market: 'US', subject: 'other' })
        .success,
    ).toBe(false);
    expect(
      csvApiInputs.upload.safeParse({
        templateId: crypto.randomUUID(),
        providerId: crypto.randomUUID(),
        licenseId: crypto.randomUUID(),
        market: 'US',
        effectiveAt: new Date().toISOString(),
        externalVersion: '1',
        url: 'https://example.com/input.csv',
      }).success,
    ).toBe(false);
  });
  it('keeps wire money exact and requires expected revisions', () => {
    expect(partnerApiInputs.profile.safeParse({ services: ['sales'] }).success).toBe(false);
    expect(partnerApiInputs.profile.safeParse({ expected: '1', services: ['sales'] }).success).toBe(
      true,
    );
  });
  it('declares only private versioned operations with unique names', () => {
    expect(new Set(partnerApiContracts.map((x) => x.operationId)).size).toBe(
      partnerApiContracts.length,
    );
    expect(
      partnerApiContracts.every(
        (x) =>
          x.path.startsWith('/api/v1/') &&
          ['partner', 'staff', 'staff-or-partner'].includes(x.access),
      ),
    ).toBe(true);
    expect(
      partnerApiContracts
        .filter((x) => x.access === 'staff')
        .map((x) => x.operationId)
        .sort(),
    ).toEqual([
      'p2Activate',
      'p2Decide',
      'p2Domains',
      'p2Health',
      'p2Internal',
      'p2OfferPublish',
      'p2OfferReview',
      'p2Verification',
      'p2Visitors',
    ]);
    expect(
      partnerApiContracts.filter((x) => x.access === 'staff-or-partner').map((x) => x.operationId),
    ).toEqual(['p2Lifecycle', 'p2Dispute']);
  });
});
