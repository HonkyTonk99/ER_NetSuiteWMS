# 12 - Phase 14: Sandbox Deployment, Integration & Solution UAT

*The consolidated **G2** stage (D-59). Development (G1) is complete: all phases 0-13 are built, every
`npm run verify` is green (37 suites, 336 tests incl. the tier-1 Solution Acceptance Tests). This is the
in-account work - deploy, wire the thin N/ layers, verify real platform behaviour, run Solution UAT. Nothing
here was runnable without a NetSuite account; nothing here was faked in G1.*

## A. Account prerequisites (read first - these were the open "sandbox-only" items)

Answer/confirm in the sandbox, then tune `customrecord_wms_config`:
- **Q-47** sandbox target + SDF deploy-rights owner + refresh schedule.
- **Q-49** service tier + SuiteCloud Plus licence count -> sizes concurrency (F-29); set channel routing config (D-49).
- **Q-50** Enhanced Validations SuiteApp / Prevent Negative Inventory on? -> if off, the WMS pre-check (#19) is the only control.
- **Q-51** Multi-Book? -> if on, the period pre-check inspects book-specific close (PF-25).
- **Q-52** OneWorld / cross-subsidiary? -> intercompany (D-51) field names + `PARTIAL_FULFILL_RCEIV_DISALLWD`.
- **T-0.1** item census (PLAIN/LOT/SERIAL share) -> tunes cache + batch config (D-34).
- **T-0.4** migration source + owner.

## B. Enable features (per the feature matrix in docs; D-07/D-41)

- **ON:** Multi-Location Inventory; Lot Tracking + Serialized Inventory **per item as the catalogue needs**;
  Transfer Orders; Work Orders / Assembly Items (for the WO flow); RMA / Return Authorizations.
- **OFF / NOT required (D-07/D-41):** Bin Management; **Advanced Bin / Numbered Inventory Management**;
  **Inventory Status**. (QC is the WMS HOLDING-class model, not Inventory Status.)
- **Optional:** SuiteCloud Plus (the design runs on the base pool and scales if present, D-49).

## C. Deploy (SDF)

1. `suitecloud project:validate --server` - **this is where the authored objects/scripts get their first
   real schema check** (every object header says so). Fix any field-type/tag corrections the account's SDF
   version needs.
2. `suitecloud project:deploy` - the 9 custom records + 2 script deployments.
3. Deployment settings: Suitelet **Audience includes Online Form User** (PF-35); **Execute-As role is NOT
   Administrator** (PF-36/AD-19) and has **create (no edit/delete)** on the event queue (D-50/Q-43).
4. Seed DATA rows (not SDF objects): `customrecord_wms_bin_policy` (the 7 types), `customrecord_wms_config`
   (all tuning values incl the D-46..D-58 per-location toggles), `custrecord_loc_class` / `custrecord_loc_site`
   on Locations, a few `customrecord_wms_operator` rows linked to Employees.

## D. G2 verification checklist (by phase - each traces to a `G2-PENDING` in docs/11)

| # | Check | From |
|---|---|---|
| 1 | **T-0.8/T1** - the Available-Without-Login Suitelet, under the Execute-As role, creates a scan_event when called **logged out**. **Gates everything.** | Ph 3 |
| 2 | `Indexed` field setting on the scan_event search index (T-0.8/T4); the composite `(status,type,location)` index exists | Ph 1 |
| 3 | Item cache: `search.lookupFields(recordtype)` returns the six types; cache TTL>=300s, cold-miss tolerant (PF-14a/15) | Ph 2 |
| 4 | Config/idempotency: duplicate `externalid` fails with **`UNIQUE_RCRD_ID_REQD`** (not DUP_CSTM_RCRD_ENTRY) and is caught (#3) | Ph 2/3 |
| 5 | PWA on a real device: IndexedDB queue persists across app kill; offline scan -> reconnect -> drains; camera path | Ph 3 |
| 6 | **All seven transforms** post: PO/TO/RMA Item Receipt, WO Completion/Assembly Build (per-location type), Item Fulfilment (one per order+location), Inventory Transfer (incl WO pick-to-floor + cross-location), **Work Order Issue** (Q-40/Q-64), Inventory Adjustment (count + write-off) | Ph 4/5B |
| 7 | `record.load`+`save` bin-state conflict: force `RCRD_HAS_BEEN_CHANGED`, confirm retry-then-raise (#1/PF-11) | Ph 4 |
| 8 | Period pre-check in a closed period -> `CLOSED_PERIOD_POSTING`; Multi-Book book-specific if Q-51 (#16) | Ph 4 |
| 9 | Negative pre-check: default PREVENT -> DEFER; per-location `allow_negative` posts PLAIN/LOT negative; SERIAL never (#19/#21) | Ph 4 |
| 10 | Governance measured per batch (T-12.1); M/R vs Suitelet pool (Q-44); batch bound by units AND 10MB value (D-34) | Ph 12 |
| 11 | Replenishment end-to-end; **never sources from HOLDING/PRODUCTION** (#23) | Ph 5 |
| 12 | Directed putaway to OPERATIONAL (good) / HOLDING (quarantine); NO_PUTAWAY_LOCATION exception path | Ph 5B |
| 13 | Blind count -> variance-by-value -> **manager approval before the adjustment posts** (D-37) | Ph 8 |
| 14 | Exception raised for every FAILED event; Hub exceptions console works the row (#8/D-39) | Ph 8/9 |
| 15 | Metric snapshots written; dashboard reads **snapshots, never raw events** (#10) | Ph 9 |
| 16 | **QMS round-trip** (needs QMS SuiteApp in sandbox): stage inspection via `qm_rest_queue`/`qm_integration_module`; PASS -> WMS Inventory Transfer; FAIL -> quarantine; QMS bin/Inventory-Status workflows NOT used (D-54) | Ph 9Q |
| 17 | Migration: load the real bin export; COLLISION / MIXED_BIN blockers fire; cutover freeze/delta (T-0.4/T-13.3) | Ph 10 |
| 18 | Retention: scheduled archive-before-purge to the external store; drain-before-period-close (D-57/T-11.4) | Ph 11 |
| 19 | Serial adopt path at cutover: NetSuite-only serial -> supervisor-authorised ADOPT; never on-the-fly (D-58/Q-54) | Ph 13 |

## E. Solution UAT (tier-2 scenarios - the real acceptance)

Run each end-to-end in the sandbox; they mirror the green tier-1 SAT (`test/solution_acceptance.test.js`):
1. Mixed-mode PO (PLAIN+LOT+SERIAL) receipt -> bin state -> SO fulfilment; confirm one Item Fulfilment per
   (order, location) and correct inventory detail per mode.
2. WO: pick components to the shop-floor (Inventory Transfer) -> start build -> Work Order Issue consumes ->
   completion. Confirm warehouse availability drops at the transfer, not before.
3. RMA receipt -> QC fail -> stays in holding -> authorised write-off (Inventory Adjustment).
4. Blind cycle count with a variance -> manager approves -> adjustment posts; reject path leaves stock untouched.
5. Serial: one serial in one bin; wrong-bin pick continues with a discrepancy; ship; reconciliation ties
   bin qty to serial rows.
6. Negative: default-prevent location defers an oversell; an `allow_negative` location posts it.
7. Closed-period scan at month-end -> deferred/raised, not mis-posted.
8. Offline: pull the radio, scan a wave, reconnect, confirm clean drain with no duplicates.

## F. Sign-off

When D (all checks) and E (all UAT scenarios) pass, the solution is accepted. Record measured governance and
latency back into `docs/08-platform-facts.md` (replace the SLICE-PENDING rows) and flip the Phase 14 row in
`docs/11-build-plan.md` section 6 to CLEARED.
