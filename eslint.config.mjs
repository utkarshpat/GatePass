import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/**', '.tools/**', 'tmp/**', 'output/**', 'database/validation/**'] },
  {
    files: ['src/**/*.{ts,tsx,js,mjs}', 'tools/**/*.{ts,mjs}', 'tests/**/*.ts', 'playwright.config.ts'],
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
  },
  {
    files: ['src/contracts/**/*.ts', 'src/shared/**/*.ts', 'src/security/SessionProof.ts',
      'src/planning/**/*.ts', 'src/email/MailContracts.ts', 'src/email/PlanningMail*.ts',
      'src/email/PlanningNotificationWorker.ts', 'src/frontend/admin/views/*.tsx'],
    plugins: {'@typescript-eslint': tseslint.plugin},
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', {prefer: 'type-imports', fixStyle: 'separate-type-imports'}],
      '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_', varsIgnorePattern: '^_'}]
    }
  }
];
