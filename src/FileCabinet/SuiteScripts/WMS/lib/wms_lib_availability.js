/**
 * wms_lib_availability - the negative-inventory pre-check (Phase 4; invariant #19;
 * D-48). PURE. The committer pre-checks availability and DEFERS on its own judgement
 * (proactive, not a caught rejection). Deferred is legitimate work in the wrong
 * sequence - never FAILED on first attempt.
 *
 * Rules:
 *   - SERIAL: never negative, ever (invariant #21) - cannot ship a serial you do not
 *     hold, regardless of config. Short -> DEFER.
 *   - PLAIN / LOT: default PREVENT (D-48). A per-location allowNegative=true lets the
 *     posting go negative; otherwise short -> DEFER.
 *   - Inbound/produce (positive delta) always posts.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], function () {
    'use strict';

    function err(name, message) {
        var e = new Error(message);
        e.name = name;
        return e;
    }

    function num(v, label) {
        var n = Number(v);
        if (!isFinite(n)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', label + ' must be a finite number');
        }
        return n;
    }

    /**
     * input:
     *   mode ('PLAIN'|'LOT'|'SERIAL')
     *   onHand (number)   - WMS/NetSuite quantity available at the posting location
     *   requested (number)- quantity this outbound posting consumes (positive)
     *   allowNegative (bool) - per-location config (D-48), ignored for SERIAL
     * Returns { ok:true } to post, or { ok:false, action:'DEFER', reasonCode }.
     */
    function check(input) {
        if (!input || typeof input !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'availability input is required');
        }
        var mode = String(input.mode || '').toUpperCase();
        if (mode !== 'PLAIN' && mode !== 'LOT' && mode !== 'SERIAL') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'unknown tracking mode: ' + input.mode);
        }
        var onHand = num(input.onHand, 'onHand');
        var requested = num(input.requested, 'requested');
        if (requested <= 0) {
            throw err('ERR_WMS_INVALID_QUANTITY', 'requested must be positive');
        }

        var sufficient = requested <= onHand;
        if (sufficient) {
            return { ok: true };
        }
        // Short.
        if (mode === 'SERIAL') {
            return { ok: false, action: 'DEFER', reasonCode: 'SERIAL_NOT_AVAILABLE' };
        }
        if (input.allowNegative === true) {
            return { ok: true, wentNegative: true };
        }
        return { ok: false, action: 'DEFER', reasonCode: 'INSUFFICIENT_AVAILABILITY' };
    }

    return { check: check };
});
