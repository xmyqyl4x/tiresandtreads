import { it, expect } from 'vitest';
import { localApiDocument } from '../../scripts/contracts/local-api.mjs';
it('allows an owner to discover saved quotes after a page reload', () => {
  expect(localApiDocument().paths['/api/v1/reports/{reportId}/quotes']?.get).toMatchObject({
    operationId: 'readQuotes',
  });
});
