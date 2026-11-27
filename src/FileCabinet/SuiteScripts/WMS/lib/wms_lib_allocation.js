/**
 * wms_lib_allocation - commitment-bounded allocation (Phase 6/7; invariant #15,
 * F-22, AD-17). PURE. The WMS refines NetSuite's commitment, it never replaces it:
 * wave eligibility filters on committed quantity, and picked quantity per line may
 * not exceed committed - get this wrong and one customer's stock ships to another.
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

    function n(v, label) {
        var x = Number(v);
        if (!isFinite(x)) { throw err('ERR_WMS_INVALID_ARGUMENT', label + ' must be a finite number'); }
        return x;
    }

    /** Units still pickable for a line = committed - already picked, floored at 0. */
    function cap(line) {
        if (!line || typeof line !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'line is required');
        }
        var committed = n(line.committed, 'committed');
        var picked = line.picked == null ? 0 : n(line.picked, 'picked');
        var remaining = committed - picked;
        return remaining > 0 ? remaining : 0;
    }

    /** A line may be waved only when NetSuite has committed stock still to pick (#15). */
    function isEligible(line) {
        return cap(line) > 0;
    }

    /** Filter a set of order lines to the wave-eligible ones (#15). */
    function eligibleLines(lines) {
        if (!Array.isArray(lines)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'lines must be an array');
        }
        return lines.filter(isEligible);
    }

    /**
     * Validate a proposed pick against the commitment cap (#15).
     * Returns { ok:true } or { ok:false, reasonCode:'COMMITMENT_EXCEEDED', cap }.
     */
    function validatePick(line, pickQty) {
        var q = n(pickQty, 'pickQty');
        if (q <= 0) {
            throw err('ERR_WMS_INVALID_QUANTITY', 'pickQty must be positive');
        }
        var c = cap(line);
        if (q > c) {
            return { ok: false, reasonCode: 'COMMITMENT_EXCEEDED', cap: c };
        }
        return { ok: true };
    }

    return {
        cap: cap,
        isEligible: isEligible,
        eligibleLines: eligibleLines,
        validatePick: validatePick,
    };
});
