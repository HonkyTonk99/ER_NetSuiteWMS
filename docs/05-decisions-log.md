# 05 — Decisions Log

Rulings from the sponsor (TK / Todd), 2026-08-07 to 2026-08-10. These override the corresponding entries in
`01-review-findings.md`, `02-architecture.md` and `04-open-questions.md`. Superseded text in those
files is marked and cross-referenced here rather than deleted, so the reasoning stays auditable.

---

## D-01 — Concurrent putaway collision is not a credible risk · *partially accepted*

**Ruling:** "VERY VERY UNLIKELY. Provided a window of 30 seconds is between users, warehouse
operations should never clash. Also, the warehouse rules as 1 product 1 batch per bin."

**Accepted.** Two operators physically racing for the same empty bin within a cache TTL is not a
realistic failure mode on a directed-putaway floor, and designing a distributed lock around it was
disproportionate. The bin lock is **removed from the ingestion path** entirely.

**Not accepted, and re-scoped:** the staleness risk in this architecture was never really about two
humans colliding — I framed it badly. It is about **the system's own asynchronous lag**. The design
posts to the NetSuite ledger up to five minutes after the scan (Doc A's own model; my target was P95
< 5 min). During that window `inventorybalance` is *wrong by design* — it does not yet reflect picks
and moves that have already physically happened. A 30-second gap between operators does not help,
because the discrepancy lasts as long as the queue does.

Concretely, with no concurrency involved at all:

> 09:00:00 Operator A picks the last 10 units from U-01. Event queued. Bin is now physically empty.
> 09:02:00 Operator B is directed to putaway lot B into U-01. Ledger still shows lot A present.
> The putaway is **rejected** — and the operator is standing in front of an empty bin being told
> it is full.

That is the common case, it involves one operator at a time, and it produces false rejections that
will destroy floor confidence in the system within a shift.

**Resolution (AD-03 rewritten):** maintain a **bin state projection** — a single small record per
bin holding `(itemId, lotNumber, qty, version)`, updated by the ingestion Suitelet on accept and
reconciled by the commit stage. Because of TK's own 1-SKU/1-batch rule this record is tiny and
cheap. It is the authoritative operational view of a bin; `inventorybalance` remains the financial
truth and the two are reconciled nightly. Validation reads the projection, not the ledger and not a
guessed cache.

This is cheaper than what I originally proposed (no locks, no live search on the hot path), it is
faster, and it removes the false-rejection failure above, which the lock-based design would not have
fixed.

---

## D-02 — Exception queue and recovery control · *accepted as core scope*

**Ruling:** "Good, this needs control."

No change to plan. Phase 8 (T-8.1 … T-8.4) stands as core scope. D-04 below adds a new exception
source: events that become invalid while a device is offline.

---

## D-03 — Replenishment when no bulk stock exists · *ruled, closes Q-03*

**Ruling:** "Warehouse rules as 1 product 1 batch per bin, so if the product has no bulk then it
gets consumed from the Bin Batches that are available, and after that it's out of stock."

Clean rule and it removes the deadlock. Restated for build:

1. Replenishment sources from a BULK bin — same lot as the UNIT bin if available, else FEFO.
2. **If no BULK stock exists for that SKU, replenishment does not raise, block or wait.** Picking is
   allowed to consume directly from **any bin holding that SKU**, batch by batch.
3. When all bins holding that SKU are exhausted, the SKU is **out of stock**. No blocked task, no
   supervisor escalation — this is a normal inventory state, not an exception.

**This ruling cascades and closes two further open questions:**

- **Q-14 (bulk pick strategy) — closed.** Direct picking from non-pick-face bins is permitted by
  rule 2. Allocation prefers the UNIT pick face, then falls through to other bins.
- **Q-04 (multi-lot summary picking) — effectively closed.** Since a bin holds exactly one batch,
  demand spanning several bins *necessarily* spans several batches. Summary picking is therefore
  **one task per SKU per bin (and so per batch)**, not one task per SKU. The FRD's "36 units in one
  action" example holds only when one bin carries all 36; otherwise it is legitimately three tasks.
  Allocation order across bins is **FEFO**. An order may be split across batches.

The de-consolidation pack screen must therefore render **multiple batch rows under one SKU summary**
as the normal case, not the exception. See T-7.1, T-7.2.

**Consequence to flag:** this makes lot expiry data mandatory on inventory numbers for correct FEFO.
Confirm coverage on existing stock before Phase 5.

---

## D-04 — Handheld offline operation is a guarantee, not a risk · *accepted, scope increased*

**Ruling:** "The expectation of connect failure on the handheld is guaranteed, you need to be able
to handle by cache and batch when a connection is restored."

Accepted and treated as an architectural mandate rather than a resilience feature. The handheld is
**offline-first**: it is designed to work with no network and to treat connectivity as an
intermittent bonus, not a precondition. See AD-09 (rewritten), T-3.2, T-3.4, and new task T-3.5.

Four requirements follow, the last of which is new scope:

1. **Local master-data cache** — assigned tasks, plus the item, bin and lot subsets needed to
   validate every scan the operator could plausibly make, held on the device. Refreshed on sync,
   with a staleness limit.
2. **Durable outbound event queue** — survives app kill and battery pull. Already specified.
3. **Batch sync on reconnect** — drain the queue through the batch endpoint in few round-trips.
   Already specified in T-3.1; now load-bearing rather than an optimisation.
4. **Reconnect conflict reconciliation — NEW (T-3.5).** A device offline for 40 minutes returns
   with events that may no longer be valid: the stock was picked by someone else, the order was
   cancelled, the wave was reassigned. These cannot be silently accepted and cannot be silently
   dropped. They route into the D-02 exception queue with the operator, device and offline duration
   attached.

**Impact on Q-01 (handheld platform):** this materially weakens the case for a browser-based or PWA
client. Requirement 1 and 2 need reliable local persistence and background execution that browsers
do not dependably provide on rugged Android. Recommendation strengthened to a **native app on
rugged Android**.

---

## D-05 — Open to creative solutions offering flexibility · *accepted, two proposals*

**Ruling:** "I'm open to creative solutions that provide flexibility."

The six sample-code defects share one root cause: **behaviour is hardwired where it should be
declared.** Fixing them individually leaves the next six to be discovered later. Two structural
proposals, in AD-14 and AD-15:

- **AD-14 — Bin policy by bin type.** Make the 1-SKU/1-batch rule a *policy attached to a bin type*
  rather than a constant in code. This surfaces a contradiction in the FRD that neither of us had
  flagged — see **F-18** — and it means a future decision to allow mixed bulk bins is a
  configuration change, not a rebuild.
- **AD-15 — Declarative event handler registry.** Each event type declares its own validation,
  grouping key, commit handler and governance estimate. Adding an event type becomes a registration,
  not an edit to a switch statement and a key parser. This eliminates F-12 and F-15 *structurally*
  rather than case by case.

---

## D-06 — Assume a basic account; accommodate advanced inventory as an option · ~~*accepted*~~ **SUPERSEDED BY D-07**

> **Superseded 2026-08-08.** The five-tier capability model below was replaced by D-07, which takes
> NetSuite bins out of the design entirely and so removes the licensing question that made tiers
> necessary. Retained for traceability — the analysis of what basic Bin Management can and cannot do
> is still accurate, it simply no longer applies.

**Ruling:** "Let's assume the account is only basic, but if it has advanced inventory then we
accommodate for it — make it an option."

Accepted, and it is the most consequential constraint raised so far. Full treatment in
`06-netsuite-boundary.md`; the essentials:

