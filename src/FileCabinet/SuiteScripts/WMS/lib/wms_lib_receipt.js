/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * wms_lib_receipt - PURE assembly of receipt lines from a group of scan events
 * (vertical slice, docs/09). No `N/` module - unit-tested without an account.
 *
 * The one rule it exists to enforce: TRACKING MODE IS RESOLVED PER LINE, not per
 * group (invariant #14 - mixed-mode orders are normal). A purchase order may carry
 * a plain line and a lot line together; each line gets its OWN mode. Resolving
 * once from the first event and applying it to the group would shape lot/serial
 * lines as plain - silent ledger corruption.
 *
 * `resolveMode` is injected (the committer passes wms_lib_item_mode.resolveItemMode,
 * which caches by item id, so twenty lines of the same item still cost one lookup).
 * Here it is a plain function, which is what makes the mixed-mode case testable.
 */
define([], function () {
    'use strict';

    function wmsError(name, message) {
        var err = new Error(message);
        err.name = name;
        return err;
    }

    /**
     * @param {Object[]} events one per received line: { eventId, item, quantity, lot?, serials? }
     * @param {function(*):('PLAIN'|'LOT'|'SERIAL')} resolveMode per-item mode resolver
     * @returns {Object[]} lines: { eventId, item, quantity, mode, lot, serials }
     */
    function buildReceiptLines(events, resolveMode) {
        if (!Array.isArray(events)) {
            throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'events must be an array');
        }
        if (typeof resolveMode !== 'function') {
            throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'resolveMode must be a function');
        }
        return events.map(function (event) {
            if (event === null || typeof event !== 'object') {
                throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'event must be an object');
            }
            return {
                eventId: event.eventId,
                item: event.item,
                quantity: event.quantity,
                // PER LINE - mode is a property of the item, never derived from the group.
                mode: resolveMode(event.item),
                lot: event.lot,
                serials: event.serials,
            };
        });
    }

    return {
        buildReceiptLines: buildReceiptLines,
    };
});
