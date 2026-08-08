/**
 * Harness smoke test (T-0.5).
 *
 * Proves three things the whole test strategy depends on:
 *   1. A SuiteScript 2.1 AMD module in `src/` loads under jest.
 *   2. Its pure logic runs with no NetSuite account.
 *   3. Its `N/` imports resolve to the stubs in test/stubs/N.
 *
 * When wms_lib_example is replaced by real Phase 2 modules, this file goes with it.
 */
const example = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_example.js');

describe('wms_lib_example (harness smoke test)', () => {
    test('pure logic runs with no NetSuite account', () => {
        expect(example.sum([2, 3, 5])).toBe(10);
        expect(example.sum([])).toBe(0);
        expect(example.sum([-1, 1])).toBe(0);
    });

    test('N/error resolves to the stub and carries the ERR_WMS_* name', () => {
        expect(() => example.sum('not-an-array')).toThrow('sum expects an array of numbers');
        try {
            example.sum(null);
            throw new Error('expected sum(null) to throw');
        } catch (e) {
            expect(e.name).toBe('ERR_WMS_INVALID_ARGUMENT');
        }
    });
});
