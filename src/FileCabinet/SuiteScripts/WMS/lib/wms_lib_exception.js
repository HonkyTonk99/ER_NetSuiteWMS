/**
 * wms_lib_exception - build an exception descriptor from a failed event (Phase 8;
 * invariant #8, AD-11). PURE. Every FAILED event raises a customrecord_wms_exception
 * - never just a log line, because the operator already moved the stock. This maps a
 * reason code to a severity and shapes the record the caller writes.
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

    // Reason code -> default severity (docs/03 section 3.8 exception set).
    var SEVERITY = {
        CLOSED_PERIOD_POSTING: 'HIGH',
        COMMITMENT_EXCEEDED: 'HIGH',
        UNATTRIBUTED_MOVEMENT: 'HIGH',
        DEFERRAL_TIMEOUT: 'HIGH',
        PO_LINE_MISMATCH: 'HIGH',
        SERIAL_ALREADY_LIVE: 'HIGH',
        SERIAL_UNKNOWN: 'HIGH',
        SERIAL_WRONG_ITEM: 'HIGH',
        SERIAL_NOT_AVAILABLE: 'HIGH',
        SERIAL_COUNT_MISMATCH: 'MEDIUM',
        SERIAL_WRONG_BIN: 'MEDIUM',
        NEGATIVE_BIN_STATE: 'MEDIUM',
        RECONCILIATION_DRIFT: 'MEDIUM',
        OVER_RECEIPT: 'MEDIUM',
        RECEIPT_DISCREPANCY: 'MEDIUM',
        NO_PUTAWAY_LOCATION: 'MEDIUM',
        MISSING_LOT_DATA: 'MEDIUM',
        SHORT_PICK: 'LOW',
        OVER_PICK: 'LOW',
    };

    function severityFor(reasonCode) {
        return SEVERITY[reasonCode] || 'MEDIUM';
    }

    /**
     * Build the exception record payload for a failed event.
     * event: { uuid, location, ... } ; reasonCode: string ; opts: { severity?, notes?, detectedAt? }
     */
    function raise(event, reasonCode, opts) {
        if (!reasonCode) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'reasonCode is required');
        }
        opts = opts || {};
        return {
            sourceEvent: event ? event.uuid : undefined,
            location: event ? event.location : undefined,
            type: reasonCode,
            severity: opts.severity || severityFor(reasonCode),
            status: 'OPEN',
            notes: opts.notes || '',
            detectedAt: opts.detectedAt || null,
        };
    }

    return {
        severityFor: severityFor,
        raise: raise,
    };
});
