export function requireHeadroom(s: {
  totalBytes: bigint;
  availableBytes: bigint;
  freeInodes: bigint;
}) {
  if (
    s.totalBytes <= 0n ||
    s.availableBytes < 64n * 1024n * 1024n ||
    s.availableBytes > s.totalBytes ||
    s.availableBytes * 100n < s.totalBytes * 5n ||
    s.freeInodes < 128n
  )
    throw Error('Local capacity headroom unavailable');
  return true;
}
