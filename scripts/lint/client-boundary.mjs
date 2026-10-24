import path from 'node:path';

export const clientBoundary = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      serverImport:
        'Client modules cannot import server packages, environment readers or Node APIs.',
    },
  },
  create(context) {
    let client = false;
    function check(node, source) {
      if (!client || typeof source !== 'string') return;
      const resolved = source.startsWith('.')
        ? path.resolve(path.dirname(context.filename), source).replaceAll('\\', '/')
        : source;
      if (
        /^(@tt\/(config|db|application|integrations)(\/|$)|node:)/.test(source) ||
        /\/packages\/(config|db|application|integrations)\//.test(resolved)
      )
        context.report({ node, messageId: 'serverImport' });
    }
    return {
      Program(node) {
        client = node.body.some((statement) => statement.directive === 'use client');
      },
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        check(node, node.source.value);
      },
      MemberExpression(node) {
        if (client && node.object.name === 'process' && node.property.name === 'env')
          context.report({ node, messageId: 'serverImport' });
      },
    };
  },
};
