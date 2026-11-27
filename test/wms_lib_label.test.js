/**
 * Unit tests for wms_lib_label (Phase 7 / D-38). No account.
 */
const label = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_label.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('render', () => {
    test('resolves placeholders from data; missing become empty', () => {
        const tmpl = {
            name: 'Putaway',
            elements: [
                { type: 'text', value: 'SKU {{sku}} LOT {{lot}}' },
                { type: 'barcode', value: '{{bin}}' },
                { type: 'text', value: 'Exp {{expiry}}' },
            ],
        };
        const out = label.render(tmpl, { sku: 'ABC', lot: 'L1', bin: 'WH1-A-01' });
        expect(out.elements[0].value).toBe('SKU ABC LOT L1');
        expect(out.elements[1].value).toBe('WH1-A-01');
        expect(out.elements[2].value).toBe('Exp '); // missing expiry -> empty
    });
    test('bad template throws', () => {
        expect(grab(() => label.render({}, {})).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('shouldAutoPrint', () => {
    test('matches on event type', () => {
        expect(label.shouldAutoPrint({ onEvent: 'RECEIPT_PO' }, { eventType: 'RECEIPT_PO' })).toBe(true);
        expect(label.shouldAutoPrint({ onEvent: 'RECEIPT_PO' }, { eventType: 'PICK' })).toBe(false);
    });
    test('honours a simple field filter', () => {
        expect(label.shouldAutoPrint({ onEvent: 'RECEIPT_PO', filter: { location: '1' } }, { eventType: 'RECEIPT_PO', location: '1' })).toBe(true);
        expect(label.shouldAutoPrint({ onEvent: 'RECEIPT_PO', filter: { location: '1' } }, { eventType: 'RECEIPT_PO', location: '2' })).toBe(false);
    });
    test('no rule -> no auto print', () => {
        expect(label.shouldAutoPrint(null, { eventType: 'X' })).toBe(false);
    });
});
