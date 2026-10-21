import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/**', '.tools/**', 'tmp/**', 'output/**', 'database/validation/**'] },
  {
    files: ['src/**/*.{ts,js,mjs}', 'tools/**/*.{ts,mjs}', 'tests/**/*.ts', 'playwright.config.ts'],
    languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      ...js.configs.recommended.rules,
      // Browser classic scripts are concatenated by the development server.
      // TypeScript's compiler checks names in modules; browser globals are shared.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      // Public boundary errors deliberately redact SQL, path and credential causes.
      'preserve-caught-error': 'off'
    }
  }
];
