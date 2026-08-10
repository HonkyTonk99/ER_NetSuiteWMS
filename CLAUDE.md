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

## Non-negotiable invariants

*Revised 2026-08-08 per sponsor rulings D-01…D-11 in `docs/05-decisions-log.md`. Invariants 1, 2, 7,
13, 14 and 17–20 changed materially or are new — do not work from a cached memory of an earlier
version.*

1. **`customrecord_wms_bin_state` is the operational truth of a bin, not `inventorybalance`.** The
   ledger lags by the event queue (up to 5 min) and is wrong by design during that window. Never
   validate a scan against `inventorybalance`, and never cache bin contents alongside the
   projection. (F-01, AD-03)
2. **Bin rules come from the bin's policy, never from a hardcoded type check.** No
   `if (binType === 'UNIT' || binType === 'BULK')` anywhere. Staging, receiving and QC bins are
   legitimately mixed-SKU. (F-18, AD-14)
3. **Never perform a saved search on the ingestion success path.** Idempotency uses the record's
   standard **`externalid`** (= client UUID), which **is** platform-enforced unique (D-12) — the
   ingestion **Suitelet** sets `externalid` and attempts the create; a duplicate fails at the platform
   and is caught (no pre-read, no search). The **committer** additionally dedupes by UUID (keep first,
   rest `SUPERSEDED`) as a safety net. Custom text fields have no uniqueness — only `externalid` does.
   Bin state is a record lookup by internal ID. (F-08, AD-04, D-12)
4. **Never call `record.transform` synchronously from a Suitelet or RESTlet.** All ledger writes go
   through the Map/Reduce committer. One `record.transform` per sales order, ever. (F-15, AD-01)
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
    inventory detail line. Bin movements post **nothing** to NetSuite. (F-19, AD-16, D-07)
14. **Item tracking mode is per item, resolved from the item cache — never an account-level flag.**
    **PLAIN or LOT only** — serial is out of scope (D-08) and a serialised item must be *rejected
    with an explicit exception*, never posted on a guess. Mixed-mode orders are normal. All of it
    goes through `wms_lib_ledger_adapter.js`. (AD-16)
15. **Never allocate stock NetSuite has not committed to that order.** Wave eligibility filters on
    committed quantity; picked quantity per line may not exceed it. The WMS refines NetSuite's
    commitment, it does not replace it. Getting this wrong ships one customer's stock to another
    while the totals still look right. (F-22, AD-17)
16. **Post transactions dated by scan time, not commit time.** A pick scanned at 23:58 must not land
    in next month's period because the queue took six minutes; if that period has closed it cannot
    post at all. Post current **and raise `CLOSED_PERIOD_POSTING`**. (F-23, AD-17)
17. **Never write costing logic.** NetSuite runs costing. The WMS supplies quantity, date and lot and
    has no opinion about valuation. No event ordering exists for costing purposes. (D-11, AD-17)
18. **Inbound posts before outbound, every cycle.** Two phases: all receipts, then all fulfillments.
    Global priority, not a per-item dependency graph. **One exception (F-30, D-22): a Transfer Order
    receipt whose source TO fulfilment is not yet `POSTED` is set `DEFERRED` and retried — never
    `FAILED` — because the destination receipt cannot precede its own source leg.** (F-24, F-30, AD-18)
19. **The WMS may go negative; NetSuite may not.** An outbound posting NetSuite cannot satisfy is
    set `DEFERRED` and retried — **never `FAILED` on first attempt.** Deferred is legitimate work in
    the wrong sequence; failed needs a human. Keep them distinct or the exception queue becomes
    noise. (F-25, AD-18)
20. **A bin is EMPTY when `custrecord_bs_item` is cleared — not when quantity equals zero.** Never test
    emptiness with a float comparison: `custrecord_bs_qty` is a Decimal, and UOM conversion or partial
    units can leave fractional residue (a bin at `0.0000001` would read as permanently occupied). A bin
    with negative quantity and an item still set is **OCCUPIED AND ANOMALOUS**, and accepts only the SKU
    and lot already recorded against it. (F-25)

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

Read `docs/05-decisions-log.md` before `docs/01-review-findings.md` — it records which findings have
been overruled, rescoped or resolved, and why.
