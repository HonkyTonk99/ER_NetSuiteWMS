/**
 * wms_lib_kit - kit / package item handling (Phase 7; D-36). PURE. A kit is picked
 * and shipped as a SET: its components expand into pick tasks, and the kit must not
 * ship half-picked - completeness is all-or-nothing across its components.
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
     * Expand a kit line into component pick tasks.
     * components: [{ item, perKit }] ; kitQty: number of kits on the line.
     * Returns [{ kitId, item, qty }].
     */
    function expandKit(kitId, components, kitQty) {
        if (!Array.isArray(components) || !components.length) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'components must be a non-empty array');
        }
        var q = Number(kitQty);
        if (!isFinite(q) || q <= 0) {
            throw err('ERR_WMS_INVALID_QUANTITY', 'kitQty must be positive');
        }
        return components.map(function (c) {
            var per = Number(c.perKit);
            if (!isFinite(per) || per <= 0) {
                throw err('ERR_WMS_INVALID_QUANTITY', 'component perKit must be positive');
            }
            return { kitId: kitId, item: c.item, qty: per * q };
        });
    }

    /**
     * Is the kit fully picked? required/picked are arrays of { item, qty }. The kit
     * is complete only when every component's picked qty >= its required qty (D-36 -
     * a kit cannot ship half-picked). Returns { complete, missing:[{item, shortBy}] }.
     */
    function completeness(required, picked) {
        if (!Array.isArray(required)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'required must be an array');
        }
        var pickedBy = {};
        (picked || []).forEach(function (p) {
            pickedBy[String(p.item)] = (pickedBy[String(p.item)] || 0) + Number(p.qty || 0);
        });
        var missing = [];
        required.forEach(function (r) {
            var have = pickedBy[String(r.item)] || 0;
            if (have < Number(r.qty)) {
                missing.push({ item: r.item, shortBy: Number(r.qty) - have });
            }
        });
        return { complete: missing.length === 0, missing: missing };
    }

    return {
        expandKit: expandKit,
        completeness: completeness,
    };
});
