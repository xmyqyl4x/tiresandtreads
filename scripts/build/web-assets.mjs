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
const editorial = await build({
  absWorkingDir: root,
  entryPoints: ['apps/web/src/editorial/client.tsx'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: join(cache, 'browser/editorial-client.js'),
  write: false,
  logLevel: 'error',
});
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
const staff = await build({
  absWorkingDir: root,
  entryPoints: ['apps/web/src/staff/client.tsx'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: join(cache, 'browser/staff-client.js'),
  write: false,
  logLevel: 'error',
});
for (const file of staff.outputFiles)
  files[basename(file.path)] = { body: file.text, type: 'text/javascript; charset=utf-8' };
const checklist = await build({
  absWorkingDir: root,
  entryPoints: ['apps/web/src/education/checklist-client.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  outfile: join(cache, 'browser/checklist-client.js'),
  write: false,
  logLevel: 'error',
});
for (const file of checklist.outputFiles)
  files[basename(file.path)] = { body: file.text, type: 'text/javascript; charset=utf-8' };
for (const file of editorial.outputFiles)
  files[basename(file.path)] = { body: file.text, type: 'text/javascript; charset=utf-8' };
writeFileSync(
  join(cache, 'assets.json'),
  JSON.stringify({
    entry: basename(entry[0]),
    editorial: 'editorial-client.js',
    staff: 'staff-client.js',
    checklist: 'checklist-client.js',
    groups: {
      visitor: browser.outputFiles.map((file) => basename(file.path)),
      editorial: editorial.outputFiles.map((file) => basename(file.path)),
      staff: staff.outputFiles.map((file) => basename(file.path)),
      checklist: checklist.outputFiles.map((file) => basename(file.path)),
    },
    css: basename(css),
    files,
  }),
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
  'export function htmlDocument(page:string):string|null;\nexport function getAsset(name:string):{readonly body:string;readonly type:string}|null;\nexport function editorialDocument():string;\nexport function staffDocument():string;\nexport function educationDocument(page:unknown,options?:{tool?:{input:string;result:unknown};checklist?:{answers:unknown;result:unknown};verification?:string}):string;\n',
);
console.log('Local React shell assets built; Next remains the HTTP/API host');
