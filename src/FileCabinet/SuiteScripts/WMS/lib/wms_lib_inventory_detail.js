/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * wms_lib_inventory_detail - PURE shaping of the inventorydetail assignment
 * sublist for a receipt/issue line (vertical slice, docs/09; T-2.7 in full).
 *
 * This is the single most error-prone shape in the slice, so it is isolated as a
 * pure function and unit-tested with no NetSuite account. The ledger adapter
 * (wms_lib_ledger_adapter.js) applies the returned spec to a real record via
 * N/record; this module imports NO `N/` module.
 *
 * Platform facts it encodes (docs/08):
 *   PF-16 - inventorydetail -> inventoryassignment sublist; receiptinventorynumber
 *           when stock ENTERS, issueinventorynumber when it LEAVES; NO bin fields.
 *   PF-17 - SERIAL: one line per serial, quantity EXACTLY 1.
 *           LOT: one line, quantity may exceed 1 / be fractional.
 *           PLAIN: no inventory detail at all.
 *
 * Error shape (D-23): a contract violation that would corrupt the ledger throws a
 * plain `Error` with an ERR_WMS_* `name` (action-wrong: must stop). It never
 * silently truncates or pads.
 */
define([], function () {
    'use strict';

    var MODES = { PLAIN: 'PLAIN', LOT: 'LOT', SERIAL: 'SERIAL' };
    var DIRECTIONS = { RECEIPT: 'receipt', ISSUE: 'issue' };

    function wmsError(name, message) {
        var err = new Error(message);
        err.name = name;
        return err;
    }

    /**
     * The assignment field that carries the inventory number, by direction (PF-16).
     * @param {string} direction 'receipt' (entering) | 'issue' (leaving)
     * @returns {string}
     */
    function numberField(direction) {
        if (direction === DIRECTIONS.RECEIPT) { return 'receiptinventorynumber'; }
        if (direction === DIRECTIONS.ISSUE) { return 'issueinventorynumber'; }
        throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'direction must be "receipt" or "issue"');
    }

    /**
     * Build the inventoryassignment line spec(s) for one order line.
     *
     * @param {Object} line
     * @param {string} line.mode      PLAIN | LOT | SERIAL (resolved from recordtype, PF-14)
     * @param {number} line.quantity  line quantity (> 0)
     * @param {string} [line.lot]     lot number (LOT mode)
     * @param {string[]} [line.serials] serial numbers (SERIAL mode)
     * @param {string} [direction]    'receipt' (default) | 'issue'
     * @returns {Array<Object>} one plain object per assignment line; [] for PLAIN
     */
    function buildInventoryAssignments(line, direction) {
        var dir = direction || DIRECTIONS.RECEIPT;
        var field = numberField(dir);

        if (line === null || typeof line !== 'object') {
            throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'line must be an object');
        }
        if (typeof line.quantity !== 'number' || !(line.quantity > 0)) {
            throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'line.quantity must be a positive number');
        }

        if (line.mode === MODES.PLAIN) {
            // No inventory detail for a plain item (PF-16).
            return [];
        }

        if (line.mode === MODES.LOT) {
            if (line.lot === null || line.lot === undefined || line.lot === '') {
                throw wmsError('ERR_WMS_MISSING_LOT', 'a LOT line requires a lot number');
            }
            // One line; quantity may exceed 1 / be fractional (PF-17).
            var lotLine = { quantity: line.quantity };
            lotLine[field] = line.lot;
            return [lotLine];
        }

        if (line.mode === MODES.SERIAL) {
            var serials = line.serials;
            if (!Array.isArray(serials)) {
                throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'a SERIAL line requires a serials array');
            }
            // Count must equal quantity - posting a wrong count corrupts the ledger
            // (action-wrong, must stop; never pad or truncate).
            if (serials.length !== line.quantity) {
                throw wmsError(
                    'ERR_WMS_SERIAL_COUNT_MISMATCH',
                    'serials (' + serials.length + ') must equal quantity (' + line.quantity + ')'
                );
            }
            // One assignment line per serial, quantity EXACTLY 1 (PF-17).
            return serials.map(function (serial) {
                if (serial === null || serial === undefined || serial === '') {
                    throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'a serial value may not be empty');
                }
                var serialLine = { quantity: 1 };
                serialLine[field] = serial;
                return serialLine;
            });
        }

        throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'unknown tracking mode: ' + line.mode);
    }

    return {
        MODES: MODES,
        DIRECTIONS: DIRECTIONS,
        buildInventoryAssignments: buildInventoryAssignments,
    };
});
