# 01 — FRD Review Findings

Severity key: **S1** = will not work / data corruption · **S2** = will not scale or will fail in
production · **S3** = spec gap needing a decision · **S4** = code defect in the illustrative samples.

Every finding below has a corresponding task in `tasks/`. The `→` column gives the task ID.

---

## A. Correctness — the design can produce wrong inventory

### F-01 · S1 · Bin validation reads a source that is stale by design → `T-2.1`, `T-2.3`, `T-4.4`

> **Revised 2026-08-07 per D-01.** My first draft of this finding led on a concurrency race — two
> handhelds putting away to the same empty bin inside a cache TTL. TK's assessment that this is
> "very very unlikely" on a directed-putaway floor is **correct and accepted**; the bin lock has
> been removed from the ingestion path. But the underlying defect survives that correction in a
> stronger, single-operator form, set out below.

Doc A §2.2 caches `WMS_BIN_MAP` containing `currentSku`, `currentBatch` and `qty`, and
`wms_sl_scan_ingest.js` (the ingestion Suitelet) uses that value to decide whether a putaway violates the single-SKU rule.

The problem is not cache coherence. It is that **every available source of bin contents is wrong
during normal operation**, because this architecture deliberately defers ledger posting:

| Source | Why it is wrong |
|---|---|
| `N/cache` | Stale by its TTL |
| `inventorybalance` (live search) | Stale by the event-to-ledger queue latency — up to 5 minutes |
| Bin denormalised fields | Only as fresh as whatever last wrote them |

The failure mode needs no concurrency at all:

> 09:00:00 Operator A picks the last 10 units from bin U-01. Event queued. **The bin is now
> physically empty.**
> 09:02:00 Operator B is directed to putaway lot B into U-01. Every source above still shows lot A
> present. The putaway is **rejected** — the operator is standing at a visibly empty bin being told
> it is occupied.

One operator, two minutes apart, well outside TK's 30-second window. This is the *common* case, not
the edge case, and it generates false rejections that will erode floor trust in the system inside a
single shift. Tightening the cache TTL makes it worse, not better — a fresher read of
`inventorybalance` is a fresher read of data the pipeline has not caught up to.

**Correction adopted (AD-03, rewritten):** introduce a **bin state projection** —
`customrecord_wms_bin_state`, one row per bin holding `(itemId, lotNumber, qty, version)`. The
ingestion Suitelet updates it on accept; the commit stage reconciles it. It reflects *physical*
reality including not-yet-posted events, which is precisely what the operator needs and what neither
the cache nor the ledger can offer.

TK's 1-SKU/1-batch rule is what makes this cheap: bin state is four fields, not a collection, so the
projection is a single lightweight record read and a single field update. No lock, no live search,
no `inventorybalance` query on the operator's path.

`inventorybalance` remains the **financial** truth. The projection is the **operational** truth. They
are reconciled nightly (T-8.3), and divergence between them is itself a monitored signal.

### F-02 · ~~S2~~ **WITHDRAWN (D-12)** · The lock is possible but rejected on simplicity → *(no task; locks removed)*

> **Withdrawn 2026-08-09 per D-12.** The original finding was that `customrecord_wms_concurrency_lock`
> was defined but never acquired, and proposed the race-free pattern: mark the lock's key **unique**,
> attempt the create, loser catches the duplicate. That pattern **is** buildable — the record's standard
> **`externalid`** field is platform-unique (custom fields are not — that was the confusion). So a lock
> is possible; it is **rejected on simplicity**, not ruled out. The races it would guard are removed
> more cheaply: order commits serialised by AD-06 grouping + `PROCESSING` claiming; bin-affecting commit
> work single-threaded through one M/R queue (correct by construction, no TTL/reaper/deadlock handling).
> `customrecord_wms_concurrency_lock`, the reaper (was T-11.2) and `STALE_LOCK`/`LOCK_TIMEOUT` are
> deleted. See AD-04 (two-layer idempotency) and AD-05 (withdrawn by choice).

