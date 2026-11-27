/**
 * wms_lib_migration - validate migrated bin data (Phase 10; D-17, T-0.4). PURE. The
 * 1-SKU/1-batch invariant and the location-prefixed unique bin name must hold BEFORE
 * go-live; two source bins that collapse to the same prefixed name fail the import
 * (not overwrite), and a mixed bin is a day-1 blocker (not greenfield slotting).
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

    function prefixed(row) {
        return String(row.locationCode) + '-' + String(row.binCode);
    }

    /**
     * rows: [{ sourceBin, locationCode, binCode, item, lot }]
     * Returns { ok, violations:[{ reasonCode, name, ... }] }.
     *   COLLISION  - two different source bins map to the same prefixed name
     *   MIXED_BIN  - one bin holds more than one distinct (item, lot) (1-SKU/1-batch)
     */
    function validateBinImport(rows) {
        if (!Array.isArray(rows)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'rows must be an array');
        }
        var sourcesByName = {};
        var contentByName = {};
        rows.forEach(function (r) {
            var name = prefixed(r);
            (sourcesByName[name] = sourcesByName[name] || {})[String(r.sourceBin)] = 1;
            var sig = String(r.item == null ? '' : r.item) + '|' + String(r.lot == null ? '' : r.lot);
            (contentByName[name] = contentByName[name] || {})[sig] = 1;
        });

        var violations = [];
        Object.keys(sourcesByName).forEach(function (name) {
            if (Object.keys(sourcesByName[name]).length > 1) {
                violations.push({ reasonCode: 'COLLISION', name: name, sources: Object.keys(sourcesByName[name]) });
            }
            // count distinct non-empty contents
            var sigs = Object.keys(contentByName[name]).filter(function (s) { return s !== '|'; });
            if (sigs.length > 1) {
                violations.push({ reasonCode: 'MIXED_BIN', name: name, contents: sigs });
            }
        });
        return { ok: violations.length === 0, violations: violations };
    }

    return { validateBinImport: validateBinImport };
});
