import { it, expect } from 'vitest';
import sharp from 'sharp';
import { createIsolatedPhotoCodec } from '../../packages/integrations/src/photo-codec.ts';
const codec = createIsolatedPhotoCodec();
it.each(['jpeg', 'png', 'webp'] as const)(
  'decodes and re-encodes an actual %s in a bounded child',
  async (format) => {
    const bytes = await sharp({
        create: { width: 30, height: 20, channels: 3, background: '#abcdef' },
      })
        .toFormat(format)
        .toBuffer(),
      out = await codec.sanitize(
        bytes,
        ('image/' + format) as 'image/jpeg' | 'image/png' | 'image/webp',
      ),
      meta = await sharp(out.bytes).metadata();
    expect(out).toMatchObject({
      mime: 'image/jpeg',
      originalWidth: 30,
      originalHeight: 20,
      width: 30,
      height: 20,
    });
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  },
);
it('applies orientation and removes EXIF and other metadata from the actual encoded output', async () => {
  const bytes = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#888888' },
  })
    .withMetadata({
      orientation: 6,
      exif: {
        IFD0: { Artist: 'SYNTHETIC_PRIVATE_MARKER' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '40/1 0/1 0/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '74/1 0/1 0/1',
        },
      },
    })
    .jpeg()
    .toBuffer();
  expect((await sharp(bytes).metadata()).exif).toBeDefined();
  const out = await codec.sanitize(bytes, 'image/jpeg'),
    meta = await sharp(out.bytes).metadata();
  expect([meta.width, meta.height]).toEqual([30, 40]);
  for (const key of ['exif', 'icc', 'iptc', 'xmp', 'orientation'] as const)
    expect(meta[key]).toBeUndefined();
  expect(Buffer.from(out.bytes).includes(Buffer.from('SYNTHETIC_PRIVATE_MARKER'))).toBe(false);
});
it('downscales a real large image to the bounded provider dimensions', async () => {
  const bytes = await sharp({
      create: { width: 5000, height: 100, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer(),
    out = await codec.sanitize(bytes, 'image/png');
  expect(out.width).toBe(4096);
  expect(out.height).toBeLessThan(100);
});
it.each([
  { bytes: new Uint8Array([255, 216, 255, 1, 2, 3]), mime: 'image/jpeg' as const },
  { bytes: new TextEncoder().encode('<svg/>'), mime: 'image/jpeg' as const },
  { bytes: new Uint8Array(10485761), mime: 'image/png' as const },
])('rejects malformed/unsupported/oversized input %#', async ({ bytes, mime }) =>
  expect(codec.sanitize(bytes, mime)).rejects.toThrow(),
);
it('refuses MIME mismatches before decoding', async () => {
  const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  await expect(codec.sanitize(bytes, 'image/jpeg')).rejects.toThrow();
});
it('rejects an actual valid compressed PNG over40 megapixels before decoding its raster', async () => {
  const bytes = await sharp({
    create: { width: 40001, height: 1000, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  expect(bytes.length).toBeLessThan(10485760);
  expect(await sharp(bytes, { limitInputPixels: false }).metadata()).toMatchObject({
    format: 'png',
    width: 40001,
    height: 1000,
  });
  await expect(codec.sanitize(bytes, 'image/png')).rejects.toThrow();
}, 20000);
it('rejects a real two-frame animated WebP rather than extracting an arbitrary first frame', async () => {
  const a = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#f00' } })
      .png()
      .toBuffer(),
    b = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#00f' } })
      .png()
      .toBuffer(),
    bytes = await sharp([a, b], { join: { animated: true } })
      .webp()
      .toBuffer();
  expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(2);
  await expect(codec.sanitize(bytes, 'image/webp')).rejects.toThrow();
});
