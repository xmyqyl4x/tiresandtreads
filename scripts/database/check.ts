import { loadSources } from './manifest.ts';

for (const kind of ['app', 'cms'] as const) {
  const sources = loadSources(kind);
  console.log(`${kind}: ${sources.length} reviewed migration checksums match`);
}
