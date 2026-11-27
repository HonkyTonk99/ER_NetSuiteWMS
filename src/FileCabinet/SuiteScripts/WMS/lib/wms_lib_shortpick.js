/**
 * wms_lib_shortpick - unresolvable short-pick policy (Phase 7; Q-11). PURE. When a
 * line cannot be fully picked, the configured policy decides: ship partial, hold the
 * order, or backorder. Short picks are recorded honestly and flagged, never blocked
 * at the handheld (the office resolves them).
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

    var POLICIES = { SHIP_PARTIAL: 1, HOLD: 1, BACKORDER: 1 };

    /**
     * line: { requested, picked }. policy: one of SHIP_PARTIAL|HOLD|BACKORDER.
     * Returns { complete:true } when fully picked, else
     * { short:true, action:<policy>, shortBy }.
     */
    function resolve(policy, line) {
        var p = String(policy || '').toUpperCase();
        if (!POLICIES[p]) {
            throw err('ERR_WMS_INVALID_CONFIG_VALUE', 'unknown short-pick policy: ' + policy);
        }
        if (!line || typeof line !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'line is required');
        }
        var requested = Number(line.requested);
        var picked = Number(line.picked);
        if (!isFinite(requested) || !isFinite(picked)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'requested and picked must be numbers');
        }
        if (picked >= requested) {
            return { complete: true };
        }
        return { short: true, action: p, shortBy: requested - picked };
    }

    return { resolve: resolve, POLICIES: Object.keys(POLICIES) };
});
