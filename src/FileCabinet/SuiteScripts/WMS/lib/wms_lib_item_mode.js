/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * wms_lib_item_mode - resolve an item's tracking mode (PLAIN / LOT / SERIAL) from
 * its NetSuite record subtype (PF-14 / PF-14a). Replaces the slice's hard-coded
 * resolveMode() in the committer.
 *
 * PF-14a (CONFIRMED, docs/08): `search.lookupFields({ type: search.Type.ITEM, id,
 * columns: ['recordtype'] })` returns the specific subtype string - one of the six
 * record types - at 1 governance unit. The coarse `type`/`itemtype` column
 * (`InvtPart`, `Assembly`) CANNOT distinguish tracking mode; `record.load` is a
 * documented anti-pattern for a field read; SuiteQL costs 10 units vs lookupFields' 1.
 *
 * The pure switch (modeForRecordType) is separated from the lookup wrapper
 * (resolveItemMode) so the mapping is unit-testable without a NetSuite account.
 *
 * Two deliberate rules (they differ from a supplied reference sample that was wrong):
 *   - serialised maps to SERIAL (the schema's PLAIN/LOT/SERIAL) - never a value like
 *     "plain_serialized" that matches nothing and would route serial down the plain path.
 *   - an unrecognised record type THROWS `ERR_WMS_UNKNOWN_ITEM_TYPE` (carrying the item
 *     id and the observed type). It never defaults to PLAIN: defaulting posts unlabelled
 *     stock to the ledger with nothing in the exception queue - silent corruption, worse
 *     than a stopped line.
 */
define(['N/search', 'N/cache'], function (search, cache) {
    'use strict';

    var MODE_BY_RECORDTYPE = {
        inventoryitem: 'PLAIN',
        assemblyitem: 'PLAIN',
        lotnumberedinventoryitem: 'LOT',
        lotnumberedassemblyitem: 'LOT',
        serializedinventoryitem: 'SERIAL',
        serializedassemblyitem: 'SERIAL',
    };

    var CACHE_NAME = 'wms_item_mode';
    // The N/cache TTL FLOOR (PF-15) - a platform constant, not a business tuning value:
    // tracking mode is stable per item, so the minimum permitted TTL suffices.
    var MODE_CACHE_TTL_SECONDS = 300;

    function wmsError(name, message) {
        var err = new Error(message);
        err.name = name;
        return err;
    }

    /**
     * PURE: map a NetSuite item record subtype to a tracking mode.
     * @param {string} recordType e.g. 'serializedinventoryitem'
     * @param {string|number} itemId  for the error message only
     * @returns {'PLAIN'|'LOT'|'SERIAL'}
     * @throws {Error} ERR_WMS_UNKNOWN_ITEM_TYPE - never defaults
     */
    function modeForRecordType(recordType, itemId) {
        var mode = MODE_BY_RECORDTYPE[recordType];
        if (!mode) {
            throw wmsError(
                'ERR_WMS_UNKNOWN_ITEM_TYPE',
                'item ' + itemId + ' has unrecognised record type "' + recordType + '"'
            );
        }
        return mode;
    }

    /**
     * Resolve an item's tracking mode, cached (PF-15: loader, TTL floor, tolerates a
     * cold miss on any call). Thin wrapper around the pure switch.
     * @param {string|number} itemId item internal id
     * @returns {'PLAIN'|'LOT'|'SERIAL'}
     */
    function resolveItemMode(itemId) {
        if (itemId === null || itemId === undefined || itemId === '') {
            throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'itemId is required');
        }
        var itemCache = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PROTECTED });
        return itemCache.get({
            key: String(itemId),
            ttl: MODE_CACHE_TTL_SECONDS,
            loader: function () {
                var looked = search.lookupFields({
                    type: search.Type.ITEM,
                    id: itemId,
                    columns: ['recordtype'],
                });
                return modeForRecordType(looked.recordtype, itemId);
            },
        });
    }

    return {
        MODE_BY_RECORDTYPE: MODE_BY_RECORDTYPE,
        modeForRecordType: modeForRecordType,
        resolveItemMode: resolveItemMode,
    };
});
