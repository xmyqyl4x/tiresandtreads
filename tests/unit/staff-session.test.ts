import { it, expect } from 'vitest';
import {
  isStaffCredential,
  isStaffAuthorization,
  maxStaffCredentialLength,
} from '../../packages/contracts/src/staff-session.ts';
const token = 'eyJhbGciOiJSUzI1NiJ9.' + 'a'.repeat(200) + '.' + 'b'.repeat(342);
it('accepts bounded opaque fixture and JWT syntax without interpreting claims as authority', () => {
  expect(isStaffCredential('a'.repeat(43))).toBe(true);
  expect(isStaffCredential(token)).toBe(true);
  expect(isStaffAuthorization('Bearer ' + token)).toBe(true);
  expect(isStaffCredential('x.y.z')).toBe(true);
  const boundary = 'a.' + 'b'.repeat(maxStaffCredentialLength - 4) + '.c';
  expect(boundary.length).toBe(maxStaffCredentialLength);
  expect(isStaffCredential(boundary)).toBe(true);
  expect(isStaffCredential(boundary + 'x')).toBe(false);
});
it.each([
  undefined,
  null,
  12,
  {},
  [],
  true,
  '',
  'a'.repeat(42),
  'a'.repeat(44),
  'a.b',
  'a.b.c.d',
  '.a.b',
  'a..b',
  'a.b.',
  'a.b.c ',
  ' a.b.c',
  'a.b.c\n',
  'a.b.c/',
  'a.b.é',
])('refuses malformed credential syntax: %s', (value) =>
  expect(isStaffCredential(value)).toBe(false),
);
it.each(['bearer ' + token, 'Bearer  ' + token, 'Basic ' + token, token, 'Bearer ' + token + '\n'])(
  'refuses malformed authorization headers: %s',
  (header) => expect(isStaffAuthorization(header)).toBe(false),
);