*Original analysis retained below for traceability — the defect it described (a lock record with no
logic) is real; the fix it proposed was sound and could be built on `externalid`, but a lock is not the
simplest way to remove these races.*

`customrecord_wms_concurrency_lock` had fields (`resource_type`, `resource_id`, `acquired_by`,
`acquired_time`) and no logic anywhere. The proposed race-free pattern — a unique key, attempt the
create — is realisable via `externalid`; D-12 chose single-threaded settlement instead.

### F-03 · S1 · No re-assertion of invariants between validation and posting → `T-4.4`, `T-8.1`

Ingestion validates. The Map/Reduce posts — seconds to minutes later. State changes in between.
Nothing in the FRD re-checks. The plan makes commit-time re-assertion mandatory and defines what
happens when it fails (F-04).

### F-04 · S1 · No reject/recovery path after an acknowledged scan → `T-8.1`, `T-8.2`, `T-8.3`

The FRD's failure handling is `custrecord_se_status = 'FAILED'` plus an error log. That is a dead
end. By the time an event fails, the operator has *physically moved the stock* and walked away
believing the move succeeded. There is no supervisor view, no alert, no re-drive, no reversal, and
no way for the floor to learn the ledger disagrees with reality.

This is the highest-risk gap in the document. Treated here as core scope: exception queue record,
supervisor resolution Suitelet, retry/replay with idempotency, escalation, and a daily
event-vs-ledger reconciliation report.

### F-05 · ~~S2~~ **RESOLVED** · Replenishment deadlock under the single-batch rule → `T-5.2`

> **Closed 2026-08-07 by D-03.** Retained for traceability; no longer a live risk.

Doc B §2.2 says replenishment prefers the same lot as the UNIT bin, and falls back to FEFO *only if
the UNIT bin is empty*. Combine with §2.1 (one bin = one lot):

> UNIT bin U-01 holds 4 units of lot A (below trigger). BULK has no lot A left — only lots B and C.

Same-lot sourcing is impossible. FEFO fallback is blocked because the bin is not empty. Single-batch
blocks putting lot B on top of lot A. As written, the pick face cannot be replenished.

**Resolution (D-03):** replenishment simply does not fire when there is no bulk. Picking falls
through to **any bin holding that SKU**, batch by batch, FEFO ordered; when those are exhausted the
SKU is out of stock. No blocked task, no escalation — out of stock is a normal inventory state.
The deadlock existed only because the original reading assumed picking was confined to the pick
face. It is not.

### F-06 · S2 · Summary picking assumes one lot per SKU per wave → `T-7.1`, `T-7.2`

§2.4's worked example consolidates 36 units of ABC123 into one pick, and the de-consolidation mock
shows all four orders on `BATCH-2026-08A`. But under single-SKU/single-batch bins, 36 units may live
across a UNIT bin (10 of lot A) plus multiple BULK bins (lots B, C). The "single Total Quantity Pick
Task per SKU/Lot per location" wording actually implies **one task per SKU *per lot***, which
contradicts the single-consolidated-action example.

**Resolved 2026-08-07 by D-03.** Since a bin holds exactly one batch, demand spanning several bins
*necessarily* spans several batches — so summary picking is **one task per SKU per bin (hence per
batch)**, not one task per SKU. The FRD's "36 units in one action" holds only where one bin carries
all 36; otherwise three bins means three tasks, and that is correct rather than a failure.
Allocation across bins is **FEFO**, and an order may split across batches. The de-consolidation pack
screen must therefore treat **multiple batch rows under one SKU summary as the normal case**.

### F-18 · S3 · The bin isolation rule cannot apply to staging bins — and staging bins have no type → `T-1.3`, `T-2.3`, `T-8.4`

*Raised 2026-08-07, arising from D-05.*

