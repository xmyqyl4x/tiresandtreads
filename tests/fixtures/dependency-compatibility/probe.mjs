import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers';
import { readFileSync, mkdirSync, writeFileSync, readdir, promises as fs } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const rootRequire = createRequire(import.meta.url);
const from = (parent, dependency) => createRequire(parent).resolve(dependency);
const eslint = rootRequire.resolve('eslint');
const tsParser = from(rootRequire.resolve('typescript-eslint'), '@typescript-eslint/parser');
const estree = from(tsParser, '@typescript-eslint/typescript-estree');
const inngest = rootRequire.resolve('inngest');
const otel = from(inngest, '@opentelemetry/auto-instrumentations-node');
const detector = from(otel, '@opentelemetry/resource-detector-gcp');
const metadata = from(detector, 'gcp-metadata');
const gaxios = from(metadata, 'gaxios');
const rimrafPath = from(gaxios, 'rimraf');
const globPath = from(rimrafPath, 'glob');
const glob = rootRequire(globPath);
const matchers = [
  from(eslint, 'minimatch'),
  from(estree, 'minimatch'),
  from(globPath, 'minimatch'),
];
const mergePath = from(rootRequire.resolve('payload'), 'deepmerge');
const merge = rootRequire(mergePath);
function manifest(entry) {
  let directory = dirname(entry);
  for (let i = 0; i < 6; i++, directory = dirname(directory)) {
    try {
      const value = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (value.name && value.version) return value;
    } catch {
      /* Search only this package's bounded ancestry. */
    }
  }
  throw Error('Dependency manifest unavailable');
}
function seed(directory) {
  for (const name of ['keep', 'remove', 'nested/a', 'nested/b'])
    mkdirSync(join(directory, name), { recursive: true });
  for (const name of [
    'keep/one.ts',
    'keep/two.js',
    'remove/one.tmp',
    'remove/two.tmp',
    'nested/a/one.ts',
    'nested/b/two.ts',
  ])
    writeFileSync(join(directory, name), 'synthetic\n', { flag: 'wx' });
}
const mode = process.argv[2],
  directory = resolve(process.argv[3]);
