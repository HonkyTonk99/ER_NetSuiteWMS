/**
 * Unit tests for wms_lib_event_registry (T-2.6). No NetSuite account required.
 * Covers the F-12 group-key round-trip, F-13 required-field rejection, the F-17
 * governance-yield decision, the "register a new type, edit nothing else"
 * property, plus D-23 error shape and the built-in determinism / no-mutation.
 */
const registryLib = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_event_registry.js');

const CANONICAL_NINE = [
    'PICK', 'PACK', 'REPLEN_MOVE', 'BIN_TRANSFER', 'COUNT',
    'SHORT_PICK', 'OVERRIDE', 'PUTAWAY', 'EXCEPTION',
];

describe('group-key serialisation (invariant #5 / F-12)', () => {
    test('REPLEN_MOVE and BIN_TRANSFER keys round-trip despite underscores in the enum values', () => {
        const registry = registryLib.defaults();

        const replen = { eventType: 'REPLEN_MOVE', sourceBinId: 'WH1-A-01', targetBinId: 'WH1-B-02', skuCode: 'SKU_1', qty: 3, locationId: 'WH1' };
        const transfer = { eventType: 'BIN_TRANSFER', sourceBinId: 'WH1-A-01', targetBinId: 'WH1-C-09', skuCode: 'SKU_2', qty: 3, locationId: 'WH1' };

        const replenKey = registry.serializedGroupKeyFor('REPLEN_MOVE', replen);
        const transferKey = registry.serializedGroupKeyFor('BIN_TRANSFER', transfer);

        expect(registryLib.parseGroupKey(replenKey)).toEqual({ eventType: 'REPLEN_MOVE', targetBinId: 'WH1-B-02', skuCode: 'SKU_1' });
        expect(registryLib.parseGroupKey(transferKey)).toEqual({ eventType: 'BIN_TRANSFER', sourceBinId: 'WH1-A-01', targetBinId: 'WH1-C-09' });
        // distinct event types with underscores never collide
        expect(replenKey).not.toBe(transferKey);
    });

    test('serialisation is canonical — key insertion order does not change the string', () => {
        const a = registryLib.serializeGroupKey({ eventType: 'PICK', orderId: 7, orderLineKey: 'A' });
        const b = registryLib.serializeGroupKey({ orderLineKey: 'A', orderId: 7, eventType: 'PICK' });
        expect(a).toBe(b);
        expect(registryLib.parseGroupKey(a)).toEqual({ eventType: 'PICK', orderId: 7, orderLineKey: 'A' });
    });

    test('a non-object group key is a programmer error (ERR_WMS_INVALID_ARGUMENT)', () => {
        expect(() => registryLib.serializeGroupKey('nope')).toThrow(/plain object/);
        try {
            registryLib.serializeGroupKey(['a']);
        } catch (e) {
            expect(e.name).toBe('ERR_WMS_INVALID_ARGUMENT');
        }
    });
});

describe('validation (F-13: required fields rejected before any I/O, as a verdict)', () => {
    test('a missing required field returns a field-level verdict, not a throw', () => {
        const registry = registryLib.defaults();
        const event = { waveId: 'W1', orderId: 'O1', /* orderLineKey missing */ sourceBinId: 'B1', skuCode: 'S1', qty: 2, locationId: 'WH1' };
        expect(registry.validateEvent('PICK', event)).toEqual({ ok: false, reasonCode: 'WMS_MISSING_FIELD', field: 'orderLineKey' });
    });

    test('a movement event with non-positive qty is rejected by the handler validator', () => {
        const registry = registryLib.defaults();
        const event = { sourceBinId: 'B1', targetBinId: 'B2', skuCode: 'S1', qty: 0, locationId: 'WH1' };
        expect(registry.validateEvent('REPLEN_MOVE', event)).toEqual({ ok: false, reasonCode: 'WMS_INVALID_QUANTITY', field: 'qty' });
    });

    test('a fully-populated valid event passes', () => {
        const registry = registryLib.defaults();
        const event = { waveId: 'W1', orderId: 'O1', orderLineKey: 'O1:1', sourceBinId: 'B1', skuCode: 'S1', qty: 2, locationId: 'WH1' };
        expect(registry.validateEvent('PICK', event)).toEqual({ ok: true });
    });
});

