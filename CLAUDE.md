# CLAUDE.md — Advanced Warehouse Management (NetSuite WMS)

Read `docs/00-objective.md` first, then **`docs/05-decisions-log.md`** (it is the current state of
every ruling and overrides the findings and architecture docs), then `docs/06-netsuite-boundary.md`
before any ledger code, then `docs/01-review-findings.md` and `docs/02-architecture.md`. The
architecture decisions **override** the sample code in the source FRD — that code contains known
defects (F-12 … F-17) which must not be reproduced.

## Recording decisions (process — do not skip)

**Every ruling gets a `D-number` in `docs/05-decisions-log.md` at the time it is made, and the
corresponding register row in `docs/04-open-questions.md` cites it.** A ruling that exists only in a
task file or a register row **has not been recorded.** The decisions log is the first thing a new
session reads; if it is out of date, a withdrawn design gets rebuilt. When a ruling changes an
architecture decision or invariant, propagate it in the same pass and add a row to the log's
Superseded table.

**Flag any narrowing of scope as a conflict — by default, even when it looks like a detail.** Reducing
a supported surface, dropping an input path, defaulting a client to fail-closed, scoping something "out
of v1" — none of these may be decided silently in prose inside a pass doing other work. If a pass
surfaces a reason to narrow scope, it is raised as a **flagged conflict with a cost** for the sponsor to
rule on, never resolved in passing. A decision made in passing that nobody ruled on is the project's
recurring failure mode (it is how the pre-D-07 residue and the D-24/D-25 narrowings happened); treat a
silent scope reduction as a defect, not an optimisation.

## Non-negotiable invariants

*Revised 2026-08-08 per sponsor rulings D-01…D-11 in `docs/05-decisions-log.md`. Invariants 1, 2, 7,
13, 14 and 17–20 changed materially or are new — do not work from a cached memory of an earlier
version.*
*Further revised 2026-08-11 per the serial reissue (D-29…D-33): **#4** now per (order, location); **#13**
gains two posting exceptions; **#14** admits SERIAL; **#19** adds the serial-never-negative rule; **#21**
and **#22** are new (serial in one bin; bin qty = serial-row count). Serial is IN scope (D-08 superseded).
**#23** is new (replenishment never sources from a holding location — hard guard, location-class pass).*

1. **`customrecord_wms_bin_state` is the operational truth of a bin, not `inventorybalance`.** The
   ledger lags by the event queue **by a measured window** (established in T-12.1, not an assumed
   "5 minutes" — the committer is triggered on demand, AD-20/PF-07/PF-08) and is wrong by design during
   it. Never validate a scan against `inventorybalance`, and never cache bin contents alongside the
   projection. The bin-state write is `record.load`+`save` (conflict-detecting, PF-11/PF-12), never
   `submitFields`; a `RCRD_HAS_BEEN_CHANGED` conflict is retried, then raised — **no accepted
   lost-update window** (AD-03, D-27). (F-01, AD-03)
2. **Bin rules come from the bin's policy, never from a hardcoded type check.** No
   `if (binType === 'UNIT' || binType === 'BULK')` anywhere. Staging, receiving and QC bins are
   legitimately mixed-SKU. (F-18, AD-14)
3. **Never perform a saved search on the ingestion success path.** Idempotency uses the record's
   standard **`externalid`** (= client UUID), which **is** platform-enforced unique (D-12) — the
   ingestion **Suitelet** sets `externalid` and attempts the create; a duplicate fails at the platform
   with **`UNIQUE_RCRD_ID_REQD`** (PF-13, **not** `DUP_CSTM_RCRD_ENTRY`) and is caught (no pre-read, no
   search). The **committer** additionally dedupes by UUID (keep first, rest `SUPERSEDED`) as a safety
   net. Custom text fields have no uniqueness — only `externalid` does. Bin state is a record lookup by
   internal ID. (F-08, AD-04, D-12)
4. **Never call `record.transform` synchronously from a Suitelet or RESTlet.** All ledger writes go
   through the Map/Reduce committer. **One `record.transform` per (sales order, location)**, ever — a
   single Item Fulfilment cannot span locations (PF-18); the rule degenerates to one-per-order when the
   order sits in a single location. (F-15, AD-01, D-27)
5. **Never build a group key by string concatenation.** Handlers return key **objects**, serialised
   centrally. Enum values contain underscores. (F-12, AD-06, AD-15)
6. **Never match fulfillment lines by item ID.** Use the SO line unique key, and aggregate all events
   for a line before touching the record. Unmatched lines get `itemreceive = false` explicitly. (F-14, AD-07)
