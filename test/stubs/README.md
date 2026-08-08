# SuiteScript module stubs

Jest resolves any `N/*` import to a file here via `moduleNameMapper` in
`jest.config.js` (`^N/(.*)$` → `test/stubs/N/$1.js`). This lets pure logic in
`src/FileCabinet/SuiteScripts/**` be unit-tested with **no NetSuite account**.

The AMD `define([...], factory)` form used by SuiteScript 2.1 modules is turned
into CommonJS at test time by `babel-plugin-transform-amd-to-commonjs`
(see `babel.config.js`), so `require()` of a `src` module returns its factory
export with the `N/*` dependencies swapped for the stubs below.

## Provided stubs

`error`, `log`, `record`, `search`, `runtime`, `cache` — a minimal core set.

## Adding / extending a stub

1. If a module under test imports an `N/` module not yet stubbed, add
   `test/stubs/N/<name>.js` exporting the shape your code calls.
2. To assert on interactions, don't edit the stub — spy in the test:
   ```js
   const log = require('N/log');
   const spy = jest.spyOn(log, 'audit');
   // ... run code ...
   expect(spy).toHaveBeenCalled();
   ```
   `clearMocks: true` in `jest.config.js` resets spies between tests.

Keep stubs minimal and behaviour-free by default — a stub that bakes in
business behaviour makes tests lie.