assert.equal(dirname(directory), resolve(process.env.TMPDIR || process.env.TEMP || '/tmp'));
assert.match(directory.split(/[\\/]/).at(-1), /^tt-dependency-[a-zA-Z0-9]+$/);
switch (mode) {
  case 'resolution': {
    assert.deepEqual(
      matchers.map((p) => manifest(p).version),
      ['11.0.1', '11.0.1', '11.0.1'],
    );
    assert.equal(manifest(globPath).version, '14.0.2');
    assert.equal(manifest(mergePath).version, '4.3.1');
    break;
  }
  case 'matching': {
    for (const path of matchers) {
      const { minimatch, Minimatch } = rootRequire(path);
      assert.equal(minimatch('src/nested/item.ts', '**/*.{ts,tsx}'), true);
      assert.equal(minimatch('src/.private.ts', '**/*.ts'), false);
      assert.equal(minimatch('SRC/ITEM.TS', '**/*.ts', { nocase: true }), true);
      assert.equal(new Minimatch('**/*.ts', { dot: true }).match('src/.private.ts'), true);
    }
    break;
  }
  case 'amplification': {
    // Fixed adversarial pattern and explicit expansion limit in an owned child.
    for (const path of matchers) {
      const { Minimatch } = rootRequire(path);
      const result = new Minimatch('**/../a/b/'.repeat(10) + 'item.ts', {
        optimizationLevel: 2,
        braceExpandMax: 32,
      });
      assert(result.globParts.length > 1, 'The fixed pattern must exercise expansion');
      assert(result.globParts.length <= 32, 'The explicit expansion budget must be respected');
    }
    break;
  }
  case 'glob-compatibility': {
    seed(directory);
    const options = { cwd: directory, posix: true, nodir: true };
    const expected = ['keep/one.ts', 'nested/a/one.ts', 'nested/b/two.ts'];
    assert.deepEqual((await glob.glob('**/*.ts', options)).sort(), expected);
    assert.deepEqual(glob.globSync('**/*.ts', options).sort(), expected);
    break;
  }
  case 'glob-abort': {
    seed(directory);
    const abort = new globalThis.AbortController();
    let dispatched = 0,
      pending = 0;
    // Observe actual filesystem calls; neither directory entries nor walk results are mocked.
    const observedFs = {
      readdir(...args) {
        dispatched++;
        pending++;
        const callback = args.pop();
        readdir(...args, (...result) => {
          pending--;
          if (!abort.signal.aborted) abort.abort(Error('Synthetic walk stopped'));
          callback(...result);
        });
      },
    };
    await assert.rejects(
      glob.glob('**/*.ts', { cwd: directory, signal: abort.signal, fs: observedFs }),
      /Synthetic walk stopped/,
    );
    // Drain only this bounded fixture, not an assumed cancellation fence.
    const start = performance.now();
    do {
      await new Promise((r) => setTimeout(r, 5));
      assert(performance.now() - start < 1000);
    } while (pending);
    await new Promise((r) => setImmediate(r));
    assert.equal(
      dispatched,
      1,
      'No traversal should be dispatched after the first read triggers abort',
    );
    break;
  }
  case 'rimraf-compatibility': {
    seed(directory);
    const { rimraf, rimrafSync } = rootRequire(rimrafPath);
    assert.equal(await rimraf('remove/*.tmp', { glob: { cwd: directory, absolute: true } }), true);
    assert.deepEqual(await fs.readdir(join(directory, 'remove')), []);
    assert.equal(rimrafSync('nested/*/*.ts', { glob: { cwd: directory, absolute: true } }), true);
    assert.equal(readFileSync(join(directory, 'keep/one.ts'), 'utf8'), 'synthetic\n');
    break;
  }
  case 'merge-null':
  case 'merge-null-prototype':
  case 'merge-target': {
    const input = JSON.parse('{"config":{"__proto__":{"syntheticPrivilege":true},"name":"kept"}}');
    const target =
      mode === 'merge-null'
        ? { config: null }
        : mode === 'merge-null-prototype'
          ? { config: Object.create(null) }
          : JSON.parse('{"config":{"__proto__":{"syntheticPrivilege":true},"existing":1}}');
    const source = mode === 'merge-target' ? { config: { name: 'kept' } } : input;
    const output = merge(target, source);
    assert.equal(Object.getPrototypeOf(output.config), Object.prototype);
    assert.equal(output.config.syntheticPrivilege, undefined);
    assert.equal(Object.hasOwn(output.config, '__proto__'), false);
    assert.equal(output.config.name, 'kept');
    assert.equal(Object.prototype.syntheticPrivilege, undefined);
    // Test shipped alternate entries too; consumers must not bypass the patch by entry choice.
    for (const entry of ['dist/umd.js']) {
      const other = rootRequire(join(dirname(dirname(mergePath)), entry));
      const result = other(target, source);
      assert.equal(Object.getPrototypeOf(result.config), Object.prototype);
      assert.equal(result.config.syntheticPrivilege, undefined);
    }
    break;
  }
  case 'merge-compatibility': {
    const symbol = Symbol('synthetic');
    const before = { config: { first: 1 }, list: [1], [symbol]: { kept: true } };
    const output = merge(before, { config: { second: 2 }, list: [2] });
    assert.deepEqual(output.config, { first: 1, second: 2 });
    assert.deepEqual(output.list, [1, 2]);
    assert.deepEqual(output[symbol], { kept: true });
    assert.notEqual(output[symbol], before[symbol]);
    assert.deepEqual(before.list, [1]);
    assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });
    assert.deepEqual(
      merge(
        { n: { count: 2 } },
        { n: { count: 3 } },
        {
          customMerge: (k) => (k === 'n' ? (a, b) => ({ count: a.count + b.count }) : undefined),
        },
      ),
      { n: { count: 5 } },
    );
    assert.deepEqual(merge({ constructor: { kept: 1 } }, { constructor: { added: 2 } }), {
      constructor: { kept: 1, added: 2 },
    });
    break;
  }
  case 'merge-getter': {
    let calls = 0;
    for (const side of ['target', 'source']) {
      const value = { kept: true };
      Object.defineProperty(value, '__proto__', {
        enumerable: true,
        get() {
          calls++;
          throw Error('Forbidden prototype getter invoked');
        },
      });
      const result = side === 'target' ? merge(value, {}) : merge({}, value);
      assert.deepEqual(result, { kept: true });
    }
    assert.equal(calls, 0);
    break;
  }
  default:
    throw Error('Unknown fixed dependency probe');
}
console.log(
  'DEPENDENCY_COMPATIBILITY_EVIDENCE ' +
    JSON.stringify({
      mode,
      passed: true,
      minimatch: matchers.map((p) => manifest(p).version),
      glob: manifest(globPath).version,
      deepmerge: manifest(mergePath).version,
      externalCalls: 0,
      productActivation: false,
    }),
);