**The hard fact.** Oracle's documentation states plainly: *"If you use basic Bin Management, you
cannot associate serial or lot items with bins."* The FRD's central invariant is 1 SKU **and 1
batch** per bin. On a basic account, **NetSuite cannot record which lot is in which bin at all.**
Every inventory-writing sample in the FRD sets the NetSuite bin-number field and the issue-inventory-number field on the same
subrecord line, which requires Advanced Bin / Numbered Inventory Management specifically — and
throws without it. Logged as **F-19**.

**Five tiers, T0 baseline.** T0 (nothing) · T1 (bins) · T2 (lots) · T3 (bins + lots but *not*
together) · T4 (Advanced Bin / Numbered Inventory Management). **T3 is a trap** — both features
enabled, UI looks correct, lots-in-bins still rejected. T-0.1 must verify `ADVBINSERIALLOTMGMT`
specifically rather than inferring it.

**Why this is survivable.** D-01's bin state projection already moved operational truth into WMS
records. So the WMS owns bins and batches **at every tier**, and floor behaviour — picking, bin
isolation, replenishment, clustering, custody — is identical from T0 to T4. Only the ledger commit
differs, and all of that difference is confined to `wms_lib_ledger_adapter.js` (T-2.7, AD-16).

Had we kept validating against `inventorybalance`, T0 would have been fatal: a basic account has no
bin dimension in the ledger to read. The projection was designed for a different reason and happens
to be what makes this ruling implementable.

**What genuinely degrades below T4** — three of these are business decisions, not technical ones:

- **Lot recall traceability.** "Which customers received lot X" is answerable from WMS records but
  not from standard NetSuite reporting. **If a statutory recall obligation applies, this is a
  compliance exposure.** New blocking question **Q-18**.
- **Lot costing** impossible below T2 (Q-20).
- **Back-office enforcement weakens** — less ledger dimensionality to validate against, so nightly
  reconciliation becomes the *primary* control rather than a safety net.
- **FEFO degrades to FIFO** by WMS putaway date at T0/T1, since no lot expiry exists.
- **Dynamic slotting fights T1** — basic Bin Management requires bins be pre-associated to items.
  Recommendation at T1: do not use NetSuite bins at all; let the WMS own them and post at location
  level, i.e. treat T1 as T0.

**Upgrade path is cheap by construction:** enable the features, change the tier on the config
record, re-run the tier-parameterised regression suite. No re-architecture.

---

---

## D-07 — Bins live in the WMS, not NetSuite · *accepted; supersedes D-06*

**Ruling (2026-08-08):** *"Assume that BINs are NOT ENABLED in NetSuite, that bins are managed in
the WMS. So the foundation configuration of NetSuite is: Locations are enabled, and Serial/Batch
numbers might be enabled or might not be, and these will be defined by the item config in
NetSuite."*

Accepted, and it is a genuine simplification. Full treatment in `06-netsuite-boundary.md`.

**What it removes.** The entire five-tier model from D-06 collapses. No Bin Management feature
(basic or advanced), no Advanced Bin / Numbered Inventory Management licence, no lots-in-bins
impossibility, no T3 trap, no bin pre-association problem. **NetSuite never knows a bin exists.**
The 1-SKU/1-batch rule becomes a purely WMS rule with no platform constraint fighting it — a
cleaner home for it than it had.

**What replaces it.** Variability moves from *account level* to *item level*: PLAIN, LOT or SERIAL
*(narrowed to PLAIN and LOT by D-08 — **restored to all three by D-29, D-08 superseded**)*,
read from the item record and cached as static data. Mixed-mode orders are normal and one
`record.transform` must handle all three. The ledger interface reduces to three transaction shapes
— Item Fulfillment, Inventory Adjustment, Inventory Transfer — and **bin movements post nothing**,
because stock has not changed location.

**Three risks it brings into the open**, two of them previously masked:

- **F-19 rewritten.** The FRD's code annex writes the NetSuite bin-number field and creates bin-transfer records.
  Under D-07 neither will ever be valid. The bin-number field must appear nowhere in the codebase.
- **F-20 (new).** Back-office movements cannot be attributed to a bin. A direct Inventory Adjustment
  changes location quantity with no bin information; reconciliation detects the mismatch but
  **cannot resolve it**, because the data needed never existed. Managed by policy plus a blocking
  User Event (T-10.2).
- **F-21 (new).** **Serial items break the throughput model.** The FRD's 50,000 lines/day and
  10–25 scans/sec assume ~one scan per line. Serial items need one scan per *unit* — at 20% serial
  lines averaging qty 5, daily scan volume **doubles**. Neither FRD document mentions serial numbers
  at all. The concurrency budget, load test, staffing model and pick-rate targets all inherit the
  error. **T-0.1 must produce an item census before T-0.2 sizes anything** (Q-21).

**And one risk it creates:** `customrecord_wms_bin_state` is now the **only** record anywhere of
what is in which bin. There is no NetSuite fallback. Loss means a full physical stocktake, so
T-11.3 adds daily export, a **rehearsed** restore, change audit, and mass-change alerting.

**Serial handling is under-specified and needs three answers** (Q-21 mix, Q-22 bin rule for serials,
Q-23 whether serials are captured at receipt or only at despatch). Q-23 in particular is a fork:
capturing only at despatch makes directed serial picking impossible and the build materially
simpler but the control materially weaker.

---

---

## D-08 — Serial numbers out of scope; batch numbers in scope · ~~*accepted 2026-08-08*~~ **SUPERSEDED BY D-29 (2026-08-11)**

> **SUPERSEDED 2026-08-11 by D-29.** Serialised items **are in scope** — they are stocked, picked,
> shipped and received in WMS-managed warehouses, and the sponsor's settled position is that **lot and
> serial were required from ideation.** The reasoning and date below stay on the record (the scan-volume
> analysis was accurate for its assumptions), but the ruling no longer holds. Everything it closed —
> F-21, Q-21/Q-22/Q-23, "reject serialised items", scalar-only bin state — is re-opened or restated by
> D-29 and the Part-H sweep. **Do not act on the text below.**

**Ruling (2026-08-08):** *"Batch numbers are in scope, Serial Numbers are out of scope."*

Item tracking modes reduce to **PLAIN** and **LOT**. Closes **F-21** and questions **Q-21, Q-22,
Q-23** outright, and removes the per-unit serial scan flow from the handheld.

Real simplification: the scan-volume risk that threatened to double the throughput model is gone,
and bin state stays scalar (four fields, no child records, no JSON collections).

**One residual requirement.** A serialised item may still *exist* in the NetSuite account. If one
reaches a WMS-managed location the commit will fail confusingly, so **T-2.7 must detect and reject
it explicitly** with a clear out-of-scope exception, and T-0.1 confirms none are present in scope.
Silent failure here would be worse than the original risk.

---

## D-09 — Inbound flows through the WMS · *accepted; scope increase*

**Ruling (2026-08-08):** *"I'd want the user to use the WMS tool to receive and put away Purchase
Orders, Transfer Orders and Work Order Completions; they will do all bin transfers on the WMS too."*

Accepted, and it closes **Q-05**, which previously deferred receiving to release 2. It also largely
neutralises **F-20** — with inbound and bin movement both originating in the WMS, a direct NetSuite
posting becomes a policy exception rather than routine traffic. The blocking User Event (T-10.2)
stays as the backstop.

**This is a genuine scope increase — new Phase 5B, six tasks (T-5.4 … T-5.9):**