7. **No distributed locks — withdrawn by choice (D-12), not because they're impossible.** A lock
   *could* be built on `externalid`, but it is **rejected on simplicity**: order work is serialised by
   AD-06 grouping plus flipping events to `PROCESSING` on claim, and **bin-affecting commit work is
   single-threaded through one Map/Reduce queue** (single-threaded bin-state settlement) — correct by
   construction, no TTL/reaper/deadlock handling. `customrecord_wms_concurrency_lock` is deleted.
   Ingestion still takes no lock. (D-01, D-12; supersedes AD-05)
8. **Never leave a failed event as just a log line.** Every FAILED event raises a
   `customrecord_wms_exception`. The operator already moved the stock. (F-04, AD-11)
9. **Never hard-code a tuning value.** Thresholds, capacities, TTLs and batch sizes come from
   `customrecord_wms_config`; bin rules from `customrecord_wms_bin_policy`. (F-16, AD-13, AD-14)
10. **Never let the dashboard query the raw scan event table.** Read metric snapshots. (F-11, AD-12)
11. **The handheld must work with the radio off.** Offline is the expected state, not a failure
    mode. Any scan requiring a server round-trip to validate is a design defect. **The sole sanctioned
    exception is a location switch, which requires connectivity (D-20) — atomic, cleanly refused when
    offline, and never touching the outbound queue.** No other exception is permitted. (D-04, AD-09, D-20)
12. **Never add an event type by editing the ingestion Suitelet, mapper or reducer.** Register a
    handler. (AD-15)
13. **`binnumber` must not appear anywhere in the codebase.** NetSuite has no bins — bins live only
    in the WMS. No Bin Management feature, no Bin Transfer record type, no bin field on any
    inventory detail line. **Bin movements post nothing to NetSuite when source and destination bins
    share a NetSuite location — with TWO exceptions (D-31, D-33):** crossing NetSuite locations within a
    site posts an **Inventory Transfer** (D-31); writing stock off posts an **Inventory Adjustment**
    (D-33). `binnumber` and Bin Management stay prohibited regardless — the CI guard is unchanged.
    (F-19, AD-16, D-07, D-31, D-33)
14. **Item tracking mode is per item, resolved from the item cache — never an account-level flag.**
    **Tracking mode IS the record type, not a field (PF-14):** the cache resolves `recordtype` across the
    **six types** (`inventoryitem`/`lotnumberedinventoryitem`/`serializedinventoryitem` + the assembly
    equivalents) to **PLAIN / LOT / SERIAL**. **All three are in scope (D-29 — serial is IN scope, D-08
    superseded).** There is **no** "reject serialised items" rule — that behaviour is now a defect.
    Mixed-mode orders are normal. All of it goes through `wms_lib_ledger_adapter.js`. (AD-16, D-27, D-29)
15. **Never allocate stock NetSuite has not committed to that order.** Wave eligibility filters on
    committed quantity; picked quantity per line may not exceed it. The WMS refines NetSuite's
    commitment, it does not replace it. Getting this wrong ships one customer's stock to another
    while the totals still look right. (F-22, AD-17)
16. **Post transactions dated by scan time, not commit time.** A pick scanned at 23:58 must not land
    in next month's period because the queue took six minutes. Posting period derives from `trandate`;
    backdating within an *open* period is permitted (PF-24). **This is now a PRE-CHECK, not a caught
    failure:** the committer reads `closed` on the `accountingperiod` record (PF-24) and decides before
    posting; if the scan-time period is closed it raises `CLOSED_PERIOD_POSTING`. `CLOSED_TRAN_PRD` is
    kept only as a backstop. **Multi-Book caveat (PF-25):** with Extended Accounting Period Close the
    shared `closed` flag is true only when closed in *all* books, so the pre-check must inspect
    book-specific status if Multi-Book is enabled (Sheet C). (F-23, AD-17, D-27)
17. **Never write costing logic.** NetSuite runs costing. The WMS supplies quantity, date and lot and
    has no opinion about valuation. No event ordering exists for costing purposes. (D-11, AD-17)
18. **Inbound posts before outbound, every cycle.** Two phases: all receipts, then all fulfillments.
    Global priority, not a per-item dependency graph. **One exception (F-30, D-22): a Transfer Order
    receipt whose source TO fulfilment is not yet `POSTED` is set `DEFERRED` and retried — never
    `FAILED` — because the destination receipt cannot precede its own source leg.** (F-24, F-30, AD-18)
