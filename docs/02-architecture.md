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
   │  group by (ORDER, LOCATION); bin-affecting work on ONE queue  ← AD-05 (locks rejected, D-12)
   │  RE-ASSERT invariants vs live inventory  ← authoritative
   │  one record.transform per (order, location)  ← invariant #4 (PF-18; degenerates to per-order in one location)
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

Serial numbers are **in scope** (D-29). Bin state stays the **scalar quantity projection** even so — a
serialised item's per-unit truth lives in its own record, **`customrecord_wms_serial_state`** (data model
§3.13), tied to bin state by **invariant #22** (bin-state quantity = count of serial rows in that bin).
Bin state is not made a collection; the serial lifecycle is a sibling record.

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

**Optimistic concurrency via the platform's own conflict detection — no accepted lost-update window**
*(rewritten 2026-08-11 per D-27; supersedes the read-check-write-with-accepted-loss design)*. The earlier
version accepted a real lost-update window on the ingestion path and leaned on nightly reconciliation to
cover it. **That is withdrawn.** NetSuite **already detects the conflict for us**: a `record.save` throws
**`RCRD_HAS_BEEN_CHANGED` (PF-11)** when the record changed between load and save. The bin-state update is
therefore:

1. **`record.load` → modify → `record.save`.** Catch `RCRD_HAS_BEEN_CHANGED`, **re-read, re-evaluate the
   bin policy against the fresh state, retry.** The attempt count is bounded by a `customrecord_wms_config`
   value. **On exhaustion, raise a `customrecord_wms_exception` — never silently proceed** (AD-11).
2. **The write MUST use `record.load` + `record.save` (6 units, PF-12), not `record.submitFields`
   (2 units).** `submitFields` on an inline-editable field **bypasses record validation and therefore
   bypasses conflict detection — it silently last-write-wins.** This is stated explicitly, with the unit
   cost, so nobody "optimises" the 6-unit load+save down to a 2-unit `submitFields` later and reopens the
   race. `custrecord_bs_version` is retained as a human-readable monotonic marker, but the *authority* for
   conflict detection is the platform's, not our version compare.

**There is no longer an accepted lost-update window on the ingestion path.** A concurrent write does not
lose an update — it throws, retries against fresh state, and either succeeds or raises an exception. The
old bounded-and-accepted-window argument (and its appeal to D-01) is deleted. **T-8.3 reconciliation
remains a backstop for *physical* divergence** (a scan that never happened, stock moved without a scan) —
**not** cover for a software race, which no longer exists.

No distributed lock is needed or built: commit-side bin work is still single-threaded through one
Map/Reduce queue (D-12), and ingestion-side concurrency is handled by the platform's conflict detection
above.

## AD-04 — Two-layer idempotency: `externalid` primary, committer dedupe safety net *(rewritten per D-12)*

Custom fields have no value-uniqueness constraint, but the record's **standard `externalid`** field
**is** platform-enforced unique (D-12). Idempotency uses it, with a committer safety net:

- **Layer 1 — `externalid` = client UUID (primary guard).** Ingestion sets `externalid` to the scan's
  UUID and attempts the create. A duplicate UUID **fails at the platform with `UNIQUE_RCRD_ID_REQD`
  (PF-13)** and is caught → return success/idempotent. No pre-read, no hot-path search. **The signal is
  `UNIQUE_RCRD_ID_REQD`, NOT `DUP_CSTM_RCRD_ENTRY`** — the latter is a *duplicate name* error raised only
  when "Require Unique Names" is set on the record type, a different condition, and must not be caught as
  the idempotency signal.
- **Layer 2 — committer-side dedupe (safety net).** When the committer groups events (AD-06) it groups
  by UUID first: keep the earliest, mark the rest **`SUPERSEDED`**, post from the survivor. So even if a
  duplicate ever lands (e.g. an `externalid` write path that bypassed layer 1), it never becomes a
  duplicate **ledger posting**.

