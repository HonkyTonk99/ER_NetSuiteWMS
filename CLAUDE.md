# CLAUDE.md — Advanced Warehouse Management (NetSuite WMS)

Read `docs/00-objective.md` first, then `docs/01-review-findings.md`, then
`docs/02-architecture.md`. The architecture decisions **override** the sample code in the source FRD
— that code contains known defects (F-12 … F-17) which must not be reproduced.

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
3. **Never perform a saved search on the ingestion success path.** Idempotency comes from the unique
   index on `custrecord_se_event_id`, not from a lookup. Bin state is a record lookup by internal
   ID. (F-08, AD-04)
4. **Never call `record.transform` synchronously from a Suitelet or RESTlet.** All ledger writes go
   through the Map/Reduce committer. One `record.transform` per sales order, ever. (F-15, AD-01)
5. **Never build a group key by string concatenation.** Handlers return key **objects**, serialised
   centrally. Enum values contain underscores. (F-12, AD-06, AD-15)
6. **Never match fulfillment lines by item ID.** Use the SO line unique key, and aggregate all events
   for a line before touching the record. Unmatched lines get `itemreceive = false` explicitly. (F-14, AD-07)
7. **Locks belong to the commit stage only.** Operator-to-operator collision is not a credible risk
   on a directed floor; ingestion uses the projection's optimistic version check. Where locks *are*
   used, acquire in `(resourceTypeOrdinal, resourceId)` order. (D-01, AD-05)
8. **Never leave a failed event as just a log line.** Every FAILED event raises a
   `customrecord_wms_exception`. The operator already moved the stock. (F-04, AD-11)
9. **Never hard-code a tuning value.** Thresholds, capacities, TTLs and batch sizes come from
   `customrecord_wms_config`; bin rules from `customrecord_wms_bin_policy`. (F-16, AD-13, AD-14)
10. **Never let the dashboard query the raw scan event table.** Read metric snapshots. (F-11, AD-12)
11. **The handheld must work with the radio off.** Offline is the expected state, not a failure
    mode. Any scan requiring a server round-trip to validate is a design defect. (D-04, AD-09)
12. **Never add an event type by editing the RESTlet, mapper or reducer.** Register a handler.
    (AD-15)
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
    Global priority, not a per-item dependency graph. (F-24, AD-18)
19. **The WMS may go negative; NetSuite may not.** An outbound posting NetSuite cannot satisfy is
    set `DEFERRED` and retried — **never `FAILED` on first attempt.** Deferred is legitimate work in
    the wrong sequence; failed needs a human. Keep them distinct or the exception queue becomes
    noise. (F-25, AD-18)
20. **A negative bin is occupied, not empty.** Never test `qty <= 0` for emptiness — use `qty === 0`.
    A negative bin accepts only the SKU and lot already recorded against it. (F-25)

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