Doc B §2.1 scopes the 1-SKU/1-batch rule to bins "designated as a UNIT or BULK bin", and §4.1 gives
`custrecord_wms_bin_type` exactly two values: Unit and Bulk. But §2.5 has the picker scan a
**staging location / tote barcode** (`TOTE-STAGE-01`) to hand off a completed wave — and a wave is by
definition a mixed pile of many SKUs and many lots.

So the schema has no type for the staging bin, and if anyone assigns it UNIT or BULK to satisfy the
field, **the custody handoff in §2.5 will be blocked by the constraint in §2.1**. The two sections
contradict each other. The same applies to receiving docks and QC hold areas, neither of which is
mentioned anywhere.

**Correction (AD-14):** bin *type* carries a *policy*, rather than the rule being a constant in
code. UNIT and BULK carry `singleSku: true, singleBatch: true, availableForFulfilment: true`; STAGE,
RECEIVING, QUALITY, RETURN and DEFECT carry `unrestricted, availableForFulfilment: false` (Q-16,
closed 2026-08-09). This resolves the contradiction, covers the missing bin types, and makes any future
change to the bulk-bin rule a configuration edit instead of a rebuild — which is the flexibility
requested in D-05.

---

## B. Scale — the design will not hit its own numbers

### F-07 · S2 · The <150 ms / <300 ms SLA is not attainable as a server round-trip → `T-3.1`, `T-12.2`

A NetSuite Suitelet (or RESTlet — same round-trip floor) doing authentication, one custom-record save
and returning JSON is realistically
**250–800 ms** at P95 from a warehouse Wi-Fi handheld, before any of the work Doc A also puts in that
call. The sample code additionally runs a saved search (F-08) inside the same request.

The stated operator experience *is* achievable — but only by making the **handheld client
optimistic**: it renders success and advances the operator to the next task on local validation, and
syncs the event in the background with a durable outbound queue. That is a client architecture
decision, not a server tuning problem, and it is not in the FRD.

**Re-baselined targets in this plan:** UI acknowledgement to operator < 150 ms (local, client-side);
server ingestion P95 < 600 ms, P99 < 1200 ms; event → ledger posting P95 < 5 min.

### F-08 · S2 · Idempotency check costs a saved search on every scan → `T-2.4`

`isDuplicateEvent()` runs `search.create().run().each()` per POST — 10 governance units and a
database read on the hot path, contradicting Doc A's own "2–4 governance units per scan" claim in
the §5 matrix.

**Correction *(refined by D-12)*:** the original fix made a *custom* field unique and caught the
violation on insert. Custom fields are **not** platform-unique — but the record's standard **`externalid`**
**is** (D-12). So the fix stands, on the right field: ingestion sets `externalid` = UUID and attempts the
create; a duplicate fails at the platform (`DUP_RECORD`) and is caught → `idempotent:true`. Zero hot-path
reads, correct under concurrency. A **committer-side dedupe** (group by UUID, keep first, rest
`SUPERSEDED`) is kept as a **safety net** (AD-04 layer 2), so even a duplicate that slips past never
becomes a duplicate *ledger posting*.

### F-09 · S2 · Concurrency, not governance, is the binding constraint → `T-0.2`, `T-3.2`, `T-12.1`

Doc A's §5 matrix frames the problem as governance units. It isn't. Suitelet (and RESTlet) governance
is 1,000 units per *invocation* and a scan costs ~4–14; you will never approach it. The real ceiling is
**concurrent request slots**, which SuiteCloud Plus grants in increments and which are shared across
handhelds, Map/Reduce queues, scheduled scripts, the dashboard, and every other integration in the
account.

At 25 scans/sec with a 500 ms server time you need ~13 slots *for scanning alone*. Add M/R queues,
CSV imports, the dashboard, and any existing integrations, and the account budget is the thing that
breaks first. `SSS_REQUEST_LIMIT_EXCEEDED` (HTTP 429) is the failure mode.

**Required and missing from the FRD:** a written concurrency budget allocating slots by workload, and
a client-side queue with exponential backoff + jitter that treats 429 as normal, not exceptional.

