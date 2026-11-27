/**
 * wms_lib_commit_plan - two-phase commit ordering + fulfilment grouping (Phase 4;
 * invariants #18, #4). PURE. One committer cycle posts ALL inbound (receipts /
 * production output) before ANY outbound (fulfilment / adjustment / consumption) -
 * a global priority, not a per-item dependency graph (D-11). Fulfilment events are
 * grouped by (order, location) so there is exactly one record.transform per
 * (sales order, location) (#4, PF-18).
 *
 * Bin movements within a location post nothing (#13) - they settle bin state only.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['./wms_lib_ledger_shapes.js'], function (shapes) {
    'use strict';

    function err(name, message) {
        var e = new Error(message);
        e.name = name;
        return e;
    }

    function crossesLocation(ev) {
        if (ev.crossLocation != null) { return !!ev.crossLocation; }
        var from = ev.sourceLocation;
        var to = ev.targetLocation;
        return from != null && to != null && String(from) !== String(to);
    }

    /**
     * Partition PENDING events for one cycle.
     * Returns { phaseA, phaseB, binOnly }:
     *   phaseA  - inbound postings (post first)
     *   phaseB  - outbound postings + location-crossing transfers (post second)
     *   binOnly - movements that post nothing to the ledger (bin-state settle only)
     */
    function plan(events) {
        if (!Array.isArray(events)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'events must be an array');
        }
        var phaseA = [];
        var phaseB = [];
        var binOnly = [];
        events.forEach(function (ev) {
            if (!ev || !ev.eventType) {
                throw err('ERR_WMS_INVALID_ARGUMENT', 'each event needs an eventType');
            }
            var dir = shapes.direction(ev.eventType);
            if (dir === 'IN') {
                phaseA.push(ev);
            } else if (dir === 'OUT') {
                phaseB.push(ev);
            } else { // MOVE
                if (crossesLocation(ev)) {
                    phaseB.push(ev); // posts an Inventory Transfer (D-31)
                } else {
                    binOnly.push(ev);
                }
            }
        });
        return { phaseA: phaseA, phaseB: phaseB, binOnly: binOnly };
    }

    function keyOf(ev) {
        return JSON.stringify(['ol', String(ev.order == null ? '' : ev.order), String(ev.location == null ? '' : ev.location)]);
    }

    /**
     * Group fulfilment-type events (shape.groupBy === 'orderLocation') by
     * (order, location). Non-fulfilment events are returned under their own uuid so
     * each posts individually. Returns an array of { key, events } groups, order
     * preserved by first appearance (deterministic).
     */
    function groupFulfilment(events) {
        if (!Array.isArray(events)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'events must be an array');
        }
        var order = [];
        var byKey = {};
        events.forEach(function (ev) {
            var shape = shapes.shapeFor(ev.eventType, {});
            var key = shape.groupBy === 'orderLocation' ? keyOf(ev) : JSON.stringify(['solo', ev.uuid || JSON.stringify(ev)]);
            if (!byKey[key]) {
                byKey[key] = { key: key, events: [] };
                order.push(key);
            }
            byKey[key].events.push(ev);
        });
        return order.map(function (k) { return byKey[k]; });
    }

    /** Deferral escalation: past the configured retry limit a DEFER becomes an exception. */
    function shouldEscalate(deferCount, limit) {
        var c = Number(deferCount);
        var l = Number(limit);
        if (!isFinite(c) || !isFinite(l)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'deferCount and limit must be numbers');
        }
        return c >= l;
    }

    return {
        plan: plan,
        groupFulfilment: groupFulfilment,
        shouldEscalate: shouldEscalate,
    };
});
