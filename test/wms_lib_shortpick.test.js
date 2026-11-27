/**
 * Unit tests for wms_lib_shortpick (Phase 7 / Q-11). No account.
 */
const sp = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_shortpick.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('resolve', () => {
    test('fully picked is complete', () => {
        expect(sp.resolve('HOLD', { requested: 5, picked: 5 })).toEqual({ complete: true });
        expect(sp.resolve('HOLD', { requested: 5, picked: 6 })).toEqual({ complete: true });
    });
    test('short returns the configured action + shortfall', () => {
        expect(sp.resolve('SHIP_PARTIAL', { requested: 5, picked: 3 })).toEqual({ short: true, action: 'SHIP_PARTIAL', shortBy: 2 });
        expect(sp.resolve('backorder', { requested: 5, picked: 0 })).toEqual({ short: true, action: 'BACKORDER', shortBy: 5 });
    });
    test('unknown policy throws', () => {
        expect(grab(() => sp.resolve('NOPE', { requested: 1, picked: 0 })).name).toBe('ERR_WMS_INVALID_CONFIG_VALUE');
    });
    test('bad line throws', () => {
        expect(grab(() => sp.resolve('HOLD', { requested: 'x', picked: 0 })).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
