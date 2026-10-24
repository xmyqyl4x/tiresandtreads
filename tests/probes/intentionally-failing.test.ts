import { expect, it } from 'vitest';

it('INTENTIONAL_GATE_PROBE must fail to prove failure propagation', () => {
  expect('red').toBe('green');
});
