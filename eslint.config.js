import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'backend/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/test/**/*.ts', '**/*.test.{ts,tsx}', 'e2e/**/*.ts', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['frontend/public/theme-init.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    files: ['frontend/public/sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
  },
  {
    files: ['frontend/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '18.3' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/no-danger': 'error',
      'react/prop-types': 'off',
    },
  },
);
