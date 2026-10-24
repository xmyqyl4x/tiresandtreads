import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const cli = process.env.npm_execpath;
if (!cli || !/pnpm/i.test(cli)) throw new Error('Run through pnpm boundaries');
const result = spawnSync(
  process.execPath,
  [
    cli,
    'exec',
    'depcruise',
    'packages',
    'apps',
    '--config',
    '.dependency-cruiser.cjs',
    '--output-type',
    'json',
  ],
  { encoding: 'utf8' },
);
if (result.error || !result.stdout) throw new Error('Dependency analysis did not produce a graph');
const graph = JSON.parse(result.stdout);
const violations = graph.summary.violations.map(
  (entry) => `${entry.rule.name}: ${entry.from} -> ${entry.to}`,
);
const modules = new Map(graph.modules.map((entry) => [entry.source, entry]));
for (const entry of graph.modules) {
  if (
    !entry.source.startsWith('apps/') ||
    !existsSync(entry.source) ||
    !/^\s*['"]use client['"];?/m.test(readFileSync(entry.source, 'utf8'))
  )
    continue;
  const pending = [entry.source];
  const visited = new Set();
  while (pending.length) {
    const name = pending.pop();
    if (visited.has(name)) continue;
    visited.add(name);
    for (const dependency of modules.get(name)?.dependencies ?? []) {
      if (
        /^packages\/(config|db|application|integrations)\//.test(dependency.resolved) ||
        dependency.coreModule
      ) {
        violations.push(`client-server-transitive: ${entry.source} -> ${dependency.resolved}`);
      }
      if (!dependency.resolved.includes('node_modules')) pending.push(dependency.resolved);
    }
  }
}
if (violations.length || result.status !== 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Layer, cycle and transitive client/server boundaries passed (${modules.size} modules)`,
  );
