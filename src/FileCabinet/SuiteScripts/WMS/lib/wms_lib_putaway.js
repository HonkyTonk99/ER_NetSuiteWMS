/**
 * wms_lib_putaway - directed putaway target selection (Phase 5B; D-09, D-16, D-30,
 * AD-14). PURE. Given received stock and candidate bins, pick a legal target that
 * respects bin policy (single-SKU / single-batch), capacity, blocked/active, and
 * location class. Good stock targets OPERATIONAL bins; non-fulfillable receipts
 * (RQD / quarantine) target their holding bins. Returns a target or a
 * NO_PUTAWAY_LOCATION verdict (which the caller raises as an exception, #8).
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

    function fits(bin, item, lot, qty) {
        // An empty bin (item cleared, invariant #20) accepts anything its policy allows.
        var empty = bin.item === undefined || bin.item === null || bin.item === '';
        if (!empty) {
            if (bin.policy && bin.policy.singleSku && String(bin.item) !== String(item)) { return false; }
            if (bin.policy && bin.policy.singleBatch && String(bin.lot || '') !== String(lot || '')) { return false; }
        }
        if (bin.capacity != null) {
            var used = Number(bin.qty || 0);
            if (used + qty > Number(bin.capacity)) { return false; }
        }
        return true;
    }

    /**
     * input: { item, lot, qty, holding (bool) }
     * candidates: [{ bin, locationClass, policy:{singleSku,singleBatch,allowPutaway,availableForFulfilment},
     *                item, lot, qty, capacity, blocked, active, preferred? }]
     * Returns { ok:true, target } or { ok:false, reasonCode:'NO_PUTAWAY_LOCATION' }.
     */
    function selectTarget(input, candidates) {
        if (!input || typeof input !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'putaway input is required');
        }
        if (!Array.isArray(candidates)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'candidates must be an array');
        }
        var qty = Number(input.qty);
        if (!isFinite(qty) || qty <= 0) {
            throw err('ERR_WMS_INVALID_QUANTITY', 'qty must be positive');
        }
        var wantHolding = input.holding === true;

        var usable = candidates.filter(function (c) {
            if (!c || c.active === false || c.blocked) { return false; }
            if (c.policy && c.policy.allowPutaway === false) { return false; }
            var cls = String(c.locationClass).toUpperCase();
            // Good stock -> OPERATIONAL only; quarantine/RQD receipts -> HOLDING only.
            if (wantHolding ? cls !== 'HOLDING' : cls !== 'OPERATIONAL') { return false; }
            return fits(c, input.item, input.lot, qty);
        });

        if (!usable.length) {
            return { ok: false, reasonCode: 'NO_PUTAWAY_LOCATION' };
        }
        // Prefer an explicitly preferred/zoned bin, then the emptiest that fits (spread load).
        usable.sort(function (a, b) {
            if (!!b.preferred - !!a.preferred) { return (!!b.preferred) - (!!a.preferred); }
            return Number(a.qty || 0) - Number(b.qty || 0);
        });
        return { ok: true, target: usable[0].bin };
    }

    return { selectTarget: selectTarget };
});
