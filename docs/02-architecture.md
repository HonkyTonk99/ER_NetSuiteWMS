# 02 — Architecture Decisions

Decisions that override or extend the FRD. Each carries the finding it resolves.

---

## AD-01 — Three-tier event pipeline (confirms FRD)

Retained as specified: **Ingest → Stage → Async commit.** Nothing on the operator's critical path
touches a NetSuite transaction record.

```
PWA (optimistic UI, IndexedDB durable queue; served by a Suitelet — D-13)
   │  POST to sibling Suitelet   (same origin; HMAC session token — D-12/T-3.3, no TBA)
   ▼
Ingestion Suitelet  wms_sl_scan_ingest   ~≤600ms P95   (D-19: Suitelet, not RESTlet)
   │  advisory validation against static cache
   │  INSERT customrecord_wms_scan_event  status=PENDING, externalid = client UUID  ← AD-04 layer 1
   ▼
Scan Event table (append-only, immutable except status)
   │
   ▼
Map/Reduce ledger committer   (SuiteCloud Plus)
   │  dedupe by UUID (keep first, rest SUPERSEDED)   ← AD-04 layer 2 (safety net)
   │  group by ORDER (not event type); bin-affecting work on ONE queue  ← AD-05 (locks rejected, D-12)
   │  RE-ASSERT invariants vs live inventory  ← authoritative
   │  one record.transform per order
   ├── success → status=POSTED, link to txn
   └── failure → status=FAILED + Exception record → supervisor queue
```

## AD-02 — Cache holds static data only *(revised per D-01)*

| Cache key | Contents | Mutability | TTL |
|---|---|---|---|
| `WMS_ITEM_<sku>` | internal ID, description, base UOM, conversion factors, **tracking mode (PLAIN / LOT)** | static | 30 min |
| `WMS_BINMETA_<binId>` | bin name, bin **type**, **bin policy** (AD-14), location, zone | static | 30 min |
| `WMS_REPLEN_<binId>` | trigger qty, optimum qty, linked bulk zone | semi-static | 15 min |
| `WMS_CONFIG` | thresholds, capacities, TTLs, batch sizes | semi-static | 5 min |

**Still explicitly not cached:** bin contents or quantity. Not because of cache coherence — TK is
right that operator collisions are not a credible risk — but because bin contents now live in a
projection record that is cheap to read directly and must never be shadowed by a second, staler copy
(AD-03).

## AD-03 — Bin state projection *(rewritten per D-01, replaces two-stage enforcement)*

The previous version of this decision proposed advisory validation at ingestion plus a locked,
live `inventorybalance` re-check at commit. **Withdrawn.** It was expensive, and it did not solve
the actual problem — that during the event-to-ledger window *every* source of bin contents,
including a live ledger query, is behind physical reality (F-01, revised).

**`customrecord_wms_bin_state` — one row per bin:**

| Field | Purpose |
|---|---|
| `custrecord_bs_bin` | Bin (unique) |
| `custrecord_bs_item` | Current SKU, or empty |
| `custrecord_bs_lot` | Current batch, or empty. Unused for PLAIN items |
| `custrecord_bs_qty` | Current physical quantity |
| `custrecord_bs_version` | Monotonic counter for optimistic concurrency |
| `custrecord_bs_last_event` | Last scan event applied |
| `custrecord_bs_pending_delta` | Quantity in accepted-but-unposted events |

TK's 1-SKU/1-batch rule is what makes this viable: bin state is four scalar fields, not a
collection. Reading it is one lightweight record lookup; updating it is one field write.

Serial numbers are **out of scope** (D-08), so bin state stays scalar for every item: four fields,
no collections, no child records.

**How it is used:**

- **Ingestion** reads the projection, applies the bin's policy (AD-14), accepts or rejects, then
  updates the projection with the accepted delta. No lock, no search, no `inventorybalance` query on
  the operator's path.
- **Commit** applies the ledger posting and reconciles the projection, clearing `pending_delta`.
  Bin-affecting commit work runs on a **single Map/Reduce queue** (AD-05, withdrawn locks per D-12),
  so two threads never target the same bin — the machine-machine race is removed structurally, not
  locked against.
- **Nightly reconciliation** (T-8.3) compares projection against `inventorybalance`. They should
  agree once the queue is drained; persistent divergence is a monitored signal and raises an
  exception.

