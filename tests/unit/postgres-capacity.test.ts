import { expect, it } from 'vitest';
import { postgresCapacity } from '../../packages/config/src/postgres-capacity.ts';
import { requireHeadroom } from '../../scripts/capacity/headroom.ts';

it('excludes PostgreSQL reserved slots and admits the exact usable boundary', () => {
  expect(postgresCapacity(75, 3, 2, 70)).toEqual({
    capacity: 75,
    serverReserved: 5,
    usableCapacity: 70,
  });
  expect(() => postgresCapacity(75, 3, 2, 71)).toThrow(/^Invalid PostgreSQL capacity$/);
  expect(postgresCapacity(100, 3, 0, 65).usableCapacity).toBe(97);
});
it.each([
  [75, -1, 2, 1],
  [75, 3, -1, 1],
  [75, 75, 0, 1],
  [75, 74, 1, 1],
  [75, 3, 2, 0],
  [75, 3, 2, 1.5],
  [NaN, 3, 2, 1],
  [75, 3.5, 2, 1],
  [0, 0, 0, 1],
  [Infinity, 0, 0, 1],
])('refuses invalid or ambiguous server capacity %j', (a, b, c, d) =>
  expect(() => postgresCapacity(a, b, c, d)).toThrow(),
);
const space = {
  totalBytes: 1024n * 1024n * 1024n,
  availableBytes: 512n * 1024n * 1024n,
  freeInodes: 1024n,
};
it('requires available space, inode and percentage headroom without floating point conversion', () => {
  expect(requireHeadroom(space)).toBe(true);
  expect(requireHeadroom({ ...space, totalBytes: 2n ** 70n, availableBytes: 2n ** 69n })).toBe(
    true,
  );
});
it.each([
  { ...space, availableBytes: 1n },
  { ...space, freeInodes: 127n },
  { ...space, totalBytes: 0n },
  { ...space, availableBytes: space.totalBytes + 1n },
  { ...space, totalBytes: 100n * space.totalBytes, availableBytes: space.availableBytes },
])('refuses low or inconsistent disk evidence before writes', (s) =>
  expect(() => requireHeadroom(s)).toThrow(/^Local capacity headroom unavailable$/),
);
