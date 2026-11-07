import sharp from 'sharp';
sharp.cache(false);
sharp.concurrency(1);
try {
  const chunks = [];
  let count = 0;
  for await (const chunk of process.stdin) {
    count += chunk.length;
    if (count > 10485760) throw Error('limit');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks),
    image = sharp(bytes, { failOn: 'warning', limitInputPixels: 40000000, sequentialRead: true });
  const meta = await image.metadata();
  if (
    !['jpeg', 'png', 'webp'].includes(meta.format) ||
    !meta.width ||
    !meta.height ||
    meta.width * meta.height > 40000000 ||
    (meta.pages ?? 1) !== 1
  )
    throw Error('unsupported');
  const { data, info } = await image
    .rotate()
    .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .timeout({ seconds: 5 })
    .toBuffer({ resolveWithObject: true });
  if (data.length < 1 || data.length > 10485760) throw Error('limit');
  process.stdout.write(
    JSON.stringify({
      format: meta.format,
      width: info.width,
      height: info.height,
      originalWidth: meta.width,
      originalHeight: meta.height,
    }) + '\n',
  );
  process.stdout.write(data);
} catch {
  process.exitCode = 1;
}
