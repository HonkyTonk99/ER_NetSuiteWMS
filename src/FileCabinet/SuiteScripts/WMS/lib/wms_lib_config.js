/**
 * wms_lib_config - config resolution (invariant #9; docs/03 section 3.10). PURE
 * logic, no N/ imports, testable without an account. The record read (N/search or
 * N/cache over customrecord_wms_config) is a thin caller concern; this module
 * resolves a typed value from the rows it is given.
 *
 * Rows shape: [{ key, value, location }]. A per-location row (location set, D-14)
 * overrides the global row (location blank/null) for the same key. Typed getters
 * take an explicit default so a missing key never silently becomes 0/''/false.
 *
 * Error shape (D-23): programmer errors throw a plain Error with an ERR_WMS_* name.
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

    function norm(v) {
        return (v === undefined || v === null) ? '' : String(v);
    }

    /**
     * Raw string value for `key`, preferring the row scoped to `locationId`, else
     * the global (blank-location) row. Returns undefined when the key is absent.
     */
    function select(rows, key, locationId) {
        if (!Array.isArray(rows)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'config rows must be an array');
        }
        if (key === undefined || key === null || key === '') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'config key is required');
        }
        var k = String(key);
        var loc = norm(locationId);
        var global;
        var scoped;
        rows.forEach(function (row) {
            if (!row || String(row.key) !== k) {
                return;
            }
            var rowLoc = norm(row.location);
            if (rowLoc === '') {
                global = row;
            } else if (loc !== '' && rowLoc === loc) {
                scoped = row;
            }
        });
        var chosen = scoped || global;
        return chosen ? norm(chosen.value) : undefined;
    }

    function getString(rows, key, locationId, dflt) {
        var v = select(rows, key, locationId);
        return v === undefined ? dflt : v;
    }

    function getNumber(rows, key, locationId, dflt) {
        var v = select(rows, key, locationId);
        if (v === undefined || v === '') {
            return dflt;
        }
        var n = Number(v);
        if (!isFinite(n)) {
            throw err('ERR_WMS_INVALID_CONFIG_VALUE', 'config ' + key + ' is not a number: ' + v);
        }
        return n;
    }

    var TRUE = { t: 1, 'true': 1, '1': 1, y: 1, yes: 1 };
    var FALSE = { f: 1, 'false': 1, '0': 1, n: 1, no: 1, '': 1 };

    function getBoolean(rows, key, locationId, dflt) {
        var v = select(rows, key, locationId);
        if (v === undefined) {
            return dflt;
        }
        var s = String(v).trim().toLowerCase();
        if (TRUE[s]) {
            return true;
        }
        if (FALSE[s]) {
            return false;
        }
        throw err('ERR_WMS_INVALID_CONFIG_VALUE', 'config ' + key + ' is not a boolean: ' + v);
    }

    return {
        select: select,
        getString: getString,
        getNumber: getNumber,
        getBoolean: getBoolean,
    };
});
