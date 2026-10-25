import { it, expect } from 'vitest';
import { normalizeAssessment } from '../../packages/engine/src/input.ts';

it('normalizes explicit size strings without equating passenger and light-truck prefixes', () => {
  const parsed = normalizeAssessment({
    regionKey: 'synthetic_us',
    market: 'US',
    configurationId: null,
    wheelPackage: null,
    sizes: { front: ' p225/45r18 ', rear: 'lt225/45r18' },
    strategy: 'year_round',
    winterUse: 'none',
    replace: ['rear_right', 'front_right', 'rear_left', 'front_left'],
    priorities: ['wet'],
    budget: null,
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.sizes).toEqual({ front: 'P225/45R18', rear: 'LT225/45R18' });
  expect(parsed.value.replace).toEqual(['front_left', 'front_right', 'rear_left', 'rear_right']);
});
