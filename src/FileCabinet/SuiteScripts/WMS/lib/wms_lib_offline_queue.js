/**
 * wms_lib_offline_queue - the handheld's durable outbound queue state machine
 * (Phase 3; invariant #11 - the radio is off by default). PURE logic over an
 * array of queued events, so the state transitions are unit-testable without a
 * device or an account. The IndexedDB persistence (T-3.2) and the HTTP send are
 * thin client concerns; this module owns only WHAT moves between states.
 *
 * Event lifecycle on the device: QUEUED -> (send) -> SYNCED | REJECTED, or stays
 * QUEUED with an incremented retry count when the server was busy (D-56).
 *
 * Error shape (D-23): programmer errors throw a plain Error with an ERR_WMS_* name.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], function () {
    'use strict';

    var STATUS = { QUEUED: 'QUEUED', SYNCED: 'SYNCED', REJECTED: 'REJECTED' };

    function err(name, message) {
        var e = new Error(message);
        e.name = name;
        return e;
    }

    function requireFn(fn, label) {
        if (typeof fn !== 'function') {
            throw err('ERR_WMS_INVALID_ARGUMENT', label + ' function is required');
        }
    }

    function requireArray(a, label) {
        if (!Array.isArray(a)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', label + ' must be an array');
        }
    }

    /**
     * Build a queue entry from a scan. `uuidFn` mints the client UUID that becomes
     * externalid (the idempotency key, #3); `nowFn` stamps client time (#se_client_ts).
     */
    function createEvent(fields, deps) {
        if (!fields || typeof fields !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'event fields object is required');
        }
        deps = deps || {};
        requireFn(deps.uuidFn, 'uuidFn');
        requireFn(deps.nowFn, 'nowFn');
        var copy = {};
        Object.keys(fields).forEach(function (k) { copy[k] = fields[k]; });
        copy.uuid = fields.uuid || deps.uuidFn();
        copy.clientTs = fields.clientTs || deps.nowFn();
        copy.status = STATUS.QUEUED;
        copy.retry = 0;
        return copy;
    }

    function enqueue(queue, event) {
        requireArray(queue, 'queue');
        if (!event || !event.uuid) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'event with a uuid is required');
        }
        if (queue.some(function (e) { return e.uuid === event.uuid; })) {
            return queue.slice(); // idempotent enqueue - never a duplicate uuid locally
        }
        return queue.concat([event]);
    }

    function pending(queue) {
        requireArray(queue, 'queue');
        return queue.filter(function (e) { return e.status === STATUS.QUEUED; });
    }

    /** The next `size` QUEUED events, in order - the batch to POST (bounded, F-29). */
    function takeBatch(queue, size) {
        requireArray(queue, 'queue');
        var n = Number(size);
        if (!isFinite(n) || n <= 0) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'batch size must be a positive number');
        }
        return pending(queue).slice(0, n);
    }

    /**
     * Apply per-event dispositions from a sync round. `dispositions` maps uuid ->
     * 'synced' | 'retry' | 'rejected' (see wms_lib_sync.classifyResponse). Returns a
     * NEW queue; 'retry' keeps the event QUEUED and increments retry. 'rejected'
     * carries an optional reason for the operator/exception surface.
     */
    function applyDispositions(queue, dispositions, reasons) {
        requireArray(queue, 'queue');
        if (!dispositions || typeof dispositions !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'dispositions map is required');
        }
        reasons = reasons || {};
        return queue.map(function (e) {
            var d = dispositions[e.uuid];
            if (!d) { return e; }
            var next = {};
            Object.keys(e).forEach(function (k) { next[k] = e[k]; });
            if (d === 'synced') {
                next.status = STATUS.SYNCED;
            } else if (d === 'retry') {
                next.retry = (e.retry || 0) + 1;
                next.status = STATUS.QUEUED;
            } else if (d === 'rejected') {
                next.status = STATUS.REJECTED;
                next.rejectReason = reasons[e.uuid] || 'rejected';
            } else {
                throw err('ERR_WMS_INVALID_ARGUMENT', 'unknown disposition: ' + d);
            }
            return next;
        });
    }

    /** Drop confirmed-SYNCED events once persistence has recorded them (T-3.2). */
    function purgeSynced(queue) {
        requireArray(queue, 'queue');
        return queue.filter(function (e) { return e.status !== STATUS.SYNCED; });
    }

    return {
        STATUS: STATUS,
        createEvent: createEvent,
        enqueue: enqueue,
        pending: pending,
        takeBatch: takeBatch,
        applyDispositions: applyDispositions,
        purgeSynced: purgeSynced,
    };
});