| | |
|---|---|
| T-5.4 | Directed putaway strategy — given SKU, lot and quantity, which bin? Honours 1-SKU/1-batch |
| T-5.5 | PO receipt on the handheld, including over/under-receipt, damage and QC hold |
| T-5.6 | Transfer Order receipt, carrying lot numbers through rather than re-keying |
| T-5.7 | Work Order completion receipt |
| T-5.8 | Receipt-before-consumption ordering in the committer (F-24) |
| T-5.9 | Inbound exception handling |

**Two things worth flagging:**

- **Lot expiry is captured at receipt.** This is where lot data enters the system and the only
  practical moment to capture expiry. FEFO across the entire solution depends on it — so Q-15 is
  answered structurally rather than needing a data-cleanup exercise.
- **Inbound postings are real financial events**, unlike bin movements. The ledger interface grows
  from three transaction shapes to six.

**And one new finding — F-24.** Stock can now be received and picked within the same minute. The
committer processes groups in parallel with no ordering guarantee, so a fulfillment can post before
the receipt that supplied it — giving an insufficient-quantity rejection hours after an operator did
everything right. AD-18 adds a dependency ordering rule.

---

## D-10 — WMS is primary; NetSuite allocation and costing must be respected · *accepted, with a boundary*

**Ruling (2026-08-08):** *"The WMS becomes the primary tool to manage inventory, NetSuite locations
are the slave. BUT we must respect NetSuite inventory allocation features and inventory cost control
features."*

Accepted. The two halves are only compatible if "primary" is scoped precisely, so AD-17 sets the
boundary:

| Authority | Holder |
|---|---|
| Physical state — what is where, right now | **WMS** |
| Commitment — which order owns which stock | **NetSuite** |
| Cost — what stock is worth | **NetSuite** |
| Financial record | **NetSuite** |

"Slave" is an *operational* statement, not a financial one. NetSuite does not stop being the book of
record — it stops being the thing that decides where a box goes.

**Two findings follow, both S1:**

- **F-22 — allocation.** The wave engine currently clusters "unfulfilled Sales Orders" with no
  reference to commitment. If the WMS allocates stock NetSuite has committed to a different order,
  totals stay correct but **attribution goes wrong** — one customer's promised stock ships to
  another, and NetSuite's availability figures become fiction. Wave eligibility now filters on
  committed quantity, and picked quantity per line may not exceed it.
- **F-23 — costing and period.** Deferred, batched, parallel posting is hostile to inventory
  accounting in three specific ways: a pick scanned at 23:58 and posted at 00:04 lands in the wrong
  **period**; parallel commits give no **sequence** guarantee, which changes computed cost under
  FIFO/LIFO; and out-of-order posting can drive **negative inventory**. Mitigations: date
  transactions by scan time, drain the queue before period close as a monitored finance procedure
  (new T-11.4), and confirm the costing method (Q-24) — if FIFO or LIFO, per-item event ordering
  becomes a hard requirement rather than a preference.

---

---

## D-11 — Costing is NetSuite's; the WMS may go negative and NetSuite may not; inbound always first · *accepted*

**Ruling (2026-08-08):** *"The account costing shouldn't be relevant, I want to leave NetSuite to run
costing. In the WMS negative inventory could exist, but in NetSuite it can't. So the sequence of
update needs to always prioritise an inbound receipt movement before an outbound fulfillment
movement. What this also means is that the WMS can run bin management allocation and replenishment
rules etc."*

Three rulings, and the middle one simplifies the design.

**1. Costing is out of WMS scope.** Closes **Q-24** and withdraws half of **F-23**. We supply
quantity, transaction date and lot; NetSuite computes cost however the account is configured. No
per-item event ordering for costing purposes, no costing logic in the codebase.

What survives from F-23 is the **period** requirement, which is not a costing question: a pick
scanned at 23:58 and posted at 00:04 lands in the next period, and if that period has *closed* it
cannot post at all. Date by scan time; drain the queue before period close (T-11.4).

**2. Negative inventory asymmetry — WMS yes, NetSuite no.** Closes **Q-26**. A clean rule and it
answers a question I had recommended the opposite way round. The floor is allowed to be ahead of the
books; the financial record is not. Three consequences, logged as **F-25**:

- **Outbound must defer, not fail.** A fulfillment whose receipt has not landed is legitimate work in
  the wrong sequence. New `DEFERRED` status, distinct from `FAILED`, retried each cycle, escalating
  to `DEFERRAL_TIMEOUT` only after a configured limit (T-4.7). Merging the two statuses would fill
  the supervisor queue with noise that resolves itself.
- **Negative bin state is diagnostic, not merely permitted.** Transient small negatives are normal
  during the queue window; persistent or large ones raise `NEGATIVE_BIN_STATE`.
- **A negative bin is occupied, not empty.** The naive `qty <= 0` test would admit a second SKU into
  a bin already in an error state — compounding the fault and destroying the evidence needed to
  diagnose the first.

**3. Inbound always before outbound.** This **replaces AD-18's dependency graph with a global
two-phase priority** — post all inbound, then all outbound, every cycle. Less code, nothing to track
per item, and easier to reason about. A straight simplification of what I had proposed.

**4. "The WMS can run bin management allocation and replenishment rules."** This **confirms rather
than contradicts** the AD-17 boundary. NetSuite decides *how much* of an item an order is entitled
to; the WMS decides *which bin and which batch* satisfies it, and owns all replenishment logic. Both
layers stay.

> **One consequence worth naming:** while picks sit in the queue, NetSuite still counts that stock as
> on hand and may commit it to another order. The WMS's own bin state is the protection — it will not
> direct a picker to a bin it knows is empty — so the second order short-picks rather than shipping
> the wrong goods. It self-corrects as the queue drains, which is a further argument for keeping
> event→ledger latency low.

---

## D-12 — Idempotency via `externalid`; locks rejected on simplicity (not impossible) · *accepted 2026-08-09; corrected 2026-08-09 per developer*

> **Corrected.** The first version of this decision said NetSuite has *no* value-uniqueness primitive
> and therefore locks were *impossible*. That was wrong — it looked only at custom fields. The standard
> **`externalid`** field is platform-enforced unique. The correction matters: an "impossible" note
> would lead a future reader who discovers `externalid` to assume this was an error and reinstate the
> lock. It was **rejected on simplicity, not ruled out on capability.**

**Platform finding (two parts):**
- **(TK)** Custom text fields have **no value-uniqueness constraint** — a "unique" checkbox is
  application-layer validation, and a search-then-create control script is read-then-write and racy.
- **(developer)** The record's **standard `externalid`** field **is** platform-enforced unique, and is
  purpose-built for integration/idempotency keys. This is the primitive the first note said did not
  exist.

**AD-04 (idempotency) — two layers:**
1. **`externalid` = client UUID as the PRIMARY guard.** Ingestion sets `externalid` to the scan's UUID
   and attempts the create; a duplicate fails at the platform and is caught → return success/idempotent.
2. **Committer-side dedupe as a SAFETY NET.** The committer still groups by UUID, keeps the first and
   marks the rest `SUPERSEDED`, so even a duplicate that somehow lands never becomes a duplicate ledger
   posting. Both layers are kept deliberately (the developer independently recommended keeping the
   downstream posting idempotent, and TK agrees).

**AD-05 (locking) — WITHDRAWN, by choice:**
- A lock **is technically possible** via `externalid` (acquire = create a lock record whose `externalid`
  is the resource id; loser catches the duplicate). It is **rejected on simplicity grounds**, not
  because it cannot be built.
- **Single-threaded bin-state settlement** — all bin-affecting commit work through **one Map/Reduce
  queue** — is correct **by construction**: no TTL, no reaper, no deadlock ordering, no stale-lock
  handling. Under D-07 bin movements post **nothing** to NetSuite, so the serialised path is cheap.
