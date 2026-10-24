import path from 'node:path';
import { buildConfig, type Access } from 'payload';
import { postgresAdapter } from '@payloadcms/db-postgres';

const editor: Access = ({ req }) =>
  req.user?.collection === 'proof-staff' && req.user.role === 'editor';

export function proofPayloadConfig(connectionString: string, secret: string) {
  return buildConfig({
    secret,
    telemetry: false,
    admin: { disable: true, user: 'proof-staff' },
    graphQL: { disable: true },
    typescript: { autoGenerate: false },
    email: () => ({
      name: 'proof-no-send',
      defaultFromAddress: 'fixture@example.invalid',
      defaultFromName: 'Synthetic proof',
      sendEmail: async () => {
        throw new Error('External email is forbidden in foundation proofs');
      },
    }),
    db: postgresAdapter({
      pool: { connectionString, max: 3, connectionTimeoutMillis: 3000, statement_timeout: 5000 },
      push: false,
      disableCreateDatabase: true,
      migrationDir: path.resolve('.local/foundation-migrations'),
    }),
    collections: [
      {
        slug: 'proof-staff',
        auth: {
          disableLocalStrategy: true,
          strategies: [
            { name: 'external-identity-required', authenticate: async () => ({ user: null }) },
          ],
        },
        access: { read: editor, create: () => false, update: () => false, delete: () => false },
        fields: [{ name: 'role', type: 'select', options: ['editor', 'viewer'], required: true }],
      },
      {
        slug: 'proof-content',
        access: { read: editor, create: editor, update: editor, delete: editor },
        fields: [{ name: 'label', type: 'text', required: true }],
      },
    ],
  });
}