### F-10 · S2 · Wave clustering is O(n²) greedy in a Scheduled Script → `T-6.1`, `T-6.2`

`clusterOrdersByCommonality` compares every order pair. At 5,000 pending orders that is ~12.5 million
Jaccard computations plus set construction, in a Scheduled Script with a 1-hour ceiling and 10,000
governance units. It will time out.

It is also not really clustering: it is first-come greedy, so results depend on internal-ID order;
there is **no cluster size cap**, so a high-frequency SKU can pull hundreds of orders into one
"wave" larger than any physical pick cart; and there is no zone, carrier, ship-date or priority
constraint.

**Correction:** invert the problem — build a SKU→orders index and only compare orders that share at
least one SKU (candidate generation), run it as a Map/Reduce, and constrain clusters by cart
capacity (tote positions), zone, and ship-by date.

### F-11 · S3 · Real-time dashboard polling will consume the concurrency budget → `T-9.1`

"Real-time" Suitelet dashboards refreshed by several supervisors are a steady concurrency drain
competing with the scan traffic (F-09). Metrics like pick rate and scan accuracy also require
aggregation over the event table, which is the largest table in the system.

**Correction:** the Map/Reduce `summarize` stage maintains a pre-aggregated metrics record; the
dashboard reads that, not the raw event table. Refresh interval configurable, default 60 s.

---

## C. Defects in the illustrative code samples

These are in the FRD's sample scripts. Listing them so they are not carried into the build.

### F-12 · S4 · Map/Reduce group key splits incorrectly on underscore → `T-4.1`

```js
const groupKey = `${eventType}_${orderId || 'INTERNAL'}`;   // "REPLEN_MOVE_INTERNAL"
const keyParts = reduceContext.key.split('_');
const eventType = keyParts[0];   // "REPLEN"  ← wrong
const orderId   = keyParts[1];   // "MOVE"    ← wrong
```

`REPLEN_MOVE` and `BIN_TRANSFER` both contain underscores, so every replenishment and bin transfer is
mis-routed. Use a JSON key or a delimiter that cannot occur in the enum (e.g. `|`).

### F-13 · S4 · Bin Transfer sets `location` to a bin internal ID → `T-4.3`

```js
binTransfer.setValue({ fieldId: 'location', value: events[0].values.custrecord_se_source_bin.value });
```

`location` expects a Location internal ID; a Bin ID is passed. Also the reduce key does not include
location, so events from different locations can be grouped into one Bin Transfer, which cannot save.

### F-14 · S4 · Fulfillment line matching breaks on duplicate items and partial picks → `T-4.2`

`processFulfillmentBatch` loops SO lines, matches the first line with the same item, `break`s, and
sets `quantity = qty` from a *single* event. Consequences:

- An SO with the same item on two lines (kitting, different price levels) only ever fulfills line 1.
- Multiple scan events for the same line **overwrite** rather than accumulate.
- Lines with no scan events are left at their transform default (full quantity) rather than being
  zeroed — so unpicked lines get shipped on paper.

Correct approach: aggregate events → `Map<lineUniqueKey, {qty, lots[]}>` first, then walk the
fulfillment sublist once setting `itemreceive` true/false and quantity from the aggregate, defaulting
every unmatched line to `itemreceive = false`.

### F-15 · S4 · Same Sales Order can be transformed twice → `T-4.1`

Grouping by `${eventType}_${orderId}` puts `PICK_1234` and `PACK_1234` in different reduce keys, so
two reduce threads may both call `record.transform` on SO 1234 — producing either a duplicate Item
Fulfillment or the very `RCRD_HAS_BEEN_CHANGED` the architecture exists to eliminate. Group by
**order**, not by event type + order.

### F-16 · S4 · Similarity threshold has three different values → `T-6.1`

Doc B §2.3 says ≥ 60%; test case TC-WAV-01 says ≥ 50%; the code passes `0.50`. Must be a single
configurable parameter on a WMS settings record.

### F-17 · S4 · Reduce-stage governance is not managed → `T-4.5`

