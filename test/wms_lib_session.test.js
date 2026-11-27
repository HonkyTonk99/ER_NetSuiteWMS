/**
 * Unit tests for wms_lib_session (Phase 3 / D-40, D-50, D-14, D-53). No account.
 */
const session = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_session.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('can - cumulative VIEW<CREATE<EDIT, no DELETE (D-50)', () => {
    test('cumulative', () => {
        expect(session.can('EDIT', 'CREATE')).toBe(true);
        expect(session.can('EDIT', 'VIEW')).toBe(true);
        expect(session.can('CREATE', 'VIEW')).toBe(true);
        expect(session.can('VIEW', 'CREATE')).toBe(false);
        expect(session.can('CREATE', 'EDIT')).toBe(false);
    });
    test('DELETE is never grantable, at any level', () => {
        expect(session.can('EDIT', 'DELETE')).toBe(false);
        expect(session.can('CREATE', 'DELETE')).toBe(false);
    });
    test('unknown level or requirement fails closed', () => {
        expect(session.can('SUPERUSER', 'EDIT')).toBe(false);
        expect(session.can('EDIT', 'NUKE')).toBe(false);
    });
});

describe('verifyPin (injected hash)', () => {
    const hashFn = (p) => `h:${p}`;
    test('matches stored hash', () => {
        expect(session.verifyPin('h:1234', '1234', hashFn)).toBe(true);
        expect(session.verifyPin('h:1234', '0000', hashFn)).toBe(false);
    });
    test('no stored hash -> false', () => {
        expect(session.verifyPin('', '1234', hashFn)).toBe(false);
    });
    test('missing hashFn throws', () => {
        expect(grab(() => session.verifyPin('x', 'y')).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('authorize', () => {
    const op = { code: 'OP1', employee: '42', tier: 'PICKER', accessLevel: 'CREATE', active: true, allowedLocations: ['1', '2'] };
    const opts = { nowFn: () => 1000, ttlSeconds: 60 };

    test('happy path issues claims (location, tier, access, employee)', () => {
        const r = session.authorize(op, '1', opts);
        expect(r.ok).toBe(true);
        expect(r.claims.locations).toEqual(['1']);
        expect(r.claims.tier).toBe('PICKER');
        expect(r.claims.accessLevel).toBe('CREATE');
        expect(r.claims.employee).toBe('42');
        expect(r.claims.exp).toBe(1000 + 60 * 1000);
    });
    test('inactive operator refused', () => {
        expect(session.authorize({ ...op, active: false }, '1', opts)).toEqual({ ok: false, reasonCode: 'WMS_OPERATOR_INACTIVE' });
    });
    test('no location selected refused', () => {
        expect(session.authorize(op, '', opts).reasonCode).toBe('WMS_NO_LOCATION_SELECTED');
    });
    test('location outside allowed set refused (D-14)', () => {
        const r = session.authorize(op, '9', opts);
        expect(r.reasonCode).toBe('WMS_LOCATION_NOT_ALLOWED');
        expect(r.detail).toEqual(['9']);
    });
    test('multi-location refused unless enabled (D-53)', () => {
        expect(session.authorize(op, ['1', '2'], opts).reasonCode).toBe('WMS_MULTI_LOCATION_NOT_ALLOWED');
        const r = session.authorize(op, ['1', '2'], { ...opts, multiLocation: true });
        expect(r.ok).toBe(true);
        expect(r.claims.locations).toEqual(['1', '2']);
    });
    test('malformed operator throws', () => {
        expect(grab(() => session.authorize(null, '1', opts)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
