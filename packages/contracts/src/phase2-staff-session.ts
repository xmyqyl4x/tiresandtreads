import { isStaffCredential } from './staff-session.ts';
// Transport only. Opaque credentials are retained for explicit local fixture authorities.
export const isP2StaffCredential = (v: unknown): v is string =>
  isStaffCredential(v) || (typeof v === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v));
export const isP2StaffAuthorization = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('Bearer ') && isP2StaffCredential(v.slice(7));