A reduce invocation gets 5,000 units. `record.transform` + inventory detail subrecord writes + save
on a large multi-line order, times several orders in one key, can exceed it. Needs
`runtime.getCurrentScript().getRemainingUsage()` checks and a yield/re-queue strategy.

---

## D. Scope that is referenced but never specified

Each of these is either a task in the plan or an open question. None of them can be silently skipped.

| Gap | Impact | Where handled |
|---|---|---|
| **The handheld application itself** | Largest single work item; Doc A assumes it exists | Phase 3, Q-01 |
| **Operator authentication** ~~(TBA vs OAuth 2.0)~~ | *Resolved by D-19 — Option C: Available-Without-Login Suitelet, hashed-PIN operator login, HMAC session token; no per-operator NetSuite user. See F-27* | `T-3.3` (Q-02 subsumed) |
| **Short pick / stock-out handling** | The #1 real floor exception. Completely absent | `T-7.4` |
| **Receiving & putaway** | §2.1 says "before committing any receipt, putaway…" — flow never defined | Q-05 |
| **Cycle counting** | `COUNT` is in the event type enum with no specification | Q-05 |
| **Returns / RMA putaway** | Not mentioned; lot + bin isolation implications | Q-05 |
| **Packing label / packing slip printing** | §2.4 "triggers packing label generation" — no printer integration spec | `T-7.5`, Q-06 |
| **UOM conversion** | Cache holds base UOM + conversion factors; nothing uses them. Do pickers scan eaches against case-UOM orders? | Q-07 |
| **Bin data remediation** | If migrated bins are mixed-SKU, go-live is blocked. **T-0.4 answered — case (b):** bin data migrates from a third-party app, so Phase 10 is a migration (audit the export for compliance, plan cutover freeze / delta reconciliation) — not greenfield slotting | Phase 10 |
| **Security roles & permissions** | Picker/packer/supervisor role design absent | `T-1.4` |
| **Multi-location / multi-subsidiary** | Every flow implicitly single-location | Q-08 |
| **Event archiving retention** | 7-day purge stated; audit/compliance requirement unconfirmed | `T-11.1`, Q-09 |
| **Scan accuracy metric source** | Requires OVERRIDE / SHORT_PICK / EXCEPTION event types not in the enum | `T-1.2`, `T-9.2` |
| **Wave release, cancellation & re-planning** | What happens when an order in an active wave is cancelled or amended? | `T-6.4` |

### F-19 · S1 · The code annex writes bin numbers that will never be valid → `T-2.7`, `T-4.2`, `T-4.3`

*Raised 2026-08-07; rewritten 2026-08-08 per D-07.*

Every inventory-writing sample in the FRD sets `binnumber` on an `inventoryassignment` subrecord
line — in `processFulfillmentBatch`, `processBinTransferBatch` and the pack Suitelet — and
`processBinTransferBatch` creates a `record.Type.BIN_TRANSFER` outright.

Under D-07 **NetSuite has no bins at all**, so none of this can ever work: no Bin Management
feature, no `binnumber` field to write, no Bin Transfer record type to create. This is not a tier
limitation to be configured around; it is code targeting a dimension that does not exist in the
target account and never will.

> *Superseded reasoning:* the previous revision framed this as a five-tier licensing problem
> (basic Bin Management cannot associate lots with bins; Advanced Bin / Numbered Inventory
> Management required). D-07 removes the question by removing NetSuite bins from the design
> entirely. That analysis is retained in `05-decisions-log.md` D-06 for traceability only.

**Correction (AD-16):** the ledger interface is three transaction shapes — Item Fulfillment,
Inventory Adjustment, Inventory Transfer — and bin movements post nothing. The only variability is
per-item tracking mode (PLAIN / LOT / SERIAL), resolved from the item record by the adapter (T-2.7).
`binnumber` appears nowhere in the codebase.

### F-20 · S2 · Back-office movements cannot be attributed to a bin → `T-10.2`, `T-8.3`

