/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * wms_lib_ledger_adapter - the NetSuite boundary for the vertical slice (docs/09).
 * Full form is T-2.7/AD-16; this is the receipt path only: transform a Purchase
 * Order into an Item Receipt and populate `inventorydetail` in STANDARD mode
 * (PF-16). Line-shape decisions are delegated to the pure, unit-tested
 * wms_lib_inventory_detail (PLAIN/LOT/SERIAL, PF-16/PF-17).
 *
 * Standard mode works, including on a transformed record - dynamic mode is not
 * required (PF-16). No bin fields ever touch the ledger (invariant #13).
 *
 * Each line carries its OWN tracking mode (invariant #14 - mixed-mode orders are
 * normal); the adapter shapes every line by its own mode, never a group default.
 */
define(['N/record', './wms_lib_inventory_detail'], function (record, detail) {
    'use strict';

    function wmsError(name, message) {
        var err = new Error(message);
        err.name = name;
        return err;
    }

    function applyDetail(receipt, lineIndex, line) {
        // Inventory detail shaped by the pure module, by THIS line's mode (empty for PLAIN).
        var assignments = detail.buildInventoryAssignments(
            { mode: line.mode, quantity: line.quantity, lot: line.lot, serials: line.serials },
            detail.DIRECTIONS.RECEIPT
        );
        if (assignments.length === 0) { return; }
        var invDetail = receipt.getSublistSubrecord({
            sublistId: 'item',
            fieldId: 'inventorydetail',
            line: lineIndex,
        });
        assignments.forEach(function (assignment, k) {
            invDetail.insertLine({ sublistId: 'inventoryassignment', line: k });
            Object.keys(assignment).forEach(function (fieldId) {
                invDetail.setSublistValue({
                    sublistId: 'inventoryassignment',
                    fieldId: fieldId,
                    line: k,
                    value: assignment[fieldId],
                });
            });
        });
    }

    /**
     * Post one Item Receipt for a PO, receiving one or more lines - each shaped by
     * its OWN tracking mode (invariant #14).
     *
     * @param {Object} params
     * @param {string|number} params.purchaseOrderId  internal id of the PO
     * @param {Object[]} params.lines  each { item, quantity, mode, lot?, serials? }
     * @returns {{itemReceiptId: string}}
     */
    function postPurchaseOrderReceipt(params) {
        if (!params || params.purchaseOrderId === undefined || params.purchaseOrderId === null) {
            throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'purchaseOrderId is required');
        }
        var lines = params.lines;
        if (!Array.isArray(lines) || lines.length === 0) {
            throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'at least one line is required');
        }
        var byItem = {};
        lines.forEach(function (line) { byItem[String(line.item)] = line; });

        // Standard mode; isDynamic not required (PF-16).
        var receipt = record.transform({
            fromType: record.Type.PURCHASE_ORDER,
            fromId: params.purchaseOrderId,
            toType: record.Type.ITEM_RECEIPT,
            isDynamic: false,
        });

        var matched = {};
        var lineCount = receipt.getLineCount({ sublistId: 'item' });
        for (var i = 0; i < lineCount; i += 1) {
            var itemId = String(receipt.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
            var cfg = byItem[itemId];
            if (cfg && !matched[itemId]) {
                matched[itemId] = true;
                receipt.setSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: i, value: true });
                receipt.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i, value: cfg.quantity });
                applyDetail(receipt, i, cfg);
            } else {
                // Unmatched (and duplicate) PO lines are not received (invariant #6).
                receipt.setSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: i, value: false });
            }
        }

        // Every requested line must have found a PO line.
        Object.keys(byItem).forEach(function (itemId) {
            if (!matched[itemId]) {
                throw wmsError('ERR_WMS_PO_LINE_MISMATCH', 'no PO line for item ' + itemId);
            }
        });

        var itemReceiptId = receipt.save();
        return { itemReceiptId: String(itemReceiptId) };
    }

    return {
        postPurchaseOrderReceipt: postPurchaseOrderReceipt,
    };
});
