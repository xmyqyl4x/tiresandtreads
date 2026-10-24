import path from 'node:path';
import { buildConfig } from 'payload';
import { postgresAdapter } from '@payloadcms/db-postgres';

export function cmsFoundationConfig(
  url: string,
  secret: string,
  migrationDir = path.resolve('infra/database/cms'),
) {
  return buildConfig({
    secret,
    telemetry: false,
    logger: { options: { level: 'silent' } },
    admin: { disable: true, user: 'cms-staff' },
    graphQL: { disable: true },
    typescript: { autoGenerate: false },
    db: postgresAdapter({
      pool: {
        connectionString: url,
        max: 3,
        connectionTimeoutMillis: 3000,
        statement_timeout: 15000,
        lock_timeout: 3000,
      },
      push: false,
      disableCreateDatabase: true,
      idType: 'uuid',
      migrationDir,
    }),
    email: () => ({
      name: 'disabled',
      defaultFromAddress: 'disabled@example.invalid',
      defaultFromName: 'Disabled',
      sendEmail: async () => {
        throw new Error('CMS delivery is not configured');
      },
    }),
    collections: [
      {
        slug: 'cms-staff',
        auth: {
          disableLocalStrategy: true,
          strategies: [
            { name: 'verified-identity-required', authenticate: async () => ({ user: null }) },
          ],
        },
        access: {
          read: () => false,
          create: () => false,
          update: () => false,
          delete: () => false,
          admin: () => false,
        },
        fields: [{ name: 'appStaffId', type: 'text', required: true, unique: true }],
      },
    ],
  });
}
