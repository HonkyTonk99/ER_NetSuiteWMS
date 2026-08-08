/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * wms_lib_example — SCAFFOLD ONLY (T-0.5).
 *
 * This module exists solely to prove the test harness works: a SuiteScript 2.1
 * AMD module whose pure logic is unit-testable with no NetSuite account, and
 * whose `N/` imports resolve to stubs under jest (see test/stubs/N).
 *
 * It contains NO domain logic on purpose. Clustering, aggregation, allocation,
 * bin policy etc. belong to their own tasks (see tasks/phase-0-2-foundation.md,
 * T-2.1 onward) and must not be pre-built here. Replace or delete this file when
 * the first real lib_ module lands in Phase 2.
 */
define(['N/error'], function (error) {
    /**
     * Pure function — representative of the kind of logic Phase 2 lib_ modules
     * will hold and unit-test without a NetSuite account. Sums a list of numbers.
     *
     * Uses N/error on the failure path so the harness demonstrably resolves the
     * stubbed module, and follows the CLAUDE.md ERR_WMS_* error convention.
     *
     * @param {number[]} values
     * @returns {number}
     */
    function sum(values) {
        if (!Array.isArray(values)) {
            throw error.create({
                name: 'ERR_WMS_INVALID_ARGUMENT',
                message: 'sum expects an array of numbers',
            });
        }
        return values.reduce(function (total, n) {
            return total + n;
        }, 0);
    }

    return {
        sum: sum,
    };
});
