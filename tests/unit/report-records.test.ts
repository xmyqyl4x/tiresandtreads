import { it, expect } from 'vitest';
import {
  canonical,
  reportDiff,
  publicReport,
  ReportFault,
  serviceFailure,
} from '../../packages/application/src/services/report-records.ts';
it('canonicalizes exact money without accepting unknown JSON values or leaking secrets', () => {
  expect(canonical({ z: 1n, a: { x: null } })).toBe('{"a":{"x":null},"z":"1"}');
  expect(() => canonical({ x: undefined })).toThrow();
  expect(() => canonical({ x: Infinity })).toThrow();
  const timeout = { code: 'timeout' as const, messageKey: 'errors.timeout', retryable: true };
  expect(serviceFailure(new ReportFault('timeout', timeout))).toEqual(timeout);
});
it('separates answer, data and rule changes when explaining a new immutable version', () => {
  const a = {
    input: { regionKey: 'A' },
    output: {
      result: { versions: { bundleId: 'a', policy: '1', scoring: '1' }, picks: ['a', 'b'] },
    },
  };
  const b = {
    input: { regionKey: 'B' },
    output: {
      result: { versions: { bundleId: 'b', policy: '1', scoring: '2' }, picks: ['b', 'c'] },
    },
  };
  expect(reportDiff(a, b)).toEqual({
    answersChanged: true,
    dataChanged: true,
    rulesChanged: true,
    scoresComparable: false,
    added: ['c'],
    removed: ['a'],
    reranked: ['b'],
  });
});
it('shares an allowlisted historical view without owner input, evidence internals or private quotes', () => {
  const dto = publicReport({
    purpose: 'technical_evaluation',
    issuanceAuthorized: false,
    result: {
      asOf: 'now',
      versions: { engine: '1' },
      picks: ['p'],
      decisions: [
        {
          id: 'p',
          status: 'eligible',
          reasons: ['FITMENT_VERIFIED'],
          scoreBp: 12,
          confidence: 1,
          budget: 'within',
          secret: 'no',
        },
      ],
    },
    evidence: { token: 'no' },
    input: { email: 'no' },
    quotes: { shopName: 'no' },
  });
  expect(JSON.stringify(dto)).not.toMatch(/secret|shopName|email|token|evidence|confidence|budget/);
  expect(dto.issuanceAuthorized).toBe(false);
});
