import { it, expect } from 'vitest';
import { providerSelection } from '../../scripts/runtime/fixture-provider.ts';
it('requires an explicit durable generation selection and rejects unknown or redirected modes', () => {
  expect(providerSelection(undefined)).toEqual({
    endpoint: 'http://moto:5000',
    file: '/state/current/provider.json',
  });
  expect(providerSelection('durable')).toEqual({
    endpoint: 'http://moto-durable:5000',
    file: '/state/provider-v2/provider.json',
  });
  for (const mode of ['production', '../dev', 'http://example.com', ''])
    expect(() => providerSelection(mode)).toThrow('Unknown local provider mode');
});
