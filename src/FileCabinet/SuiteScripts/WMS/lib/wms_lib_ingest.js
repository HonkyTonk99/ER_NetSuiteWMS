/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * wms_lib_ingest - PURE ingestion helpers for the vertical slice (docs/09):
 * batch parsing, scan-event validation, and platform-error classification
 * (idempotency). No `N/` module - unit-tested without a NetSuite account. The
 * Suitelet (wms_sl_scan_ingest.js) stays thin and delegates here.
 *
 * Error shape (D-23): a field/business validation failure is a RETURNED verdict
 * `{ ok:false, reasonCode, field }`; a malformed request body (a programmer/caller
 * error) throws a plain `Error` with an ERR_WMS_* `name`.
 *
 * Idempotency (AD-04 / PF-13): a duplicate `externalid` fails the platform create
 * with `UNIQUE_RCRD_ID_REQD` - classified here as idempotent-success, NOT
 * `DUP_CSTM_RCRD_ENTRY` (a different, name-uniqueness error).
 */
define([], function () {
    'use strict';

    // Required fields for a slice receipt scan event (docs/09 minimal record).
    var REQUIRED_FIELDS = ['uuid', 'eventType', 'sourceDocument', 'item', 'quantity', 'bin', 'location'];

    // Platform error names that are safe to retry (transient), vs terminal.
    var RETRYABLE_ERRORS = {
        SSS_REQUEST_LIMIT_EXCEEDED: true,
        EXCEEDED_MAX_CONCUR_RQST: true,
        SSS_CONNECTION_TIME_OUT: true,
        RCRD_HAS_BEEN_CHANGED: true,
    };

    function wmsError(name, message) {
        var err = new Error(message);
        err.name = name;
        return err;
    }

    function isBlank(value) {
        return value === null || value === undefined || value === '';
    }

    /**
     * Parse the POST body into an events array. Throws on a malformed body.
     * Accepts `{ events: [...] }` or a bare array.
     * @param {*} body already-JSON-parsed request body
     * @returns {Object[]}
     */
    function parseBatch(body) {
        if (body === null || typeof body !== 'object') {
            throw wmsError('ERR_WMS_BAD_REQUEST', 'request body must be a JSON object or array');
        }
        var events = Array.isArray(body) ? body : body.events;
        if (!Array.isArray(events)) {
            throw wmsError('ERR_WMS_BAD_REQUEST', 'request must carry an events array');
        }
        return events;
    }

    /**
     * Validate one scan event. Returns a verdict; never throws for a business fault.
     * @param {Object} event
     * @returns {{ok: boolean, reasonCode?: string, field?: string}}
     */
    function validateScanEvent(event) {
        if (event === null || typeof event !== 'object') {
            return { ok: false, reasonCode: 'WMS_BAD_EVENT', field: null };
        }
        for (var i = 0; i < REQUIRED_FIELDS.length; i += 1) {
            var field = REQUIRED_FIELDS[i];
            if (isBlank(event[field])) {
                return { ok: false, reasonCode: 'WMS_MISSING_FIELD', field: field };
            }
        }
        if (typeof event.quantity !== 'number' || !(event.quantity > 0)) {
            return { ok: false, reasonCode: 'WMS_INVALID_QUANTITY', field: 'quantity' };
        }
        return { ok: true };
    }

    /**
     * Classify a caught platform error name for the ingest write path (AD-04).
     * @param {string} errorName the caught error's `name`
     * @returns {{idempotent: boolean, retryable: boolean}}
     */
    function classifyIngestError(errorName) {
        if (errorName === 'UNIQUE_RCRD_ID_REQD') {
            // Duplicate externalid -> the event already exists; a safe retry (PF-13).
            return { idempotent: true, retryable: false };
        }
        return { idempotent: false, retryable: RETRYABLE_ERRORS[errorName] === true };
    }

    return {
        REQUIRED_FIELDS: REQUIRED_FIELDS,
        parseBatch: parseBatch,
        validateScanEvent: validateScanEvent,
        classifyIngestError: classifyIngestError,
    };
});
