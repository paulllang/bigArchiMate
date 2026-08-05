/** @type {import('ts-jest').JestConfigWithTsJest} */
const baseConfig = require('./base.jest.config');

module.exports = {
   ...baseConfig,
   extensionsToTreatAsEsm: ['.ts', '.tsx'],
   moduleNameMapper: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
      // Langium publishes an `exports` map with only an `import` condition, which Jest's resolver does
      // not match, so every suite touching it failed to load with "Cannot find module 'langium'".
      // Mapped explicitly rather than via `customExportConditions`: adding `import` to the condition
      // set routes every dual-published package to its ESM build (a package's own exports order wins),
      // which breaks Jest's own dependencies.
      '^langium$': '<rootDir>/../../node_modules/langium/lib/index.js',
      '^langium/(generate|grammar|lsp|node|test)$': '<rootDir>/../../node_modules/langium/lib/$1/index.js'
   },
   transform: {
      // '^.+\\.[tj]sx?$' to process js/ts with `ts-jest`
      // '^.+\\.m?[tj]sx?$' to process js/ts/mjs/mts with `ts-jest`
      '^.+\\.tsx?$': [
         'ts-jest',
         {
            useESM: true
         }
      ]
   }
};