**Division of truth:** the projection is the **operational** truth — what is physically on the shelf
right now, including work the ledger has not caught up to. `inventorybalance` remains the
**financial** truth. Neither is subordinate; they answer different questions and are reconciled.

**Optimistic version check, not an atomic compare-and-set** *(amended 2026-08-09 — wording correction)*:
SuiteScript offers no atomic compare-and-set. The ingestion update is a **read-check-write**: read
`custrecord_bs_version`, evaluate, then write with the incremented version. Two ingestion writes to
the same bin that interleave between another's read and write can therefore **lose an update** — the
window is real, not eliminated. It is narrowed by re-reading and re-evaluating once on a detected
mismatch, not closed.

**The residual risk is bounded and accepted, by design — do not build a heavier primitive to close it:**

- The window exists **only on the ingestion path.** Bin-affecting commit work is **single-threaded
  through one Map/Reduce queue** (D-12, single-threaded bin-state settlement), so there is no
  machine-machine race there.
- On ingestion the colliding parties are two operators, and **D-01 rules operator-to-operator
  collision on a directed floor not a credible risk.** A lost update here needs two operators writing
  the same bin in the same sub-second window.
- **Nightly reconciliation (T-8.3) is the backstop** — a lost update surfaces as projection-vs-ledger
  divergence and is caught within a day.

A distributed lock or a heavier concurrency primitive on the ingestion path would re-introduce exactly
the cost D-01 removed, to close a window the backstop already covers. It is deliberately not built.

## AD-04 — Two-layer idempotency: `externalid` primary, committer dedupe safety net *(rewritten per D-12)*

Custom fields have no value-uniqueness constraint, but the record's **standard `externalid`** field
**is** platform-enforced unique (D-12). Idempotency uses it, with a committer safety net:

- **Layer 1 — `externalid` = client UUID (primary guard).** Ingestion sets `externalid` to the scan's
  UUID and attempts the create. A duplicate UUID **fails at the platform** (unique `externalid`) and is
  caught → return success/idempotent. No pre-read, no hot-path search.
- **Layer 2 — committer-side dedupe (safety net).** When the committer groups events (AD-06) it groups
  by UUID first: keep the earliest, mark the rest **`SUPERSEDED`**, post from the survivor. So even if a
  duplicate ever lands (e.g. an `externalid` write path that bypassed layer 1), it never becomes a
  duplicate **ledger posting**.

```
ingest:  create with externalid = UUID → { status:'SUCCESS', eventId }
         catch DUP_RECORD (externalid)  → { status:'SUCCESS', idempotent:true }   // safe retry
         catch other platform error     → { status:'ERROR', code, message, retryable:true|false }

commit:  group by UUID → keep first, mark rest SUPERSEDED → post once   // safety net
```

Client UUIDs are v4, generated **before** the first send attempt and reused verbatim on every retry of
that scan — so all retries of one scan share a UUID and collapse to one posting at **both** layers.

## AD-05 — *(WITHDRAWN per D-12 — rejected on simplicity, NOT impossible)* No distributed locks

**Withdrawn — by choice, not for lack of a primitive.** A lock *could* be built on `externalid`
(acquire = create a lock record whose `externalid` is the resource id; the loser catches the
duplicate). It is **rejected because the races it would guard are removed more simply**, so the lock
adds cost (TTL, reaper, deadlock ordering, stale-lock handling) for no benefit. *If a future reader
finds `externalid` and thinks "the lock was possible after all" — yes, it was; it was still the wrong
choice.*

