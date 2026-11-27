/**
 * wms_lib_wo_flow - Work Order component flow + receiving tolerance (Phase 5B;
 * D-35, D-43, D-44, D-45; Q-27). PURE.
 *
 * The WO component flow is two steps (D-43): "pick for a work order" = an Inventory
 * Transfer warehouse -> a segregated PRODUCTION location (removes it from warehouse
 * availability, does not consume); "issue to the work order" = a Work Order Issue at
 * build start (consumes into WIP). A WO builds at exactly one PRODUCTION location
 * (D-44). The transfer screen (D-45) exposes on-hand / committed / available /
 * needed and defaults the transfer qty to AVAILABLE, operator-overridable.
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

    function num(v, label) {
        var n = Number(v);
        if (!isFinite(n)) { throw err('ERR_WMS_INVALID_ARGUMENT', label + ' must be a finite number'); }
        return n;
    }

    /**
     * The WO component-transfer screen figures (D-45).
     * input: { onHand, committed, needed }
     * Returns { onHand, committed, available, needed, defaultQty } where
     * available = onHand - committed and defaultQty defaults to available (the
     * operator may override; this is a location move, not gated by #15 - D-45).
     */
    function transferScreen(input) {
        if (!input || typeof input !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'screen input is required');
        }
        var onHand = num(input.onHand, 'onHand');
        var committed = num(input.committed, 'committed');
        var needed = num(input.needed, 'needed');
        var available = onHand - committed;
        if (available < 0) { available = 0; }
        return {
            onHand: onHand,
            committed: committed,
            available: available,
            needed: needed,
            defaultQty: available, // D-45: default to available, user-overridable
        };
    }

    /**
     * A WO builds at exactly one PRODUCTION location (D-44). Validate the target.
     * target: { locationClass } ; returns true or throws.
     */
    function assertProductionTarget(target) {
        if (!target || String(target.locationClass).toUpperCase() !== 'PRODUCTION') {
            throw err('ERR_WMS_WO_TARGET_NOT_PRODUCTION', 'a work order issues/builds at a PRODUCTION location (D-43/D-44)');
        }
        return true;
    }

    /**
     * Over-receipt tolerance (Q-27). ordered vs received against a PO/TO line, with a
     * config tolerance percent and a supervisor-override threshold.
     * Returns { ok:true } | { ok:false, reasonCode:'OVER_RECEIPT', overBy, needsApproval }.
     */
    function overReceiptCheck(ordered, received, tolerancePct) {
        var o = num(ordered, 'ordered');
        var r = num(received, 'received');
        var pct = tolerancePct == null ? 0 : num(tolerancePct, 'tolerancePct');
        if (r <= o) { return { ok: true }; }
        var allowed = o * (1 + pct / 100);
        if (r <= allowed) { return { ok: true }; }
        return { ok: false, reasonCode: 'OVER_RECEIPT', overBy: r - o, needsApproval: true };
    }

    return {
        transferScreen: transferScreen,
        assertProductionTarget: assertProductionTarget,
        overReceiptCheck: overReceiptCheck,
    };
});
