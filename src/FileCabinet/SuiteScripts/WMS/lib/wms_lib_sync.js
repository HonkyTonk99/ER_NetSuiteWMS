/**
 * wms_lib_sync - classify the ingest Suitelet's per-event responses into queue
 * dispositions, and reconcile on reconnect (Phase 3; T-3.5; D-56). PURE logic.
 *
 * The ingest endpoint returns HTTP 200 with a per-event status in the body (D-56;
 * a Suitelet cannot set a non-200 status, PF-03). Each body result is one of:
 *   { uuid, status: 'accepted' | 'idempotent' | 'busy' | 'rejected', error? }
 * classifyResponse maps it to 'synced' | 'retry' | 'rejected' for the queue.
 *
 * Error shape (D-23): programmer errors throw ERR_WMS_* on .name.
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

    // Error names that mean "transient - try again" vs "idempotent success".
    var RETRYABLE = { RCRD_HAS_BEEN_CHANGED: 1, EXCEEDED_MAX_CONCUR_RQST: 1, SSS_REQUEST_LIMIT_EXCEEDED: 1 };
    var IDEMPOTENT = { UNIQUE_RCRD_ID_REQD: 1 }; // duplicate externalid = already accepted (#3)

    /** One body result -> 'synced' | 'retry' | 'rejected'. */
    function classifyResponse(result) {
        if (!result || typeof result !== 'object' || !result.uuid) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'result with a uuid is required');
        }
        var status = String(result.status || '').toLowerCase();
        if (status === 'accepted' || status === 'ok' || status === 'posted' || status === 'idempotent') {
            return 'synced';
        }
        if (status === 'busy' || status === 'retry') {
            return 'retry';
        }
        // status 'rejected' or absent: inspect the error name for the real meaning.
        var name = result.error || '';
        if (IDEMPOTENT[name]) { return 'synced'; }
        if (RETRYABLE[name]) { return 'retry'; }
        return 'rejected';
    }

    /** Build the dispositions + reasons maps from an array of body results. */
    function dispositionsFor(results) {
        if (!Array.isArray(results)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'results must be an array');
        }
        var dispositions = {};
        var reasons = {};
        results.forEach(function (r) {
            var d = classifyResponse(r);
            dispositions[r.uuid] = d;
            if (d === 'rejected') {
                reasons[r.uuid] = r.error || r.message || 'rejected';
            }
        });
        return { dispositions: dispositions, reasons: reasons };
    }

    /**
     * Reconnect reconciliation (T-3.5): the device comes back and asks the server
     * the authoritative status of an event it is unsure about. Server state wins.
     */
    function reconcile(serverStatus) {
        switch (String(serverStatus || '').toUpperCase()) {
            case 'POSTED':
            case 'PROCESSING':
            case 'PENDING':
            case 'DEFERRED':
            case 'SUPERSEDED':
                // The server has it (or a dedupe kept the first copy) - stop resending.
                return 'synced';
            case 'FAILED':
                return 'rejected';
            default:
                // Server has never seen it -> safe to resend.
                return 'retry';
        }
    }

    return {
        classifyResponse: classifyResponse,
        dispositionsFor: dispositionsFor,
        reconcile: reconcile,
    };
});
