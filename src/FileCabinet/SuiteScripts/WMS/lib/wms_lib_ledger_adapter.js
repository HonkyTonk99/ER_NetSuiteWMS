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
 * Slice scope: one PO, one line. Days 6/7 exercise LOT/SERIAL; the shaping is
 * already mode-aware here, so those days add data, not code paths.
 */
define(['N/record', './wms_lib_inventory_detail'], function (record, detail) {
    'use strict';

    function wmsError(name, message) {
        var err = new Error(message);
        err.name = name;
        return err;
    }

    /**
     * Post an Item Receipt for one PO line.
     *
     * @param {Object} params
     * @param {string|number} params.purchaseOrderId  internal id of the PO
     * @param {Object} params.line
     * @param {string} params.line.mode      PLAIN | LOT | SERIAL
     * @param {string|number} params.line.item  item internal id (to match the PO line)
     * @param {number} params.line.quantity
     * @param {string} [params.line.lot]
     * @param {string[]} [params.line.serials]
     * @returns {{itemReceiptId: string}}
     */
    function postPurchaseOrderReceipt(params) {
        if (!params || params.purchaseOrderId === undefined || params.purchaseOrderId === null) {
            throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'purchaseOrderId is required');
        }
        var line = params.line;
        if (!line || typeof line !== 'object') {
            throw wmsError('ERR_WMS_INVALID_ARGUMENT', 'line is required');
        }

        // Standard mode; isDynamic not required (PF-16).
        var receipt = record.transform({
            fromType: record.Type.PURCHASE_ORDER,
            fromId: params.purchaseOrderId,
            toType: record.Type.ITEM_RECEIPT,
            isDynamic: false,
        });

        // Match the PO line by item; unmatched lines are not received (AD-07 spirit).
        var lineCount = receipt.getLineCount({ sublistId: 'item' });
        var targetIndex = -1;
        for (var i = 0; i < lineCount; i += 1) {
            var itemId = receipt.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
            if (String(itemId) === String(line.item)) {
                targetIndex = i;
                break;
            }
        }
        if (targetIndex === -1) {
            throw wmsError('ERR_WMS_PO_LINE_MISMATCH', 'no PO line for item ' + line.item);
        }

        // Receive only the target line; everything else itemreceive = false (invariant #6).
        for (var j = 0; j < lineCount; j += 1) {
            receipt.setSublistValue({
                sublistId: 'item',
                fieldId: 'itemreceive',
                line: j,
                value: j === targetIndex,
            });
        }
        receipt.setSublistValue({
            sublistId: 'item',
            fieldId: 'quantity',
            line: targetIndex,
            value: line.quantity,
        });

        // Inventory detail, shaped by the pure module (empty for PLAIN).
        var assignments = detail.buildInventoryAssignments(
            {
                mode: line.mode,
                quantity: line.quantity,
                lot: line.lot,
                serials: line.serials,
            },
            detail.DIRECTIONS.RECEIPT
        );
        if (assignments.length > 0) {
            var invDetail = receipt.getSublistSubrecord({
                sublistId: 'item',
                fieldId: 'inventorydetail',
                line: targetIndex,
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

        var itemReceiptId = receipt.save();
        return { itemReceiptId: String(itemReceiptId) };
    }

    return {
        postPurchaseOrderReceipt: postPurchaseOrderReceipt,
    };
});
