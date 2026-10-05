// Jest + SWC (поддержка декораторов и метаданных NestJS). Два проекта: unit и integration.
const swcTransform = [
  '@swc/jest',
  {
    jsc: {
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: 'es2023',
      keepClassNames: true,
    },
    module: { type: 'commonjs' },
    sourceMaps: 'inline',
  },
];

const common = {
  rootDir: __dirname,
  testEnvironment: 'node',
  transform: { '^.+\\.(t|j)s$': swcTransform },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Импорты вида './x.js' из сгенерированного клиента Prisma указывают на .ts-исходники.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
};

module.exports = {
  projects: [
    {
      ...common,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
    },
    {
      ...common,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
      setupFiles: ['<rootDir>/test/setup-env.ts'],
      testTimeout: 60000,
    },
  ],
};
