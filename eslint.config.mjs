import js from '@eslint/js';
import ts from 'typescript-eslint';
import { clientBoundary } from './scripts/lint/client-boundary.mjs';

const nodeGlobals = Object.fromEntries(
  ['process', 'console', 'Buffer', 'URL', 'fetch', 'AbortSignal', 'setTimeout', 'clearTimeout'].map(
    (name) => [name, 'readonly'],
  ),
);

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '.work/**',
      '.local/**',
      'coverage/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['apps/**/*.{ts,tsx}'],
    plugins: { architecture: { rules: { 'client-boundary': clientBoundary } } },
    rules: { 'architecture/client-boundary': 'error' },
  },
  { files: ['**/*.{ts,mjs}'], languageOptions: { globals: nodeGlobals } },
  { files: ['**/*.mjs', '**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  { files: ['**/*.cjs'], languageOptions: { globals: { module: 'readonly' } } },
  {
    files: ['packages/{domain,engine}/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'fetch', 'process', 'Date'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random' }],
    },
  },
];
