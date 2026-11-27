/**
 * wms_lib_ledger_shapes - the single source of truth for WHICH NetSuite posting an
 * event type produces (Phase 4; docs/06 section 4; invariant #13). PURE lookup, no
 * N/. The committer's thin N/ layer reads a descriptor from here and performs the
 * record.transform/save; the DECISION (txn type, transform source, direction,
 * whether it even posts) lives here and is unit-testable.
 *
 * Seven posting shapes (D-35 added WO Issue): three inbound, three outbound, plus
 * Inventory Transfer; bin movements post NOTHING unless they cross a NetSuite
 * location (D-31) - then an Inventory Transfer - or write stock off (D-33).
 *
 * Error shape (D-23): unknown type throws ERR_WMS_UNKNOWN_EVENT_TYPE.
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

    // direction: IN (receipts/production output), OUT (consumption/fulfilment),
    // MOVE (location/bin movement - posts only when crossing a NetSuite location).
    var TABLE = {
        RECEIPT_PO: { direction: 'IN', postsLedger: true, netsuiteTxn: 'itemreceipt', transformFrom: 'purchaseorder', needsInventoryDetail: true },
        RECEIPT_TO: { direction: 'IN', postsLedger: true, netsuiteTxn: 'itemreceipt', transformFrom: 'transferorder', needsInventoryDetail: true },
        RECEIPT_RMA: { direction: 'IN', postsLedger: true, netsuiteTxn: 'itemreceipt', transformFrom: 'returnauthorization', needsInventoryDetail: true },
        RECEIPT_WO: { direction: 'IN', postsLedger: true, netsuiteTxn: 'workordercompletion', transformFrom: 'workorder', needsInventoryDetail: true },
        PICK: { direction: 'OUT', postsLedger: true, netsuiteTxn: 'itemfulfillment', transformFrom: 'salesorder', needsInventoryDetail: true, groupBy: 'orderLocation' },
        PACK: { direction: 'OUT', postsLedger: true, netsuiteTxn: 'itemfulfillment', transformFrom: 'salesorder', needsInventoryDetail: true, groupBy: 'orderLocation' },
        WO_ISSUE: { direction: 'OUT', postsLedger: true, netsuiteTxn: 'workorderissue', transformFrom: 'workorder', needsInventoryDetail: true },
        WRITE_OFF: { direction: 'OUT', postsLedger: true, netsuiteTxn: 'inventoryadjustment', needsInventoryDetail: true },
        COUNT: { direction: 'OUT', postsLedger: true, netsuiteTxn: 'inventoryadjustment', needsInventoryDetail: true },
        // Movements: post nothing within a location; an Inventory Transfer across
        // NetSuite locations (D-31). The WO "pick-to-floor" (D-43) is one of these.
        BIN_TRANSFER: { direction: 'MOVE', postsLedger: false, netsuiteTxn: null },
        REPLEN_MOVE: { direction: 'MOVE', postsLedger: false, netsuiteTxn: null },
        PUTAWAY: { direction: 'MOVE', postsLedger: false, netsuiteTxn: null },
    };

    function direction(eventType) {
        var d = TABLE[eventType];
        if (!d) { throw err('ERR_WMS_UNKNOWN_EVENT_TYPE', 'no ledger shape for event type: ' + eventType); }
        return d.direction;
    }

    /**
     * Resolve the concrete posting descriptor for an event type.
     * ctx:
     *   crossLocation (bool) - MOVE events post an Inventory Transfer when true
     *   woOutputType ('WORK_ORDER_COMPLETION'|'ASSEMBLY_BUILD') - per location (D-47)
     */
    function shapeFor(eventType, ctx) {
        var base = TABLE[eventType];
        if (!base) { throw err('ERR_WMS_UNKNOWN_EVENT_TYPE', 'no ledger shape for event type: ' + eventType); }
        ctx = ctx || {};
        var d = {};
        Object.keys(base).forEach(function (k) { d[k] = base[k]; });

        if (d.direction === 'MOVE') {
            if (ctx.crossLocation) {
                d.postsLedger = true;
                d.netsuiteTxn = 'inventorytransfer';
                d.needsInventoryDetail = true;
            }
            return d;
        }
        if (eventType === 'RECEIPT_WO' && String(ctx.woOutputType).toUpperCase() === 'ASSEMBLY_BUILD') {
            d.netsuiteTxn = 'assemblybuild';
        }
        return d;
    }

    function isKnown(eventType) {
        return Object.prototype.hasOwnProperty.call(TABLE, eventType);
    }

    return {
        direction: direction,
        shapeFor: shapeFor,
        isKnown: isKnown,
        types: function () { return Object.keys(TABLE); },
    };
});
