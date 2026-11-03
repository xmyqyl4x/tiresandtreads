import './browser-runtime.ts';
import { strictObject, string, record, boolean, uuid } from 'zod/mini';
export const apiErrorSchema = strictObject({
  code: string(),
  messageKey: string(),
  fieldErrors: record(string(), string()),
  retryable: boolean(),
  requestId: uuid(),
});

export { toJSONSchema as wireSchemaJson } from 'zod/mini';
