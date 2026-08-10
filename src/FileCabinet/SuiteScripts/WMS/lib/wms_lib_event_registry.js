/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * wms_lib_event_registry - declarative event handler registry (T-2.6, AD-15).
 *
 * Pure logic, carved out of the T-0.3 gate by D-23. Imports NO `N/` module
 * (CI-enforced). The registry mechanism and the central group-key serialisation
 * are the carve-out; each handler's `commit` is a STUB here (its NetSuite body
 * lives in the held committer, T-4.x) so no `N/` module is needed.
 *
 * Why this exists (F-12/F-13/F-15/F-16/F-17): adding an event type must be a
 * REGISTRATION, not an edit to a switch statement in four scripts. The held
 * Suitelet / mapper / reducer dispatch by registry lookup and contain no
 * per-event-type conditional.
 *
 * Two structural rules baked in:
 *   - Invariant #5: a handler's `groupKey` returns an OBJECT; keys are serialised
 *     CENTRALLY here, never by string concatenation. Enum values contain
 *     underscores (REPLEN_MOVE, BIN_TRANSFER), which a `parts.join('_')` scheme
 *     cannot round-trip (F-12) - JSON of a canonically-ordered object can.
 *   - Error shape (D-23): a field/business validation failure is a RETURNED
 *     verdict ({ ok:false, reasonCode, field }); a programmer error (a malformed
 *     handler, an unknown type) throws a plain `Error` with an ERR_WMS_* `name`.
 *
 * Invariant #9: `governanceEst` is handler-declared COST metadata, not a tuning
 * knob; the live budget (`remainingUsage`) is injected by the caller, never a
 * literal here.
 */
