# 05 — Decisions Log

Rulings from the sponsor (TK), 2026-08-07 to 2026-08-08. These override the corresponding entries in
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
bin holding `(itemId, lotNumber, qty, version)`, updated by the ingestion RESTlet on accept and
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
Every inventory-writing sample in the FRD sets `binnumber` and `issueinventorynumber` on the same
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
*(narrowed to PLAIN and LOT by D-08)*,
read from the item record and cached as static data. Mixed-mode orders are normal and one
`record.transform` must handle all three. The ledger interface reduces to three transaction shapes
— Item Fulfillment, Inventory Adjustment, Inventory Transfer — and **bin movements post nothing**,
because stock has not changed location.

**Three risks it brings into the open**, two of them previously masked:

- **F-19 rewritten.** The FRD's code annex writes `binnumber` and creates Bin Transfer records.
  Under D-07 neither will ever be valid. `binnumber` must appear nowhere in the codebase.
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

## D-08 — Serial numbers out of scope; batch numbers in scope · *accepted*

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

## Superseded

| Item | Status |
|---|---|
| F-01 (original: cache concurrency race) | **Rewritten** — see D-01 and revised F-01 |
| F-21 (serial scan volume) | **Closed by D-08** — serial out of scope |
| Q-05 (receiving/counting/returns deferred) | **Receiving closed by D-09**; counting and returns still deferred |
| Q-15 (lot expiry coverage) | **Answered structurally by D-09** — expiry captured at receipt |
| Q-21, Q-22, Q-23 (serial questions) | **Closed by D-08** |
| F-20 (back-office attribution) | **Materially reduced by D-09** — severity S2 retained as backstop |
| F-23 costing-sequence half | **Withdrawn by D-11** — NetSuite runs costing; period half retained |
| AD-18 per-item dependency graph | **Replaced by D-11** with a global two-phase priority |
| Q-24 (costing method), Q-26 (negative inventory) | **Closed by D-11** |
| D-06 and the five-tier capability model | **Superseded by D-07** |
| F-19 (original: tier/licensing problem) | **Rewritten** — now "binnumber will never be valid" |
| Q-18, Q-19, Q-20 (tier/licensing questions) | **Closed by D-07** |
| AD-16 (capability tier abstraction) | **Rewritten** as the NetSuite boundary |
| `06-capability-tiers.md` | **Replaced** by `06-netsuite-boundary.md` |
| F-02 (lock protocol on ingestion path) | **Reduced scope** — locks retained only for the commit stage; removed from ingestion |
| F-05 (replenishment deadlock) | **Resolved by D-03** — no longer a live risk |
| Q-03, Q-04, Q-14 | **Closed by D-03** |
| AD-03, AD-05, AD-09 | **Rewritten** in `02-architecture.md` |
