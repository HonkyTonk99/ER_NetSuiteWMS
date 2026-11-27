/**
 * wms_lib_replenishment - FEFO source selection for replenishment (Phase 5;
 * invariant #23, D-03/D-30/D-33). PURE.
 *
 * HARD GUARD (#23): replenishment must NEVER source from a holding or production
 * location - only `locationClass === 'OPERATIONAL'` candidates are eligible, and a
 * caller that passes a non-operational source as mandatory is refused outright
 * (assertOperationalSource throws). FEFO: earliest expiry first, then putaway time
 * (FIFO fallback for no-expiry stock, D-03).
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

    function isOperational(c) {
        return String(c.locationClass).toUpperCase() === 'OPERATIONAL';
    }

    /** #23 absolute: refuse a mandated non-operational source rather than de-prioritise. */
    function assertOperationalSource(candidate) {
        if (!candidate || !isOperational(candidate)) {
            throw err('ERR_WMS_HOLDING_SOURCE_FORBIDDEN', 'replenishment may not source from a non-operational location (#23)');
        }
        return true;
    }

    function fefoKey(c) {
        // earliest expiry first; no-expiry sorts last; tie-break on putaway (FIFO), then bin for determinism
        var exp = (c.expiry === undefined || c.expiry === null || c.expiry === '') ? Infinity : new Date(c.expiry).getTime();
        if (isNaN(exp)) { exp = Infinity; }
        var put = (c.putawayTs === undefined || c.putawayTs === null) ? Infinity : new Date(c.putawayTs).getTime();
        if (isNaN(put)) { put = Infinity; }
        return [exp, put, String(c.bin)];
    }

    function cmp(a, b) {
        var ka = fefoKey(a);
        var kb = fefoKey(b);
        for (var i = 0; i < ka.length; i += 1) {
            if (ka[i] < kb[i]) { return -1; }
            if (ka[i] > kb[i]) { return 1; }
        }
        return 0;
    }

    /**
     * demand: { item, qtyNeeded }
     * candidates: [{ bin, location, locationClass, lot, expiry?, putawayTs?, qty }]
     * Returns { sources:[{ bin, location, lot, qty }], allocated, shortfall }.
     */
    function selectSources(demand, candidates) {
        if (!demand || typeof demand !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'demand is required');
        }
        if (!Array.isArray(candidates)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'candidates must be an array');
        }
        var need = Number(demand.qtyNeeded);
        if (!isFinite(need) || need <= 0) {
            throw err('ERR_WMS_INVALID_QUANTITY', 'qtyNeeded must be positive');
        }
        var eligible = candidates
            .filter(function (c) { return c && isOperational(c) && !c.blocked && Number(c.qty) > 0; })
            .slice()
            .sort(cmp);

        var sources = [];
        var remaining = need;
        for (var i = 0; i < eligible.length && remaining > 0; i += 1) {
            var c = eligible[i];
            var take = Math.min(remaining, Number(c.qty));
            sources.push({ bin: c.bin, location: c.location, lot: c.lot, qty: take });
            remaining -= take;
        }
        return {
            sources: sources,
            allocated: need - remaining,
            shortfall: remaining > 0 ? remaining : 0,
        };
    }

    return {
        assertOperationalSource: assertOperationalSource,
        selectSources: selectSources,
    };
});