*Raised 2026-08-08, arising from D-07.*

A back-office user posting an Inventory Adjustment, Item Fulfillment or Item Receipt directly in
NetSuite changes quantity at the **location** level. Because NetSuite has no bin dimension, there is
no way — even in principle — to know which bin the stock left or entered.

Nightly reconciliation (T-8.3) will correctly detect that WMS bin totals no longer match the
NetSuite location total. It **cannot resolve the discrepancy**, because the information required was
never captured anywhere. Resolution means somebody physically walking the warehouse.

Previously a `beforeSubmit` User Event could validate against NetSuite's own bin dimension. That
option is gone, so the control changes shape (`06-netsuite-boundary.md` §6):

1. **Policy** — all inventory movement for WMS-managed locations goes through the WMS.
2. **Enforcement** — `beforeSubmit` **blocks** direct posting against a WMS-managed location unless
   WMS-originated or performed under an audited override role.
3. **Fallback** — an override raises an `UNATTRIBUTED_MOVEMENT` exception for physical resolution.

This is the largest operational risk D-07 introduces, and it is managed by process at least as much
as by code.

### F-21 · ~~S2~~ **CLOSED** · Serial items break the throughput model → `T-0.1`, `T-2.7`

> **Closed 2026-08-08 by D-08 — serial numbers are out of scope.** Retained for traceability. The
> analysis stands and should be re-read if serialised items are ever brought into scope, because the
> scan-volume effect is large and non-obvious.

Doc A sizes everything on ~one scan per order line. Serial items need one scan per *unit*, so a line
for 10 serialised units is 10 scans. At 20% serial lines averaging quantity 5 that would have been
50,000 extra scans a day — **double the assumed volume** — silently invalidating the concurrency
budget, the load-test profile and the staffing model.

**Residual requirement:** tracking modes reduce to **PLAIN** and **LOT**. But a serialised item may
still *exist* in the NetSuite account, and if one reaches a WMS-managed location the commit will
fail in a confusing way. T-2.7 must **detect and reject** a serialised item explicitly, with a clear
exception, rather than attempting to post it. T-0.1 confirms none are present in scope.

### F-22 · S1 · WMS allocation can hand out stock NetSuite has already committed elsewhere → `T-6.2`, `T-7.1`, `T-4.2`

*Raised 2026-08-08, arising from D-10.*

NetSuite commits inventory to sales orders at the **location** level — that is what drives
availability, backorder behaviour and the promise made to the customer. The WMS allocates at the
**bin and lot** level, and under D-10 it is the primary inventory tool.

Nothing in the FRD connects the two. The wave engine (§2.3) clusters "unfulfilled Sales Orders" with
no reference to commitment status, and the summary pick allocator assigns bin stock with no check
that NetSuite has reserved that quantity for those orders.

The failure is not a quantity error — totals stay correct — it is an **attribution** error:

> SO-1001 has 10 units committed by NetSuite. The wave engine, looking only at open demand, builds a
> pick for SO-1002 and consumes the same 10 physical units. Both orders now believe they are
> covered. One customer's promised stock has shipped to another, and NetSuite's availability figures
> were right up until the WMS quietly contradicted them.

**Correction (AD-17):** the WMS allocates **within** NetSuite's commitment, never around it. Wave
eligibility filters on committed quantity; picked quantity per line may not exceed committed
quantity; and where commitment changes after a wave is released, the wave is flagged (T-6.4). The
WMS's bin/lot choice is a *refinement* of a decision NetSuite has already made — not an independent
one.

### F-23 · S2 · Asynchronous posting collides with the accounting period → `T-4.6`, `T-11.4`

> **Narrowed 2026-08-08 by D-11.** The original finding raised three things: period boundary,
> costing sequence, and negative inventory. **The costing-sequence half is withdrawn** — TK's ruling
> is that NetSuite runs costing and the WMS does not design around it. We supply quantity, date and
> lot; NetSuite computes cost however the account is configured. That is a clean division and it
> removes a build requirement. **Negative inventory moves to F-25** under its own rule. What remains
> is the period boundary, which is not a costing-method question at all.

