/**
 * wms_lib_retention - scan-event archive-before-purge (Phase 11; D-57, Q-09, T-11.1).
 * PURE. A scan event is the only record of who scanned what, so it is archived to a
 * durable store BEFORE any purge; only POSTED events older than the retention window
 * AND already archived may be purged. Non-POSTED events are never purged.
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

    var DAY_MS = 24 * 60 * 60 * 1000;

    /** 'KEEP' | 'ARCHIVE' | 'PURGE' for one event. */
    function classify(event, retentionDays, nowMs) {
        if (!event || typeof event !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'event is required');
        }
        var days = Number(retentionDays);
        var now = Number(nowMs);
        if (!isFinite(days) || !isFinite(now)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'retentionDays and nowMs must be numbers');
        }
        if (String(event.status).toUpperCase() !== 'POSTED') {
            return 'KEEP'; // only settled events are ever purged
        }
        var postedTs = Number(event.postedTs);
        if (!isFinite(postedTs)) { return 'KEEP'; }
        var ageDays = (now - postedTs) / DAY_MS;
        if (ageDays <= days) { return 'KEEP'; }
        return event.archived ? 'PURGE' : 'ARCHIVE';
    }

    /** Partition a batch into { keep, archive, purge }. */
    function partition(events, retentionDays, nowMs) {
        if (!Array.isArray(events)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'events must be an array');
        }
        var out = { keep: [], archive: [], purge: [] };
        events.forEach(function (e) {
            var c = classify(e, retentionDays, nowMs);
            if (c === 'ARCHIVE') { out.archive.push(e); } else if (c === 'PURGE') { out.purge.push(e); } else { out.keep.push(e); }
        });
        return out;
    }

    return { classify: classify, partition: partition };
});
