import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const ports = [
  'partner-repositories',
  'analysis-repositories',
  'analysis-privacy',
  'photo-repositories',
  'csv-review-repositories',
].map((x) => `packages/application/src/ports/${x}.ts`);
const entities = ['partner', 'analysis', 'photo', 'csv-review'].map(
  (x) => `packages/domain/src/entities/${x}.ts`,
);
const read = (p) => readFileSync(p, 'utf8');
const sha = (value) => createHash('sha256').update(value).digest('hex');
function parse(source) {
  const tree = ts.createSourceFile('audit.ts', source, ts.ScriptTarget.Latest, true);
  if (tree.parseDiagnostics.length) throw Error('Invalid TypeScript');
  return tree;
}
// Includes type-only, re-export, import-type and dynamic edges. Never executes inspected code.
export function inspectPureSource(path, source) {
  const inward = path.startsWith('packages/domain/')
    ? (p) => p.startsWith('packages/domain/src/')
    : (p) =>
        p.startsWith('packages/domain/src/') || p.startsWith('packages/application/src/ports/');
  const edges = new Set();
  function edge(node) {
    if (
      !node ||
      !ts.isStringLiteral(node) ||
      !node.text.startsWith('.') ||
      !node.text.endsWith('.ts')
    )
      throw Error('Pure module requires fixed inward TypeScript imports');
    const target = posix.normalize(posix.join(posix.dirname(path), node.text));
    if (!inward(target)) throw Error('Impure model edge');
    edges.add(target);
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) edge(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      if (!ts.isLiteralTypeNode(node.argument)) throw Error('Unbounded import type');
      edge(node.argument.literal);
    } else if (ts.isImportEqualsDeclaration(node)) {
      throw Error('Require aliases are outside the pure module contract');
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      edge(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(parse(source));
  return [...edges].sort();
}
export function inspectProjection(source, name, fields) {
  const matches = parse(source).statements.filter(
    (n) => ts.isInterfaceDeclaration(n) && n.name.text === name,
  );
  if (matches.length !== 1 || matches[0].heritageClauses?.length)
    throw Error('Exact projection declaration required');
  const actual = matches[0].members.map((n) => {
    if (
      !ts.isPropertySignature(n) ||
      !ts.isIdentifier(n.name) ||
      n.questionToken ||
      !n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword)
    )
      throw Error('Explicit readonly projection required');
    return n.name.text;
  });
  if (JSON.stringify(actual.toSorted()) !== JSON.stringify(fields.toSorted()))
    throw Error('Projection field drift');
}
export function auditP2DataAccess(load = read) {
  const revisionPath = 'scripts/review/p2-source-revisions.json',
    revisionSource = load(revisionPath);
  if (sha(revisionSource) !== '03df35a31771e858244047b0be1f585816cb878a0b1df7471949dccf89c9284b')
    throw Error('Source revision checksum mismatch');
  const revisions = JSON.parse(revisionSource);
  if (
    revisions.schemaVersion !== 1 ||
    revisions.card !== 'P2-PR-009' ||
    JSON.stringify(Object.keys(revisions.revisions).sort()) !==
      JSON.stringify([
        'packages/db/src/repositories/partner-mappers.ts',
        'packages/db/src/repositories/partner-offers.ts',
        'packages/domain/src/entities/partner.ts',
      ])
  )
    throw Error('Exact source revisions required');
  const pins = {};
  for (const card of ['006', '007']) {
    const proof = JSON.parse(
      load(`docs/implementation/evidence/P2/p2-pr-${card}-local-proof.json`),
    );
    if (
      (card === '007'
        ? proof.card !== 'P2-PR-007'
        : proof.kind !== 'focused-disposable-local-partner-repository-proof') ||
      !proof.typecheckPassed ||
      !proof.ownedProjectRemoved
    )
      throw Error('Complete prior local proof required');
    for (const [path, checksum] of Object.entries(proof.sourceSha256)) {
      if (
        !/^(packages|tests|infra)\/[a-zA-Z0-9/_.-]+$/.test(path) ||
        path.split('/').includes('..') ||
        !/^[a-f0-9]{64}$/.test(checksum)
      )
        throw Error('Invalid source pin');
      if (pins[path] && pins[path] !== checksum) throw Error('Conflicting source pins');
      const revision = revisions.revisions[path];
      if (revision && revision.priorSha256 !== checksum)
        throw Error('Historical revision mismatch');
      const currentChecksum = revision ? revision.sha256 : checksum;
      if (sha(load(path)) !== currentChecksum) throw Error('Source checksum mismatch: ' + path);
      pins[path] = currentChecksum;
    }
  }
  if (Object.keys(pins).length !== 50) throw Error('Exact P2 repository inventory required');
  const seen = new Set();
  function walk(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const source = load(path);
    pins[path] = sha(source);
    for (const target of inspectPureSource(path, source)) walk(target);
  }
  for (const path of [...entities, ...ports]) walk(path);
  const reuse = {
    'analysis-privacy': {
      './transactions.ts': ['TransactionContext'],
      './privacy-services.ts': ['PrivacyLease'],
      './assets.ts': ['AssetLocation'],
      './pagination.ts': ['Page', 'PageRequest'],
    },
    'photo-repositories': {
      './transactions.ts': ['TransactionContext'],
      './jobs.ts': ['JobLease'],
      './assets.ts': ['AssetRepository', 'AssetLocation'],
      './pagination.ts': ['Page', 'PageRequest'],
    },
    'csv-review-repositories': {
      './transactions.ts': ['TransactionContext'],
      './assets.ts': ['AssetLocation'],
      './pagination.ts': ['Page', 'PageRequest'],
    },
    'partner-repositories': {
      './transactions.ts': ['TransactionContext'],
      './pagination.ts': ['Page', 'PageRequest'],
    },
    'analysis-repositories': {
      './transactions.ts': ['TransactionContext'],
      './pagination.ts': ['Page', 'PageRequest'],
    },
  };
  for (const [name, expected] of Object.entries(reuse)) {
    const tree = parse(load(`packages/application/src/ports/${name}.ts`));
    for (const [path, symbols] of Object.entries(expected)) {
      const imports = tree.statements.filter(
        (n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === path,
      );
      const names = imports.flatMap((n) =>
        n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)
          ? n.importClause.namedBindings.elements.map((e) => (e.propertyName ?? e.name).text)
          : [],
      );
      if (symbols.some((n) => !names.includes(n))) throw Error('P1 port reuse missing: ' + name);
    }
    for (const n of tree.statements.filter(
      (n) => ts.isInterfaceDeclaration(n) && n.name.text.endsWith('Repository'),
    )) {
      for (const m of n.members) {
        const first = ts.isMethodSignature(m) ? m.parameters[0] : null;
        if (!first || first.name.getText(tree) !== 'tx' || first.type?.getText(tree) !== 'Tx')
          throw Error('Shared explicit transaction port required');
      }
    }
  }
  const projections = {
    analysis: {
      AnalysisProjection: [
        'reportId',
        'version',
        'revision',
        'kind',
        'output',
        'generatedAt',
        'validUntil',
      ],
    },
    photo: {
      PhotoStatus: ['id', 'state', 'createdAt', 'expiresAt', 'savedAt'],
      PhotoCandidate: [
        'id',
        'uploadId',
        'field',
        'ordinal',
        'rawText',
        'value',
        'unknownReason',
        'quality',
        'region',
      ],
      PhotoConfirmation: [
        'uploadId',
        'field',
        'revision',
        'candidateId',
        'origin',
        'value',
        'confirmedAt',
      ],
    },
    partner: { PartnerMetricCell: ['day', 'metric', 'market', 'count'] },
  };
  let projectionCount = 0;
  for (const [entity, names] of Object.entries(projections))
    for (const [name, fields] of Object.entries(names)) {
      inspectProjection(load(`packages/domain/src/entities/${entity}.ts`), name, fields);
      projectionCount++;
    }
  return Object.freeze({
    pinnedSources: Object.keys(pins).length,
    pureModules: seen.size,
    repositoryPorts: ports.length,
    safeProjections: projectionCount,
    sourceSha256: Object.freeze(pins),
    actualS1Approval: false,
    actualS2Approval: false,
    servicesStarted: false,
    wireContractsApproved: false,
    providerDispatches: 0,
    actualRecipientNotifications: 0,
    casesClosed: 0,
    gatesClosed: 0,
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw Error('Read-only audit accepts no arguments');
  console.log('P2_DATA_ACCESS_AUDIT ' + JSON.stringify(auditP2DataAccess()));
}
