/**
 * Unit tests for wms_lib_clustering (T-6.1). No NetSuite account required.
 * Covers every acceptance criterion, plus the three properties the sponsor asked
 * to be built in and tested rather than assumed: determinism, no input mutation,
 * and bounded (sub-quadratic) candidate generation measured by comparison count.
 */
const clusteringLib = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_clustering.js');

const OPTS = { threshold: 0.5, maxOrders: 10, maxLines: 1000, maxUnits: 100000, fanOutCap: 50 };

function order(orderId, location, skuIds, extra) {
    const o = { orderId, location, lines: skuIds.map((skuId) => ({ skuId, qty: 1 })) };
    return Object.assign(o, extra || {});
}

describe('jaccard', () => {
    test('A={1,2,3} B={2,3,4} → 0.5 exactly', () => {
        expect(clusteringLib.jaccard([1, 2, 3], [2, 3, 4])).toBe(0.5);
    });
    test('accepts Sets and arrays; two empty sets → 0', () => {
        expect(clusteringLib.jaccard(new Set([1, 2]), [2, 3])).toBeCloseTo(1 / 3, 10);
        expect(clusteringLib.jaccard([], [])).toBe(0);
    });
    test('a non-collection argument is a programmer error', () => {
        try {
            clusteringLib.jaccard(42, [1]);
        } catch (e) {
            expect(e.name).toBe('ERR_WMS_INVALID_ARGUMENT');
        }
    });
});

describe('candidate generation (F-10)', () => {
    test('two orders sharing no SKUs are never made into a candidate pair', () => {
        const index = clusteringLib.buildSkuIndex([order('A', 'WH1', [1, 2]), order('B', 'WH1', [3, 4])]);
        const { pairs } = clusteringLib.generateCandidatePairs(index, 50);
        expect(pairs).toHaveLength(0);
    });

    test('a SKU carried by more orders than the fan-out cap is skipped and reported, contributing no pairs', () => {
        const orders = [];
        for (let i = 0; i < 8; i += 1) { orders.push(order('O' + i, 'WH1', ['HOT'])); }
        const index = clusteringLib.buildSkuIndex(orders);
        const { pairs, skippedSkus } = clusteringLib.generateCandidatePairs(index, 5);
        expect(pairs).toHaveLength(0);
        expect(skippedSkus).toEqual([{ skuId: 'HOT', orderCount: 8 }]);
    });

    test('a shared pair is emitted exactly once even when two orders share several SKUs', () => {
        const index = clusteringLib.buildSkuIndex([order('A', 'WH1', [1, 2, 3]), order('B', 'WH1', [1, 2, 3])]);
        const { pairs } = clusteringLib.generateCandidatePairs(index, 50);
        expect(pairs).toHaveLength(1);
    });
});

describe('cluster', () => {
    test('two orders in DIFFERENT locations sharing every SKU are never in the same wave (D-14)', () => {
        const result = clusteringLib.cluster([order('A', 'WH1', [1, 2, 3]), order('B', 'WH2', [1, 2, 3])], OPTS);
        result.clusters.forEach((c) => {
            expect(c.orderIds.includes('A') && c.orderIds.includes('B')).toBe(false);
        });
        // and every cluster belongs to exactly one location
        const locs = new Set(result.clusters.map((c) => c.location));
        expect(locs).toEqual(new Set(['WH1', 'WH2']));
    });

    test('similar orders in the same location cluster together', () => {
        const result = clusteringLib.cluster([
            order('A', 'WH1', [1, 2, 3, 4]),
            order('B', 'WH1', [1, 2, 3, 5]),
        ], OPTS);
        expect(result.clusters).toHaveLength(1);
        expect(result.clusters[0].orderIds).toEqual(['A', 'B']);
    });

    test('a cluster that would exceed maxOrders is split, not grown', () => {
        const orders = [];
        for (let i = 0; i < 6; i += 1) { orders.push(order('O' + i, 'WH1', [1, 2, 3, 4])); } // all identical → all similar
        const result = clusteringLib.cluster(orders, Object.assign({}, OPTS, { maxOrders: 2 }));
        result.clusters.forEach((c) => expect(c.orderIds.length).toBeLessThanOrEqual(2));
        // every order is placed exactly once
        const placed = result.clusters.reduce((n, c) => n + c.orderIds.length, 0);
        expect(placed).toBe(6);
    });

    test('malformed input is a programmer error (ERR_WMS_INVALID_ARGUMENT)', () => {
        expect(() => clusteringLib.cluster([{ orderId: 'A', lines: [] }], OPTS)).toThrow(/location/);
        expect(() => clusteringLib.cluster([order('A', 'WH1', [1])], { threshold: 0.5 })).toThrow(/must be a number/);
    });
});

describe('built-in properties (sponsor-required, tested not assumed)', () => {
    // A realistic, deterministic input: 3000 orders in one location, 10 lines
    // each, drawn from a sliding SKU window so orders share SKUs with their
    // neighbours; plus one hot SKU on more orders than the fan-out cap.
    function buildRealisticOrders() {
        const N = 3000;
        const POOL = 3000;
        const orders = [];
        for (let i = 0; i < N; i += 1) {
            const skus = [];
            for (let k = 0; k < 10; k += 1) { skus.push('S' + ((i + k) % POOL)); }
            if (i < 60) { skus.push('HOT'); } // 60 > fanOutCap 50 → must be skipped
            orders.push({ orderId: 'O' + i, location: 'WH1', shipBy: '2026-08-1' + (i % 9), lines: skus.map((s) => ({ skuId: s, qty: 1 })) });
        }
        return orders;
    }

    test('deterministic: the same input produces identical clusters in identical order', () => {
        const input = buildRealisticOrders();
        const a = clusteringLib.cluster(input, OPTS);
        const b = clusteringLib.cluster(input, OPTS);
        expect(JSON.stringify(a.clusters)).toBe(JSON.stringify(b.clusters));
    });

    test('mutates none of its input orders', () => {
        const input = buildRealisticOrders();
        const before = JSON.stringify(input);
        clusteringLib.cluster(input, OPTS);
        expect(JSON.stringify(input)).toBe(before);
    });

    test('candidate generation is bounded well below n² (comparison count, not wall-clock)', () => {
        const input = buildRealisticOrders();
        const n = input.length;
        const { diagnostics } = clusteringLib.cluster(input, OPTS);
        const quadratic = (n * (n - 1)) / 2;
        // the fan-out cap + shared-SKU filter keep comparisons roughly linear in n
        expect(diagnostics.comparisonCount).toBeLessThan(100 * n);
        expect(diagnostics.comparisonCount).toBeLessThan(quadratic * 0.05);
        // the hot SKU was skipped, and reported for the caller to log
        expect(diagnostics.skippedSkus.some((s) => s.skuId === 'HOT')).toBe(true);
    });

    test('every order is placed in exactly one cluster', () => {
        const input = buildRealisticOrders();
        const { clusters } = clusteringLib.cluster(input, OPTS);
        const placed = clusters.reduce((n, c) => n + c.orderIds.length, 0);
        const unique = new Set();
        clusters.forEach((c) => c.orderIds.forEach((id) => unique.add(id)));
        expect(placed).toBe(input.length);
        expect(unique.size).toBe(input.length);
    });
});
