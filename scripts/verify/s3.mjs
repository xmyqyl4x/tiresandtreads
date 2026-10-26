import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
export function evaluateServiceGate(register, packet) {
  if (
    register.schemaVersion !== 1 ||
    register.stage !== 'S3' ||
    !Array.isArray(register.gates) ||
    register.gates.length !== 6 ||
    ['acceptanceRequested', 'endpointImplementationAllowed', 'publicActivation'].some(
      (key) => typeof register[key] !== 'boolean',
    ) ||
    new Set(register.gates.map((g) => g.id)).size !== register.gates.length
  )
    throw Error('Invalid S3 register');
  const required = [
    'G1-specialist',
    'G1-fitment-catalog',
    'G1-prices',
    'G2-provider-effects',
    'G2-privacy-policy',
    'S3-service-host',
  ];
  if (required.some((id) => !register.gates.some((g) => g.id === id)))
    throw Error('Missing S3 gate');
  if (
    !Array.isArray(packet.scenarios) ||
    packet.scenarioCount !== packet.scenarios.length ||
    packet.scenarios.some((s) => typeof s.id !== 'string' || !s.id.trim()) ||
    new Set(packet.scenarios.map((s) => s.id)).size !== packet.scenarios.length
  )
    throw Error('Invalid specialist packet');
  const kinds = {
    'G1-specialist': 'human_review',
    'G1-fitment-catalog': 'provider',
    'G1-prices': 'provider',
    'G2-provider-effects': 'provider',
    'G2-privacy-policy': 'human_review',
    'S3-service-host': 'technical_integration',
  };
  const dated = (value) =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
  const reviewed = packet.scenarios.filter(
    (s) =>
      s.specialistReview?.status === 'accepted' &&
      typeof s.specialistReview.reviewer === 'string' &&
      s.specialistReview.reviewer.trim() &&
      dated(s.specialistReview.reviewedAt),
  ).length;
  for (const gate of register.gates) {
    if (
      gate.kind !== kinds[gate.id] ||
      !['pending', 'accepted'].includes(gate.status) ||
      !Array.isArray(gate.records)
    )
      throw Error('Invalid S3 evidence state');
    if (
      gate.status === 'accepted' &&
      (gate.records.length === 0 ||
        gate.records.some(
          (r) =>
            r.kind !== gate.kind ||
            typeof r.path !== 'string' ||
            !r.path.trim() ||
            typeof r.reviewer !== 'string' ||
            !r.reviewer.trim(),
        ))
    )
      throw Error('Actual scoped evidence required');
  }
  if (
    register.gates.find((g) => g.id === 'G1-specialist').status === 'accepted' &&
    (reviewed < 50 || packet.reviewStatus !== 'accepted')
  )
    throw Error('Actual specialist acceptance required');
  const pending = register.gates.filter((g) => g.status !== 'accepted').map((g) => g.id),
    accepted = pending.length === 0 && register.acceptanceRequested === true;
  if (
    (register.acceptanceRequested ||
      register.endpointImplementationAllowed ||
      register.publicActivation) &&
    !accepted
  )
    throw Error('S3 gate cannot be bypassed');
  return {
    stage: 'S3',
    accepted,
    endpointImplementationAllowed: accepted && register.endpointImplementationAllowed,
    publicActivation: accepted && register.publicActivation,
    pendingGates: pending,
    draftGoldenScenarios: packet.scenarioCount,
    actualSpecialistReviews: reviewed,
  };
}
export function inspectServiceRegister(root = process.cwd()) {
  const read = (n) => JSON.parse(readFileSync(path.join(root, n), 'utf8'));
  const register = read('docs/implementation/evidence/P1/s3-service-register.json'),
    packet = read('docs/implementation/evidence/P1/p1-pr-017-golden-review.json');
  const report = evaluateServiceGate(register, packet),
    modules = [];
  if (
    !Array.isArray(register.components) ||
    new Set(register.components.map((c) => c.card)).size !== 14
  )
    throw Error('Incomplete S3 inventory');
  const evidencePath = (n) => {
    if (
      typeof n !== 'string' ||
      path.isAbsolute(n) ||
      n.includes('..') ||
      !existsSync(path.join(root, n))
    )
      throw Error('Missing S3 inventory evidence');
  };
  for (const component of register.components) {
    evidencePath(component.contract);
    component.tests.forEach(evidencePath);
    for (const file of component.modules) {
      evidencePath(file);
      if (modules.some((m) => m.file === file)) throw Error('Duplicate S3 module');
      const tree = ts.createSourceFile(
        file,
        readFileSync(path.join(root, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const exports = tree.statements
        .filter(
          (s) =>
            ts.isFunctionDeclaration(s) &&
            s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
        )
        .map((s) => s.name?.text)
        .filter(Boolean);
      modules.push({ file, card: component.card, exports });
    }
  }
  const actual = readdirSync(path.join(root, 'packages/application/src/services'))
    .filter((n) => n.endsWith('.ts'))
    .map((n) => 'packages/application/src/services/' + n)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(modules.map((m) => m.file).sort()))
    throw Error('Uninventoried S3 service module');
  for (const gate of register.gates) for (const record of gate.records) evidencePath(record.path);
  return {
    ...report,
    inventoryStatus: 'validated; acceptance is separate',
    components: register.components.length,
    serviceModules: modules.length,
    modules,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = inspectServiceRegister();
    console.log('S3_GATE_EVIDENCE ' + JSON.stringify(report));
    if (process.argv.includes('--require-accepted') && !report.accepted) process.exitCode = 2;
  } catch {
    console.error('S3 register validation failed');
    process.exitCode = 1;
  }
}