- **Order commits** are serialised by AD-06 (all of an order's events land in one reduce invocation)
  plus flipping claimed events to `PROCESSING`. No order lock needed — this was always independent of
  the uniqueness question.
- **Bin-affecting commit work** runs **single-threaded through one Map/Reduce queue** — *single-threaded
  bin-state settlement* — correct **by construction**: one thread, so two threads never target the same
  bin. Under D-07 bin movements post nothing to NetSuite, so the serialised path is cheap. The cost is
  lost parallelism on that phase; accepted (D-12).

`customrecord_wms_concurrency_lock`, the stale-lock reaper (was T-11.2), and the `STALE_LOCK` /
`LOCK_TIMEOUT` exception types are **deleted**. Ingestion still takes no lock.

## AD-06 — Reduce grouping by order, not by event type (resolves F-12, F-15)

Group key is a JSON string, not underscore-delimited:

```js
// fulfillment work
JSON.stringify({ k: 'ORDER', orderId })
// inventory moves
JSON.stringify({ k: 'MOVE', locationId, sourceBinId })
```

All PICK and PACK events for one order land in **one** reduce invocation → one `record.transform`
→ no duplicate fulfillment, and one order settled by one invocation. Move events are grouped by location +
source bin so the Bin Transfer is constructible.

## AD-07 — Fulfillment line aggregation (resolves F-14)

Reduce stage builds `Map<lineKey, { qty, lotAllocations[] }>` from all events **before** touching the
fulfillment record, then walks the sublist exactly once:

- line has aggregate → `itemreceive = true`, quantity = aggregate, inventory detail from lots
- line has no aggregate → `itemreceive = false` (explicitly, never left at transform default)
- aggregate exceeds ordered qty → do not post; raise an over-pick exception

## AD-08 — Concurrency budget, published and enforced (resolves F-09)

A written allocation of the account's concurrent request slots, owned as a living document:

| Workload | Reserved slots |
|---|---|
| Handheld scan ingestion | *n* (largest share) |
| Map/Reduce ledger commit | *m* queues |
| Wave clustering M/R | 1 queue, off-peak window |
| Dashboard + Suitelets | small fixed |
| Existing integrations | as-is, must be measured first |
| Headroom | ≥ 20% |

Actual numbers are set in `T-0.2` after measuring the account. The client treats HTTP 429 /
`SSS_REQUEST_LIMIT_EXCEEDED` as an expected condition: queue, back off exponentially with jitter,
never drop, never duplicate (the UUID makes retry safe).

## AD-09 — Offline-first handheld *(elevated per D-04)*

Previously framed as an optimistic-UI resilience measure. **Reframed as an architectural mandate:**
per TK, connection failure on the floor is *guaranteed*, so the handheld is designed to work with no
network at all and to treat connectivity as an intermittent bonus rather than a precondition.

**Five capabilities, in dependency order:**

1. **Local master-data cache.** Assigned tasks plus the item, bin, lot and policy subsets needed to
   validate every scan the operator could plausibly make during a shift — resolved and pushed at
   sync, not fetched on demand. A scan the device cannot validate locally is a design failure.
2. **Local validation and instant feedback.** Success renders and advances in < 150 ms with the
   radio off.
3. **Durable outbound queue.** Survives app kill and battery pull. FIFO, UUID-stamped at creation
   so retry is always safe.
4. **Batch sync on reconnect.** Drains through the batch endpoint (T-3.1) in few round-trips —
   load-bearing now, not an optimisation. A device returning from 40 minutes offline must not
   generate 200 individual requests and consume the concurrency budget.
5. **Reconnect conflict reconciliation — new scope (T-3.5).** Events queued offline may be invalid
   by the time they land: stock picked by someone else, order cancelled, wave reassigned. These are
   neither silently accepted nor silently dropped — they route into the exception queue with
   operator, device and offline duration attached.

Visible at all times: unsynced count and oldest unsynced age. The operator is hard-blocked only when
queue depth or staleness exceeds configured limits, with a supervisor-visible reason.

**Delivery — a PWA (D-13, closes Q-01).** *(Corrects the earlier claim that a browser/PWA client
"cannot dependably" deliver local persistence and background execution — that was wrong.)* Offline-first
(D-04) is unchanged; it is delivered as a **responsive PWA, Android-first, served from NetSuite (iOS
out of scope)**:
- **Local cache and durable outbound queue → IndexedDB.**
- **`navigator.storage.persist()`** to request persistent storage and avoid eviction.
- **Service worker** for asset caching (app shell available offline).

**Residual risk, accepted in writing (D-13):** a PWA has **no background sync when the app is not
foregrounded**, and **storage can be evicted if `persist()` is denied**. Accepted on the basis that an
operator who is actively picking has the app **open**, so the queue drains as they work; mitigated by
the always-visible unsynced count and the hard-block on queue depth/age (T-3.2). The IndexedDB schema
and service-worker strategy are **Phase 3 design work**, not spec.

Server SLAs re-baselined: ingestion P95 < 600 ms, P99 < 1200 ms; event→ledger P95 < 5 min. Note that
with offline-first these are throughput targets, not operator-experience targets — the operator's
experience is now entirely decoupled from them, which is the point.

## AD-10 — Wave clustering as candidate generation + bounded Map/Reduce (resolves F-10)

1. **Index:** `getInputData` emits `SKU → [orderIds]`.
2. **Candidate generation:** only order pairs sharing ≥ 1 SKU are ever compared. Skip SKUs whose
   order count exceeds a configured fan-out cap (a SKU on 3,000 orders generates no useful signal
   and produces quadratic blow-up).
3. **Score:** Jaccard `|A∩B| / |A∪B|`, threshold from `WMS_CONFIG` (single source of truth, F-16).
4. **Constrain:** cluster capped by cart tote positions, restricted to one zone, one ship-by date
   bucket, one carrier/service where relevant.
5. **Deterministic:** seed ordering by (ship-by date, order ID) so runs are reproducible and testable.

## AD-11 — Exceptions are first-class (resolves F-04)

`customrecord_wms_exception` with: source event, type, severity, detected-at, assigned-to, resolution
action, resolution notes, resolved-by/at. Every FAILED event creates one. Supervisor Suitelet offers
**Retry**, **Reverse**, **Manual adjust**, **Write off**, **Escalate**. A nightly reconciliation
compares POSTED events against actual ledger movements and raises exceptions for drift.

## AD-12 — Dashboard reads pre-aggregated metrics (resolves F-11)

The M/R `summarize` stage upserts `customrecord_wms_metric_snapshot` (per operator, per team, per
interval). The dashboard reads snapshots. Raw event scanning is never on the dashboard's path.

## AD-14 — Bin policy by bin type *(new, per D-05; resolves F-18)*

The 1-SKU/1-batch rule is currently a constant in code and a two-value list in the schema. That
hardwiring is what produces F-18: **the staging bin the picker hands off to cannot possibly be
single-SKU**, yet the schema offers no type for it, and §2.1 would block §2.5.

Make the rule a **policy attached to a bin type**, held in configuration:

Bin types (Q-16 closed 2026-08-09): **UNIT, BULK, STAGE, RECEIVING, QUALITY, RETURN, DEFECT.**

| Bin type | `singleSku` | `singleBatch` | `allowDirectPick` | `replenTarget` | `availableForFulfilment` | Notes |
|---|---|---|---|---|---|---|
| `UNIT` | true | true | true | true | **true** | Pick face |
| `BULK` | true | true | true | false | **true** | Reserve storage; direct pick allowed per D-03 |
| `STAGE` | false | false | false | false | **false** | Totes / staging — mixed by definition |
| `RECEIVING` | false | false | false | false | **false** | Inbound dock, pre-putaway |
| `QUALITY` | false | false | false | false | **false** | Quarantine / QC hold (was `QC_HOLD`) |
| `RETURN` | false | false | false | false | **false** | Returned stock, pre-disposition |
| `DEFECT` | false | false | false | false | **false** | Confirmed defective (post-inspection disposition) |

**`availableForFulfilment` (new, Q-16):** true for **UNIT and BULK only.** Stock in any other bin type
is physically present but **not pickable** — it must be physically moved into a UNIT or BULK bin
before it can be allocated. This attribute is enforced in allocation (T-7.1), replenishment sourcing
(T-5.2) and putaway routing (T-5.4), and is deliberately **not** a reconciliation filter (T-8.3): the
stock still exists and still counts toward the WMS-total-equals-NetSuite-quantity contract. It also
surfaces **F-26** — NetSuite counts this stock toward quantity on hand and may commit it, but the WMS
cannot pick it.

Validation becomes: *load the bin's policy, apply it.* One code path, no special cases, no `if
(binType === 'UNIT' || binType === 'BULK')` scattered through the codebase.

**What this buys:**

- F-18 disappears — staging, receiving, quality, return and defect bins are describable rather than contradictory.
- If the business ever wants mixed-lot bulk bins, or a fast-mover pick face carrying two lots, that
  is a **configuration change**, not a rebuild.
- New bin types (cross-dock, returns, kitting) are additive.
- The rule becomes *testable in isolation* — a policy table plus a pure validator.

## AD-15 — Declarative event handler registry *(new, per D-05)*

The six sample-code defects (F-12 … F-17) are not six unrelated bugs. They share one cause:
**behaviour that should be declared is hardwired**, so each event type's handling is spread across a
key-builder, a key-parser, a `switch`, and a set of literals. Fixing them one by one leaves the next
six to be found in production.

Instead, each event type registers a descriptor:

```js
// wms_lib_event_registry.js  — illustrative shape, not final code
registerHandler('REPLEN_MOVE', {
  requiredFields : ['sourceBinId', 'targetBinId', 'skuCode', 'qty', 'locationId'],
  validate       : (evt, ctx) => ctx.binPolicy.check(evt.targetBinId, evt.skuCode, evt.batchNumber),
  groupKey       : (evt) => ({ k: 'MOVE', locationId: evt.locationId, sourceBinId: evt.sourceBinId }),
  commit         : (events, ctx) => ctx.postBinTransfer(events),
  governanceEst  : (events) => 40 + events.length * 12,
});
```

**What each element structurally eliminates:**

| Element | Kills |
|---|---|
| `groupKey` returns an **object**, serialised centrally as JSON | F-12 — no `split('_')` can ever mis-parse `REPLEN_MOVE` |
| One handler owns one event type's commit | F-15 — a sales order cannot be transformed by two paths |
| `requiredFields` declared, validated generically | F-13 — a bin ID cannot reach a location field unchecked |
| `governanceEst` consulted before dispatch | F-17 — the reducer yields on prediction, not on failure |
| Thresholds resolved from config, injected via `ctx` | F-16 — one threshold value, structurally |

**The flexibility payoff:** adding an event type — QC_HOLD, KIT_ASSEMBLY, CYCLE_COUNT, CROSS_DOCK —
is a registration plus a handler. No edits to the ingestion Suitelet, the mapper, the key parser or the
reducer. That matters here because Q-05 defers receiving, counting and returns to a later release:
this is the seam that lets them be added without reopening Phase 4.

## AD-16 — The NetSuite boundary *(rewritten per D-07; supersedes the capability-tier model)*

**Bins do not exist in NetSuite. They exist only in the WMS.** NetSuite's Bin Management feature is
not enabled and is not required — basic or advanced. Full detail in `06-netsuite-boundary.md`.

**Division of ownership:**

| WMS owns | NetSuite owns |
|---|---|
| Bins, bin policy, zone, pick sequence | Locations |
| Bin contents (SKU, lot/serial, qty) | Item master and **item tracking mode** |
| Bin-to-bin movement — **no ledger impact, ever** | Quantity on hand per item per location |
| Slotting, waves, tasks, custody | Lot and serial numbers |
| The warehouse's physical topology | Financial transactions |

**The ledger interface is six transaction shapes** — three outbound, three inbound since D-09 put
receiving through the WMS:

| Direction | WMS event | NetSuite posting |
|---|---|---|
| Out | Order complete | **Item Fulfillment** |
| Out | Count variance | **Inventory Adjustment** |
| Out | Location-to-location move | **Inventory Transfer** |
| In | PO receipt | **Item Receipt** |
| In | Transfer Order receipt | **Item Receipt** (against the TO) |
| In | Production output | **Work Order Completion / Assembly Build** |
| — | **Bin movement** | **Nothing.** Stock has not changed location |

**The one axis of variability is per-item, not per-account.** An item is **PLAIN** (no tracking) or
**LOT** (batch numbered), read from the item record and cached as static data. Serial numbers are out
of scope (D-08); a serialised item reaching a WMS-managed location is **rejected with an explicit
exception**, never posted on a best guess. `wms_lib_ledger_adapter.js` (T-2.7) resolves each line's
mode and shapes inventory detail accordingly. **Mixed-mode orders are normal** — one sales order can
carry both, and one `record.transform` must handle them together.

This composes with AD-15: handlers declare a commit *intent*; the adapter renders it into what the
item's mode requires. No account-level switch, no configuration flag, no tier.

**Two risks this creates, both real:**

1. **WMS bin data is irreplaceable.** There is no NetSuite fallback — if bin state is lost it cannot
   be reconstructed, only re-counted physically. Mandates T-11.3 (export, rehearsed restore, change
   audit, mass-change alerting).
2. **Back-office movements cannot be attributed to a bin.** Materially reduced by D-09 — all
   inbound and all bin movement now originates in the WMS, so a direct NetSuite posting is a policy
   exception rather than a routine occurrence. The blocking User Event (T-10.2) remains as the
   backstop (F-20).

## AD-17 — Authority boundary *(per D-10, narrowed by D-11)*

The WMS is the primary inventory tool and NetSuite locations follow it. "Slave" is an **operational**
statement, not a financial one — NetSuite does not stop being the book of record, it stops being the
thing that decides where a box goes.

| Authority | Holder | Meaning |
|---|---|---|
| **Physical state** — what is where, right now | **WMS** | Bins, quantities, lots, movement sequence |
| **Bin-level allocation & replenishment rules** | **WMS** | Which bin, which batch, when to replenish — confirmed by D-11 |
| **Order-level commitment** — how much of item X order Y may take | **NetSuite** | The WMS allocates *within* it |
| **Cost** | **NetSuite** | **The WMS does not model, sequence for, or reason about cost at all** (D-11) |
| **Financial record** | **NetSuite** | Book of record for audit |

**Two-layer allocation, and both layers are real.** NetSuite decides *how much* of an item an order
is entitled to; the WMS decides *which bin and which batch* satisfies that entitlement, and runs all
replenishment logic. Neither layer can be skipped: without the NetSuite gate the WMS ships one
customer's promised stock to another (F-22); without the WMS gate the system directs pickers to bins
that are physically empty.

**Costing is out of scope for the WMS entirely (D-11).** We supply quantity, transaction date and
lot; NetSuite computes cost however the account is configured. No per-item event ordering is
required for costing purposes, and the codebase carries no costing logic. What survives is the
**period** requirement — post dated by scan time, drain the queue before period close (F-23) — which
is about the transaction being *postable at all*, not about how it is valued.

**Transient over-commitment is expected and self-correcting.** While picks sit in the queue, NetSuite
still counts that stock as on hand and may commit it to another order. The WMS's own bin state is
the protection: it will not direct a picker to a bin it knows is empty, so the second order
short-picks or waits rather than shipping the wrong goods. It resolves as the queue drains — which
is another argument for keeping event→ledger latency low.

## AD-18 — Inbound before outbound, and defer rather than fail *(per D-11; resolves F-24, F-25)*

**The rule:** *the WMS may go negative; NetSuite may not.*

That asymmetry is deliberate. The floor is allowed to be ahead of the books, because the operator has
physically moved stock the ledger has not caught up with. NetSuite, being the financial record, is
not allowed the same latitude.

**Two-phase committer cycle.** Every cycle posts **all inbound events, then all outbound events.**
No per-item dependency graph, no ordering bookkeeping — a global priority is sufficient and is what
D-11 asks for.

```
cycle N:
  PHASE A — post every PENDING inbound event    (Item Receipt, WO Completion)
  PHASE B — post every PENDING outbound event   (Item Fulfillment, Adjustment)
             │
             └─ insufficient quantity in NetSuite?
                  → status = DEFERRED, retry next cycle   ← not FAILED
                  → after N cycles → exception
```

**`DEFERRED` is a distinct status from `FAILED`, and the distinction matters.** A deferred event is
legitimate work in the wrong sequence — it will succeed once its receipt lands. A failed event is
work that will never succeed without human intervention. Collapsing the two would fill the
supervisor queue with noise that resolves itself, and train people to ignore it.

**Negative bin state is permitted but diagnostic.** A bin at −3 is not blocked, but it is not silent
either: small transient negatives during the queue window are normal, while persistent or large
negatives raise a `NEGATIVE_BIN_STATE` exception on configurable magnitude and age thresholds.

**A negative bin is treated as occupied, not empty.** The naive test — `qty <= 0` means the bin is
free — would allow a different SKU into a bin that is already in an error state, compounding the
first fault and destroying the evidence needed to diagnose it. A negative bin accepts only the SKU
and lot already recorded against it until a supervisor resolves it.

## AD-13 — Delivery mechanics## AD-13 — Delivery mechanics

- **SDF project**, SuiteScript 2.1, source-controlled. No point-and-click customisation that is not
  captured in the project.
- **Environments:** DEV sandbox → UAT/staging sandbox (production data refresh) → Production.
- **Unit tests** via a mocked-module harness (jest + SuiteScript module stubs) for pure logic —
  clustering, aggregation, allocation, similarity. These are the parts worth unit-testing; record
  I/O is covered by integration tests in sandbox.
- **Naming:** scripts `wms_<type>_<purpose>.js` (`rl_`, `mr_`, `ss_`, `ue_`, `sl_`, `cs_`, `lib_`).
- **Every script** declares `@NApiVersion 2.1` and `@NModuleScope SameAccount`.
