/**
 * Unit tests for wms_lib_governance (Phase 12 / D-49, D-34, F-29, F-17). No account.
 */
const gov = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_governance.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('batchSize - bounded by units AND value AND config (D-34)', () => {
    test('units is the binding constraint', () => {
        expect(gov.batchSize({ remainingUnits: 1000, perEventUnits: 10, maxValueBytes: 1e9, perEventBytes: 1, configMax: 1000 })).toBe(100);
    });
    test('value (10 MB M/R limit) binds at high serial share', () => {
        expect(gov.batchSize({ remainingUnits: 1e9, perEventUnits: 1, maxValueBytes: 10 * 1024 * 1024, perEventBytes: 1024 * 1024, configMax: 1000 })).toBe(10);
    });
    test('config max caps it', () => {
        expect(gov.batchSize({ remainingUnits: 1e9, perEventUnits: 1, maxValueBytes: 1e9, perEventBytes: 1, configMax: 50 })).toBe(50);
    });
    test('bad opts throw', () => {
        expect(grab(() => gov.batchSize({ remainingUnits: 0, perEventUnits: 1, maxValueBytes: 1, perEventBytes: 1 })).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('shouldYield (F-17)', () => {
    test('yields when the next estimate exceeds remaining', () => {
        expect(gov.shouldYield(50, 100)).toBe(true);
        expect(gov.shouldYield(100, 100)).toBe(false);
    });
});

describe('channelFor (D-49)', () => {
    test('routes known process types, defaults the rest', () => {
        const routing = { COMMITTER: 'queueA', RECONCILE: 'queueB' };
        expect(gov.channelFor('COMMITTER', routing)).toBe('queueA');
        expect(gov.channelFor('UNKNOWN', routing)).toBe('default');
        expect(gov.channelFor('X', null)).toBe('default');
    });
});
