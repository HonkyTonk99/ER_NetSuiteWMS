/**
 * wms_lib_serial_adopt - the serial adopt path (Phase 13; D-58, Q-54, section 3.13b).
 * PURE. At cutover / parallel running NetSuite holds serials the WMS has never seen.
 * The WMS must NOT create serial rows on the fly during a pick (SERIAL_UNKNOWN); a
 * pre-existing serial is adopted through a controlled, supervisor-authorised flow,
 * reconciled against NetSuite.
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

    /**
     * input: { existsInNetSuite (bool), wmsRow (object|null), authorised (bool),
     *          item, serial, bin, location }
     * Returns:
     *   { action:'NO_ACTION' }                      - WMS already has the row
     *   { action:'REJECT', reasonCode:'SERIAL_UNKNOWN' } - not in NetSuite either
     *   { action:'REQUIRES_AUTH' }                  - adoptable but needs a supervisor
     *   { action:'ADOPT', row }                     - create the WMS row (generation 0)
     */
    function adoptDecision(input) {
        if (!input || typeof input !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'input is required');
        }
        if (input.wmsRow) {
            return { action: 'NO_ACTION' };
        }
        if (!input.existsInNetSuite) {
            return { action: 'REJECT', reasonCode: 'SERIAL_UNKNOWN' };
        }
        if (!input.authorised) {
            return { action: 'REQUIRES_AUTH' };
        }
        return {
            action: 'ADOPT',
            row: {
                item: input.item,
                serial: input.serial,
                bin: input.bin,
                location: input.location,
                status: 'IN_STOCK',
                generation: 0,
            },
        };
    }

    return { adoptDecision: adoptDecision };
});
