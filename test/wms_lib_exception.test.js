/**
 * Unit tests for wms_lib_exception (Phase 8 / invariant #8). No account.
 */
const exc = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_exception.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('severityFor', () => {
    test('known codes map to a severity; unknown defaults MEDIUM', () => {
        expect(exc.severityFor('CLOSED_PERIOD_POSTING')).toBe('HIGH');
        expect(exc.severityFor('SHORT_PICK')).toBe('LOW');
        expect(exc.severityFor('SERIAL_WRONG_BIN')).toBe('MEDIUM');
        expect(exc.severityFor('SOMETHING_NEW')).toBe('MEDIUM');
    });
});

describe('raise - shapes the exception record (#8)', () => {
    test('carries source event, location, type, severity, OPEN', () => {
        const e = exc.raise({ uuid: 'u1', location: '3' }, 'COMMITMENT_EXCEEDED', { detectedAt: 123 });
        expect(e).toEqual({
            sourceEvent: 'u1',
            location: '3',
            type: 'COMMITMENT_EXCEEDED',
            severity: 'HIGH',
            status: 'OPEN',
            notes: '',
            detectedAt: 123,
        });
    });
    test('severity override respected', () => {
        expect(exc.raise({ uuid: 'u' }, 'SHORT_PICK', { severity: 'HIGH' }).severity).toBe('HIGH');
    });
    test('missing reasonCode throws', () => {
        expect(grab(() => exc.raise({ uuid: 'u' })).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
