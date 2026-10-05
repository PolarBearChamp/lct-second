import { baseConfig } from '@fsp/config/eslint';

// Сквозные тесты: консольный вывод разрешён в global-setup и вспомогательных скриптах.
export default [
  ...baseConfig({ tsconfigRootDir: import.meta.dirname, ignores: ['test-results/**', 'playwright-report/**', 'dev/**'] }),
  { rules: { 'no-console': 'off' } },
];
