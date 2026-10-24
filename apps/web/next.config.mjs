import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPayload } from '@payloadcms/next/withPayload';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default withPayload({
  output: 'standalone',
  outputFileTracingRoot: repositoryRoot,
  turbopack: { root: repositoryRoot },
  transpilePackages: ['@tt/config', '@tt/contracts'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
});