- The **order lock stays deleted regardless** — it was always redundant given AD-06 group-by-order plus
  flipping events to `PROCESSING` on claim; that reasoning never depended on the uniqueness question.
- `customrecord_wms_concurrency_lock`, the stale-lock reaper and the `STALE_LOCK`/`LOCK_TIMEOUT`
  exception types are deleted (they belong to the rejected design).

**One `externalid` per record type = one platform-enforced unique key.** A record can have only one
`externalid`, so it enforces exactly one uniqueness rule; any *second* uniqueness rule on the same
record falls back to script validation. The three records that need it: scan event (`externalid` =
client UUID), bin state (= bin identifier), bin master (= location-prefixed bin code).

**Supersedes:** AD-04, AD-05, F-02, CLAUDE.md invariants #3 and #7, and the lock record §3.2.

## D-13 — Handheld is a responsive PWA · *accepted*

**Ruling:** the handheld is a **responsive PWA, Android-first, served from NetSuite. iOS is out of
scope.**

**Supersedes** the plan's recommendation of a native app, and **corrects AD-09**, which wrongly stated
a browser/PWA client *cannot dependably* deliver local persistence and background execution. It can:
IndexedDB for the local cache and durable outbound queue, `navigator.storage.persist()` against
eviction, a service worker for asset caching. Offline-first (D-04) is unchanged.

**Residual risk, accepted in writing:** no background sync when the app is not foregrounded, and
storage eviction if `persist()` is denied. Accepted because an operator who is actively picking has
the app open, so the queue drains as they work; mitigated by the visible unsynced count and the
hard-block on queue depth/age already in T-3.2. IndexedDB schema and service-worker strategy are
Phase 3 design work, not spec.

## D-14 — Multi-location in scope; location is mandatory session context · *accepted*

**Ruling:** **multiple warehouse locations are in scope** (closes Q-08). Location is **mandatory
session context**, not an afterthought:

- Every operator session is bound to a location; scans carry it.
- **Bin names are prefixed with the location code** (e.g. `WH1-A-01-03`), so bin identity is unique
  across locations.
