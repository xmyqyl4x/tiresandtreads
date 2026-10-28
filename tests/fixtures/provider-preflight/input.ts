export const preflightEnv = {
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  ISOLATED_TEST_PROJECT: 'tt-test-1234abcd',
};
export function providerInput(env = preflightEnv) {
  const suffix = env.ISOLATED_TEST_PROJECT.slice(8);
  return {
    mode: 'local-provider-preflight',
    storageEndpoint: 'http://moto:5000',
    workflowEndpoint: 'http://inngest:8288',
    region: 'us-east-1',
    account: '123456789012',
    privateBucket: `tt-preflight-${suffix}-private`,
    publicBucket: `tt-preflight-${suffix}-public`,
    keyArn: 'arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111',
    objectVersion: '11111111-1111-4111-8111-111111111111',
    kmsCiphertext: 'ab'.repeat(64),
    mailMode: 'no-send',
  };
}
