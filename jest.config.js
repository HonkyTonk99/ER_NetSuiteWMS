/**
 * Jest configuration for pure-logic unit tests.
 *
 * - moduleNameMapper swaps every `N/*` SuiteScript import for a local stub, so
 *   tests never need a NetSuite account.
 * - babel-jest (see babel.config.js) makes the AMD `define()` modules loadable.
 */
module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/test', '<rootDir>/src'],
    testMatch: ['**/?(*.)+(test).js'],
    moduleNameMapper: {
        '^N/(.*)$': '<rootDir>/test/stubs/N/$1.js',
    },
    clearMocks: true,
    collectCoverageFrom: [
        'src/FileCabinet/SuiteScripts/**/*.js',
    ],
};
