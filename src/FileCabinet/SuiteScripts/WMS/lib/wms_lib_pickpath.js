/**
 * wms_lib_pickpath - order pick tasks along the warehouse walk path (Phase 6; D-55,
 * T-6.3). PURE. Bins carry a zone and a pick sequence (custrecord_wb_zone /
 * custrecord_wb_pick_sequence); a pick list is ordered by zone walk order then pick
 * sequence so the operator walks an efficient route. Deterministic tie-break on bin.
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

    function seqOf(t) {
        var s = Number(t.pickSequence);
        return isFinite(s) ? s : Infinity; // unsequenced bins sort last
    }

    /**
     * tasks: [{ bin, zone?, pickSequence? }]
     * zoneOrder: optional { zoneName: walkIndex } ; zones not listed sort last.
     * Returns a NEW ordered array.
     */
    function orderTasks(tasks, zoneOrder) {
        if (!Array.isArray(tasks)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'tasks must be an array');
        }
        var zo = zoneOrder || {};
        function zoneIndex(z) {
            if (z == null || z === '') { return Infinity; }
            return Object.prototype.hasOwnProperty.call(zo, z) ? Number(zo[z]) : Infinity;
        }
        return tasks.slice().sort(function (a, b) {
            var za = zoneIndex(a.zone);
            var zb = zoneIndex(b.zone);
            if (za !== zb) { return za - zb; }
            var sa = seqOf(a);
            var sb = seqOf(b);
            if (sa !== sb) { return sa - sb; }
            return String(a.bin).localeCompare(String(b.bin));
        });
    }

    return { orderTasks: orderTasks };
});
