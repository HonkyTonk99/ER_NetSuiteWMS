# Phases 6–9 · Waves, Picking & Packing, Custody, Dashboard

---

# PHASE 6 — Item-Commonality Wave Clustering

### T-6.1 — `wms_lib_clustering.js` — similarity and cluster construction
**Depends on:** T-2.5 · **Resolves:** F-10, F-16 · **Implements:** AD-10

> **Carved out of the T-0.3 gate — buildable now (D-23, 2026-08-10).** Pure logic, no SuiteScript
> dependency. Conditions of the carve-out: the module imports **no `N/` module** (not even `N/error`;
> CI-enforced by `guard-carveout-imports.js`). **Error shape (D-23):** clustering has no per-item
> business "rejection" — it **returns** clusters (and may return a diagnostic on a SKU skipped past the
> fan-out cap); a **programmer error** (malformed order input) throws a plain `Error` with `err.name`
> set to an `ERR_WMS_*` value, matching the `N/error` shape with no translation layer. **Unit
> tests of the acceptance criteria below are the deliverable, not an extra**; **no hard-coded tuning**
> — `threshold`, `maxOrders`, `maxLines`, `maxUnits`, cart capacity all arrive as parameters (invariant
> #9); **transaction type is opaque** (state it in the module header — clustering never branches on
> `salesorder`/`transferorder`, so D-22 leaves it untouched). **Do not write the consuming
> `wms_mr_wave_allocation.js` (T-6.2) — that stays held.**

**Narrative**
As a warehouse planner, I want orders grouped by how much stock they share, so that one picker walk
serves many orders instead of one.

**Requirement**
Pure, dependency-free module (fully unit-testable). `jaccard(setA, setB) = |A∩B| / |A∪B|`.
**Partition orders by location first (D-14): a wave never spans locations, so candidate generation and
scoring run within one location.** This is both a correctness rule (no cross-location wave) **and a
performance property** — partitioning shrinks the candidate set before the O(pairs) step, on top of the
share-≥1-SKU filter. `buildSkuIndex(orders)` → `Map<skuId, orderId[]>` **built per location**.
`generateCandidatePairs(index, fanOutCap)` — only pairs sharing ≥ 1 SKU, skipping SKUs whose order
count exceeds the cap. `cluster(orders, opts)` with `{threshold, maxOrders, maxLines, maxUnits, zone,
shipByBucket}` from **per-location config** (§3.10 precedence — cart capacity differs by warehouse) —
**the single source of the threshold value** (F-16). Deterministic seed ordering by (shipBy, orderId)
so runs are reproducible. Zone names are **location-scoped** (may repeat across locations).

