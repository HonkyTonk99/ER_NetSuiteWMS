/**
 * wms_lib_governance - batch sizing + channel routing (Phase 12; D-49, D-34, F-29,
 * F-17). PURE. A committer batch is bounded by BOTH governance units and the 10 MB
 * Map/Reduce value limit (D-34, high serial share), and by the config max; process
 * types can route to different deployment channels (D-49, no SuiteCloud Plus
 * assumed but scalable).
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

    function pos(v, label) {
        var n = Number(v);
        if (!isFinite(n) || n <= 0) { throw err('ERR_WMS_INVALID_ARGUMENT', label + ' must be positive'); }
        return n;
    }

    /**
     * How many events fit in one batch, bounded by units AND value AND config max.
     * opts: { remainingUnits, perEventUnits, maxValueBytes, perEventBytes, configMax }
     */
    function batchSize(opts) {
        if (!opts || typeof opts !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'opts is required');
        }
        var byUnits = Math.floor(pos(opts.remainingUnits, 'remainingUnits') / pos(opts.perEventUnits, 'perEventUnits'));
        var byValue = Math.floor(pos(opts.maxValueBytes, 'maxValueBytes') / pos(opts.perEventBytes, 'perEventBytes'));
        var cap = opts.configMax == null ? Infinity : pos(opts.configMax, 'configMax');
        var n = Math.min(byUnits, byValue, cap);
        return n > 0 ? n : 0;
    }

    /** Yield when the next unit of work would exceed remaining governance (F-17). */
    function shouldYield(remainingUnits, estimate) {
        var r = Number(remainingUnits);
        var e = Number(estimate);
        if (!isFinite(r) || !isFinite(e)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'remainingUnits and estimate must be numbers');
        }
        return r < e;
    }

    /** Route a process type to its deployment channel (D-49); default when unmapped. */
    function channelFor(processType, routing) {
        var r = routing || {};
        return Object.prototype.hasOwnProperty.call(r, processType) ? r[processType] : 'default';
    }

    return {
        batchSize: batchSize,
        shouldYield: shouldYield,
        channelFor: channelFor,
    };
});
