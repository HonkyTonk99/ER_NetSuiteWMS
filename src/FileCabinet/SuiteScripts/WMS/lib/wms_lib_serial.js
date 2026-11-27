/**
 * wms_lib_serial - serial validation + state transitions (Phase 5B; D-29, section 3.13/3.13b;
 * invariants #21, #22, PF-23). PURE.
 *
 * Governing principle (section 3.13b): distinguish "the data is wrong" (CONTINUE, correct the
 * record) from "the action is wrong" (STOP, because proceeding compounds a real error).
 *
 * Statuses: IN_STOCK, PICKED, SHIPPED, QUARANTINE, RETIRED. A serial is in exactly one
 * bin (#21). Re-entry of a RETIRED serial reactivates the SAME row and increments
 * generation - never a second row, no hard delete (PF-23).
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

    var ACTIVE = { IN_STOCK: 1, PICKED: 1, SHIPPED: 1, QUARANTINE: 1 };

    /** Receiving a serial. state = existing serial_state row or null. */
    function validateEntry(serial, state) {
        if (serial === undefined || serial === null || serial === '') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'serial is required');
        }
        if (state && ACTIVE[String(state.status).toUpperCase()]) {
            return { ok: false, action: 'STOP', reasonCode: 'SERIAL_ALREADY_LIVE' };
        }
        // No row, or a RETIRED row to reactivate (generation++): accept.
        var reactivate = !!(state && String(state.status).toUpperCase() === 'RETIRED');
        return { ok: true, reactivate: reactivate, nextGeneration: reactivate ? (Number(state.generation || 0) + 1) : 0 };
    }

    /** Picking a serial. ctx = { expectedItem, expectedBin }. */
    function validatePick(serial, state, ctx) {
        if (serial === undefined || serial === null || serial === '') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'serial is required');
        }
        ctx = ctx || {};
        if (!state) {
            // section 3.13b: never create a row on the fly; needs the adopt path (Q-54).
            return { ok: false, action: 'STOP', reasonCode: 'SERIAL_UNKNOWN' };
        }
        if (ctx.expectedItem != null && String(state.item) !== String(ctx.expectedItem)) {
            return { ok: false, action: 'STOP', reasonCode: 'SERIAL_WRONG_ITEM' };
        }
        var status = String(state.status).toUpperCase();
        if (status !== 'IN_STOCK') {
            return { ok: false, action: 'STOP', reasonCode: 'SERIAL_NOT_AVAILABLE', subCase: status };
        }
        if (ctx.expectedBin != null && String(state.bin) !== String(ctx.expectedBin)) {
            // Data-wrong, not action-wrong: the physical world wins. Continue, move the
            // serial to reflect reality, raise a discrepancy (#20/#21).
            return { ok: true, action: 'CONTINUE', discrepancy: 'SERIAL_WRONG_BIN', actualBin: state.bin };
        }
        return { ok: true };
    }

    /** Serials scanned must equal the line quantity (#se_serials validation). */
    function countMatches(serials, qty) {
        if (!Array.isArray(serials)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'serials must be an array');
        }
        var q = Number(qty);
        if (!isFinite(q)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'qty must be a number');
        }
        if (serials.length !== q) {
            return { ok: false, action: 'STOP', reasonCode: 'SERIAL_COUNT_MISMATCH', scanned: serials.length, expected: q };
        }
        // No duplicate serials within one line.
        var seen = {};
        for (var i = 0; i < serials.length; i += 1) {
            var s = String(serials[i]);
            if (seen[s]) {
                return { ok: false, action: 'STOP', reasonCode: 'SERIAL_COUNT_MISMATCH', duplicate: s };
            }
            seen[s] = 1;
        }
        return { ok: true };
    }

    return {
        validateEntry: validateEntry,
        validatePick: validatePick,
        countMatches: countMatches,
    };
});