19. **The WMS may go negative for PLAIN and LOT; the WMS must not let NetSuite go negative; and the WMS
    must NEVER go negative for a serialised item.** Core NetSuite *permits* negative inventory (PF-22) —
    prevention lives in the Enhanced Validations SuiteApp, which this account may not have installed, so
    **the platform will not enforce this for us.** The committer therefore **pre-checks availability and
    sets `DEFERRED` on its own judgement (proactive, not a caught rejection)**. Asymmetry by tracking mode
    (PF-22): serial/lot items genuinely refuse (`NOT_IN_INVT`, `NUM_ITEMS_GRTR_THAN_QTY`) — kept as a
    catch-and-defer backstop; **plain items post negative if not pre-checked** — so the WMS pre-check is
    the *only* control for them. **A serialised item can never go negative in the WMS either — you cannot
    ship a serial you do not hold (invariant #21).** An outbound NetSuite cannot satisfy is set `DEFERRED`
    and retried — **never `FAILED` on first attempt.** Deferred is legitimate work in the wrong sequence;
    failed needs a human. Keep them distinct or the exception queue becomes noise. (F-25, AD-18, D-29)
20. **A bin is EMPTY when `custrecord_bs_item` is cleared — not when quantity equals zero.** Never test
    emptiness with a float comparison: `custrecord_bs_qty` is a Decimal, and UOM conversion or partial
    units can leave fractional residue (a bin at `0.0000001` would read as permanently occupied). A bin
    with negative quantity and an item still set is **OCCUPIED AND ANOMALOUS**, and accepts only the SKU
    and lot already recorded against it. (F-25)
21. **A serial number is in exactly one bin at a time.** A serialised unit is a single physical object and
    cannot be in two places. A putaway or transfer naming a serial already recorded elsewhere (an active
    row in `customrecord_wms_serial_state`) is **rejected**. A **lot**, by contrast, may split freely
    across bins and locations (PF-31) — it is a quantity attribute, not a physical unit. (D-29, PF-31)
22. **For a serialised item, bin-state quantity equals the count of its serial rows in that bin.**
    `custrecord_wms_serial_state` is the per-unit truth; `customrecord_wms_bin_state` is the scalar
    quantity. Reconciliation (T-8.3) checks the two agree for serialised items and raises on divergence.
    (D-29, PF-31)
23. **Replenishment must NEVER source from a holding location — a hard guard, not a preference.** A
    HOLDING location (RQD) holds stock that is not fit to sell; sourcing a replenishment from it physically
    ships defective goods to a customer. Every replenishment candidate is filtered on
    `custrecord_loc_class === OPERATIONAL` before it can be selected, and a task that would source from a
    holding location is refused outright, not merely de-prioritised. The location class also excludes
    holding locations from the picker default, the default wave sweep and putaway targeting — but *those*
    are defaults a named order/target can override; **this one is absolute.** (D-30, D-33)

## Conventions

- SuiteScript **2.1**. Every file declares `@NApiVersion 2.1` and `@NModuleScope SameAccount`.
- Naming: `wms_<type>_<purpose>.js` — `rl_` RESTlet, `mr_` Map/Reduce, `ss_` Scheduled, `ue_` User
  Event, `sl_` Suitelet, `cs_` Client, `lib_` shared module.
- Custom records `customrecord_wms_*`; fields `custrecord_<prefix>_*` per `docs/03-data-model.md`.
- Business logic lives in `lib_` modules as pure functions wherever possible, so it is unit-testable
  without a NetSuite account. Entry-point scripts should be thin.
- Errors use `error.create({ name: 'ERR_WMS_*', message })` with a machine-readable name the client
  can branch on and a message a warehouse supervisor can act on.
- Governance: check `runtime.getCurrentScript().getRemainingUsage()` before any transform or save in
  a loop; yield cleanly rather than failing mid-batch. (F-17)
- All searches used on hot paths must be backed by an index; state which one in a comment.

## Definition of done for any task here

- Acceptance criteria in the task file all demonstrably pass.
- Unit tests for any pure logic added; integration verified in the DEV sandbox.
- Governance consumption measured and recorded for anything on the scan or commit path.
- No new hard-coded tuning values.
- Failure paths produce an actionable exception record, not a silent log.

## Working order

Phases are dependency-ordered. Phase 0 gates everything. **Phase 3 is the only phase blocked on an
unanswered question** — Q-01, the handheld platform. Everything else has what it needs to start once
Phase 0 completes.

Inbound (PO / TO / Work Order receipt and putaway) is **in scope** since D-09 — Phase 5B.

**Do not begin implementation before `T-0.3` closes the remaining register.** Several tasks are
deliberately unbuildable until a human answers a question the source FRD never asked.

**Exception — D-23 (2026-08-10):** exactly three pure-logic tasks are carved out of the T-0.3 gate and
may be built and unit-tested now — **T-6.1** (wave clustering), **T-2.3b** (bin policy evaluation) and
**T-2.6** (event handler registry). The carve-out is mechanically bounded: a carved-out file may import
**no `N/` module** (not even `N/error`), enforced by `scripts/guard-carveout-imports.js` in
`npm run verify`. These three only — a fourth needs a new ruling. Everything else stays held.

Read `docs/05-decisions-log.md` before `docs/01-review-findings.md` — it records which findings have
been overruled, rescoped or resolved, and why.
