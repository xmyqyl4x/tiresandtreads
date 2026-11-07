import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { PhotoCodec } from '../../application/src/ports/photo-services.ts';
import { imageMime } from '../../domain/src/photo-policy.ts';
let activeCodecs = 0;
export function createIsolatedPhotoCodec(): PhotoCodec {
  return Object.freeze<PhotoCodec>({
    async sanitize(input, mime) {
      if (
        !(input instanceof Uint8Array) ||
        input.length < 1 ||
        input.length > 10485760 ||
        imageMime(input) !== mime
      )
        throw Error('Invalid photo');
      if (activeCodecs >= 2) throw Error('Photo decoder busy');
      activeCodecs++;
      const bytes = Buffer.from(input);
      return new Promise<Awaited<ReturnType<PhotoCodec['sanitize']>>>((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
              '--max-old-space-size=128',
              fileURLToPath(new URL('./photo-codec-child.mjs', import.meta.url)),
            ],
            {
              stdio: ['pipe', 'pipe', 'pipe'],
              windowsHide: true,
              env: {
                NODE_ENV: process.env.NODE_ENV ?? 'test',
                SystemRoot: process.env.SystemRoot ?? '',
                SHARP_IGNORE_GLOBAL_LIBVIPS: '1',
              },
            },
          ),
          chunks: Buffer[] = [];
        let length = 0,
          failed = false,
          done = false;
        const fail = () => {
          failed = true;
          child.kill();
        };
        const timer = setTimeout(fail, 10000);
        child.stdout.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 10486016) fail();
          else chunks.push(chunk);
        });
        child.stderr.resume();
        child.on('error', fail);
        child.stdin.on('error', fail);
        child.on('close', (code) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try {
            if (failed || code !== 0) throw Error('Invalid photo');
            const all = Buffer.concat(chunks),
              line = all.indexOf(10);
            if (line < 1 || line > 255) throw Error('Invalid photo');
            const meta = JSON.parse(all.subarray(0, line).toString('utf8')),
              output = all.subarray(line + 1);
            if (
              meta.format !== mime.slice(6) ||
              !['width', 'height', 'originalWidth', 'originalHeight'].every(
                (k) => Number.isInteger(meta[k]) && meta[k] >= 1,
              ) ||
              meta.width > 4096 ||
              meta.height > 4096 ||
              meta.originalWidth * meta.originalHeight > 40000000 ||
              output.length > 10485760 ||
              imageMime(output) !== 'image/jpeg'
            )
              throw Error('Invalid photo');
            resolve(
              Object.freeze({
                bytes: new Uint8Array(output),
                mime: 'image/jpeg',
                width: meta.width,
                height: meta.height,
                originalWidth: meta.originalWidth,
                originalHeight: meta.originalHeight,
              }),
            );
          } catch {
            reject(Error('Invalid photo'));
          }
        });
        child.stdin.end(bytes);
      }).finally(() => {
        activeCodecs--;
      });
    },
  });
}
