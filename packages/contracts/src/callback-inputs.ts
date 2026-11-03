import { z } from 'zod';
const empty = z.strictObject({});
export const collectionBatchSchema = z
  .strictObject({
    events: z
      .array(
        z.strictObject({
          id: z.string().uuid(),
          name: z.enum([
            'public_page_view',
            'assessment_started',
            'report_viewed',
            'comparison_saved',
            'delivery_requested',
          ]),
          occurredAt: z.iso.datetime({ precision: 3 }),
          route: z.enum([
            '/',
            '/assess',
            '/reports/:report',
            '/compare/:report',
            '/learn/:slug',
            '/guides/:slug',
            '/glossary/:slug',
            '/tires/models/:slug',
            '/tires/sizes/:slug',
          ]),
          props: z.strictObject({
            step: z.enum(['start', 'vehicle', 'tires', 'conditions', 'results']).optional(),
            outcome: z.enum(['success', 'denied', 'failed']).optional(),
          }),
        }),
      )
      .min(1)
      .max(50),
  })
  .describe(
    'The domain service also validates event/route compatibility, identity uniqueness and time bounds.',
  );
export const mailCallbackSchema = z.looseObject({
  type: z.string().max(200),
  created_at: z.iso.datetime({ precision: 3 }),
  data: z.looseObject({ email_id: z.string().uuid().optional() }),
});
export const callbackInputSchemas = {
  wakeDurableJob: z.strictObject({
    jobId: z
      .string()
      .uuid()
      .refine((value) => value !== '00000000-0000-0000-0000-000000000000'),
  }),
  issueAnalyticsGrant: z.strictObject({
    channel: z.enum(['web', 'app', 'mcp']).default('web'),
    cmpAvailable: z.boolean(),
  }),
  confirmEmail: empty,
  withdrawEmail: empty,
  confirmEmailLink: empty,
  updatePreferences: z.strictObject({ action: z.enum(['confirm', 'withdraw']) }),
  recordEmailFeedback: z.strictObject({ value: z.enum(['yes', 'no']) }),
  oneClickUnsubscribe: z.strictObject({ 'List-Unsubscribe': z.literal('One-Click') }),
  oneClickUnsubscribeApi: z.strictObject({ 'List-Unsubscribe': z.literal('One-Click') }),
  collectEvents: collectionBatchSchema,
  receiveMailCallback: mailCallbackSchema,
};
