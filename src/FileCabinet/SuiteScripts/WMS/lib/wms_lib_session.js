/**
 * wms_lib_session - operator authorisation + access-level logic (Phase 3; D-19,
 * D-40, D-50, D-14). PURE logic: no N/, no crypto - the PIN hash function is
 * injected so the decision logic is unit-testable. The Suitelet/T-3.3 wires the
 * real hash + HMAC token.
 *
 * Model: a WMS user is backed by an Employee (attribution, D-40) with NO NetSuite
 * login (#24). Authorisation is WMS-owned: tier (PICKER/MANAGER) + a CUMULATIVE
 * access level VIEW < CREATE < EDIT, and there is NO DELETE level (D-50). Location
 * is a per-session selection validated against the operator's allowed set (D-14);
 * more than one only when multi-location sessions are enabled (D-53).
 *
 * Business outcomes are returned verdicts ({ ok:false, reasonCode }); malformed
 * input throws ERR_WMS_* (D-23).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], function () {
    'use strict';

    var LEVELS = { VIEW: 1, CREATE: 2, EDIT: 3 };

    function err(name, message) {
        var e = new Error(message);
        e.name = name;
        return e;
    }

    /**
     * Cumulative access check. VIEW < CREATE < EDIT. DELETE is never grantable
     * (D-50), so any check for DELETE is always false. Unknown required level fails
     * closed.
     */
    function can(level, required) {
        if (String(required).toUpperCase() === 'DELETE') {
            return false;
        }
        var have = LEVELS[String(level).toUpperCase()] || 0;
        var need = LEVELS[String(required).toUpperCase()];
        if (!need) { return false; }
        return have >= need;
    }

    function verifyPin(storedHash, pin, hashFn) {
        if (typeof hashFn !== 'function') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'hashFn is required');
        }
        if (!storedHash) { return false; }
        return hashFn(String(pin == null ? '' : pin)) === storedHash;
    }

    function asArray(v) {
        if (v == null || v === '') { return []; }
        if (Array.isArray(v)) { return v.map(String); }
        return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }

    /**
     * Decide a session. Returns { ok:true, claims } or { ok:false, reasonCode }.
     * `opts.multiLocation` reflects config custrecord_cfg_multi_location_session (D-53).
     */
    function authorize(operator, selectedLocations, opts) {
        if (!operator || typeof operator !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'operator record is required');
        }
        opts = opts || {};
        var selected = asArray(selectedLocations);
        var allowed = asArray(operator.allowedLocations);

        if (operator.active === false) {
            return { ok: false, reasonCode: 'WMS_OPERATOR_INACTIVE' };
        }
        if (selected.length === 0) {
            return { ok: false, reasonCode: 'WMS_NO_LOCATION_SELECTED' };
        }
        if (selected.length > 1 && !opts.multiLocation) {
            return { ok: false, reasonCode: 'WMS_MULTI_LOCATION_NOT_ALLOWED' };
        }
        var outside = selected.filter(function (l) { return allowed.indexOf(l) === -1; });
        if (outside.length) {
            return { ok: false, reasonCode: 'WMS_LOCATION_NOT_ALLOWED', detail: outside };
        }

        var now = typeof opts.nowFn === 'function' ? opts.nowFn() : Date.now();
        var ttl = Number(opts.ttlSeconds) > 0 ? Number(opts.ttlSeconds) : 3600;
        return {
            ok: true,
            claims: {
                op: operator.code,
                employee: operator.employee,
                tier: operator.tier,
                accessLevel: operator.accessLevel,
                locations: selected,
                iat: now,
                exp: now + ttl * 1000,
            },
        };
    }

    return {
        LEVELS: LEVELS,
        can: can,
        verifyPin: verifyPin,
        authorize: authorize,
    };
});
