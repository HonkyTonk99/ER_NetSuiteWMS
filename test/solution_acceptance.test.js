/**
 * SOLUTION ACCEPTANCE TESTS - tier 1 (here-runnable), per docs/11 section 5.
 *
 * Cross-phase scenarios that exercise the built modules TOGETHER against no account,
 * asserting the headline invariants end to end. Tier 2 (deploy, real transforms,
 * governance, offline device, QMS round-trip) is the Phase 14 sandbox runbook.
 */
const shapes = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_ledger_shapes.js');
const plan = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_commit_plan.js');
const avail = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_availability.js');
const period = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_period.js');
const alloc = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_allocation.js');
const detail = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_inventory_detail.js');
const wo = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_wo_flow.js');
const serial = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_serial.js');
const reconcile = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_reconcile.js');
const count = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_count.js');
const exc = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_exception.js');
const q = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_offline_queue.js');
const sync = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_sync.js');
const session = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_session.js');
const replen = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_replenishment.js');
const qms = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_qms.js');
const migration = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_migration.js');

describe('SAT-1 mixed-mode receipt then fulfilment, two-phase, one transform per (order,location)', () => {
    test('receipts post before fulfilments; picks group per order+location', () => {
        const events = [
            { eventType: 'RECEIPT_PO', uuid: 'r1' },
            { eventType: 'PICK', uuid: 'p1', order: 'SO1', location: '1' },
            { eventType: 'PICK', uuid: 'p2', order: 'SO1', location: '1' },
            { eventType: 'PICK', uuid: 'p3', order: 'SO1', location: '2' },
        ];
        const p = plan.plan(events);
        expect(p.phaseA.map((e) => e.uuid)).toEqual(['r1']);          // inbound first (#18)
        const groups = plan.groupFulfilment(p.phaseB);
        expect(groups).toHaveLength(2);                                // (SO1,1) and (SO1,2) (#4)
        expect(shapes.shapeFor('RECEIPT_PO', {}).netsuiteTxn).toBe('itemreceipt');
        expect(shapes.shapeFor('PICK', {}).netsuiteTxn).toBe('itemfulfillment');
    });
    test('inventory detail shapes per tracking mode (PLAIN none / LOT one / SERIAL per unit)', () => {
        expect(detail.buildInventoryAssignments({ mode: 'PLAIN', quantity: 5 })).toEqual([]);
        expect(detail.buildInventoryAssignments({ mode: 'LOT', quantity: 12, lot: 'B1' })).toHaveLength(1);
        expect(detail.buildInventoryAssignments({ mode: 'SERIAL', quantity: 2, serials: ['a', 'b'] })).toHaveLength(2);
    });
});

describe('SAT-2 outbound controls: commitment, availability, period', () => {
    test('a pick within commitment, with stock, in an open period, is clear to post', () => {
        expect(alloc.validatePick({ committed: 10, picked: 2 }, 5)).toEqual({ ok: true });
        expect(avail.check({ mode: 'PLAIN', onHand: 20, requested: 5 })).toEqual({ ok: true });
        expect(period.decide({ closed: false })).toEqual({ ok: true });
    });
    test('over-commitment is refused (never ship another order stock, #15)', () => {
        expect(alloc.validatePick({ committed: 10, picked: 8 }, 5).reasonCode).toBe('COMMITMENT_EXCEEDED');
    });
    test('short stock DEFERS by default (D-48); closed period raises an exception (#16)', () => {
        expect(avail.check({ mode: 'PLAIN', onHand: 3, requested: 5 }).action).toBe('DEFER');
        const pr = period.decide({ closed: true });
        expect(pr.reasonCode).toBe('CLOSED_PERIOD_POSTING');
        expect(exc.raise({ uuid: 'e', location: '1' }, pr.reasonCode).severity).toBe('HIGH');
    });
    test('SERIAL never goes negative even if the location allows it (#21)', () => {
        expect(avail.check({ mode: 'SERIAL', onHand: 1, requested: 2, allowNegative: true }).reasonCode).toBe('SERIAL_NOT_AVAILABLE');
    });
});

describe('SAT-3 work-order component flow (D-43/44/45)', () => {
    test('pick-to-floor is an Inventory Transfer; issue-at-build is a Work Order Issue', () => {
        expect(shapes.shapeFor('BIN_TRANSFER', { crossLocation: true }).netsuiteTxn).toBe('inventorytransfer');
        expect(shapes.shapeFor('WO_ISSUE', {}).netsuiteTxn).toBe('workorderissue');
    });
    test('the transfer screen defaults to available; the WO builds at a PRODUCTION location', () => {
        expect(wo.transferScreen({ onHand: 100, committed: 30, needed: 40 }).defaultQty).toBe(70);
        expect(wo.assertProductionTarget({ locationClass: 'PRODUCTION' })).toBe(true);
    });
});

