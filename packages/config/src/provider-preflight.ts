import { z } from 'zod';

export function localProviderProject(env: Readonly<Record<string, string | undefined>>) {
  if (
    env.APP_ENV !== 'test-local' ||
    env.PROVIDER_MODE !== 'fixtures' ||
    !/^tt-test-[a-f0-9]{8,32}$/.test(env.ISOLATED_TEST_PROJECT ?? '')
  )
    throw Error('Invalid local provider preflight');
  return env.ISOLATED_TEST_PROJECT!;
}
const schema = z
  .object({
    mode: z.literal('local-provider-preflight'),
    storageEndpoint: z.literal('http://moto:5000'),
    workflowEndpoint: z.literal('http://inngest:8288'),
    region: z.literal('us-east-1'),
    account: z.literal('123456789012'),
    privateBucket: z.string().max(63),
    publicBucket: z.string().max(63),
    keyArn: z
      .string()
      .regex(
        /^arn:aws:kms:us-east-1:123456789012:key\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
      ),
    objectVersion: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/),
    kmsCiphertext: z.string().regex(/^(?:[a-f0-9]{2}){16,4096}$/),
    mailMode: z.literal('no-send'),
  })
  .strict();

// This contract never authorizes hosted endpoints, credentials or resource creation.
export function readLocalProviderPreflight(
  input: unknown,
  env: Readonly<Record<string, string | undefined>>,
) {
  try {
    const project = localProviderProject(env),
      s = schema.parse(input),
      prefix = 'tt-preflight-' + project.slice(8);
    if (s.privateBucket !== prefix + '-private' || s.publicBucket !== prefix + '-public')
      throw Error();
    return Object.freeze({
      ...s,
      context: Object.freeze({ app: 'tiresandtreads', purpose: 'provider-preflight', project }),
    });
  } catch {
    throw Error('Invalid local provider preflight');
  }
}
