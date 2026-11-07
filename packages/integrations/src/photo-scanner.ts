import type {
  PhotoScanner,
  PhotoScanTransport,
} from '../../application/src/ports/photo-services.ts';
import { boundedIO } from './bounded-io.ts';
export function createPhotoScanner(transport: PhotoScanTransport): PhotoScanner {
  return Object.freeze<PhotoScanner>({
    async scan(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 10485760)
        return 'unsafe';
      try {
        const out = await boundedIO(
          (signal) => transport.scan(new Uint8Array(bytes), signal),
          5000,
        );
        return out === 'clean' || out === 'unsafe' ? out : 'unavailable';
      } catch {
        return 'unavailable';
      }
    },
  });
}
