/**
 * Unit tests for wms_lib_retention (Phase 11 / D-57, Q-09). No account.
 */
const ret = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_retention.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

describe('classify', () => {
    test('non-POSTED is always KEPT (never purged)', () => {
        expect(ret.classify({ status: 'PENDING', postedTs: 0 }, 7, NOW)).toBe('KEEP');
        expect(ret.classify({ status: 'FAILED', postedTs: 0 }, 7, NOW)).toBe('KEEP');
    });
    test('POSTED within retention is KEPT', () => {
        expect(ret.classify({ status: 'POSTED', postedTs: NOW - 3 * DAY }, 7, NOW)).toBe('KEEP');
    });
    test('POSTED past retention but not yet archived -> ARCHIVE (never purge first)', () => {
        expect(ret.classify({ status: 'POSTED', postedTs: NOW - 30 * DAY, archived: false }, 7, NOW)).toBe('ARCHIVE');
    });
    test('POSTED past retention and archived -> PURGE', () => {
        expect(ret.classify({ status: 'POSTED', postedTs: NOW - 30 * DAY, archived: true }, 7, NOW)).toBe('PURGE');
    });
    test('bad input throws', () => {
        expect(grab(() => ret.classify({ status: 'POSTED' }, 'x', NOW)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('partition', () => {
    test('splits a batch into keep/archive/purge', () => {
        const out = ret.partition([
            { status: 'PENDING', postedTs: 0 },
            { status: 'POSTED', postedTs: NOW - 2 * DAY },
            { status: 'POSTED', postedTs: NOW - 30 * DAY, archived: false },
            { status: 'POSTED', postedTs: NOW - 30 * DAY, archived: true },
        ], 7, NOW);
        expect(out.keep).toHaveLength(2);
        expect(out.archive).toHaveLength(1);
        expect(out.purge).toHaveLength(1);
    });
});
