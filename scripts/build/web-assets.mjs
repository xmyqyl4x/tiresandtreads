import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  cache = join(root, 'apps/web/node_modules/.cache/tt-preview');
mkdirSync(cache, { recursive: true });
const browser = await build({
  absWorkingDir: root,
  entryPoints: ['apps/web/src/preview-client.tsx'],
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
  outdir: join(cache, 'browser'),
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  write: false,
  metafile: true,
  logLevel: 'error',
});
const entry = Object.entries(browser.metafile.outputs).find(
  ([path, value]) => value.entryPoint?.endsWith('preview-client.tsx') && path.endsWith('.js'),
);
if (!entry) throw Error('Preview client entry missing');
const css = browser.metafile.outputs[entry[0]].cssBundle;
if (!css) throw Error('Preview stylesheet missing');
const files = Object.fromEntries(
  browser.outputFiles.map((file) => [
    basename(file.path),
    {
      body: file.text,
      type: file.path.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : 'text/javascript; charset=utf-8',
    },
  ]),
);
writeFileSync(
  join(cache, 'assets.json'),
  JSON.stringify({ entry: basename(entry[0]), css: basename(css), files }),
);
await build({
  absWorkingDir: root,
  entryPoints: ['apps/web/src/server-render.tsx'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  jsx: 'automatic',
  minify: true,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: {
    js: "import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);",
  },
  outfile: join(cache, 'renderer.mjs'),
  logLevel: 'error',
});
writeFileSync(
  join(cache, 'renderer.d.mts'),
  'export function htmlDocument(page:string):string|null;\nexport function getAsset(name:string):{readonly body:string;readonly type:string}|null;\n',
);
console.log('Local React shell assets built; Next remains the HTTP/API host');
