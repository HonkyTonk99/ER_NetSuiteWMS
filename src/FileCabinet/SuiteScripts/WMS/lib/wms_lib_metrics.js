/**
 * wms_lib_metrics - roll scan events into a metric snapshot (Phase 9; invariant #10,
 * AD-12, D-39). PURE. The dashboard/Hub reads SNAPSHOTS, never the raw scan-event
 * table (#10); this is the aggregation the snapshot writer runs.
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

    function isError(e) {
        return String(e.status).toUpperCase() === 'FAILED' || !!e.error;
    }

    /**
     * Aggregate an array of scan events into snapshot counters.
     * event: { type, order?, orderLineKey?, qty?, status?, error? }
     * Returns { scansTotal, scansError, scansOverride, linesPicked, unitsPicked, ordersPacked }.
     */
    function aggregate(events) {
        if (!Array.isArray(events)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'events must be an array');
        }
        var pickedLines = {};
        var packedOrders = {};
        var snap = { scansTotal: 0, scansError: 0, scansOverride: 0, linesPicked: 0, unitsPicked: 0, ordersPacked: 0 };
        events.forEach(function (e) {
            snap.scansTotal += 1;
            if (isError(e)) { snap.scansError += 1; }
            if (String(e.type).toUpperCase() === 'OVERRIDE') { snap.scansOverride += 1; }
            if (String(e.type).toUpperCase() === 'PICK') {
                snap.unitsPicked += Number(e.qty) || 0;
                var lk = String(e.order == null ? '' : e.order) + '#' + String(e.orderLineKey == null ? '' : e.orderLineKey);
                pickedLines[lk] = 1;
            }
            if (String(e.type).toUpperCase() === 'PACK' && e.order != null) {
                packedOrders[String(e.order)] = 1;
            }
        });
        snap.linesPicked = Object.keys(pickedLines).length;
        snap.ordersPacked = Object.keys(packedOrders).length;
        return snap;
    }

    /** Build a full snapshot payload for one (location, operator, interval). */
    function snapshotFor(events, meta) {
        meta = meta || {};
        var snap = aggregate(events);
        snap.location = meta.location;
        snap.operator = meta.operator || null; // null = team-level row
        snap.intervalStart = meta.intervalStart || null;
        snap.intervalEnd = meta.intervalEnd || null;
        return snap;
    }

    return {
        aggregate: aggregate,
        snapshotFor: snapshotFor,
    };
});
