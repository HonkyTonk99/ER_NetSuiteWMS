/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * wms_lib_clustering - wave similarity and cluster construction (T-6.1, AD-10).
 *
 * Pure logic, carved out of the T-0.3 gate by D-23. Imports NO `N/` module
 * (CI-enforced). The held pipeline (wms_mr_wave_allocation.js, T-6.2) builds the
 * order projection, calls this module, and persists the resulting waves; this
 * module reads and posts nothing.
 *
 * TRANSACTION TYPE IS OPAQUE (D-22). Clustering never branches on
 * `salesorder` / `transferorder`; an order carries a `transactionType` for the
 * held pipeline to route pack/ship, but nothing here reads it. The transfer-order
 * expansion of D-22 therefore leaves this module untouched.
 *
 * Correctness + performance rules:
 *   - Partition by LOCATION before scoring (D-14): a wave never spans locations.
 *     This is also the primary candidate-set reduction, on top of the
 *     share->=1-SKU filter and the fan-out cap (F-10).
 *   - Deterministic: stable sorts, canonical string comparison, no reliance on
 *     object key order, no Date/random. Same input -> same output (a wave that
 *     cannot be reproduced cannot be explained later).
 *   - No input mutation: every argument is left unchanged.
 *   - No hard-coded tuning (invariant #9): `threshold`, `maxOrders`, `maxLines`,
 *     `maxUnits`, `fanOutCap` all arrive in `opts` from per-location config.
 *
 * `fanOutCap` is a MODELLING choice, not just a performance cap (D-26): a SKU on
 * a very large share of orders carries almost no discriminating signal, so it is
 * excluded from candidate generation (stopword removal). CONSEQUENCE: two orders
 * that share ONLY high-fan-out SKUs are never compared, and therefore may never
 * cluster - they fall through to singleton (or smaller) waves. That is intended,
 * not a bug. The skipped SKUs are returned in `diagnostics.skippedSkus`; the held
 * caller (T-6.2) must surface them where a supervisor can see them (D-26).
 *
 * Order projection contract: defined in docs/03-data-model.md section 3.12. The
 * HELD consumer (wms_mr_wave_allocation.js, T-6.2) must satisfy that contract;
 * this module is not bent to fit the consumer. Summary of the fields consumed:
 *   {
 *     orderId,            // unique id (string or number)
 *     location,           // location code - orders are partitioned by this
 *     lines: [{ skuId, qty }],
 *     shipBy,             // optional; ISO string or number, drives seed order
 *     transactionType,    // optional; OPAQUE here (D-22)
 *     zone,               // optional; clusters only merge equal zones
 *     shipByBucket        // optional; clusters only merge equal buckets; its
 *                         //   boundaries come from config, NOT from this module
 *                         //   (the consumer derives it - section 3.12 / section 3.10)
 *   }
 */
define([], function () {
    'use strict';

    function invalidArgument(message) {
        var err = new Error(message);
        err.name = 'ERR_WMS_INVALID_ARGUMENT';
        return err;
    }

    /**
     * Canonical, locale-independent id comparison. Locale-aware compares are not
     * deterministic across environments, so ids are compared as raw strings.
     */
    function compareIds(a, b) {
        var sa = String(a);
        var sb = String(b);
        if (sa < sb) { return -1; }
        if (sa > sb) { return 1; }
        return 0;
    }

    /** Undefined shipBy sorts last; ISO date strings sort chronologically. */
    function compareShipBy(a, b) {
        var aMissing = (a === null || a === undefined);
        var bMissing = (b === null || b === undefined);
        if (aMissing && bMissing) { return 0; }
        if (aMissing) { return 1; }
        if (bMissing) { return -1; }
        var av = String(a);
        var bv = String(b);
        if (av < bv) { return -1; }
        if (av > bv) { return 1; }
        return 0;
    }

    function toSet(collection) {
        if (collection instanceof Set) { return collection; }
        if (Array.isArray(collection)) { return new Set(collection); }
        throw invalidArgument('jaccard expects an array or a Set');
    }

    /**
     * Jaccard similarity |A intersect B| / |A union B|. Two empty sets have similarity 0.
     * @returns {number} in [0, 1]
     */
    function jaccard(a, b) {
        var setA = toSet(a);
        var setB = toSet(b);
        if (setA.size === 0 && setB.size === 0) { return 0; }
        var intersection = 0;
        setA.forEach(function (x) {
            if (setB.has(x)) { intersection += 1; }
        });
        var union = setA.size + setB.size - intersection;
        return union === 0 ? 0 : intersection / union;
    }

    function orderSkuSet(order) {
        var s = new Set();
        order.lines.forEach(function (line) { s.add(line.skuId); });
        return s;
    }

    function orderUnitCount(order) {
        return order.lines.reduce(function (total, line) {
            return total + (typeof line.qty === 'number' ? line.qty : 0);
        }, 0);
    }

    /**
     * Inverted index skuId -> sorted list of orderIds, over one location's orders.
     * @returns {Map<*, Array>}
     */
    function buildSkuIndex(orders) {
        var index = new Map();
        orders.forEach(function (order) {
            orderSkuSet(order).forEach(function (sku) {
                if (!index.has(sku)) { index.set(sku, []); }
                index.get(sku).push(order.orderId);
            });
        });
        index.forEach(function (list) { list.sort(compareIds); });
        return index;
    }

    /**
     * Candidate pairs: only orders sharing >= 1 SKU, skipping any SKU carried by
     * more orders than `fanOutCap` (a popular SKU would otherwise generate a
     * quadratic burst of pairs - F-10). Deduped; deterministically ordered.
     * @returns {{pairs: Array<Array>, skippedSkus: Array<{skuId:*, orderCount:number}>}}
     */
    function generateCandidatePairs(index, fanOutCap) {
        if (typeof fanOutCap !== 'number') {
            throw invalidArgument('generateCandidatePairs requires a numeric fanOutCap');
        }
        var skippedSkus = [];
        var seen = new Set();
        var pairs = [];
        var skus = Array.from(index.keys()).sort(compareIds);
        skus.forEach(function (sku) {
            var list = index.get(sku); // already sorted ascending by compareIds
            if (list.length > fanOutCap) {
                skippedSkus.push({ skuId: sku, orderCount: list.length });
                return;
            }
            for (var i = 0; i < list.length; i += 1) {
                for (var j = i + 1; j < list.length; j += 1) {
                    // list is sorted, so (list[i], list[j]) is already canonical;
                    // JSON key is collision-proof regardless of id contents
                    var dedupeKey = JSON.stringify([list[i], list[j]]);
                    if (!seen.has(dedupeKey)) {
                        seen.add(dedupeKey);
                        pairs.push([list[i], list[j]]);
                    }
                }
            }
        });
        pairs.sort(function (p, q) {
            return compareIds(p[0], q[0]) || compareIds(p[1], q[1]);
        });
        return { pairs: pairs, skippedSkus: skippedSkus };
    }

    /** Two orders may share a wave only if their zone and shipByBucket agree. */
    function sameBucket(a, b) {
        if (a.zone !== undefined && b.zone !== undefined && a.zone !== b.zone) { return false; }
        if (a.shipByBucket !== undefined && b.shipByBucket !== undefined && a.shipByBucket !== b.shipByBucket) {
            return false;
        }
        return true;
    }

    function fits(cluster, cand, opts) {
        if (cluster.orderIds.length + 1 > opts.maxOrders) { return false; }
        if (cluster.lineCount + cand.lineCount > opts.maxLines) { return false; }
        if (cluster.unitCount + cand.unitCount > opts.maxUnits) { return false; }
        return true;
    }

    function assertOrders(orders) {
        if (!Array.isArray(orders)) {
            throw invalidArgument('cluster expects an array of orders');
        }
        orders.forEach(function (o, i) {
            if (o === null || typeof o !== 'object') {
                throw invalidArgument('order at index ' + i + ' is not an object');
            }
            if (o.orderId === null || o.orderId === undefined || o.orderId === '') {
                throw invalidArgument('order at index ' + i + ' has no orderId');
            }
            if (o.location === null || o.location === undefined || o.location === '') {
                throw invalidArgument('order ' + o.orderId + ' has no location (partition by location, D-14)');
            }
            if (!Array.isArray(o.lines)) {
                throw invalidArgument('order ' + o.orderId + ' has no lines array');
            }
        });
    }

    function assertOpts(opts) {
        if (opts === null || typeof opts !== 'object') {
            throw invalidArgument('cluster requires an opts object (config-injected, invariant #9)');
        }
        ['threshold', 'maxOrders', 'maxLines', 'maxUnits', 'fanOutCap'].forEach(function (k) {
            if (typeof opts[k] !== 'number') {
                throw invalidArgument('opts.' + k + ' must be a number (config-injected, invariant #9)');
            }
        });
    }

    /**
     * Cluster orders into waves. Location-partitioned; within a location, greedy
     * agglomeration seeded in (shipBy, orderId) order; a candidate that would
     * breach maxOrders/maxLines/maxUnits is NOT added (the cluster is split - the
     * order seeds or joins another cluster). Pure; mutates no argument.
     *
     * @returns {{clusters: Array, diagnostics: {comparisonCount: number, skippedSkus: Array}}}
     */
    function cluster(orders, opts) {
        assertOpts(opts);
        assertOrders(orders);

        var comparisonCount = 0;
        var skippedSkus = [];
        var clusters = [];

        // 1. Partition by location - a wave never spans locations (D-14).
        var byLocation = new Map();
        orders.forEach(function (o) {
            if (!byLocation.has(o.location)) { byLocation.set(o.location, []); }
            byLocation.get(o.location).push(o);
        });

        var locations = Array.from(byLocation.keys()).sort(compareIds);
        locations.forEach(function (loc) {
            // 2. Deterministic seed order by (shipBy, orderId).
            var locOrders = byLocation.get(loc).slice();
            locOrders.sort(function (a, b) {
                return compareShipBy(a.shipBy, b.shipBy) || compareIds(a.orderId, b.orderId);
            });

            var meta = new Map();
            locOrders.forEach(function (o) {
                meta.set(o.orderId, {
                    order: o,
                    skus: orderSkuSet(o),
                    lineCount: o.lines.length,
                    unitCount: orderUnitCount(o),
                });
            });

            // 3. Candidate pairs within this location, scored once each.
            var index = buildSkuIndex(locOrders);
            var candidates = generateCandidatePairs(index, opts.fanOutCap);
            candidates.skippedSkus.forEach(function (s) {
                skippedSkus.push({ location: loc, skuId: s.skuId, orderCount: s.orderCount });
            });

            var neighbors = new Map();
            locOrders.forEach(function (o) { neighbors.set(o.orderId, []); });
            candidates.pairs.forEach(function (pair) {
                var ma = meta.get(pair[0]);
                var mb = meta.get(pair[1]);
                if (!sameBucket(ma.order, mb.order)) { return; }
                comparisonCount += 1;
                var score = jaccard(ma.skus, mb.skus);
                if (score >= opts.threshold) {
                    neighbors.get(pair[0]).push({ orderId: pair[1], score: score });
                    neighbors.get(pair[1]).push({ orderId: pair[0], score: score });
                }
            });
            neighbors.forEach(function (list) {
                list.sort(function (x, y) {
                    return (y.score - x.score) || compareIds(x.orderId, y.orderId);
                });
            });

            // 4. Greedy agglomeration seeded by the deterministic order.
            var assigned = new Set();
            locOrders.forEach(function (seed) {
                if (assigned.has(seed.orderId)) { return; }
                var sm = meta.get(seed.orderId);
                var current = {
                    location: loc,
                    zone: seed.zone,
                    shipByBucket: seed.shipByBucket,
                    orderIds: [seed.orderId],
                    lineCount: sm.lineCount,
                    unitCount: sm.unitCount,
                };
                assigned.add(seed.orderId);

                var rejected = new Set(); // candidates that don't fit THIS cluster
                var growing = true;
                while (growing) {
                    growing = false;
                    var best = null;
                    current.orderIds.forEach(function (memberId) {
                        neighbors.get(memberId).forEach(function (nb) {
                            if (assigned.has(nb.orderId) || rejected.has(nb.orderId)) { return; }
                            if (!sameBucket(meta.get(seed.orderId).order, meta.get(nb.orderId).order)) { return; }
                            if (best === null ||
                                nb.score > best.score ||
                                (nb.score === best.score && compareIds(nb.orderId, best.orderId) < 0)) {
                                best = nb;
                            }
                        });
                    });
                    if (best === null) { break; }
                    var cm = meta.get(best.orderId);
                    if (fits(current, cm, opts)) {
                        current.orderIds.push(best.orderId);
                        current.lineCount += cm.lineCount;
                        current.unitCount += cm.unitCount;
                        assigned.add(best.orderId);
                        growing = true;
                    } else {
                        // Split rather than grow: leave it unassigned for another cluster.
                        rejected.add(best.orderId);
                        growing = true;
                    }
                }

                current.orderIds.sort(compareIds); // canonical output
                clusters.push(current);
            });
        });

        return {
            clusters: clusters,
            diagnostics: { comparisonCount: comparisonCount, skippedSkus: skippedSkus },
        };
    }

    return {
        jaccard: jaccard,
        buildSkuIndex: buildSkuIndex,
        generateCandidatePairs: generateCandidatePairs,
        cluster: cluster,
    };
});
