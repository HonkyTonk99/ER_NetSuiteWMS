/**
 * wms_lib_qms - QMS integration mapping (Phase 9Q; D-54). PURE. The NetSuite QMS
 * SuiteApp is the inspection layer; the WMS owns ALL stock movement. This module
 * maps a WMS receipt to a QMS inspection-queue request (staged via qm_rest_queue /
 * qm_integration_module - the thin N/ caller), and maps a QMS inspection OUTCOME to
 * a WMS movement intent. QMS's own bin/Inventory-Status quarantine workflows are
 * NOT used (foreclosed by D-07/D-41); the WMS moves stock via Inventory Transfer
 * (D-28/D-31) or an authorised write-off (D-33).
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
     * Build the QMS inspection-queue request for a received line.
     * event: { item, lot, qty, location, sourceDoc, serials? } ; specId: the quality spec.
     */
    function inspectionRequest(event, specId) {
        if (!event || typeof event !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'event is required');
        }
        if (!specId) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'specId is required');
        }
        return {
            spec: specId,
            item: event.item,
            lot: event.lot || null,
            qty: event.qty,
            location: event.location,
            sourceDoc: event.sourceDoc || null,
            serials: Array.isArray(event.serials) ? event.serials.slice() : [],
        };
    }

    /**
     * Map a QMS inspection outcome to a WMS movement intent. The WMS - not QMS -
     * performs the move.
     *   PASS    -> release: Inventory Transfer holding -> operational (D-31)
     *   FAIL    -> quarantine: stock stays in the holding location; an authorised
     *              write-off (D-33) is a separate, supervisor-gated step
     *   PARTIAL -> split: release the passed qty, quarantine the rest
     * Returns { action, wmsMovement, ... }.
     */
    function onResult(result) {
        if (!result || typeof result !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'result is required');
        }
        var outcome = String(result.outcome || '').toUpperCase();
        if (outcome === 'PASS') {
            return { action: 'RELEASE', wmsMovement: 'INVENTORY_TRANSFER', from: 'HOLDING', to: 'OPERATIONAL' };
        }
        if (outcome === 'FAIL') {
            return { action: 'QUARANTINE', wmsMovement: null, note: 'stays in holding; write-off is authorised separately (D-33)' };
        }
        if (outcome === 'PARTIAL') {
            return {
                action: 'SPLIT',
                release: { wmsMovement: 'INVENTORY_TRANSFER', qty: Number(result.passQty) || 0 },
                quarantine: { wmsMovement: null, qty: Number(result.failQty) || 0 },
            };
        }
        throw err('ERR_WMS_INVALID_ARGUMENT', 'unknown QMS outcome: ' + result.outcome);
    }

    return {
        inspectionRequest: inspectionRequest,
        onResult: onResult,
    };
});
