module.exports = {
  forbidden: [
    {
      name: 'production-never-imports-test-fixtures',
      severity: 'error',
      from: { path: '^(apps|packages)/' },
      to: { path: '^tests/' },
    },
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-unresolved-imports', severity: 'error', from: {}, to: { couldNotResolve: true } },
    {
      name: 'pure-domain',
      severity: 'error',
      from: { path: '^packages/(domain|engine)/' },
      to: { pathNot: '^packages/(domain|engine)/' },
    },
    {
      name: 'application-points-inward',
      severity: 'error',
      from: { path: '^packages/application/' },
      to: { pathNot: '^packages/(application|domain|engine)/' },
    },
    {
      name: 'wire-contracts-stay-independent',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { path: '^(apps/|packages/(?!contracts/))' },
    },
    {
      name: 'adapters-never-import-ui',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default', 'types'],
    },
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.next' },
  },
};