**Acceptance**
- [ ] GIVEN orders A={1,2,3} and B={2,3,4}, THEN `jaccard` returns 0.5 exactly.
- [ ] GIVEN two orders in **different locations** sharing every SKU, WHEN clustering runs, THEN they are **never** placed in the same wave (partitioned by location first). *(D-14)*
- [ ] GIVEN two orders sharing no SKUs, WHEN candidates are generated, THEN that pair is never compared.
- [ ] GIVEN a SKU appearing on more orders than the fan-out cap, THEN it contributes no candidate pairs and this is logged.
- [ ] GIVEN a cluster that would exceed `maxOrders` (from that location's config), THEN it is split rather than allowed to grow.
- [ ] GIVEN the same input run twice, THEN identical clusters are produced in identical order.
- [ ] GIVEN 5,000 orders averaging 10 lines across N locations, WHEN clustering runs in the harness, THEN it completes within the agreed time budget with no quadratic blow-up (per-location partitioning bounds the candidate set).

---

### T-6.2 — `wms_mr_wave_allocation.js` — clustering pipeline
**Depends on:** T-6.1, T-1.3 · **Resolves:** F-10

**Narrative**
As a warehouse planner, I want clustering to run over the full order book without timing out, so
that wave planning is reliable at peak volume.

**Requirement**
Map/Reduce, **not** a Scheduled Script. `getInputData` searches unfulfilled, approved **Sales Order
*and* Transfer Order** lines (`mainline=F`, `taxline=F`, `shippingline=F`), restricted to the release
window. **Transaction type is a parameter of the same engine (D-22), not a second engine** — a
`transferorder` line is picked, staged and shipped out of its *source* location exactly like a sales
order line; do not fork the wave/pick path. The wave carries which transaction type each order is (for
the pack/ship step, which differs: a TO ships to another location, an SO to a customer).

**Eligibility is gated on NetSuite commitment (F-22, AD-17).** Only lines with quantity committed by
NetSuite enter a wave, and the wave's demand for a line is capped at the **committed** quantity, not
the ordered quantity. The WMS allocates *within* NetSuite's commitment — it does not decide which
order gets stock. Skipping this hands one customer's promised stock to another: totals stay correct,
attribution does not.

`map` emits **`(location, SKU)` → order** so partitioning by location is intrinsic (D-14). `reduce`
builds candidate pairs **within a location**. `summarize` runs `cluster()` and creates
`customrecord_wms_wave_pick` records with **`custrecord_wave_location` set**, orders, zone, ship-by,
similarity score, line and unit counts, status Pending. Orders already on an open wave are excluded.
An order's fulfilling stock location determines its wave location; an order that cannot be served from
a single location is out of scope for this release (flag, do not silently split).

**Acceptance**
- [ ] GIVEN pending sales orders sharing ≥ the configured threshold of SKUs **in the same location**, WHEN the pipeline runs, THEN they are grouped into a single Wave Pick record with its `custrecord_wave_location` set. *(FRD TC-WAV-01, D-14)*
- [ ] GIVEN two orders that share every SKU but draw from **different locations**, WHEN the pipeline runs, THEN they are placed in **separate** waves.
- [ ] GIVEN an order already assigned to an open wave, WHEN clustering runs, THEN it is not assigned to a second wave.
- [ ] GIVEN an open **Transfer Order** with committed lines at its source location, WHEN the pipeline runs, THEN its lines are eligible and cluster through the **same engine** as sales-order lines (parameterised by transaction type), producing a wave in the source location. *(D-22)*
- [ ] GIVEN a sales order line with zero committed quantity, WHEN clustering runs, THEN it is excluded from every wave.
- [ ] GIVEN a line ordered 10 and committed 4, WHEN a wave is built, THEN wave demand for that line is 4.
- [ ] GIVEN 5,000 pending orders, WHEN the pipeline runs, THEN it completes without governance or timeout failure.
- [ ] GIVEN a created wave, THEN its similarity score, line count and unit count are populated and its size is within cart capacity.

---

### T-6.3 — Wave release, assignment and pick-path sequencing
**Depends on:** T-6.2, T-1.3

**Narrative**
As a warehouse supervisor, I want to release waves to named pickers in an efficient walk order, so
that clustering translates into actual walking-distance savings.

**Requirement**
Supervisor Suitelet: review Pending waves **for the supervisor's location (D-14)**, adjust, assign a
picker, release. On release, generate pick tasks sorted by `custrecord_wb_pick_sequence` within zone —
zone and pick sequence are **location-scoped** (the wave is single-location), so no cross-location walk
path can be produced. This is what delivers the FRD's promised "optimise walk sequences", which nothing
in the source document actually implements. Wave status Pending → Picking on release.

**Acceptance**
- [ ] GIVEN a Pending wave, WHEN a supervisor assigns a picker and releases it, THEN status becomes Picking and tasks appear on that picker's device.
- [ ] GIVEN generated pick tasks, THEN they are ordered by bin pick sequence within zone, not by order or item.
- [ ] GIVEN a wave with no assigned picker, THEN it cannot be released.

---

### T-6.4 — Wave amendment, cancellation and re-planning
**Depends on:** T-6.3 · **Resolves:** scope gap D

**Narrative**
As a customer service agent, I want to cancel or amend an order that is already on a wave, so that a
last-minute change does not ship the wrong goods.

**Requirement**
Define and implement behaviour for: order cancelled while wave is Pending / Picking / Staged;
quantity amended; line added; order put on credit hold; **NetSuite commitment reduced or released
after the wave was built** (F-22 — the wave may now be holding stock promised elsewhere). Rules must cover already-picked stock —
return to bin or hold at pack. User Event on Sales Order detects the change and flags the wave.
Supervisor is notified; wave moves to Exception where automatic handling is unsafe.

**Acceptance**
- [ ] GIVEN an order on a Pending wave is cancelled, WHEN the wave is next viewed, THEN the order is removed and the wave is re-costed.
- [ ] GIVEN an order on a Picking wave is cancelled, THEN the picker is notified on-device, the wave flags Exception, and a documented disposition for already-picked stock is applied.
- [ ] GIVEN an order quantity is reduced below the picked quantity, THEN the surplus is flagged for return-to-bin and an exception is raised.
- [ ] GIVEN NetSuite commitment for a line on an active wave is reduced, THEN the wave is flagged and the allocation is re-evaluated before picking continues.

---

# PHASE 7 — Summary Picking & De-consolidation Packing

*Unblocked 2026-08-07 — Q-04 closed by D-03. Summary picking is one task per SKU **per bin**;
multi-batch rows in the pack screen are the normal case.*

### T-7.1 — Summary pick task generation
**Depends on:** T-6.3 · **Resolves:** F-06 · **Implements:** D-03 · *(Q-04 now closed)*

**Narrative**
As a picker, I want one consolidated instruction per SKU per bin rather than one per order line, so
that I pick 36 units in a single action instead of four.

**Requirement**
Aggregate wave demand into one task **per SKU per bin**. **All candidate bins are within the wave's
location (D-14) — the wave is single-location, so allocation never reaches across locations.** Because a
bin holds exactly one batch, this is also one task per batch — which is the correct reading of Doc B
§2.4 under the single-batch rule (F-06, closed by D-03). Allocation across bins is **FEFO**; an order
may split across batches.

Consequence to build for explicitly: demand for a SKU spanning three bins produces **three** tasks,
not one. The FRD's "36 units in one action" example holds only where a single bin carries all 36.
This is correct behaviour, not degradation.

Where wave demand exceeds the UNIT pick face, fall through to other bins holding the SKU (policy
`allowDirectPick`) per D-03, and raise replenishment only where BULK stock actually exists. Each
task retains its constituent order-line allocations so de-consolidation is possible.

**Never allocate from a non-fulfillable bin** (`availableForFulfilment: false` — QUALITY, RETURN,
DEFECT, STAGE, RECEIVING) (Q-16). Stock there is physically present but not pickable until moved into
UNIT/BULK, so it is invisible to allocation even when it is the only stock for the SKU — the SKU
short-picks or is out of stock rather than directing a picker to unpickable stock. This is the WMS
side of **F-26**: NetSuite may still have committed that quarantine stock, which is why F-26 matters.

**Allocated quantity per order line may not exceed the quantity NetSuite has committed to that line**
(F-22, AD-17). Bin and lot selection is a refinement of NetSuite's commitment, never a substitute
for it.

**Acceptance**
- [ ] GIVEN four orders needing 5, 10, 6 and 15 of ABC123 from one bin, THEN one pick task for 36 units is generated. *(FRD §2.4 worked example)*
- [ ] GIVEN wave demand for one SKU spanning three bins, THEN three tasks are generated in FEFO bin order, and the per-order allocation records which batch serves which order.
- [ ] GIVEN wave demand exceeding the UNIT pick face and BULK stock existing, THEN a replenishment task is raised and picking is directed to the pick face.
- [ ] GIVEN wave demand exceeding the UNIT pick face and **no** BULK stock existing, THEN picking is directed straight to other bins holding the SKU with no replenishment task raised. *(D-03)*
- [ ] GIVEN every generated task, THEN the sum of its order allocations equals its total quantity.
- [ ] GIVEN a line committed for 4 units, WHEN allocation runs, THEN no more than 4 units are allocated to it regardless of available stock.
- [ ] GIVEN a SKU whose only physical stock is in a QUALITY/RETURN/DEFECT bin, WHEN allocation runs, THEN nothing is allocated from it and the line short-picks or reports out of stock — no picker is directed to a non-fulfillable bin.

---

### T-7.2 — `wms_sl_pack_deconsolidation.js` — packer Suitelet
**Depends on:** T-7.1 · **Resolves:** F-06

**Narrative**
As a packer, I want to expand a consolidated SKU line into its constituent orders and pack them one
by one, so that the right units go into the right box with the right lot recorded.

**Requirement**
Render per Doc B §2.4: collapsed summary row (`ITEM | Total Wave Qty | Picked`) expanding to order
rows with Order #, Order Qty, Picked Qty, Scanned Batch, Status and a `[PACK ORDER]` action. Replace
the FRD sample's hard-coded mock data with a live query over wave allocations.

**Multiple batches under one SKU summary is the normal case, not the exception** (F-06, D-03) —
the FRD's mock showing all four orders on `BATCH-2026-08A` is the *special* case where one bin
happened to cover the whole demand. Design the row grouping for the general case: one order line may
itself be served by two batches, and the screen must show that clearly enough that a packer does not
put the wrong lot in the box. `[PACK ORDER]` validates that all lines for that order have confirmed
quantities and batches before enabling.

**Acceptance**
- [ ] GIVEN an active wave, WHEN the packer opens the screen, THEN live allocation data renders — no mock data anywhere in the deployed script.
- [ ] GIVEN a summary row served by three batches, WHEN expanded, THEN each order row shows the batch actually allocated to it.
- [ ] GIVEN a single order line split across two batches, WHEN expanded, THEN both batch allocations are shown against that order with their quantities.
- [ ] GIVEN an order with an unconfirmed quantity or missing lot, THEN `[PACK ORDER]` is disabled with the reason shown.
- [ ] GIVEN 40 order rows under one summary, WHEN the page renders, THEN it loads in under 3 seconds.

---

### T-7.3 — Pack action → fulfillment commit
**Depends on:** T-7.2, T-4.2

**Narrative**
As a packer, I want clicking `[PACK ORDER]` to record the fulfillment reliably, so that the order is
shipped with correct lot traceability and I am not left waiting.

**Requirement**
`[PACK ORDER]` emits a **PACK scan event** and returns immediately — it does **not** transform the
record synchronously, unlike the FRD sample Suitelet. That keeps every ledger write on the one
asynchronous path (AD-01) and preserves the no-double-transform guarantee (F-15). The UI shows
"packing" then flips to "packed" when the committer posts. Triggers packing label generation per
T-7.5.

**Acceptance**
- [ ] GIVEN `[PACK ORDER]` is clicked, THEN a PACK event is created and the UI responds in under 1 second without waiting for a transform.
- [ ] GIVEN the committer processes the event, THEN an Item Fulfillment is created in Picked status with exact batch/lot details attached. *(FRD TC-PCK-01)*
- [ ] GIVEN `[PACK ORDER]` is clicked twice, THEN only one Item Fulfillment results.
- [ ] GIVEN the commit fails, THEN the row shows an error state and an exception is raised — the packer is never left believing a failed order shipped.

---

### T-7.4 — Short pick and stock-out handling
**Depends on:** T-3.4, T-7.1 · **Resolves:** scope gap D

**Narrative**
As a picker, I want to report that stock is not there, so that the order can be re-planned instead of
me standing at an empty bin.

**Requirement**
Entirely absent from the FRD and the single most common real floor exception. On-device short-pick
action capturing quantity found and reason (empty, damaged, wrong item, blocked). Emits SHORT_PICK.
Downstream: trigger urgent replenishment; attempt re-allocation from an alternative bin or lot;
if unresolvable, flag the order for partial fulfillment or backorder per the configured policy;
notify the supervisor; adjust the pack screen's expected quantities.

**Acceptance**
- [ ] GIVEN a picker reports 3 found against 10 required, THEN a SHORT_PICK event records 3 and the reason, and the wave allocation reduces to 3.
- [ ] GIVEN alternative stock exists in another bin, THEN a follow-on pick task is generated automatically.
- [ ] GIVEN no alternative stock exists, THEN the affected order is flagged per the partial-fulfilment policy and the supervisor is notified.
- [ ] GIVEN a short pick, THEN the pack de-consolidation screen shows the reduced quantity, not the original demand.

---

### T-7.5 — Packing label and document generation
**Depends on:** T-7.3, T-0.3 (Q-06)

**Narrative**
As a packer, I want the label and packing slip to print when I pack an order, so that the carton can
move straight to despatch.

**Requirement**
Implement the mechanism decided in Q-06. Generate packing slip and shipping label on successful pack.
Define printer routing by pack station. Define reprint. Define behaviour when printing fails —
the pack must not be blocked, but the failure must be visible.

**Acceptance**
- [ ] GIVEN a successful pack, THEN a packing slip and label are produced and routed to the station's printer.
- [ ] GIVEN a print failure, THEN the pack still completes and a visible reprint action is offered.
- [ ] GIVEN a reprint request, THEN the identical document regenerates without creating a second fulfillment.

---

# PHASE 8 — Exception Handling & Chain of Custody

### T-8.1 — Exception generation and classification
**Depends on:** T-1.3, T-4.4 · **Resolves:** F-04 · **Implements:** AD-11

**Narrative**
As a warehouse supervisor, I want every failed or inconsistent event to land in a queue I can act on,
so that the ledger never quietly diverges from what is on the shelf.

**Requirement**
Every FAILED event creates a `customrecord_wms_exception` with type, severity, source event,
operator, bin, **location (`custrecord_exc_location`, from the source event — D-14)**, detected time and
a human-readable description of the conflict. Severity rules documented. CRITICAL exceptions notify
immediately; others aggregate into a supervisor digest. Deduplicate repeated failures of the same event
into one exception with a retry count.

**Acceptance**
- [ ] GIVEN a commit-time invariant violation, THEN exactly one INVARIANT_VIOLATION exception exists linked to the source event and naming the conflicting item and lot.
- [ ] GIVEN any exception, THEN its `custrecord_exc_location` is set from the source event, so the queue can be worked by the owning warehouse. *(D-14)*
- [ ] GIVEN one event failing three retries, THEN one exception exists with retry count 3 — not three exceptions.
- [ ] GIVEN a CRITICAL exception, THEN the named supervisor is notified within the configured interval.

---

### T-8.2 — Supervisor exception resolution Suitelet
**Depends on:** T-8.1, T-1.4 · **Resolves:** F-04

**Narrative**
As a warehouse supervisor, I want to retry, reverse or manually correct a failed event, so that I can
bring the system back into agreement with physical reality without a developer.

**Requirement**
Queue view filterable by type, severity, status, operator, age **and location (D-14 — a supervisor
works their own warehouse's queue)**. Actions: **Retry** (re-drive the
event — safe because of the UUID guard), **Reverse** (post a compensating movement), **Manual
adjust** (create an inventory adjustment with mandatory reason), **Write off**, **Escalate**. Every
action is audited with user, timestamp and notes. Bulk action on selected exceptions.

**Acceptance**
- [ ] GIVEN a FAILED event whose blocking condition has cleared, WHEN Retry is used, THEN it posts successfully and the exception closes.
- [ ] GIVEN Retry is used twice on the same event, THEN only one ledger transaction results.
- [ ] GIVEN Manual adjust without a reason, THEN the action is rejected.
- [ ] GIVEN any resolution, THEN user, timestamp, action and notes are recorded immutably.

---

### T-8.3 — Nightly event-to-ledger reconciliation
**Depends on:** T-8.1 · **Resolves:** F-04

**Narrative**
As a finance controller, I want daily proof that scan events and posted inventory agree, so that
drift is caught in a day rather than at stocktake.

**Requirement**
Scheduled script comparing POSTED events against the transactions they claim to have created:
POSTED events with no linked transaction; linked transactions with mismatched quantity; events stuck
PENDING or PROCESSING beyond threshold; bins holding more than one SKU or lot. Each discrepancy
raises a RECONCILIATION_DRIFT exception. Produces a daily summary report to finance and operations.

**Comparison grain** (`06-netsuite-boundary.md` §4). The reconciliation contract is:
`SUM(WMS bin quantities)` **must equal** NetSuite quantity on hand, for every item and location —
additionally per lot for LOT items.

**`availableForFulfilment: false` does NOT mean excluded from the sum (Q-16).** Stock in QUALITY,
RETURN, DEFECT, STAGE and RECEIVING bins is *unpickable*, but it is *physically present* and NetSuite
counts it in quantity on hand. It **must** be included in `SUM(WMS bin quantities)` or the contract
will falsely report drift equal to the quarantine volume. Do not let anyone "helpfully" filter
non-fulfillable bins out of reconciliation — availability and existence are different questions, and
this control is about existence. *(The mismatch that availability actually causes is on NetSuite's
side — it commits stock the WMS can't pick — and that is F-26, handled separately, not here.)*

**Bins themselves have nothing to reconcile against.** NetSuite has no bin dimension, so bin-level
correctness is unverifiable from outside the WMS. That raises the stakes on T-11.3 (bin state
backup) and on the mass-change alerting there.

> This control is **the primary defence, not a safety net.** Under D-07 a back-office user can move
> stock at location level with no bin attribution (F-20); reconciliation is what surfaces it.
> Bin movements post no NetSuite transaction by design (T-4.3) and must be **excluded** from the
> "POSTED with no linked transaction" check rather than flagged as drift.

**Acceptance**
- [ ] GIVEN a POSTED event with no linked transaction, WHEN reconciliation runs, THEN a RECONCILIATION_DRIFT exception is raised — **except** bin movements, which correctly post nothing.
- [ ] GIVEN a location, WHEN reconciliation runs, THEN WMS bin totals are compared to NetSuite quantity per item, and additionally per lot for LOT items.
- [ ] GIVEN a back-office adjustment made outside the WMS, THEN the resulting mismatch is detected and raised as an UNATTRIBUTED_MOVEMENT exception for physical resolution.
- [ ] GIVEN a bin holding two SKUs, THEN it is reported as an invariant breach regardless of how it arose.
- [ ] GIVEN a clean day, THEN the report is produced showing zero discrepancies — the report always runs, so silence is never ambiguous.

---

### T-8.4 — Chain of custody handoff
**Depends on:** T-6.3, T-3.4, T-1.3

**Narrative**
As a warehouse supervisor, I want a recorded handover from picker to packer, so that responsibility
for a tote is never ambiguous when something goes missing.

**Requirement**
Picker completes a wave, moves the cart to staging, scans the stage/tote barcode → wave status
`STAGED_FOR_PACKING`, custody log HANDOFF with picker ID, timestamp, stage bin, tote ID. Packer scans
the same barcode at their station → custody log ACCEPT, wave status Packing, responsibility
reassigned. **Add a REJECT path** (absent from the FRD): the packer can refuse a tote with a reason,
returning the wave to the picker and raising an exception. Support supervisor REASSIGN.

**Acceptance**
- [ ] GIVEN a picker scans the staging bin on completion and a packer then scans the same bin to accept, THEN a custody log entry records the transfer between the two employee IDs. *(FRD TC-CUS-01)*
- [ ] GIVEN a packer scans a tote not staged for them, THEN the scan is rejected with a clear message.
- [ ] GIVEN a packer rejects a tote with a reason, THEN the wave returns to the picker, a REJECT entry is logged and an exception is raised.
- [ ] GIVEN a wave, WHEN its custody history is viewed, THEN a complete ordered chain of handoffs is shown.

---

# PHASE 9 — Real-Time Dashboard

### T-9.1 — Metric snapshot aggregation
**Depends on:** T-4.1, T-1.3 · **Resolves:** F-11 · **Implements:** AD-12

**Narrative**
As the system, I want operational metrics pre-aggregated, so that supervisors watching a dashboard do
not consume the concurrency that pickers need to scan.

**Requirement**
The committer's `summarize` stage upserts `customrecord_wms_metric_snapshot` per operator and per
team on a configurable interval (default 15 minutes): lines picked, units picked, orders packed,
total scans, error scans, override scans, current task, zone. Roll snapshots up to daily after 30
days. The dashboard **never** queries the raw scan event table.

**Acceptance**
- [ ] GIVEN a completed interval, THEN snapshots exist per active operator with counts matching a hand-check against the underlying events.
- [ ] GIVEN the dashboard's data access path, THEN no query touches `customrecord_wms_scan_event`.
- [ ] GIVEN snapshots older than 30 days, WHEN rollup runs, THEN they are consolidated to daily granularity.

---

### T-9.2 — `wms_sl_dashboard.js` — operational dashboard
**Depends on:** T-9.1, T-1.2 · **Implements:** AD-12

**Narrative**
As a warehouse manager, I want live team and individual performance on one screen, so that I can
rebalance staff during the shift rather than after it.

**Requirement**
Per Doc B §2.6. **Team:** total open waves / pick tasks, active replenishment requests, orders staged
pending packing, on-time fulfillment %. **Individual:** pick rate (lines/hr and units/hr), pack rate
(orders/hr), scan accuracy % (per the T-1.2 formula), current active task and assigned zone.
**Additions justified by the review:** open exception count by severity, PENDING event backlog depth
and oldest age, replenishment tasks blocked. **Location filter (D-14): the dashboard is scoped to a
selected location (metric snapshots carry `custrecord_ms_location`); a multi-location view sums the
per-location snapshots, never the raw event table.** Configurable refresh, default 60 s. Charts follow
the `dataviz` skill conventions.

**Acceptance**
- [ ] GIVEN active operations, WHEN the dashboard loads, THEN every metric in §2.6 renders with data no older than the configured refresh interval.
- [ ] GIVEN a selected location, THEN every metric is filtered to that location's snapshots; a multi-location roll-up sums per-location snapshots. *(D-14)*
- [ ] GIVEN five supervisors with the dashboard open, WHEN scan load is at peak, THEN measured concurrency consumption stays inside the T-0.2 allocation.
- [ ] GIVEN an operator's pick rate on screen, THEN it reconciles to a manual calculation from their events for the same period.
- [ ] GIVEN an exception backlog above threshold, THEN it is visually prominent, not buried.
