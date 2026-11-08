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
      partnerApiContracts.every((x) => x.path.startsWith('/api/v1/') && x.access === 'partner'),
    ).toBe(true);
  });
});