define([], function () {
    'use strict';

    function wmsError(name, message) {
        var err = new Error(message);
        err.name = name;
        return err;
    }

    /**
     * A commit stub shared by every default handler. The real commit body posts
     * to the NetSuite ledger and therefore needs `N/` modules - it is OUT of the
     * D-23 carve-out. Calling it at this layer is a programmer error.
     */
    function commitNotImplemented() {
        throw wmsError(
            'ERR_WMS_COMMIT_NOT_IMPLEMENTED',
            'commit body is out of the D-23 carve-out; it lives in the held committer (T-4.x)'
        );
    }

    /**
     * Create an isolated registry instance. Isolation (vs a module-level
     * singleton) keeps tests independent and free of registration-order effects.
     */
    function createRegistry() {
        var handlers = Object.create(null);

        function register(eventType, handler) {
            if (typeof eventType !== 'string' || eventType === '') {
                throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'eventType must be a non-empty string');
            }
            if (handler === null || typeof handler !== 'object') {
                throw wmsError('ERR_WMS_INVALID_HANDLER', 'handler must be an object for ' + eventType);
            }
            if (!Array.isArray(handler.requiredFields)) {
                throw wmsError('ERR_WMS_INVALID_HANDLER', 'handler.requiredFields must be an array for ' + eventType);
            }
            if (typeof handler.validate !== 'function') {
                throw wmsError('ERR_WMS_INVALID_HANDLER', 'handler.validate must be a function for ' + eventType);
            }
            if (typeof handler.groupKey !== 'function') {
                throw wmsError('ERR_WMS_INVALID_HANDLER', 'handler.groupKey must be a function for ' + eventType);
            }
            if (typeof handler.commit !== 'function') {
                throw wmsError('ERR_WMS_INVALID_HANDLER', 'handler.commit must be a function for ' + eventType);
            }
            if (typeof handler.governanceEst !== 'number') {
                throw wmsError('ERR_WMS_INVALID_HANDLER', 'handler.governanceEst must be a number for ' + eventType);
            }
            handlers[eventType] = handler;
            return handler;
        }

        function hasHandler(eventType) {
            return Object.prototype.hasOwnProperty.call(handlers, eventType);
        }

        function getHandler(eventType) {
            if (!hasHandler(eventType)) {
                throw wmsError('ERR_WMS_UNKNOWN_EVENT_TYPE', 'no handler registered for event type: ' + eventType);
            }
            return handlers[eventType];
        }

        function registeredTypes() {
            return Object.keys(handlers).sort();
        }

        /**
         * Validate an event: required fields FIRST (F-13 - rejected before any
         * record I/O, with a field-level message), then the handler's own
         * business validation. Both are returned verdicts, never thrown.
         * @returns {{ok: boolean, reasonCode?: string, field?: string}}
         */
        function validateEvent(eventType, event, ctx) {
            var handler = getHandler(eventType);
            if (event === null || typeof event !== 'object') {
                throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'event must be an object');
            }
            for (var i = 0; i < handler.requiredFields.length; i += 1) {
                var field = handler.requiredFields[i];
                var value = event[field];
                if (value === null || value === undefined || value === '') {
                    return { ok: false, reasonCode: 'WMS_MISSING_FIELD', field: field };
                }
            }
            return handler.validate(event, ctx || {});
        }

        function groupKeyFor(eventType, event) {
            return getHandler(eventType).groupKey(event);
        }

        function serializedGroupKeyFor(eventType, event) {
            return serializeGroupKey(groupKeyFor(eventType, event));
        }

        /**
         * Governance gate (F-17): the DECISION a reducer uses to yield BEFORE
         * attempting work whose estimate exceeds remaining usage. The actual
         * yield is the held reducer's job (it needs N/runtime); this is the pure,
         * testable predicate.
         */
        function shouldYield(eventType, remainingUsage) {
            var handler = getHandler(eventType);
            if (typeof remainingUsage !== 'number') {
                throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'remainingUsage must be a number');
            }
            return handler.governanceEst > remainingUsage;
        }

        return {
            register: register,
            hasHandler: hasHandler,
            getHandler: getHandler,
            registeredTypes: registeredTypes,
            validateEvent: validateEvent,
            groupKeyFor: groupKeyFor,
            serializedGroupKeyFor: serializedGroupKeyFor,
            shouldYield: shouldYield,
        };
    }

    /**
     * Central group-key serialisation (invariant #5). Canonicalise key order so
     * the string is deterministic and reversible; JSON avoids the delimiter
     * collision that string concatenation suffers when enum values contain
     * underscores (F-12).
     * @param {Object} keyObject
     * @returns {string}
     */
    function serializeGroupKey(keyObject) {
        if (keyObject === null || typeof keyObject !== 'object' || Array.isArray(keyObject)) {
            throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'group key must be a plain object');
        }
        var canonical = {};
        Object.keys(keyObject).sort().forEach(function (k) {
            canonical[k] = keyObject[k];
        });
        return JSON.stringify(canonical);
    }

    /**
     * @param {string} serialized
     * @returns {Object}
     */
    function parseGroupKey(serialized) {
        if (typeof serialized !== 'string') {
            throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'serialized group key must be a string');
        }
        return JSON.parse(serialized);
    }

    // --- Default handlers ---------------------------------------------------
    //
    // The nine canonical event types (T-1.2) plus the three D-09 inbound
    // receipts. `requiredFields` and `groupKey` are the pure, testable contract;
    // `commit` is a stub (see commitNotImplemented). `governanceEst` is nominal
    // cost metadata, refined against T-12.1's measured units before go-live.

    function requirePositiveQty(event) {
        if (typeof event.qty !== 'number' || !(event.qty > 0)) {
            return { ok: false, reasonCode: 'WMS_INVALID_QUANTITY', field: 'qty' };
        }
        return { ok: true };
    }

    function alwaysValid() {
        return { ok: true };
    }

    var DEFAULT_HANDLERS = {
        // Outbound / floor movement
        PICK: {
            requiredFields: ['waveId', 'orderId', 'orderLineKey', 'sourceBinId', 'skuCode', 'qty', 'locationId'],
            validate: requirePositiveQty,
            // aggregate all events for a SO line before touching the record (AD-07)
            groupKey: function (e) { return { eventType: 'PICK', orderId: e.orderId, orderLineKey: e.orderLineKey }; },
            commit: commitNotImplemented,
            governanceEst: 10,
        },
        PACK: {
            requiredFields: ['waveId', 'orderId', 'locationId'],
            validate: alwaysValid,
            groupKey: function (e) { return { eventType: 'PACK', orderId: e.orderId }; },
            commit: commitNotImplemented,
            governanceEst: 10,
        },
        REPLEN_MOVE: {
            requiredFields: ['sourceBinId', 'targetBinId', 'skuCode', 'qty', 'locationId'],
            validate: requirePositiveQty,
            groupKey: function (e) { return { eventType: 'REPLEN_MOVE', targetBinId: e.targetBinId, skuCode: e.skuCode }; },
            commit: commitNotImplemented,
            governanceEst: 5,
        },
        BIN_TRANSFER: {
            requiredFields: ['sourceBinId', 'targetBinId', 'skuCode', 'qty', 'locationId'],
            validate: requirePositiveQty,
            groupKey: function (e) { return { eventType: 'BIN_TRANSFER', sourceBinId: e.sourceBinId, targetBinId: e.targetBinId }; },
            commit: commitNotImplemented,
            governanceEst: 5,
        },
        PUTAWAY: {
            requiredFields: ['targetBinId', 'skuCode', 'qty', 'locationId'],
            validate: requirePositiveQty,
            groupKey: function (e) { return { eventType: 'PUTAWAY', targetBinId: e.targetBinId, skuCode: e.skuCode }; },
            commit: commitNotImplemented,
            governanceEst: 5,
        },
        COUNT: {
            requiredFields: ['sourceBinId', 'skuCode', 'qty', 'locationId'],
            validate: alwaysValid, // COUNT spec is deferred (Q-05); a count of 0 is legitimate
            groupKey: function (e) { return { eventType: 'COUNT', sourceBinId: e.sourceBinId }; },
            commit: commitNotImplemented,
            governanceEst: 5,
        },
        // Telemetry (scan-accuracy metric, T-1.2) - no ledger posting
        SHORT_PICK: {
            requiredFields: ['waveId', 'orderId', 'orderLineKey', 'skuCode', 'locationId'],
            validate: alwaysValid,
            groupKey: function (e) { return { eventType: 'SHORT_PICK', orderId: e.orderId, orderLineKey: e.orderLineKey }; },
            commit: commitNotImplemented,
            governanceEst: 2,
        },
        OVERRIDE: {
            requiredFields: ['operatorId', 'locationId'],
            validate: alwaysValid,
            groupKey: function (e) { return { eventType: 'OVERRIDE', uuid: e.uuid }; },
            commit: commitNotImplemented,
            governanceEst: 2,
        },
        EXCEPTION: {
            requiredFields: ['locationId'],
            validate: alwaysValid,
            groupKey: function (e) { return { eventType: 'EXCEPTION', uuid: e.uuid }; },
            commit: commitNotImplemented,
            governanceEst: 2,
        },
        // Inbound receipts (D-09)
        RECEIPT_PO: {
            requiredFields: ['orderId', 'orderLineKey', 'skuCode', 'qty', 'locationId'],
            validate: requirePositiveQty,
            groupKey: function (e) { return { eventType: 'RECEIPT_PO', orderId: e.orderId, orderLineKey: e.orderLineKey }; },
            commit: commitNotImplemented,
            governanceEst: 10,
        },
        RECEIPT_TO: {
            requiredFields: ['orderId', 'orderLineKey', 'skuCode', 'qty', 'locationId'],
            validate: requirePositiveQty,
            groupKey: function (e) { return { eventType: 'RECEIPT_TO', orderId: e.orderId, orderLineKey: e.orderLineKey }; },
            commit: commitNotImplemented,
            governanceEst: 10,
        },
        RECEIPT_WO: {
            requiredFields: ['orderId', 'skuCode', 'qty', 'locationId'],
            validate: requirePositiveQty,
            groupKey: function (e) { return { eventType: 'RECEIPT_WO', orderId: e.orderId }; },
            commit: commitNotImplemented,
            governanceEst: 10,
        },
    };

    /**
     * A fresh registry pre-loaded with the default handlers.
     * @returns {Object} registry instance
     */
    function defaults() {
        var registry = createRegistry();
        Object.keys(DEFAULT_HANDLERS).forEach(function (eventType) {
            registry.register(eventType, DEFAULT_HANDLERS[eventType]);
        });
        return registry;
    }

    return {
        createRegistry: createRegistry,
        defaults: defaults,
        serializeGroupKey: serializeGroupKey,
        parseGroupKey: parseGroupKey,
        DEFAULT_HANDLERS: DEFAULT_HANDLERS,
    };
});
