/**
 * wms_lib_uom - UOM conversion (D-46; docs/03 Q-07). PURE logic, no N/ imports,
 * so it is unit-testable without an account. The N/ side (reading an item's units
 * table from the cache) is a thin caller concern; this module converts given the
 * units table as data.
 *
 * Units table shape: { baseUom: <id>, ratios: { <uomId>: <units of base per 1 of
 * this uom> } }. The base UOM has ratio 1. A quantity is converted to base, then
 * to the target. Quantities stay Decimal (invariant #20) - no forced rounding.
 *
 * Error shape (D-23): data/programmer errors throw a plain Error whose .name is a
 * machine-readable ERR_WMS_* the caller can branch on.
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

    function ratioFor(units, uom) {
        if (!units || typeof units !== 'object' || !units.ratios || typeof units.ratios !== 'object') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'units table must be { baseUom, ratios:{} }');
        }
        if (uom === undefined || uom === null || uom === '') {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'uom is required');
        }
        var key = String(uom);
        if (!Object.prototype.hasOwnProperty.call(units.ratios, key)) {
            throw err('ERR_WMS_UNKNOWN_UOM', 'uom ' + key + ' is not in the item units table');
        }
        var r = Number(units.ratios[key]);
        if (!isFinite(r) || r <= 0) {
            throw err('ERR_WMS_INVALID_UOM_RATIO', 'uom ' + key + ' has a non-positive ratio');
        }
        return r;
    }

    function assertQty(qty) {
        var q = Number(qty);
        if (!isFinite(q) || q <= 0) {
            throw err('ERR_WMS_INVALID_QUANTITY', 'quantity must be a positive finite number');
        }
        return q;
    }

    /** Quantity in `uom` expressed in the item's base UOM. */
    function toBase(qty, uom, units) {
        return assertQty(qty) * ratioFor(units, uom);
    }

    /** Quantity in base UOM expressed in `uom`. */
    function fromBase(baseQty, uom, units) {
        return assertQty(baseQty) / ratioFor(units, uom);
    }

    /**
     * Convert `qty` from `fromUom` to `toUom`. Same-uom is a validated pass-through
     * (still checks the uom exists and the qty is positive).
     */
    function convert(qty, fromUom, toUom, units) {
        var q = assertQty(qty);
        var fromR = ratioFor(units, fromUom);
        var toR = ratioFor(units, toUom);
        if (String(fromUom) === String(toUom)) {
            return q;
        }
        return (q * fromR) / toR;
    }

    /** True when `qty` in `uom` is a whole number of base units (no partial base unit). */
    function isWholeInBase(qty, uom, units) {
        var base = toBase(qty, uom, units);
        return Math.abs(base - Math.round(base)) < 1e-9;
    }

    return {
        toBase: toBase,
        fromBase: fromBase,
        convert: convert,
        isWholeInBase: isWholeInBase,
    };
});