describe('governance yield decision (F-17)', () => {
    test('yields when the estimate exceeds remaining usage, not otherwise', () => {
        const registry = registryLib.defaults();
        const est = registry.getHandler('PICK').governanceEst;
        expect(registry.shouldYield('PICK', est - 1)).toBe(true);
        expect(registry.shouldYield('PICK', est)).toBe(false);
        expect(registry.shouldYield('PICK', est + 100)).toBe(false);
    });

    test('a non-numeric remaining usage is a programmer error', () => {
        const registry = registryLib.defaults();
        expect(() => registry.shouldYield('PICK', 'lots')).toThrow(/remainingUsage/);
    });
});

describe('registry mechanism (AD-15 / F-15 enabling: dispatch by lookup, no type switch)', () => {
    test('the nine canonical event types are all registered', () => {
        const types = registryLib.defaults().registeredTypes();
        CANONICAL_NINE.forEach((t) => expect(types).toContain(t));
    });

    test('every default handler carries the full declared shape and a STUB commit', () => {
        const registry = registryLib.defaults();
        registry.registeredTypes().forEach((type) => {
            const h = registry.getHandler(type);
            expect(Array.isArray(h.requiredFields)).toBe(true);
            expect(typeof h.validate).toBe('function');
            expect(typeof h.groupKey).toBe('function');
            expect(typeof h.governanceEst).toBe('number');
            // commit is a stub at this layer (its body needs N/, out of D-23)
            expect(() => h.commit()).toThrow(/carve-out/);
            try {
                h.commit();
            } catch (e) {
                expect(e.name).toBe('ERR_WMS_COMMIT_NOT_IMPLEMENTED');
            }
        });
    });

    test('registering a NEW event type makes it dispatchable with no change to the registry core', () => {
        const registry = registryLib.defaults();
        registry.register('THROWAWAY_TYPE', {
            requiredFields: ['orderId', 'locationId'],
            validate: () => ({ ok: true }),
            groupKey: (e) => ({ eventType: 'THROWAWAY_TYPE', orderId: e.orderId }),
            commit: () => { throw new Error('not wired'); },
            governanceEst: 3,
        });
        const event = { orderId: 'X9', locationId: 'WH1' };
        expect(registry.validateEvent('THROWAWAY_TYPE', event)).toEqual({ ok: true });
        expect(registry.serializedGroupKeyFor('THROWAWAY_TYPE', event)).toBe(
            registryLib.serializeGroupKey({ eventType: 'THROWAWAY_TYPE', orderId: 'X9' })
        );
        // isolation: registering on one registry does not leak into another
        expect(registryLib.defaults().hasHandler('THROWAWAY_TYPE')).toBe(false);
    });

    test('programmer errors: malformed handler and unknown type throw with ERR_WMS_* names', () => {
        const registry = registryLib.createRegistry();
        try {
            registry.register('BAD', { requiredFields: 'not-an-array', validate: () => ({ ok: true }), groupKey: () => ({}), commit: () => {}, governanceEst: 1 });
        } catch (e) {
            expect(e.name).toBe('ERR_WMS_INVALID_HANDLER');
        }
        try {
            registry.getHandler('NOPE');
        } catch (e) {
            expect(e.name).toBe('ERR_WMS_UNKNOWN_EVENT_TYPE');
        }
    });
});

describe('built-in properties', () => {
    test('validateEvent and groupKey do not mutate the event', () => {
        const registry = registryLib.defaults();
        const event = { waveId: 'W1', orderId: 'O1', orderLineKey: 'O1:1', sourceBinId: 'B1', skuCode: 'S1', qty: 2, locationId: 'WH1' };
        const before = JSON.stringify(event);
        registry.validateEvent('PICK', event);
        registry.groupKeyFor('PICK', event);
        registry.serializedGroupKeyFor('PICK', event);
        expect(JSON.stringify(event)).toBe(before);
    });

    test('deterministic serialisation across repeated calls', () => {
        const key = { eventType: 'BIN_TRANSFER', sourceBinId: 'A', targetBinId: 'B' };
        expect(registryLib.serializeGroupKey(key)).toBe(registryLib.serializeGroupKey(key));
    });
});
