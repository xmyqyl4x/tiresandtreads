export const databaseRoles = {
  app: [
    'tt_app_migrator',
    'tt_app_runtime',
    'tt_staff_runtime',
    'tt_asset_runtime',
    'tt_catalog_runtime',
    'tt_ingest_runtime',
    'tt_publish_runtime',
    'tt_private_runtime',
    'tt_content_runtime',
    'tt_public_runtime',
    'tt_analytics_runtime',
    'tt_limiter_runtime',
    'tt_operations_runtime',
    'tt_report_source_runtime',
    'tt_privacy_runtime',
    'tt_staff_service_runtime',
    'tt_commercial_runtime',
  ],
  cms: ['tt_cms_migrator', 'tt_cms_runtime'],
} as const;
export type DatabaseRole = (typeof databaseRoles)[keyof typeof databaseRoles][number];
export type RolePasswords = Readonly<Record<DatabaseRole, string>>;
