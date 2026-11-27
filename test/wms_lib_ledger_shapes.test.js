/**
 * Unit tests for wms_lib_ledger_shapes (Phase 4 / docs/06 section 4). No account.
 */
const shapes = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_ledger_shapes.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('direction', () => {
    test('IN / OUT / MOVE', () => {
        expect(shapes.direction('RECEIPT_PO')).toBe('IN');
        expect(shapes.direction('RECEIPT_WO')).toBe('IN');
        expect(shapes.direction('PICK')).toBe('OUT');
        expect(shapes.direction('WO_ISSUE')).toBe('OUT');
        expect(shapes.direction('WRITE_OFF')).toBe('OUT');
        expect(shapes.direction('PUTAWAY')).toBe('MOVE');
    });
    test('unknown throws', () => {
        expect(grab(() => shapes.direction('NONSENSE')).name).toBe('ERR_WMS_UNKNOWN_EVENT_TYPE');
    });
});

describe('shapeFor - the seven posting shapes', () => {
    test('PO receipt', () => {
        expect(shapes.shapeFor('RECEIPT_PO', {})).toMatchObject({ postsLedger: true, netsuiteTxn: 'itemreceipt', transformFrom: 'purchaseorder', needsInventoryDetail: true });
    });
    test('TO + RMA receipts transform from their own source', () => {
        expect(shapes.shapeFor('RECEIPT_TO', {}).transformFrom).toBe('transferorder');
        expect(shapes.shapeFor('RECEIPT_RMA', {}).transformFrom).toBe('returnauthorization');
    });
    test('WO output type is per-location config (D-47)', () => {
        expect(shapes.shapeFor('RECEIPT_WO', {}).netsuiteTxn).toBe('workordercompletion');
        expect(shapes.shapeFor('RECEIPT_WO', { woOutputType: 'ASSEMBLY_BUILD' }).netsuiteTxn).toBe('assemblybuild');
    });
    test('WO Issue (D-35) posts a workorderissue', () => {
        expect(shapes.shapeFor('WO_ISSUE', {})).toMatchObject({ direction: 'OUT', postsLedger: true, netsuiteTxn: 'workorderissue' });
    });
    test('fulfilment groups by order+location (#4)', () => {
        expect(shapes.shapeFor('PICK', {})).toMatchObject({ netsuiteTxn: 'itemfulfillment', groupBy: 'orderLocation' });
    });
    test('bin movement within a location posts NOTHING (#13)', () => {
        expect(shapes.shapeFor('BIN_TRANSFER', {})).toMatchObject({ postsLedger: false, netsuiteTxn: null });
    });
    test('bin movement across locations posts an Inventory Transfer (D-31)', () => {
        expect(shapes.shapeFor('BIN_TRANSFER', { crossLocation: true })).toMatchObject({ postsLedger: true, netsuiteTxn: 'inventorytransfer', needsInventoryDetail: true });
    });
    test('unknown throws', () => {
        expect(grab(() => shapes.shapeFor('NONSENSE', {})).name).toBe('ERR_WMS_UNKNOWN_EVENT_TYPE');
    });
});