```
ingest:  create with externalid = UUID       → { status:'SUCCESS', eventId }
         catch UNIQUE_RCRD_ID_REQD (externalid)→ { status:'SUCCESS', idempotent:true }   // safe retry (PF-13)
         catch other platform error           → { status:'ERROR', code, message, retryable:true|false }

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
source bin so each move settles against the right bins **within one location** (D-14) — bin moves post
nothing to NetSuite (D-07), so there is no "Bin Transfer" record to build; the grouping is for correct
WMS bin-state settlement.

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

## AD-13 — Delivery mechanics

- **SDF project — an Account Customization Project, not a SuiteApp (D-15)**, SuiteScript 2.1,
  source-controlled. Scripts ship open. No point-and-click customisation that is not captured in the
  project.
- **Environments:** DEV sandbox → UAT/staging sandbox (production data refresh) → Production.
- **Unit tests** via a mocked-module harness (jest + SuiteScript module stubs) for pure logic —
  clustering, aggregation, allocation, similarity. These are the parts worth unit-testing; record
  I/O is covered by integration tests in sandbox. The **browser/PWA** has its own test strategy (T-12.5).
- **Naming:** scripts `wms_<type>_<purpose>.js` (`rl_`, `mr_`, `ss_`, `ue_`, `sl_`, `cs_`, `lib_`).
- **Every script** declares `@NApiVersion 2.1` and `@NModuleScope SameAccount`.

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
  commit         : (events, ctx) => ctx.settleBinMove(events),   // WMS bin-state only; posts nothing to NetSuite (D-07)
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

**The one axis of variability is per-item, not per-account.** An item is **PLAIN** (no tracking),
**LOT** (batch numbered) or **SERIAL** (serialised) — the record type (PF-14), read and cached as static
data. **All three are in scope (D-29).** A serialised line posts one `inventoryassignment` line per
serial (quantity 1, PF-17) and updates `customrecord_wms_serial_state`; it is never rejected.
`wms_lib_ledger_adapter.js` (T-2.7) resolves each line's mode and shapes inventory detail accordingly.
**Mixed-mode orders are normal** — one sales order can carry all three, and one `record.transform`
(per order, per location — invariant #4) must handle them together.

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

**Multi-location (D-14): the ordering guarantee is per location, and the global two-phase cycle already
delivers it.** Because Phase A drains *all* inbound (across every location) before Phase B posts *any*
outbound, inbound-before-outbound holds within each location for free. **Do not shard the committer
into a per-location queue** to "parallelise" — that would let location B's outbound post before
location A's inbound drains and quietly break the guarantee for cross-cutting cycles. `DEFERRED` retry
and negative-bin handling are evaluated per `(item, location)`, since NetSuite quantity is per location.

**Transfer-Order ordering exception (F-30, D-22).** With TO outbound in scope, a **TO receipt at the
destination cannot post before its source TO fulfilment** — but both are inbound-vs-outbound of the
same transfer and can land in one cycle, and the global rule would attempt the receipt (inbound, Phase
A) before the source fulfilment (outbound, Phase B). This is the **one ordering exception**: within
Phase A, a **TO receipt whose corresponding source fulfilment is not yet `POSTED` is set `DEFERRED` and
retried next cycle — never `FAILED`.** It is legitimate work waiting on its own source leg, exactly the
`DEFERRED` semantics. (Amends invariant #18.)

**`DEFERRED` is a distinct status from `FAILED`, and the distinction matters.** A deferred event is
legitimate work in the wrong sequence — it will succeed once its receipt lands. A failed event is
work that will never succeed without human intervention. Collapsing the two would fill the
supervisor queue with noise that resolves itself, and train people to ignore it.

**Negative bin state is permitted but diagnostic.** A bin at −3 is not blocked, but it is not silent
either: small transient negatives during the queue window are normal, while persistent or large
negatives raise a `NEGATIVE_BIN_STATE` exception on configurable magnitude and age thresholds.

**Emptiness is `custrecord_bs_item` cleared — never a quantity comparison (invariant #20).** Testing
`qty <= 0` (or `qty === 0`) is wrong two ways: `qty <= 0` would let a different SKU into a **negative**
bin that is already in an error state, compounding the fault; and any float compare is fragile because
`qty` is a Decimal and UOM/partial-unit residue (e.g. `0.0000001`) would read as permanently occupied.
A bin whose item is still set — including a negative one — is **occupied and, if negative, anomalous**,
and accepts only the SKU and lot already recorded against it until a supervisor resolves it.

*(AD-13 moved into numeric order between AD-12 and AD-14.)*

## AD-19 — Privilege separation: the public surface cannot touch the ledger *(new, per D-19)*

Under D-19 the ingest endpoint is a **public, Available-Without-Login Suitelet.** Its blast radius is
bounded **by design, not by hope**, through a hard privilege split:

| Surface | Role | May do | May NOT do |
|---|---|---|---|
| **Public ingest Suitelet** (`wms_sl_scan_ingest`, GET+POST) | dedicated least-privilege **Execute-As role** | **append** to `customrecord_wms_scan_event`; **read** reference data (item/bin/policy/config) | any transaction permission; edit/delete events; read financial data |
| **Committer** (`wms_mr_ledger_commit`) | separate **authenticated** deployment role, **not publicly reachable** | transform SOs/TOs, post Item Fulfillments/Receipts/Adjustments | be invoked from the browser |

**The property, stated plainly:** *a compromise of the public endpoint can inject **queue noise** — bogus
scan events — but it **cannot touch the ledger.*** Bad events are caught by commit-time invariant
re-assertion (F-03) and land in the exception queue; they never post. This is why ingest and commit are
different roles on different reachability, and why the ingest role holds **no** transaction permission
(T-1.4). Device auth (D-21) and rate limiting (F-29) reduce the *volume* of injectable noise; AD-19
bounds its *worst case*.

**SuiteQL interaction — a least-privilege role can silently return empty (PF-06).** `SuiteQL` **enforces
role permissions**, so any component running under the least-privilege Execute-As role that issues a
SuiteQL query may get **empty results** where a broader role would not — an availability bug that reads as
"no data", not as an error. Rule: **any component using SuiteQL must state which role it runs under, and
that role must hold *View* permission on every record type the query touches.** This is an acceptance
criterion wherever SuiteQL is proposed. On hot paths prefer `search.lookupFields` (1 unit) over SuiteQL
(10 units) anyway (PF-06); reserve SuiteQL for multi-table projections and dashboards.

## AD-20 — Committer triggering: on-demand plus a deployment pool, and a measured lag window *(new, per D-27; PF-07/PF-08)*

A **Scheduled** Map/Reduce cannot run more often than **every 15 minutes (PF-07)**, so invariant #1's old
"lags by up to 5 minutes" was simply wrong. The committer is triggered **on demand**, not merely scheduled:

- **The ingestion Suitelet triggers the committer via `task.MapReduceScriptTask`**, passing the `scriptId`
  and **omitting `deploymentId`** so NetSuite routes to an **idle** deployment (PF-08).
- **A pool of committer deployment records, all set `Not Scheduled`.** NetSuite cannot submit to a
  deployment that is already running, so the pool provides concurrency. **Pool size is a documented,
  configured number, not an accident.**
- **One scheduled deployment at the 15-minute floor** as a **safety-net sweep** for anything the
  on-demand path missed after an interruption.
- **Invariant #1's staleness window is restated as a MEASURED figure**, established in **T-12.1** — not an
  assumed constant. The projection is still the operational truth; only the number is empirical.

## AD-21 — Automatic Location Assignment line-freezing, routed through the committer *(new, per D-27; PF-26)*

**Automatic Location Assignment can reassign a sales-order line's location after approval (PF-26)**, which
races a wave the WMS has already released against the original location. The mitigation is the line-level
**`noautoassignlocation`** flag. But **setting it writes to the sales order**, and *all NetSuite writes go
through the committer* (invariant #4 / AD-01) — we do **not** carve an exception. Instead:

- **Wave release emits a new event type** (a line-freeze event); the **committer processes it** and sets
  `noautoassignlocation` on the affected lines, inheriting the **same optimistic-concurrency retry**
  (AD-03) as every other write.
- The event type is **registered as a handler** in the declarative registry (AD-15). The registry module
  is carved-out and **must not be edited here** (D-23) — the handler definition and its tests are recorded
  as task **T-2.6b** for its own pass.

Whether this is needed at all depends on `AUTOLOCATIONASSIGNMENT` actually being on (SANDBOX-PENDING,
PF-26/PF-27); if the feature is off in this account, the event type is defined but dormant.

## AD-22 — The kill switch is a config flag, not deployment status *(new, per D-27; PF-29)*

**A script deployment record cannot be edited while that script is executing (PF-29).** A committer that
runs continuously therefore **cannot be reliably paused at its deployment record during an incident** —
precisely when a pause is needed. So the **kill switch is a flag on `customrecord_wms_config`, read at the
start of every committer execution**; when set, the execution exits cleanly without posting. This is
recorded against **C4** (environment/runbook) and the T-0.2 config record.
