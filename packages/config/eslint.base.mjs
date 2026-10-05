// Базовая конфигурация ESLint (flat config) для TypeScript-пакетов монорепозитория.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export function baseConfig({ tsconfigRootDir, ignores = [] }) {
  return tseslint.config(
    { ignores: ['dist/**', 'coverage/**', 'node_modules/**', ...ignores] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        parserOptions: { tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        'no-console': ['warn', { allow: ['warn', 'error'] }],
        eqeqeq: ['error', 'always'],
      },
    },
  );
}
