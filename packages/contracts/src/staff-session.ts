// Transport syntax only. The selected server verifier and current services grant authority.
// Never decode role, staff identity, MFA or expiration claims in browser code.
export const maxStaffCredentialLength = 8185;
export function isStaffCredential(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maxStaffCredentialLength &&
    (/^[A-Za-z0-9_-]{43}$/.test(value) ||
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))
  );
}
export function isStaffAuthorization(value: unknown): value is string {
  return (
    typeof value === 'string' && value.startsWith('Bearer ') && isStaffCredential(value.slice(7))
  );
}