The architecture defers ledger posting by up to five minutes. A pick scanned at 23:58 on the last
day of a period, posted at 00:04, lands in the **next** period. At month end that is misstated COGS
and a reconciliation somebody has to unpick by hand. Nothing in the FRD addresses posting dates.

Worse: if the period has been **closed** in the interim, the transaction cannot post to it at all —
NetSuite will reject it outright. That is not a preference, it is a hard stop, and it turns a
six-minute queue delay into a stuck event.

**Correction (AD-17):**

- Post transactions dated by **scan time**, not commit time, whenever that period is open. NetSuite
  then costs it as of the correct date without the WMS having any opinion about how.
- **Period-close drain (T-11.4):** the queue is drained and verified empty before a period closes —
  a documented, monitored finance procedure rather than an informal habit.
- Where the scan-time period has already closed, post to the current period **and raise a
  `CLOSED_PERIOD_POSTING` exception**, so finance sees it rather than finding it in a variance
  report.

### F-25 · S2 · Negative inventory is legitimate in the WMS and forbidden in NetSuite → `T-4.7`, `T-5.8`, `T-2.3`

*Raised 2026-08-08, arising from D-11.*

TK's rule: **the WMS may go negative; NetSuite may not.** That asymmetry is deliberate and correct —
the floor is allowed to be ahead of the books, because the operator has physically moved stock the
ledger has not caught up with. But it has three consequences the design must handle explicitly.

**1. Outbound must never be allowed to drive NetSuite negative.** A fulfillment whose supporting
receipt has not yet posted cannot simply be attempted and allowed to fail. It must be **deferred and
retried**, not failed — the work was legitimate, only the sequence is wrong. This needs a new
`DEFERRED` event status distinct from `FAILED` (AD-18).

**2. Negative bin quantity is diagnostic, not merely permitted.** A bin at −3 means one of: an event
double-counted, stock removed without scanning, a receipt never captured, or a count error. It should
not block the floor, but it must not be silent either. Small transient negatives during the queue
window are normal; **persistent or large negatives are an exception** (`NEGATIVE_BIN_STATE`) with
thresholds on magnitude and age.

**3. Negative interacts with the bin isolation rule, and the naive reading is wrong.** A bin at
−3 of SKU A has `qty <= 0`, so a literal "empty bin accepts anything" test would let SKU B be put
away into it — compounding one error with another and losing the evidence needed to diagnose the
first. **A bin with negative quantity is treated as occupied and anomalous**, not empty: it accepts
only the SKU and lot already recorded against it, until a supervisor resolves it.

### F-24 · S2 · No ordering guarantee between receipt and consumption → `T-5.8`, `T-4.7`

> **Simplified 2026-08-08 by D-11.** The original correction proposed a per-`(item, location)`
> dependency graph. TK's rule is blunter and better: **inbound always posts before outbound.** A
> global two-phase priority replaces the dependency tracking entirely — less code, easier to reason
> about, and no per-item bookkeeping to get wrong.

With inbound flowing through the WMS (D-09), stock can be received and picked within the same few
minutes. Both are events in the same queue, and the Map/Reduce processes groups **in parallel with
no ordering guarantee** — so the Item Fulfillment that consumes the stock can post before the Item
Receipt that created it.

Because NetSuite may not go negative (F-25), that is not a cosmetic ordering problem. It is a hard
rejection, hours after an operator did everything correctly.

**Correction (AD-18):** every committer cycle runs in two phases — **all inbound events, then all
outbound events.** Any outbound event that still cannot be satisfied is **deferred and retried**,
never failed on first attempt; only after a configured number of cycles does it become an exception.

### F-26 · S2 · Non-fulfillable bins make NetSuite over-commit → **tracked as Q-29** *(with sponsor — do not implement)*