- The handheld **cache warms on location selection** — so **switching location requires
  connectivity** (a deliberate, bounded exception to offline-first: you work offline *within* a
  location, but changing location needs a connection to load the new location's master data).

**Propagated 2026-08-09** (standalone D-14 pass). What changed:
- **Data model (§3):** mandatory Location on scan event *(scan-time, what the committer posts against)*,
  bin state *(denormalised `custrecord_bs_location`)*, replen profile/task, wave, exception, metric
  snapshot; config is now global-defaults + optional per-location override rows with field-by-field
  precedence; a "Location scoping" map names the deliberately location-agnostic records (bin policy,
  operator identity, custody-via-wave, item cache, event registry).
- **Bin identity:** the `<LOCATIONCODE>-<BINCODE>` prefix rationale stated; migration must fail (not
  overwrite) two source bins that collapse to the same prefixed name (T-0.4).
- **Cross-location movement forbidden:** new `ERR_WMS_CROSS_LOCATION_MOVE` / exception type; a transfer
  whose source and destination resolve to different locations is rejected at ingestion (T-3.1) and
  re-asserted at commit (T-4.3) — inter-location movement is a NetSuite Transfer Order received inbound.
- **Login / cache / queue (T-3.2, T-3.4):** location selected at login; cache warm is location-scoped;
  a location switch is a **full purge + re-warm, not a delta**, and **requires connectivity** (the one
  bounded exception to offline-first, invariant #11); the durable queue is **not** purged on switch and
  events keep their scan-time location (T-12.5 test).
- **Waves/zones/replen (Phase 6):** clustering **partitions by location before Jaccard** (correctness
  *and* a candidate-set reduction), replen source/target within one location, zone & pick sequence
  location-scoped, cart capacity per-location config.
- **Committer (AD-18):** inbound-before-outbound holds **within each location**; the global two-phase
  cycle already satisfies it — **do not shard the committer per location.**
- **Assumption logged:** one operator holds **one location per session** (register Q-31), pending
  confirmation.

**Location class — now likely required (two independent drivers).** A **location *class* (operational
vs holding)** is needed so that non-warehouse NetSuite locations are excluded from the operator's
picker, wave generation and cache warm. **Two independent drivers now point at it:**
1. **Q-29** — if F-26 resolves via a separate NetSuite location for non-fulfillable stock, that
   location is a **holding bucket, not a warehouse.**
2. **Q-36** (from D-22) — if the client uses **in-transit inventory** on transfer orders, the
   in-transit NetSuite location is likewise **not a warehouse.**

This has moved from *"if Q-29 resolves that way"* to **likely required.** **Hold the design until both
Q-29 and Q-36 land, so it is built once.** Not built now. Cross-referenced from Q-29 and Q-36.
**The two are coupled (2026-08-10):** Q-29's recommended fallback (opt (a), a separate holding location)
*creates* the location this class must exclude, so **Q-29's default may not fire unless Q-36 is also
answered** — otherwise a holding location sits in the operator picker with nothing to exclude it. Q-36 is
escalated to effectively required by the same date; if it stays open, Q-29 and the class both stay open.

**Follow-ups this pass raised:** D-20 (location-switch connectivity exception), F-28/Q-33 (TO outbound
unscoped — blocks Phase 6), Q-31 (session-location assumption), Q-32 (multi-location order), and the
Q-29 location-class dependency above.

**Supersedes** the plan's implicit single-location assumption throughout.

## D-15 — Delivery is an Account Customization Project, not a SuiteApp · *accepted*

**Ruling:** deliver as an **Account Customization Project (ACP)**; scripts ship **open** (readable in
the account). May be repackaged as a SuiteApp later via the UI if distribution is ever needed.
Confirms AD-13's SDF direction and settles the project *type*. No supersession — it fills a gap the
plan left open.

## D-16 — Bin taxonomy and fulfilment eligibility · *accepted 2026-08-09 (closes Q-16)*

**Ruling:** bin types are **UNIT, BULK, STAGE, RECEIVING, QUALITY, RETURN, DEFECT** (QC_HOLD renamed
QUALITY; RETURN and DEFECT added). New policy attribute **`availableForFulfilment`** — **true for UNIT
and BULK only**; stock in any other type is physically present but not pickable until moved into
UNIT/BULK. Enforced in allocation (T-7.1), replenishment sourcing (T-5.2) and putaway routing (T-5.4);
**not** filtered from reconciliation (T-8.3). **Surfaces F-26** (NetSuite over-commits non-fulfillable
stock → Q-29). **Supersedes** AD-14's five-type table.

## D-17 — Bin data migrates from a third-party application · *accepted 2026-08-09 (T-0.4 case b)*

**Ruling:** bin definitions and contents live in a **third-party application today** and will be
**migrated** into NetSuite (`customrecord_wms_bin` + opening `customrecord_wms_bin_state`). Phase 10 is
therefore a **migration**, not greenfield slotting; it needs a **cutover point** (movement freeze or
delta reconciliation, T-10.1 / T-13.3) because the export is stale on arrival. **Supersedes** the
original T-0.4 ("audit `inventorybalance` grouped by bin"), which had no referent under D-07.

## D-18 — NetSuite WMS SuiteApp is not installed; D-07 confirmed · *accepted 2026-08-09 (closes Q-13)*

**Ruling:** Oracle's **NetSuite WMS SuiteApp is not installed** in the target account. It would have
required Bin Management enabled and contradicted D-07 — so this **confirms D-07 is settled, not
provisional.** T-0.1 keeps a general namespace-collision check on ACP-hygiene merits. **Supersedes**
the provisional "D-07 contingent on Q-13" caveat.

## D-19 — Browser transport & auth: same-origin Suitelets, no per-operator login (Option C) · **CONFIRMED 2026-08-09**

Two corrections from the NetSuite developer that the earlier design got wrong, and the sponsor's auth
ruling. **CONFIRMED** — the developer answered the three open questions (verbatim basis below):

> 1. **One Available Without Login Suitelet handles both roles — GET serves the SPA, POST is the JSON
>    API.** No second deployment, no CORS problem.
> 2. **Governance: 1,000 units per Suitelet request.**
> 3. **No logged-in operator context — Execute As Role must be a dedicated least-privilege role.**

So the model is settled: one anonymous Suitelet, GET = app shell, POST = ingest API, same origin.
Device authentication becomes mandatory (the endpoint is public) — see **D-21**; and the shared
concurrency pool must be throttled — see **F-29**.

**Transport — Suitelet is the API, not a RESTlet.** A Suitelet and a RESTlet are served from
*different hosts*, so a PWA calling a RESTlet is cross-origin (CORS). The PWA is served by a Suitelet
(D-13), so its API is a **sibling Suitelet — same origin, no CORS.** RESTlets leave the browser path
entirely (they remain available for server-to-server integrations). `wms_rl_scan_ingest.js` →
`wms_sl_scan_ingest.js`. Governance and concurrent-slot cost are identical to a RESTlet — T-0.2's
numbers are unchanged, only the wording. **Closes T-0.7.**

**Auth — Option C, no NetSuite user per operator** *(sponsor rejected "every operator needs a NetSuite
login")*:
- The SPA is served from an **Available Without Login** Suitelet — **no NetSuite user for any
  operator** (resolves **Q-30**: no per-operator licence).
- The API is a **sibling Suitelet, same origin.**
- **No TBA in the browser** (credentials stay server-side); none is needed.
- **Operator identity is carried in the payload** onto `custrecord_se_operator`.
- Hardening (T-3.3, rewritten): operator ID + **PIN/badge** against a WMS operator record with a
  **hashed PIN**; a **signed session token HMAC'd** with a script-parameter secret, with expiry; every
  call validates signature, expiry and operator-active; IP allowlisting where feasible; rate limiting
  per token and per IP; execute-as-role scoped to **create scan events and read reference data only**.

**New finding F-27** — an **internet-exposed, unauthenticated write endpoint** now fronts inventory
event creation. Not contemplated by the FRD; **accepted deliberately** (it removes the per-operator
licence requirement), mitigated by the six controls above, and **must be in the pre-go-live security
review.**

**Q-02 (device auth) is subsumed** into T-3.3 and closed as a separate question.

**Confirmed (2026-08-09):** (a) one Available-Without-Login Suitelet serves the HTML/JS app on GET and
is its JSON API on POST — no second deployment, no CORS; (b) governance is 1,000 units per request;
(c) no logged-in operator context — the Suitelet runs under a dedicated least-privilege **Execute As
Role** (AD-19 privilege separation).

**Consequences now recorded:** **D-21** (device authentication is mandatory — the endpoint is public),
**F-29** (concurrency-pool contention on the shared anonymous-Suitelet pool → throttling constraints on
T-3.2/T-3.4), **AD-19** (privilege separation — the public surface can append queue events and read
reference data only, never touch the ledger), the served bundle carries **no secrets** (T-3.4), and
`allowed_locations` becomes a **WMS-enforced** control (§3.11, no longer advisory).

**Supersedes/affects:** AD-01, AD-09/D-13 (delivery detail), T-3.1 (Suitelet), T-3.3 (rewritten), Q-02
(closed), Q-30 (resolved). **D-13's PWA propagation is the next pass** — its design must now satisfy
F-29's throttling and D-21's device auth, which is why those are recorded first.

## D-20 — A location switch requires connectivity: the one sanctioned exception to invariant #11 · *accepted 2026-08-09*

Invariant #11 (CLAUDE.md) is *"the handheld must work with the radio off."* D-14's cache-warm-on-select
model carves **one** exception: **switching location requires connectivity** (the new location's
master data must be loaded). This is recorded as a formal, bounded exception so invariant #11 is not
quietly weakened — **all other operations remain offline-first.**

**Bounds (non-negotiable):**
- **The switch is atomic.** If connectivity drops mid-warm, the app **keeps the previous location and
  its cache intact** and reports failure. A **half-warmed cache is a defect, not a degraded state.**
- **An offline switch attempt is refused cleanly** with an operator-readable message — **never queued**
  for later.
- **The durable outbound queue is never touched** by a switch attempt, successful or failed (events
  keep their scan-time location, D-14).

**Rejected:** pre-warming *all* allowed locations at login — it inflates the T-3.4 performance budget
for a case that occurs once a shift, at the dock, where connectivity exists.

**Affects:** invariant #11 (amended to name D-20 as its sole exception), T-3.2 (switch = atomic full
purge + re-warm), T-3.4 (login/location select), T-12.5 (tests). Q-31 (one location per session) is the
related assumption.

## D-21 — Device authentication is mandatory · *accepted 2026-08-09*

The D-19 ingest endpoint is an **Available-Without-Login Suitelet — publicly reachable and
unauthenticated at the platform level** (F-27). Operator badge/PIN (D-19/T-3.3) proves *who is
scanning*; it does **not** prove *which device* is talking to the endpoint. **A per-device credential
is mandatory.** Recording the **requirement, not the mechanism** (mechanism is Phase 3 design, task
stub T-3.6):

- A **per-device credential issued at provisioning**, revocable per device.
- **Checked as the very first operation in the POST handler, before any record load** — an unknown or
  revoked device is rejected on a **cheap path that consumes minimal governance** (no cache read, no
  projection read).
- A **per-device rate cap** (distinct from the per-token/per-IP caps of F-29).
- **Device identity and operator identity are separate concerns — do not merge them.** Device identity
  is a transport credential; operator identity (badge/PIN → `custrecord_se_operator`) is in the payload.

**Affects:** T-3.1 (device check is the first POST step), T-3.3 (auth hardening), new **T-3.6** (device
credential design — stub only, not designed here), F-27 (this is part of its mitigation).

## D-22 — Transfer Order outbound is in scope · *accepted 2026-08-09 (resolves Q-33 as option (a))*

D-14 forbids cross-location movement in the WMS and routes inter-location stock through a NetSuite
**Transfer Order**. F-28 flagged that **TO outbound** (pick / stage / ship out of the *source*
location) was scoped nowhere. **Ruling: option (a) — TO outbound is in scope.** The client does move
stock between locations, so the WMS must pick, stage and ship transfer orders out of the source.

- **Wave eligibility, allocation, pick and stage extend to transaction type `transferorder` alongside
  `salesorder` — the same engine, parameterised by transaction type, NOT a parallel one.** (State this
  explicitly so nobody forks the wave/pick engine.)
- **The ledger adapter (T-2.7) gains the TO-fulfilment shape.** The NetSuite transform target
  (transform a Transfer Order into its fulfilment) **requires developer confirmation before build** —
  do not assert NetSuite transform behaviour in the docs.
- **Confirm the Phase 5B inbound path (D-09) handles receipt of a TO the WMS itself fulfilled at
  source** — the destination receipt is the other half of the same transfer.
- **Ordering:** a TO receipt cannot post before its source fulfilment — see **F-30** (amends AD-18 /
  invariant #18). And whether an **in-transit** NetSuite location exists is **Q-36** — if it does, it
  is a holding location, not a warehouse (location class, Q-29/§ D-14).

**Affects:** delivery plan + phase scope (adds tasks to Phases 6–7, reshapes Phase 5B), T-2.7, T-6.1/2,
T-6.3, T-7.1, AD-18, invariant #18. Raises **F-30**, **Q-36**, **Q-37**.

## D-23 — Pure-logic tasks are carved out of the T-0.3 gate · *accepted 2026-08-10, with a hard machine-enforced boundary*

The rule *"no implementation before the register (T-0.3) closes"* exists because most tasks depend on
unanswered questions. **Exactly three do not:** wave clustering (**T-6.1**), bin policy evaluation
(**T-2.3b**) and the event handler registry (**T-2.6**). They are pure functions over data structures
already fixed by the data model, import no SuiteScript module, touch no record, and none of the open
questions changes their inputs or outputs — clustering in particular treats transaction type as
**opaque data**, so even the D-22 transfer-order expansion leaves it untouched. Building them now costs
nothing if an answer surprises us and buys the most: clustering is the hardest algorithmic component in
the system and the one most likely to be wrong first time.

**These three, and no others. D-23 creates no precedent** — a fourth task joining the carve-out
requires a **new ruling** (a new D-number), not an appeal to this one.

**The boundary is not "pure logic" as a judgement call — it is mechanical and CI-enforced:**

- **A carved-out file may not import ANY `N/` module.** No `N/record`, `N/search`, `N/runtime`,
  `N/cache` — **not even `N/error`.** A file that needs a SuiteScript module is, by definition, outside
  the carve-out and stays held until the register closes.

**Error shape (do not defer `ERR_WMS_*` naming to a future caller — no translation layer).** Banning
`N/error` does not mean losing the machine-readable name. Two rules, built to from the start:

- **Business rejections do not throw — they return a structured verdict.** A rejected putaway, a
  cluster that exceeds a cap, a field that fails validation are **normal outcomes**, not exceptions. The
  pure function returns `{ allowed: false, reasonCode: 'WMS_...' }` (or the task's equivalent result
  shape) so the caller branches on data, not on a caught throw. Bin policy evaluation (T-2.3b) is the
  canonical case: `check(...)` returns a verdict.
- **Programmer errors throw a plain `Error` with `err.name` set to the `ERR_WMS_*` value.** A JS
  `Error` has a settable `name`, so `Object.assign(new Error(msg), { name: 'ERR_WMS_INVALID_ARGUMENT' })`
  produces exactly the shape `N/error.create({name})` produces — the boundary sees the same
  `err.name`, and there is **no translation layer to rot**. This is for contract violations (bad
  arguments, impossible state), never for business rejections.
- **Enforced in `scripts/guard-carveout-imports.js`, wired into `npm run verify`.** The guard holds a
  closed allowlist of the three file paths and fails the build if any of them imports an `N/` module.
  It is in place **before** the first line is written, so the boundary cannot be crossed by accident,
  and a fourth path can only be added by a deliberate edit tied to a new ruling.

**Also required for the three (conditions of the carve-out):**

- **Unit-test coverage of the acceptance criteria already written for each task — the tests are the
  deliverable as much as the functions are.**
- **No hard-coded tuning values (invariant #9).** Thresholds, capacities and cart limits arrive as
  **function parameters**, sourced from `customrecord_wms_config` by the caller later — never baked into
  the pure module.
- **Clustering treats transaction type as opaque** — state this in the module header so no one couples
  it to `salesorder`/`transferorder`.
- **The consuming entry-point scripts (Suitelets, Map/Reduce, etc.) do not exist yet — do not write
  them.** The carve-out is the pure logic only.

**Phase 1 remains held for everything else.** This ruling narrows the T-0.3 gate; it does not open it.

**Affects:** T-0.3 (three tasks no longer gated), T-6.1 / T-2.3b / T-2.6 (buildable now, under the
conditions above), CLAUDE.md Working-order note, new CI guard `guard-carveout-imports.js`, `package.json`
verify chain. Enables planning **Pass 2** (the pure-logic build), which runs as its own pass.

## D-24 — The handheld PWA is responsive across desktop, tablet and phone — same operations · *accepted (sponsor requirement, formalised 2026-08-10)*

**Ruling (sponsor, predates the D-13 passes):** *"Can't we make the handheld html responsive, so when
used on a desktop, or tablet or phone the operations are the same?"* **Yes.** The same operations must
work on **desktop, tablet and phone** — not on one device class.

Recorded as a D-number now because it was a sponsor requirement living only in prose, and a
gap-closure pass (`4df2026`) silently narrowed it to "a single class of rugged Android handheld in
portrait." **That narrowing is reversed.** The rule:

- **The supported surface is desktop, tablet and phone.** Capability is **identical** across all three
  — a desktop user and a handheld user perform the **same operations**. The desktop is **not** a
  read-only or supervisor-only view unless the sponsor explicitly says so.
- **What changes across breakpoints is layout and density, not capability** — column count, control
  sizing, table vs card. Real breakpoints are specified in T-3.4.
- **The rugged-Android portrait handheld remains the *primary target* for the performance budget and
  field testing** (T-3.4 SPA budget, T-12.5) — a legitimate way to say "this device must feel fast,"
  **not** a way to narrow the supported surface.
- **If the responsive requirement is ever judged unaffordable, it is raised as a flagged conflict with a
  cost — never resolved silently.**

**Affects:** T-3.4 (responsive requirement + breakpoints), the SPA performance budget wording, T-12.5
(tested across breakpoints), and Q-48 (camera scanning — a consequence of phone support). Interacts with
D-13 (PWA delivery).

## D-25 — A version-mismatched client may always drain its queue; only new work is gated · *accepted 2026-08-10*

Corrects a rule introduced in `4df2026` (client-version *fail-closed on POST*). A device offline through
a deployment is holding **real stock movements** in its durable queue; **refusing its POST loses
inventory truth with no recovery path** — the operator already moved the goods. The rule is split:

- **Drain is always permitted while the event *schema* version is supported.** An out-of-date client may
  **always flush its outbound queue** — those events are physical facts that already happened. Only an
  incompatible **event-schema** version (not merely an old app build) can refuse a drain, and that is a
  migration concern handled by keeping the schema backward-compatible.
- **New work is gated.** The endpoint refuses to issue **new tasks or cache warms** to an out-of-date
  client (`ERR_WMS_CLIENT_UPDATE_REQUIRED`), and the operator is told to update. The queue drains first;
  the block applies to *forward* work only.

**Affects:** T-3.1 (split the version check — drain path vs new-work/warm path), T-3.4 (app update path),
T-12.5 (acceptance: previous-version client drains, then is refused new work). Relates to invariant #19
(never lose a scan) and D-13.

## D-26 — `fanOutCap` is a modelling choice (stopword removal), not a performance cap · *accepted 2026-08-10*

`generateCandidatePairs` (T-6.1) skips any SKU carried by more orders than `fanOutCap`. That is not
merely a throughput lever: **a SKU appearing in a very large share of orders carries almost no
discriminating signal** — clustering on it groups orders that have nothing meaningful in common. Excluding
it is the warehouse equivalent of **stopword removal**, and it is the right call. `fanOutCap` **stays
parameterised** (config-injected per location, invariant #9). Two consequences must be **written down,
not left implicit**:

- **Orders that share *only* high-fan-out SKUs are never compared, and therefore may never cluster.**
  They fall through to singleton (or smaller) waves. This is stated plainly in the `wms_lib_clustering.js`
  module contract so nobody reads a skipped comparison as a bug.
- **`skippedSkus` must surface operationally, not only in the returned diagnostics object.** A cap
  nobody sees reads as full coverage. The held wave-generation task (**T-6.2**) must record, where a
  **supervisor can see it**, that a run skipped SKUs and which ones — so a mis-set cap (too low, excluding
  real signal) is visible rather than silent.

**Affects:** `wms_lib_clustering.js` (contract note), T-6.2 (supervisor-visible skip reporting), F-10.
Relates to the order-projection contract (section 3.12, data model).

## D-27 — Platform-facts pass: verified NetSuite behaviour recorded and applied · *accepted 2026-08-11*

A documentation-grounded pass established the NetSuite platform behaviours the design was assuming or
guessing, now recorded canonically in **`docs/08-platform-facts.md`** (`PF-01`..`PF-30`). **Every design
document cites `PF-nn` rather than restating platform behaviour.** The facts come from NetSuite
documentation, **not** from the project developer and **not** from the live account, so each is either
**CONFIRMED** (documented, safe to design against) or **SANDBOX-PENDING** (must be proven in *this*
account's sandbox first — discharged by the new **T-0.8**; its **T1** gates all of Phase 1).

What this pass changed (each detailed in its own document):
- **AD-03 rewritten** — optimistic concurrency with retry-on-`RCRD_HAS_BEEN_CHANGED`, **no accepted
  lost-update window**; bin-state write uses `record.load`+`save` (6u, conflict-detecting), never
  `submitFields` (2u, silently last-write-wins). PF-11/PF-12.
- **AD-04 error constant corrected** — idempotency signal is **`UNIQUE_RCRD_ID_REQD`**, not
  `DUP_CSTM_RCRD_ENTRY`. PF-13.
- **F-29 rewritten with real pool numbers** (PF-01..PF-05); every mitigation now mandatory; batch size a
  measured config value (default 50); **cache warm moves off the pool to a File Cabinet file**.
- **Q-35 RESOLVED affirmatively** — File Cabinet Available-Without-Login cache warm is the **required**
  design (zero integration concurrency, PF-05), not optional. The shift-start burst is otherwise
  unsurvivable at the pool sizes in PF-01.
- **AD-20** committer on-demand triggering + deployment pool + the lag window restated as a **measured**
  figure (PF-07/PF-08); invariant #1's "up to 5 minutes" was wrong.
- **AD-21** ALA line-freezing routed through the committer as a new event type (PF-26); **AD-22** kill
  switch is a config flag, not deployment status (PF-29).
- **Invariant #16** closed-period becomes a **pre-check** (PF-24/PF-25); **invariant #19** reworded to
  *"the WMS must not let NetSuite go negative"* — the platform will not enforce it for us (PF-22).
- **Ledger adapter (T-2.7) unblocked** — all shapes CONFIRMED (PF-16..PF-21); the "pending developer
  answer" markers are removed.
- **Item cache** resolves **`recordtype`**, not a tracking-mode field (PF-14); `N/cache` constraints
  recorded (PF-15).

**Affects:** docs/08 (new), AD-03, AD-04, AD-19, AD-20/21/22, F-23, F-29, F-30, invariants #1/#16/#19,
T-2.7, T-2.4, new T-0.8/T-0.9, Phase-4 committer tasks, register (Q-35 closed, new Sheet B/C rows).

## D-28 — Receipt-quarantine (RQD) isolation stays an Inventory Transfer, not a Transfer Order · *accepted 2026-08-11*

A documented recommendation favoured a **Transfer Order** for the location-to-location move that isolates
non-fulfillable receipts within one subsidiary. **Rejected**, reasoning recorded so it is not revisited:
the RQD move is **same-roof, same-minute, immediately after receipt**; a Transfer Order imposes approval,
fulfilment, in-transit and receipt steps, and since **a TO receipt cannot precede its fulfilment
(`CANT_RCEIV_BEFORE_FULFILL`, PF-19)** the isolation could not complete within one committer cycle. The
usual objection to an **Inventory Transfer** — that exact serials/lots must be known at entry — **does not
apply here, because the operator has already scanned them.** RQD isolation is therefore an **Inventory
Transfer** (PF-20).

**Affects:** T-2.7 (Inventory Transfer shape), the inbound/QC isolation path (Phase 5B), `06-netsuite-boundary.md`.

## D-29 — Serialised items are IN scope · *accepted 2026-08-11; SUPERSEDES D-08*

Serialised items are **stocked, picked, shipped and received in WMS-managed warehouses.** The sponsor's
settled position is that **lot and serial were required from ideation**; D-08's exclusion was a wrong
turn, now reversed. **D-08 is marked SUPERSEDED** (its reasoning and date retained for the record).

**Platform detail (PF-14):** a NetSuite item may be **inventory or assembly**, and either may be **plain,
lot-tracked or serialised — six record types**: `inventoryitem`, `lotnumberedinventoryitem`,
`serializedinventoryitem`, `assemblyitem`, `lotnumberedassemblyitem`, `serializedassemblyitem`. The item
cache resolves **record type**, not a tracking-mode field.

Tracking modes are now **PLAIN, LOT and SERIAL** (invariant #14). Bin state stays the scalar quantity
projection, but a serialised item additionally has its own lifecycle record (`customrecord_wms_serial_state`,
Part C) and two new invariants (#21, #22). **Affects:** invariants #14/#19/#21/#22, schema (serial_state),
all flows (Part D), the handheld serial cache (Part E), the ledger adapter (Part F), and the entire Part-H
D-08 cascade sweep.

## D-30 — Site and NetSuite location are distinct concepts · *accepted 2026-08-11*

A **site** is a physical building. A **NetSuite location belongs to exactly one site; a site may contain
several.** A **bin belongs to exactly one location and therefore one site.** All three bindings are
**immutable.**

**Worked example (recorded verbatim):** *Location A is the good warehouse with ~1,000 bins; Location B is
the RQD warehouse with ~3 bins; both are under one roof, one site, but the system keeps them separate.*

**Consequences (stated so they are not re-litigated):**
- **The operator picker selects a SITE**, not a location. **Cache warm covers every location at that
  site**, so the RQD bins (Location B) are reachable by the operator who physically walks to them.
- **The `<LOCATIONCODE>-<BINCODE>` naming prefix stays the LOCATION code** — that is what guarantees bin
  uniqueness and what NetSuite postings reference. The prefix is not re-based on the site.

**Representation (sponsor ruling 2026-08-11):** site is a **custom LIST field on Location**
(`custrecord_loc_site` backed by `customlist_wms_site`), **not a custom record.** Locations sharing a
value are the same building. Because the list is hand-maintained, bin/location setup **validates the site
against the existing list values, not free-text** — a typo would otherwise mint a phantom site (§3.14).

**Affects:** schema (site as a list field on Location, §3.14), the handheld picker + cache warm (Part E),
D-14 bin naming, the location class (below).

## D-31 — Movement rules by scope · *accepted 2026-08-11; EXTENDS D-28*

- **Between sites** — a NetSuite **Transfer Order**, picked and shipped by the WMS (D-22).
  **`ERR_WMS_CROSS_LOCATION_MOVE` re-scopes to cross-SITE moves only.**
- **Between NetSuite locations within one site** (A <-> B, **both directions**) — an **Inventory Transfer**
  posted by the committer. **B -> A is as routine as A -> B**: stock deemed fit for sale transfers back
  into an operational bin.

**This REVERSES the previously recorded rule that a WMS bin transfer may never cross locations** (D-14).
That rule was too strong: within a site, crossing NetSuite locations is a committer-posted Inventory
Transfer, not a forbidden move. **Sweep for the old wording** (Part H / Part G).

**Affects:** invariant #13 (bin movements now post in two cases), D-14 cross-location wording, T-4.3
(cross-location check re-scoped to cross-site), the RQD isolation flow (Part D).

## D-32 — Customer returns (RMA) are IN scope · *accepted 2026-08-11; resolves Q-45*

**RMA receipt joins PO, TO and Work-Order receipts in the Phase 5B inbound path**, and is **one of the
three points where serials enter the system** (Part D). Delivery plan and phase scope updated.

**Affects:** Q-45 (resolved), Phase 5B scope, the delivery plan, serial entry validation (Part D).

## D-33 — Inventory write-off path, with mandatory authorisation · *accepted 2026-08-11*

Stock reviewed and condemned is **written off via an Inventory Adjustment (PF-21).** A write-off destroys
value and hits the GL, so it is **not a bare operator scan**: it requires **supervisor authorisation and a
mandatory reason code.** For serialised items it **retires named serials** (status -> RETIRED in
`customrecord_wms_serial_state`, never deletion, consistent with PF-23).

**Open questions raised (recorded, not resolved):** which **GL account** offsets the write-off (Q-53), and
is there a **value threshold** above which finance — not a warehouse supervisor — must approve (Q-53).
NetSuite's **Default Inventory Count Account** preference may answer the first half.

**Affects:** a new write-off event type + handler (Part D task), the committer (same phase as Inventory
Transfers), invariant #13 (write-off posts an Inventory Adjustment), Q-53.

## Location class — confirmed REQUIRED, no longer conditional · *2026-08-11 (under D-30/D-33)*

Every location is **operational or holding.** A **holding** location (RQD) is **excluded from default wave
generation, replenishment sourcing and putaway targeting**, and **its stock never counts toward an
operational location's availability.** But it is **NOT barred from fulfilment** — stock can legitimately
ship from Location B (a defect giveaway is the sponsor's own example), and NetSuite's location-locked
transactions handle that natively. **Any earlier "holding locations never fulfil" formulation is wrong —
correct it.** **PF-32 confirms in-transit inventory creates no location record, so RQD is the only driver**
of the class (this removes the earlier Q-36 dependency for *requiring* the class — the class is required
now; Q-36 only affects whether an in-transit location additionally needs classifying, which PF-32 says it
does not).

**Affects:** the location-class schema (Part C), the Q-29/Q-36 knot in D-14 (the class is no longer
*conditional* on both landing), wave/replen/putaway scoping, availability.

## D-34 — Serial share is a parameter with a design envelope, not a measured value · *accepted 2026-08-11 (sponsor)*

**Ruling:** every account differs and **serial may be a material share.** The design **must function
correctly at up to 100% serialised.** Serial share is therefore a **parameter with a design envelope**,
not a number the build waits on. **T-0.1's census becomes an input that TUNES configuration, not a gate on
the design** (this changes the character of Q-21 — resolved, not open).

**Parameterised (invariant #9 — all from `customrecord_wms_config`):** the **wave-scoped serial cache
size**; the **scan-volume model in T-0.2**; the **handheld multi-scan flow** (how many serials one screen
collects); the **ingest batch size**.

**Design consequence (recorded):** a line for **N serialised units is ONE event carrying N serials**, not
N events — **one record, one bin-state update, one governance charge.** Size the payload against the
**10 MB Map/Reduce value limit (PF-10)** and the **3,000-character group-key bound (PF-10 / T-2.6a)** —
at 100% serial and large N the serial array is the payload's dominant term, so the batch size must be
bounded by *value size*, not only governance units.

**Affects:** Q-21 (resolved), T-0.1 (census tunes config), T-0.2 (scan-volume model + 100% envelope),
T-3.2 (serial cache size a config value), T-2.6a (group-key bound), F-29 (batch size bounded by value
size too), invariant #9.

---

## Superseded

| Item | Status |
|---|---|
| **D-08 (serial out of scope)** | **SUPERSEDED by D-29 (2026-08-11)** — serial is in scope; see the Part-H cascade sweep |
| F-01 (original: cache concurrency race) | **Rewritten** — see D-01 and revised F-01 |
| F-21 (serial scan volume) | ~~Closed by D-08~~ **RE-OPENED by D-29** — restated: serial volume is a real sizing input again (T-0.1 census, T-0.2) |
| Q-05 (receiving/counting/returns deferred) | **Receiving closed by D-09**; counting deferred (Q-46); **returns closed by D-32** |
| Q-15 (lot expiry coverage) | **Answered structurally by D-09** — expiry captured at receipt |
| Q-21, Q-22, Q-23 (serial questions) | ~~Closed by D-08~~ **RE-OPENED / restated by D-29** — serial mix, bin rule and capture-point are now live design (invariant #21, serial_state, Part D) |
| F-20 (back-office attribution) | **Materially reduced by D-09** — severity S2 retained as backstop |
| F-23 costing-sequence half | **Withdrawn by D-11** — NetSuite runs costing; period half retained |
| AD-18 per-item dependency graph | **Replaced by D-11** with a global two-phase priority |
| Q-24 (costing method), Q-26 (negative inventory) | **Closed by D-11** |
| D-06 and the five-tier capability model | **Superseded by D-07** |
| F-19 (original: tier/licensing problem) | **Rewritten** — now "the bin-number field will never be valid" |
| Q-18, Q-19, Q-20 (tier/licensing questions) | **Closed by D-07** |
| AD-16 (capability tier abstraction) | **Rewritten** as the NetSuite boundary |
| `06-capability-tiers.md` | **Replaced** by `06-netsuite-boundary.md` |
| F-02 (lock protocol) | **Withdrawn by D-12** — a lock is *possible* via `externalid` but **rejected on simplicity** for single-threaded bin-state settlement (not impossible; earlier "reduced to commit stage" also superseded) |
| F-05 (replenishment deadlock) | **Resolved by D-03** — no longer a live risk |
| Q-03, Q-04, Q-14 | **Closed by D-03** |
| AD-03 | **Rewritten** in `02-architecture.md` (optimistic version check, not atomic CAS) |
| **AD-04 (unique-field idempotency)** | **Rewritten by D-12** — `externalid` = UUID as primary guard **plus** committer-side dedupe (keep first, rest `SUPERSEDED`) as safety net |
| **AD-05 (concurrency lock protocol)** | **WITHDRAWN by D-12** — lock is possible via `externalid` but rejected on simplicity; order lock redundant anyway; single-threaded bin-state settlement; lock record, reaper and `STALE_LOCK`/`LOCK_TIMEOUT` deleted |
| **AD-09 ("PWA cannot deliver persistence")** | **Corrected by D-13** — PWA delivers persistence via IndexedDB + `persist()`; residual risk accepted in writing |
| **AD-14 (five bin types)** | **Extended by D-16** — seven types + `availableForFulfilment` |
| **Q-08 (single vs multi location)** | **Closed by D-14** — multi-location in scope; location mandatory session context |
| **Q-13 (WMS SuiteApp installed?)** | **Closed by D-18** — not installed; D-07 confirmed |
| **Q-16 (bin types beyond UNIT/BULK)** | **Closed by D-16** |
| **Q-10 (reserved stock occupies a bin?)** | **Closed 2026-08-09 — moot** — WMS tracks physical quantity only (no D-number: a scoping clarification, not a design ruling) |
| **T-0.4 (audit inventorybalance by bin)** | **Superseded by D-17** — bin data migrates from a third-party app (case b) |
| **T-0.6 / the whole lock subsystem** | **Superseded by D-12** — see AD-04, AD-05 rows |
