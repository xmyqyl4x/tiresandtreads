import { build } from 'esbuild';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
if (process.argv.length !== 2) throw Error('Fixed portal render probe accepts no arguments');
const output = await build({
  stdin: {
    contents: `import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {PartnerSpace} from './src/phase2/partner/portal.tsx';import {Receipt} from './src/phase2/workbench.tsx';const w={client:{},busy:false,blocked:false,read:()=>{},command:()=>{}};console.log(JSON.stringify({connected:renderToStaticMarkup(createElement(PartnerSpace,{w})),receipts:['11111111-1111-4111-8111-111111111111',0,false].map(value=>renderToStaticMarkup(createElement(Receipt,{value:{value}})))}));`,
    resolveDir: resolve('apps/web'),
    sourcefile: 'portal-proof.tsx',
    loader: 'tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  jsx: 'automatic',
  write: false,
  logLevel: 'error',
});
const child = spawnSync(process.execPath, ['--input-type=commonjs'], {
  input: output.outputFiles[0].text,
  encoding: 'utf8',
  timeout: 5000,
  maxBuffer: 65536,
});
if (child.status !== 0) throw Error('Bounded isolated portal render failed');
process.stdout.write(child.stdout);