*Raised 2026-08-09, arising from Q-16 / D-16 (`availableForFulfilment`). The decision is tracked in
the register as **Q-29**; this finding is the analysis behind it.*

Bins of type QUALITY, RETURN, DEFECT (and STAGE, RECEIVING) hold stock that is physically present but
**not pickable** — the WMS will not allocate from them (`availableForFulfilment: false`, enforced in
T-7.1 / T-5.2 / T-5.4). NetSuite, however, has no bin dimension: it counts that stock toward quantity
on hand at the location and **will commit it to sales orders.** The result is that NetSuite promises
stock that cannot ship, and those orders **short-pick.**

This is the **mirror of F-22.** There, the WMS allocated *beyond* NetSuite's commitment (attribution
error, WMS over-reaching). Here, NetSuite commits *beyond what the WMS can allocate* (availability
error, NetSuite over-reaching). Both break the AD-17 two-layer contract from opposite directions, and
this one matters precisely *because* AD-17 makes NetSuite the commitment authority — its availability
figure has to be true.

**Three options, recommendation (a). With the sponsor — not to be implemented until ruled on:**

- **(a) RECOMMENDED — a separate NetSuite location for non-fulfillable stock.** Moves across the
  fulfillable boundary (e.g. QC release into pickable stock) post an **Inventory Transfer** between
  locations; moves *within* a location still post nothing (D-07). NetSuite availability becomes
  correct, which is what AD-17 needs.
- **(b) Same location, accept over-commitment, lean on short-pick handling (T-7.4).** NetSuite
  availability is then wrong by the quarantine volume, **permanently** — every day, not transiently.
- **(c) NetSuite inventory status** to mark quarantine stock unavailable — an Advanced Inventory
  feature, **likely unavailable** in the target account; confirm in T-0.1 if pursued.

Option (a) has a build consequence to note when ruled on: a second location means the WMS↔NetSuite
boundary carries genuine location-to-location Inventory Transfers (T-2.7, T-4.3), which also touches
Q-08 (multi-location scope).

### F-27 · S2 · Internet-exposed unauthenticated write endpoint → `T-3.3` *(accepted, mitigated)*

*Raised 2026-08-09, arising from D-19 (auth Option C).*

Option C serves the SPA and its API from an **Available Without Login** Suitelet so operators need no
NetSuite user (removing 50 licences — Q-30). The consequence: a **publicly reachable, unauthenticated
(at the platform level) endpoint now fronts inventory event creation.** The FRD never contemplated
this — it assumed authenticated device connections.

**Accepted deliberately** — the licence saving is real and the exposure is manageable — but only
**because it is mitigated in application code** (T-3.3): hashed-PIN operator login, HMAC-signed session
tokens with expiry, per-token/per-IP rate limiting, IP allowlisting where feasible, an execute-as-role
that can only create scan events and read reference data, and audit logging. **This finding must be
carried into the pre-go-live security review** (the endpoint is the largest new attack surface the
programme introduces) and re-tested whenever the auth code changes.

---

## E. What the FRD gets right

Worth stating plainly, because the shape of this design is sound:

- **Event sourcing is the correct answer** to NetSuite ledger contention at this volume. Decoupling
  the scan from the post is not over-engineering here; it is the only thing that works.
- **UUID idempotency keyed from the client** is exactly right for a warehouse with flaky Wi-Fi.
- **Caching static reference data** genuinely does remove the governance and latency cost of
  per-scan `N/search` lookups — the problem is only *what* was put in the cache (F-01).
- **Aggregating many scan events into one `record.transform` per order** is the correct mitigation
  for `RCRD_HAS_BEEN_CHANGED`.
- **Single-SKU/single-batch bins** massively simplify pick accuracy and lot traceability. It is an
  opinionated, operationally expensive choice — but it is a coherent one, and the FRD applies it
  consistently.
- **Item-commonality wave clustering** with a Jaccard index is a legitimate, well-chosen heuristic;
  the problem is implementation scale (F-10), not the idea.
