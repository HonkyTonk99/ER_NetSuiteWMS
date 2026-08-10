/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * wms_lib_bin_policy — policy-driven bin validation (T-2.3b).
 *
 * Pure logic, carved out of the T-0.3 gate by D-23. It imports NO `N/` module
 * (CI-enforced by scripts/guard-carveout-imports.js). The caller — the held
 * ingestion Suitelet (T-3.1) / committer — resolves the bin's policy row
 * (customrecord_wms_bin_policy, §3.9b) and the bin-state projection
 * (customrecord_wms_bin_state, §3.2b) from cache and passes them in here; this
 * module reads no cache and posts nothing.
 *
 * Error shape (D-23):
 *   - A bin rejection is a NORMAL outcome, not an exception. `check` RETURNS a
 *     structured verdict { allowed, reasonCode, ... }; it does not throw for it.
 *   - A programmer error (missing/malformed argument) throws a plain `Error`
 *     with `err.name` set to an ERR_WMS_* value — the same shape N/error.create
 *     produces, so there is no translation layer at the boundary.
 *
 * Invariants enforced here:
 *   #2  bin rules come from the POLICY, never a hardcoded bin-type check.
 *   #20 a bin is EMPTY when its item is cleared — never a float compare on qty;
 *       a negative-qty bin with an item still set is OCCUPIED AND ANOMALOUS and
 *       accepts only the SKU and lot already recorded against it.
 */
define([], function () {
    'use strict';

    /**
     * Build a programmer-error Error whose `name` matches the N/error shape.
     * @param {string} message
     * @returns {Error}
     */
    function invalidArgument(message) {
        var err = new Error(message);
        err.name = 'ERR_WMS_INVALID_ARGUMENT';
        return err;
    }

    /**
     * Emptiness test — invariant #20. A bin is empty iff its item is cleared.
     * NEVER a `qty === 0` comparison: qty is a Decimal and UOM conversion can
     * leave fractional residue, and a negative-qty bin is occupied, not empty.
     * @param {{item: *}} state
     * @returns {boolean}
     */
    function isEmpty(state) {
        var item = state.item;
        return item === null || item === undefined || item === '';
    }

    /**
     * Evaluate whether `proposedItem` / `proposedLot` may be placed in a bin
     * whose policy and current state are given. Pure; mutates nothing.
     *
     * @param {Object} policy       - { singleSku, singleBatch, ... } (§3.9b booleans)
     * @param {Object} currentState - { item, lot, qty, blocked } (bin-state projection)
     * @param {*}      proposedItem - SKU being placed
     * @param {*}      [proposedLot]- batch being placed (undefined for PLAIN items)
     * @returns {{allowed: boolean, reasonCode?: string, conflictItem?: *, conflictLot?: *}}
     */
    function check(policy, currentState, proposedItem, proposedLot) {
        if (policy === null || typeof policy !== 'object') {
            throw invalidArgument('check requires a policy object');
        }
        if (currentState === null || typeof currentState !== 'object') {
            throw invalidArgument('check requires a currentState object');
        }
        if (proposedItem === null || proposedItem === undefined || proposedItem === '') {
            throw invalidArgument('check requires a proposedItem');
        }

        // A blocked bin refuses everything, whatever it holds.
        if (currentState.blocked === true) {
            return { allowed: false, reasonCode: 'WMS_BIN_BLOCKED' };
        }

        // Empty bin (item cleared, invariant #20) always passes.
        if (isEmpty(currentState)) {
            return { allowed: true };
        }

        // Occupied. A negative-qty bin is OCCUPIED AND ANOMALOUS (invariant #20):
        // it accepts ONLY the exact SKU and lot already recorded against it, so
        // corrective putaway is possible without a second SKU compounding the fault.
        if (typeof currentState.qty === 'number' && currentState.qty < 0) {
            var sameItem = proposedItem === currentState.item;
            var sameLot = proposedLot === currentState.lot;
            if (sameItem && sameLot) {
                return { allowed: true };
            }
            return {
                allowed: false,
                reasonCode: 'WMS_BIN_NEGATIVE_STATE',
                conflictItem: currentState.item,
                conflictLot: currentState.lot,
            };
        }

        // Normally occupied: apply the bin's POLICY — never a bin-type check
        // (invariant #2). A mixed-SKU bin (singleSku !== true, e.g. STAGE) accepts
        // any SKU; that is the whole point of a staging area (F-18).
        if (policy.singleSku === true && proposedItem !== currentState.item) {
            return {
                allowed: false,
                reasonCode: 'WMS_BIN_CONSTRAINT_VIOLATION',
                conflictItem: currentState.item,
                conflictLot: currentState.lot,
            };
        }
        if (
            policy.singleBatch === true &&
            proposedItem === currentState.item &&
            proposedLot !== currentState.lot
        ) {
            return {
                allowed: false,
                reasonCode: 'WMS_BIN_CONSTRAINT_VIOLATION',
                conflictItem: currentState.item,
                conflictLot: currentState.lot,
            };
        }

        return { allowed: true };
    }

    return {
        check: check,
        isEmpty: isEmpty,
    };
});
