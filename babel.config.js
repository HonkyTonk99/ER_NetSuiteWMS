/**
 * Babel is used only by jest (babel-jest). It compiles for the current Node and
 * rewrites SuiteScript's AMD `define([...], factory)` into CommonJS so modules
 * under src/ can be `require()`d in tests, with N/* deps mapped to stubs.
 * This config does NOT run against deployed code — SDF ships the source as-is.
 */
module.exports = {
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    plugins: ['babel-plugin-transform-amd-to-commonjs'],
};
