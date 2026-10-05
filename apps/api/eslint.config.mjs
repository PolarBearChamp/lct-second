import { baseConfig } from '@fsp/config/eslint';

const nodeGlobals = {
  module: 'readonly',
  require: 'readonly',
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
};

export default [
  ...baseConfig({
    tsconfigRootDir: import.meta.dirname,
    // Сгенерированный Prisma-клиент и миграции не проверяются; dist — результат сборки.
    ignores: ['src/generated/**', 'prisma/migrations/**'],
  }),
  {
    // projectService нужен правилу consistent-type-imports, чтобы не превращать импорты DI-классов NestJS
    // (emitDecoratorMetadata) в import type.
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: nodeGlobals },
  },
  {
    // Скрипты командной строки выводят результат в консоль.
    files: ['scripts/**', 'test/**'],
    rules: { 'no-console': 'off' },
  },
];
