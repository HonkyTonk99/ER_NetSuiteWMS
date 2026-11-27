/**
 * wms_lib_period - closed-period pre-check (Phase 4; invariant #16; F-23, PF-24/25).
 * PURE. The committer reads `closed` on the accountingperiod for the event's SCAN
 * date and decides BEFORE posting; a scan-time period that is closed raises
 * CLOSED_PERIOD_POSTING rather than failing at the platform.
 *
 * Multi-Book caveat (PF-25): with Extended Accounting Period Close the shared
 * `closed` flag is true only when closed in ALL books, so when Multi-Book is on the
 * pre-check must inspect the target book's own status.
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

    /**
     * periodInfo:
     *   closed (bool)        - the shared accountingperiod.closed flag
     *   multiBook (bool)     - Multi-Book accounting enabled (Q-51)
     *   bookStatuses ([{ book, closed }]) - per-book close state (Multi-Book only)
     *   targetBook           - the book the WMS posts to (Multi-Book only)
     * Returns { ok:true } to post, or { ok:false, reasonCode:'CLOSED_PERIOD_POSTING' }.
     */
    function decide(periodInfo) {
        if (!periodInfo || typeof periodInfo !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'periodInfo is required');
        }
        var closed;
        if (periodInfo.multiBook && Array.isArray(periodInfo.bookStatuses)) {
            var target = periodInfo.targetBook;
            var row = periodInfo.bookStatuses.filter(function (b) {
                return target == null || String(b.book) === String(target);
            });
            // If a target book is named, that book's state governs; otherwise any
            // closed book blocks (fail-safe - do not post into a closed book).
            closed = row.some(function (b) { return !!b.closed; });
        } else {
            closed = !!periodInfo.closed;
        }
        return closed
            ? { ok: false, reasonCode: 'CLOSED_PERIOD_POSTING' }
            : { ok: true };
    }

    return { decide: decide };
});