describe('SAT-4 RMA -> quarantine -> authorised write-off (QMS owns inspection, WMS owns the move)', () => {
    test('RMA receipt, fail inspection stays in holding, write-off posts an adjustment', () => {
        expect(shapes.shapeFor('RECEIPT_RMA', {}).transformFrom).toBe('returnauthorization');
        expect(qms.onResult({ outcome: 'FAIL' }).action).toBe('QUARANTINE');
        expect(shapes.shapeFor('WRITE_OFF', {}).netsuiteTxn).toBe('inventoryadjustment');
    });
    test('pass releases via Inventory Transfer (WMS move, not a QMS status change)', () => {
        expect(qms.onResult({ outcome: 'PASS' }).wmsMovement).toBe('INVENTORY_TRANSFER');
    });
});

describe('SAT-5 blind cycle count -> variance -> approval -> adjustment (D-37)', () => {
    test('a variance cannot post until approved, then posts an inventory adjustment', () => {
        const v = count.computeVariance(100, 95, 2);
        expect(v.varianceValue).toBe(-10);
        expect(count.postDecision('SUBMITTED', v).reason).toBe('AWAITING_APPROVAL');
        expect(count.postDecision('APPROVED', v)).toEqual({ canPost: true });
        expect(shapes.shapeFor('COUNT', {}).netsuiteTxn).toBe('inventoryadjustment');
    });
});

describe('SAT-6 serial integrity (#21/#22)', () => {
    test('wrong-bin pick continues with a discrepancy; reconciliation ties qty to serial rows', () => {
        const r = serial.validatePick('SN1', { item: 'A', status: 'IN_STOCK', bin: 'B9' }, { expectedItem: 'A', expectedBin: 'B1' });
        expect(r).toMatchObject({ ok: true, discrepancy: 'SERIAL_WRONG_BIN' });
        expect(reconcile.serialConsistency(3, 3).ok).toBe(true);
        expect(reconcile.serialConsistency(3, 2).ok).toBe(false);
    });
    test('receiving an already-live serial stops', () => {
        expect(serial.validateEntry('SN1', { status: 'IN_STOCK' }).reasonCode).toBe('SERIAL_ALREADY_LIVE');
    });
});

describe('SAT-7 offline queue + idempotent sync + reconnect (#11/#3/T-3.5)', () => {
    test('a duplicate externalid is idempotent success; reconnect trusts server state', () => {
        let queue = q.enqueue([], q.createEvent({ eventType: 'PICK', uuid: 'x' }, { uuidFn: () => 'x', nowFn: () => 1 }));
        const d = sync.classifyResponse({ uuid: 'x', status: 'rejected', error: 'UNIQUE_RCRD_ID_REQD' });
        expect(d).toBe('synced');
        queue = q.applyDispositions(queue, { x: d });
        expect(q.purgeSynced(queue)).toHaveLength(0);
        expect(sync.reconcile('POSTED')).toBe('synced');
    });
});

describe('SAT-8 access model + replenishment guard + migration gate', () => {
    test('permissions are cumulative with no DELETE (D-50)', () => {
        expect(session.can('CREATE', 'CREATE')).toBe(true);
        expect(session.can('CREATE', 'EDIT')).toBe(false);
        expect(session.can('EDIT', 'DELETE')).toBe(false);
    });
    test('replenishment never sources from a holding location (#23)', () => {
        const r = replen.selectSources({ item: 'X', qtyNeeded: 5 }, [
            { bin: 'H', location: '2', locationClass: 'HOLDING', qty: 100, expiry: '2024-01-01' },
            { bin: 'O', location: '1', locationClass: 'OPERATIONAL', qty: 5, expiry: '2026-01-01' },
        ]);
        expect(r.sources.map((s) => s.bin)).toEqual(['O']);
    });
    test('migration blocks a mixed bin before go-live', () => {
        expect(migration.validateBinImport([
            { sourceBin: 's', locationCode: 'WH1', binCode: 'A1', item: 'X', lot: 'L1' },
            { sourceBin: 's', locationCode: 'WH1', binCode: 'A1', item: 'X', lot: 'L2' },
        ]).ok).toBe(false);
    });
});
