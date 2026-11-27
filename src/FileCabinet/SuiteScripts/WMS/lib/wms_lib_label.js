/**
 * wms_lib_label - the label/document engine's pure core (Phase 7; D-38, Q-06). PURE.
 * A label is a configured template, not code: elements carry {{placeholders}} that
 * resolve from scan/receipt data, and a print rule decides on-demand vs automatic
 * (e.g. print on receipt). Rendering + rule evaluation are pure; the actual print
 * (PDF / network / thermal) is a thin device concern (Phase 14).
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

    var PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

    function resolve(str, data) {
        return String(str).replace(PLACEHOLDER, function (m, key) {
            var v = data ? data[key] : undefined;
            return (v === undefined || v === null) ? '' : String(v);
        });
    }

    /**
     * Render a template against data.
     * template: { name, elements:[{ type:'text'|'barcode'|'image', value }] }
     * Returns { name, elements:[{ type, value(resolved) }] }.
     */
    function render(template, data) {
        if (!template || !Array.isArray(template.elements)) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'template with elements[] is required');
        }
        return {
            name: template.name,
            elements: template.elements.map(function (el) {
                return { type: el.type, value: resolve(el.value, data) };
            }),
        };
    }

    /**
     * Should this template auto-print for an event? rule: { onEvent, filter? }.
     * Returns true when the event type matches (and any simple field filter matches).
     */
    function shouldAutoPrint(rule, event) {
        if (!rule || !rule.onEvent) { return false; }
        if (!event || String(event.eventType) !== String(rule.onEvent)) { return false; }
        if (rule.filter) {
            return Object.keys(rule.filter).every(function (k) {
                return String(event[k]) === String(rule.filter[k]);
            });
        }
        return true;
    }

    return {
        render: render,
        shouldAutoPrint: shouldAutoPrint,
    };
});
