/**
 * wms_lib_reconcile - reconciliation checks (Phase 8; T-8.3; invariants #1, #22).
 * PURE. Detects divergence that the system must surface (RECONCILIATION_DRIFT), and
 * the serialised-item consistency rule: bin-state quantity must equal the count of
 * that bin's serial rows (#22).
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

    // Decimal residue tolerance (#20): bin qty is Decimal, so compare with epsilon.
    var EPS = 1e-6;

    /** #22: for a serialised item, bin-state qty must equal its serial-row count. */
    function serialConsistency(binQty, serialRowCount) {
        var q = Number(binQty);
        var c = Number(serialRowCount);
        if (!isFinite(q) || !isFinite(c)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'binQty and serialRowCount must be numbers');
        }
        return { ok: Math.abs(q - c) < EPS, binQty: q, serialRowCount: c };
    }

    /**
     * Stock drift for an (item, location[, lot]) cell: WMS bin total vs NetSuite
     * quantity on hand (invariant #1 - the two are reconciled, never conflated).
     * Returns { ok, drift } where drift = wmsQty - nsOnHand.
     */
    function stockDrift(wmsQty, nsOnHand) {
        var w = Number(wmsQty);
        var n = Number(nsOnHand);
        if (!isFinite(w) || !isFinite(n)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'wmsQty and nsOnHand must be numbers');
        }
        var drift = w - n;
        return { ok: Math.abs(drift) < EPS, drift: drift };
    }

    /**
     * Reconcile a batch of cells. Each cell: { item, location, lot?, wmsQty, nsOnHand,
     * mode?, binQty?, serialRowCount? }. Returns only the cells that diverge, each
     * with a reasonCode the caller raises as an exception (#8).
     */
    function reconcileBatch(cells) {
        if (!Array.isArray(cells)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'cells must be an array');
        }
        var drifts = [];
        cells.forEach(function (cell) {
            var sd = stockDrift(cell.wmsQty, cell.nsOnHand);
            if (!sd.ok) {
                drifts.push({ item: cell.item, location: cell.location, lot: cell.lot, reasonCode: 'RECONCILIATION_DRIFT', drift: sd.drift });
            }
            if (String(cell.mode).toUpperCase() === 'SERIAL' && cell.serialRowCount != null) {
                var sc = serialConsistency(cell.binQty != null ? cell.binQty : cell.wmsQty, cell.serialRowCount);
                if (!sc.ok) {
                    drifts.push({ item: cell.item, location: cell.location, reasonCode: 'SERIAL_COUNT_MISMATCH', binQty: sc.binQty, serialRowCount: sc.serialRowCount });
                }
            }
        });
        return drifts;
    }

    return {
        serialConsistency: serialConsistency,
        stockDrift: stockDrift,
        reconcileBatch: reconcileBatch,
    };
});
