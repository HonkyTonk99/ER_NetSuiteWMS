/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * wms_mr_committer - the async ledger committer (vertical slice, docs/09; T-4.x in
 * full). Triggered on demand by the Suitelet (task.MapReduceScriptTask, no
 * deploymentId, PF-08); a scheduled deployment sweeps as a fallback (AD-20).
 *
 * THIN INVOCATION (PF-09): getInputData emits one unit of work per PENDING event;
 * `map` handles exactly ONE event and never loops a batch; `reduce` groups by
 * source document and posts one receipt. Stage limits are respected by never
 * doing bounded-N work inside a single invocation.
 *
 * Slice scope: PO -> Item Receipt (Day 3). Tracking mode is resolved per item from
 * the record subtype (wms_lib_item_mode, PF-14a) - PLAIN/LOT/SERIAL, no hard-coded
 * assumption. The ledger adapter is mode-aware, so LOT/SERIAL (Days 6/7) add data,
 * not new control flow here.
 */
define([
    'N/search',
    'N/record',
    'N/runtime',
    'N/log',
    './lib/wms_lib_ledger_adapter',
    './lib/wms_lib_item_mode',
], function (search, record, runtime, log, ledger, itemMode) {
    'use strict';

    var EVENT_RECORD = 'customrecord_wms_scan_event';

    function getInputData() {
        return search.create({
            type: EVENT_RECORD,
            filters: [['custrecord_se_status', 'is', 'PENDING']],
            columns: ['custrecord_se_source_doc', 'custrecord_se_sku', 'custrecord_se_qty', 'externalid'],
        });
    }

    // One event per invocation (thin, PF-09). Group by source document for reduce.
    function map(context) {
        var result = JSON.parse(context.value);
        var values = result.values;
        var sourceDoc = values.custrecord_se_source_doc && values.custrecord_se_source_doc.value
            ? values.custrecord_se_source_doc.value
            : values.custrecord_se_source_doc;
        var item = values.custrecord_se_sku && values.custrecord_se_sku.value
            ? values.custrecord_se_sku.value
            : values.custrecord_se_sku;
        context.write({
            key: String(sourceDoc),
            value: JSON.stringify({
                eventId: result.id,
                item: item,
                quantity: Number(values.custrecord_se_qty),
            }),
        });
    }

    function setStatus(eventId, status, extra) {
        var values = { custrecord_se_status: status };
        if (extra && extra.errorName) { values.custrecord_se_error_name = extra.errorName; }
        if (extra && extra.errorMsg) { values.custrecord_se_error_msg = extra.errorMsg; }
        record.submitFields({ type: EVENT_RECORD, id: eventId, values: values });
    }

    function reduce(context) {
        var events = context.values.map(function (v) { return JSON.parse(v); });
        // Slice: one PO, one line. Post from the first event; the source document is
        // the reduce key. Governance guard before the transform (invariant: check
        // remaining usage before a transform in a loop).
        var first = events[0];
        if (runtime.getCurrentScript().getRemainingUsage() < 100) {
            // Not enough budget this invocation - leave PENDING for the next cycle.
            return;
        }
        try {
            var posted = ledger.postPurchaseOrderReceipt({
                purchaseOrderId: context.key,
                line: { mode: itemMode.resolveItemMode(first.item), item: first.item, quantity: first.quantity },
            });
            events.forEach(function (e) { setStatus(e.eventId, 'POSTED'); });
            log.audit({ title: 'receipt posted', details: 'PO ' + context.key + ' -> IR ' + posted.itemReceiptId });
        } catch (e) {
            events.forEach(function (ev) {
                setStatus(ev.eventId, 'FAILED', { errorName: e.name, errorMsg: e.message });
            });
            log.error({ title: 'receipt failed', details: (e.name || 'ERR') + ': ' + e.message });
        }
    }

    function summarize(summary) {
        var errorCount = 0;
        summary.mapSummary.errors.iterator().each(function () { errorCount += 1; return true; });
        summary.reduceSummary.errors.iterator().each(function () { errorCount += 1; return true; });
        log.audit({ title: 'committer summary', details: 'stage errors: ' + errorCount });
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize,
    };
});
