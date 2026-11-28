# 13 - Functional Requirements Document (FRD), incl. UAT

**System:** Advanced Warehouse Management for NetSuite (ER_NetSuiteWMS)
**Status:** Development complete (G1, phases 0-13); pending sandbox + Solution UAT (Phase 14, D-59).
**Version:** 1.0 - 2026-11-28
**Authority note:** This FRD consolidates the project's authoritative sources. Where it summarises, the
canonical text wins: `docs/05-decisions-log.md` (rulings D-01..D-59), `CLAUDE.md` (invariants #1..#24),
`docs/06-netsuite-boundary.md`, `docs/03-data-model.md`, `docs/11-build-plan.md`, `docs/12-phase14-sandbox-uat.md`.
It supersedes the source FRD's sample code, which carried known defects (F-12..F-17).

---

## 1. Purpose & scope

### 1.1 Purpose
Define, in verifiable terms, what the WMS must do, and the UAT by which it is accepted. It is the reference
for build verification and for the sponsor's user-acceptance testing.

### 1.2 In scope
A native NetSuite (SuiteScript 2.1, SDF Account Customization Project) warehouse management system providing:
offline handheld operations; an asynchronous event-sourced ledger committer; multi-location and multi-site
operation; inbound (PO / TO / Work Order / RMA receipt) and putaway; replenishment; waves, zones and
pick-paths; pick / pack / despatch incl. kits and labels; work-order component flow; exceptions, custody and
blind cycle counting; a management "Hub"; QMS inspection integration; and the supporting housekeeping,
migration and cutover functions.

### 1.3 Out of scope
Costing/valuation (NetSuite owns it, #17); the NetSuite Bin Management, Advanced Bin/Numbered Inventory and
Inventory Status features (deliberately NOT used - D-07/D-41/D-42); any second system of record.

### 1.4 Actors
- **Operator / Picker** - floor staff on the handheld; **no NetSuite login or licence** (#24, D-19).
- **Manager** - desk user of the Hub; uses an existing NetSuite login.
- **Supervisor** - authorises write-offs, serial adoption, count approval, overrides.
- **Committer** - the asynchronous Map/Reduce service that posts to the NetSuite ledger.
- **NetSuite** - system of record for commitment, cost and the financial ledger.
- **QMS SuiteApp** - the inspection layer (integrated, D-54).

---

## 2. System context & architecture

### 2.1 Principles
- **Event-sourced:** every floor action is an immutable scan event; the ledger catches up asynchronously. The
  operator is never made to wait for a NetSuite save.
- **Offline-first:** the handheld works with the radio off (#11); the one sanctioned online exception is a
  location switch (D-20).
- **WMS owns physical state; NetSuite owns commitment, cost and the books** (D-10, #1, #15, #17).
- **WMS-owned bins by choice** (D-07/D-42): native NetSuite bin/lot/serial handling is judged subpar;
  NetSuite has no bins - the WMS does.

### 2.2 Flow (happy path)
Scan (offline) -> durable device queue -> ingestion Suitelet (Available-Without-Login) writes an immutable
`customrecord_wms_scan_event` (externalid = client UUID) -> on-demand Map/Reduce committer settles bin state
and posts the native NetSuite transaction -> metric snapshots feed the Hub; failures raise exceptions.

### 2.3 NetSuite feature configuration (D-07/D-41; see FR-13x and section 9)
- **Enabled:** Multi-Location Inventory; Lot Tracking + Serialized Inventory **per item**; Transfer Orders;
  Work Orders / Assembly Items; RMA.
- **NOT used:** Bin Management; Advanced Bin / Numbered Inventory Management; Inventory Status.

---

## 3. Functional requirements

*Each FR: ID - requirement - [source invariant/decision]. "The system" = the WMS.*

### 3.1 Ingestion & handheld (FR-1xx)
- **FR-101** The handheld shall capture scans and operate fully offline; no scan shall require a server
  round-trip to validate. [#11, D-04]
- **FR-102** Each scan shall be assigned a client UUID (v4) and client timestamp on the device, and queued
  durably (survives app restart). [D-12, #3; Ph3]
- **FR-103** The device shall batch-sync queued events to the ingestion Suitelet when connectivity allows, in
  bounded batches. [F-29]
- **FR-104** Ingestion shall be an Available-Without-Login Suitelet that sets `externalid` and attempts the
  create; a duplicate shall fail at the platform with `UNIQUE_RCRD_ID_REQD` and be treated as idempotent
  success - no pre-read, no saved search on the success path. [#3, D-12, PF-13]
- **FR-105** The Suitelet shall return HTTP 200 with a per-event status in the body; the client shall branch
  on body status (accepted / busy-retry / rejected), not the HTTP code. [D-56, PF-03]
- **FR-106** On reconnect the client shall reconcile uncertain events against server state; server state wins
  (POSTED/PROCESSING/SUPERSEDED => stop resending; FAILED => surface; unseen => resend). [T-3.5]
- **FR-107** A location switch is the sole online exception: atomic, cleanly refused offline, never touching
  the outbound queue. [#11, D-20]
- **FR-108** The handheld shall support barcode scanning and manual keying identically; a damaged label never
  blocks the job. Camera scanning shall be available where configured (phones without a wedge). [Q-48, D-58]

### 3.2 Identity & access (FR-11x)
- **FR-111** Every WMS user shall be an identity backed by a NetSuite Employee record; operators hold no
  NetSuite login/licence. [#24, D-40, D-19]
- **FR-112** Role/access shall be assigned and enforced in WMS configuration, never inherited from a NetSuite
  permission role; tiers are PICKER and MANAGER. [#24, D-39, D-40]
- **FR-113** Access levels shall be cumulative - VIEW < CREATE < EDIT - and DELETE shall never be grantable;
  the ingest Execute-As role operates at CREATE (append-only). [D-50, AD-19, Q-43]
- **FR-114** Operator login shall validate the operator record, a hashed PIN, and the selected location(s)
  against the operator's allowed set; a multi-location session is permitted only when configured. [D-14, D-53]

### 3.3 Core services (FR-12x)
- **FR-121** Item tracking mode shall be resolved from the item record type (six types) to PLAIN / LOT /
  SERIAL, cached; never an account-level flag; no "reject serialised item" path. [#14, PF-14, D-29]
- **FR-122** All tuning values (thresholds, capacities, TTLs, batch sizes, policies, per-location toggles)
  shall come from `customrecord_wms_config`; none hard-coded. [#9]
- **FR-123** Config resolution shall prefer a per-location row over the global row for the same key. [D-14]
- **FR-124** UOM conversion shall be supported where enabled, converting between stock-keeping and transacting
  UOM from the item units table; quantities remain Decimal. [D-46, Q-07, #20]
- **FR-125** New event types shall be added by registering a handler, never by editing the ingestion Suitelet,
  mapper or reducer. [#12, AD-15]

### 3.4 Bin state & concurrency (FR-13x)
- **FR-131** `customrecord_wms_bin_state` shall be the operational truth of a bin; scans shall never be
  validated against `inventorybalance`, and bin contents shall never be cached alongside the projection. [#1]
- **FR-132** Bin-state writes shall use `record.load`+`save` (conflict-detecting), never `submitFields`; a
  `RCRD_HAS_BEEN_CHANGED` conflict shall be retried then raised - no accepted lost-update window. [#1, AD-03]
- **FR-133** A bin shall be EMPTY only when its item is cleared, never by a float quantity test; a negative
  bin with an item set is OCCUPIED AND ANOMALOUS and accepts only the recorded SKU+lot. [#20]
- **FR-134** No NetSuite bin feature, bin-transfer record, or bin field on any inventory-detail line shall be
  used; the prohibited NetSuite bin-number identifier shall not appear in the codebase (CI-guarded). [#13]

### 3.5 Ledger commit (FR-14x)
- **FR-141** All ledger writes shall go through the Map/Reduce committer; no synchronous `record.transform`
  from a Suitelet/RESTlet. One transform per (sales order, location). [#4]
- **FR-142** The committer shall post the correct native transaction per event type (seven shapes): PO/TO/RMA
  Item Receipt; Work Order Completion or Assembly Build (per-location config, D-47); Item Fulfilment;
  Inventory Transfer (cross-location moves + WO pick-to-floor); Work Order Issue; Inventory Adjustment (count
  variance + write-off). [docs/06 s4, D-35]
- **FR-143** Bin movements within a NetSuite location shall post nothing; crossing locations posts an
  Inventory Transfer; write-off posts an Inventory Adjustment. [#13, D-31, D-33]
- **FR-144** Each cycle shall post all inbound before any outbound (two phases); a TO receipt whose source
  fulfilment is not yet POSTED shall be DEFERRED and retried, never FAILED. [#18, F-30]
- **FR-145** Posting period shall derive from scan time; the committer shall pre-check the accounting period's
  closed status (book-specific under Multi-Book) and raise CLOSED_PERIOD_POSTING if closed. [#16, PF-25]
- **FR-146** The committer shall pre-check availability and set DEFERRED (not FAILED) when NetSuite cannot
  satisfy an outbound; negative inventory is a per-location option defaulting to PREVENT; a serialised item
  shall never go negative. [#19, D-48, #21]
- **FR-147** DEFERRED and FAILED shall remain distinct; a deferral past the configured limit escalates to a
  DEFERRAL_TIMEOUT exception. [#19, D-11]
- **FR-148** The committer shall be pausable via a config kill-switch read at the start of each execution.
  [AD-22, PF-29]
- **FR-149** The committer shall check remaining governance and yield/reschedule rather than fail mid-batch;
  batch size shall be bounded by governance units AND the 10 MB Map/Reduce value limit AND config. [#9, F-17,
  D-34, D-49]

### 3.6 Serial & lot (FR-15x)
- **FR-151** A serial shall be in exactly one bin; a putaway/transfer naming a serial recorded active
  elsewhere shall be rejected. A lot may split across bins/locations. [#21, PF-31]
- **FR-152** For a serialised item, bin-state quantity shall equal the count of its serial rows in that bin;
  reconciliation shall verify this. [#22, T-8.3]
- **FR-153** Serial validation shall distinguish data-wrong (continue + discrepancy) from action-wrong (stop):
  ALREADY_LIVE/UNKNOWN/WRONG_ITEM/NOT_AVAILABLE stop; WRONG_BIN continues with a discrepancy; COUNT_MISMATCH
  stops at the handheld. [D-29 s3.13b]
- **FR-154** A retired serial re-entered shall reactivate the same row and increment its generation - never a
  second row, no hard delete. [PF-23]
- **FR-155** At cutover, a serial present in NetSuite but unknown to the WMS shall be adopted only through a
  supervisor-authorised flow; never created on the fly during a pick. [D-58, Q-54]

### 3.7 Replenishment (FR-16x)
- **FR-161** Replenishment shall source FEFO (earliest expiry first; FIFO fallback for no-expiry). [D-03]
- **FR-162** Replenishment shall NEVER source from a holding or production location - a hard guard filtering
  on `locationClass === OPERATIONAL`; a mandated non-operational source is refused outright. [#23, D-30]

### 3.8 Inbound & work orders (FR-17x)
- **FR-171** The system shall receive PO, Transfer Order, Work Order and RMA, capturing lot/serial/expiry at
  receipt, and direct putaway respecting bin policy, capacity and location class. [D-09, D-32]
- **FR-172** Over-receipt beyond a configured tolerance shall require supervisor approval. [Q-27]
- **FR-173** Work-order components shall be "picked for a work order" by moving them to a segregated PRODUCTION
  location via an Inventory Transfer (removing them from warehouse availability without consuming them), then
  "issued to the work order" via a Work Order Issue at build start. [D-43]
- **FR-174** A business may run many PRODUCTION locations; a work order sources/builds at exactly one. [D-44]
- **FR-175** The WO component-transfer screen shall expose on-hand / committed / available / needed and default
  the transfer quantity to available, operator-overridable; the transfer is a location move not gated by #15.
  [D-45]
- **FR-176** Write-off of condemned stock shall require supervisor authorisation and a mandatory reason code,
  posting an Inventory Adjustment and retiring named serials. [D-33]

### 3.9 Waves, allocation, pick, pack (FR-18x)
- **FR-181** Wave eligibility shall filter on NetSuite committed quantity; picked quantity per line shall
  never exceed committed (COMMITMENT_EXCEEDED). [#15, F-22]
- **FR-182** A wave shall never span locations; clustering partitions by location. [D-14, AD-10]
- **FR-183** Pick lists shall be ordered by zone walk order then pick sequence (pick-path). [D-55]
- **FR-184** Kit/package items shall be picked and shipped as a set; a kit shall not ship half-picked. [D-36]
- **FR-185** Unresolvable short picks shall follow the configured policy (ship-partial / hold / backorder) and
  be recorded, never blocked. [Q-11]
- **FR-186** Despatch shall stage to a bin or fulfil from the pick face; labels shall be produced from
  configurable templates, on demand or automatically on an event, to PDF/network/thermal. [D-38]

### 3.10 Exceptions, custody, counting (FR-19x)
- **FR-191** Every FAILED event shall raise a `customrecord_wms_exception` (never only a log line), typed and
  severity-rated, workable from the Hub. [#8]
- **FR-192** Custody handover shall allow reassigning part-finished work, keeping or clearing progress. [AD-10]
- **FR-193** Blind cycle counting shall let the counter record actuals without seeing the expected figure;
  the system computes variance by quantity and value; no adjustment posts without manager approval. [D-37]
- **FR-194** Nightly reconciliation shall verify WMS bin totals against NetSuite on-hand (and per lot; serial
  row counts for serialised items) and raise on divergence. [T-8.3, #22]

### 3.11 Management Hub & dashboards (FR-20x)
- **FR-201** The Hub shall be a desk tier distinct from the floor: plan work (waves, assignment, handover),
  watch it (dashboards, order tracking, exceptions), and run setup (bins, zones, users, roles, printers).
  [D-39]
- **FR-202** Dashboards shall read metric snapshots, never the raw scan-event table. [#10]
- **FR-203** User & role management shall link users to Employee records and govern access in-app. [D-40]

### 3.12 QMS integration (FR-21x)
- **FR-211** The system shall stage QMS inspection-queue entries for received stock via the QMS integration
  API and capture outcomes; QMS is the inspection layer only. [D-54]
- **FR-212** The WMS shall own all stock movement arising from inspection: PASS releases via Inventory
  Transfer to operational; FAIL quarantines in holding (write-off is the separate authorised step). QMS's own
  bin/Inventory-Status quarantine workflows shall NOT be used. [D-54, D-07/D-41]

### 3.13 Housekeeping, migration, cutover (FR-22x)
- **FR-221** Scan events shall be archived to a durable store before any purge; retention is configurable;
  non-POSTED events are never purged. [D-57, Q-09]
- **FR-222** Bin data migration shall validate 1-SKU/1-batch compliance and location-prefixed bin-name
  uniqueness; a collision or mixed bin fails the import (not overwrite). [D-17, T-0.4]
- **FR-223** Multi-subsidiary: a site may span subsidiaries (one NetSuite location per subsidiary); a
  per-location toggle shall allow or prevent automatic intercompany inventory; intercompany TOs are in scope.
  [D-51]

---

## 4. Non-functional requirements (invariants)

NFRs are the 24 non-negotiable invariants in `CLAUDE.md` (concurrency correctness #1/#7; offline #11;
idempotency #3; period #16; negative-inventory #19; serial integrity #21/#22; commitment #15; licence-free
identity #24; etc.). Each is a pass/fail condition at UAT. Additional NFRs: SuiteScript 2.1 + SameAccount
scope; errors use `ERR_WMS_*` machine-readable names; hot-path searches index-backed; governance measured and
recorded on scan/commit paths.

---

## 5. Data model (summary)

Custom records (see `docs/03-data-model.md` for fields): `wms_scan_event` (append-only log),
`wms_bin_state` (operational truth, optimistic-locked), `wms_bin`, `wms_bin_policy`, `wms_serial_state`
(optimistic-locked, generation), `wms_exception`, `wms_operator` (employee link, tier, access level),
`wms_metric_snapshot`, `wms_config` (global + per-location). Location carries `custrecord_loc_class`
(OPERATIONAL/HOLDING/PRODUCTION) and `custrecord_loc_site`. Replen/wave/custody records per their phases.

---

## 6. Configuration catalogue (key examples)

Per-location-overridable config (section 3.10 of data model): WO output type (D-47); `allow_negative` default
FALSE (D-48); auto-intercompany toggle (D-51); multi-location-session flag (D-53); UOM enabled (D-46);
short-pick policy (Q-11); over-receipt tolerance + override threshold (Q-27); offline warn/block minutes
(Q-17); cart/tote capacity (Q-12); scan-event retention + archive target (Q-09); write-off GL account +
finance-approval threshold (Q-53); camera-scan enabled (Q-48); ingest batch size; bin-state retry count;
committer pool size; kill-switch; governance-reconciliation tolerance; serial cache size.

---

## 7. User Acceptance Testing (UAT)

### 7.1 Approach
UAT runs in the DEV/UAT **NetSuite sandbox** after SDF deploy (this is Phase 14, D-59 - the consolidated
in-account gate). It verifies the functional requirements against real platform behaviour; it is the real
acceptance (development/G1 unit + cross-phase tests are already green: 37 suites, 336 tests). The full deploy
and verification runbook is `docs/12-phase14-sandbox-uat.md`; the cases below are the formal acceptance set.

### 7.2 Environment & prerequisites
- Sandbox deployed via SDF (`project:validate --server` then `project:deploy`); seed config/policy/operator
  rows; Location class/site set. Features per section 2.3. Account facts confirmed (Q-47/49/50/51/52), census
  (T-0.1), migration source (T-0.4). Suitelet audience includes Online Form User (PF-35); Execute-As role is
  non-Administrator with create-only on the event queue (PF-36, D-50).

### 7.3 Roles for UAT
Operator (handheld, no licence), Manager (Hub), Supervisor (authorisations). Confirm each sees only its tier.

### 7.4 Entry criteria
G1 green (done); SDF deploy succeeds; UAT-000 (smoke) passes.

### 7.5 Exit / acceptance criteria
All UAT cases below Pass; measured governance + latency recorded into `docs/08-platform-facts.md`; no open
Critical/High exception; sponsor sign-off (section 8).

### 7.6 UAT test cases
*Format: ID - Title - Pre - Steps - Expected - Traces. Pass/Fail recorded per run.*

- **UAT-000 Deploy smoke.** Pre: SDF deploy done. Steps: open each record type; run `validate --server`.
  Expected: all 9 records + 2 scripts present; no schema errors. Traces: FR-13x, docs/12 C.
- **UAT-001 Logged-out ingest (gating).** Pre: Suitelet deployed, Execute-As role set. Steps: POST a scan
  batch while logged out. Expected: `customrecord_wms_scan_event` rows created with externalid=UUID; HTTP 200
  with per-event body statuses. Traces: FR-104/105, T-0.8/T1.
- **UAT-002 Idempotency.** Steps: re-POST the same UUID. Expected: platform returns `UNIQUE_RCRD_ID_REQD`,
  handled as success; no duplicate row. Traces: FR-104, #3.
- **UAT-003 Offline capture & drain.** Steps: disable radio, scan a wave, re-enable. Expected: events queue on
  device, then drain with no duplicates; reconnect reconciliation trusts server state. Traces: FR-101/103/106.
- **UAT-004 Bin-state concurrency.** Steps: force two near-simultaneous updates to one bin. Expected:
  conflict retried then settled; no lost update; version increments. Traces: FR-131/132, #1.
- **UAT-005 Mixed-mode PO receipt.** Steps: receive a PO with PLAIN, LOT and SERIAL lines (lot/serial/expiry
  captured). Expected: one Item Receipt; inventory detail correct per mode; bin state + serial_state updated;
  putaway directed to OPERATIONAL bins. Traces: FR-142/171, #14, #21/#22.
- **UAT-006 Directed putaway constraints.** Steps: attempt putaway violating single-SKU/single-batch or
  capacity. Expected: bin excluded; NO_PUTAWAY_LOCATION exception if none fit. Traces: FR-171, #20.
- **UAT-007 Two-phase commit ordering.** Steps: queue a receipt and a dependent fulfilment in one cycle.
  Expected: receipt posts before fulfilment. Traces: FR-144, #18.
- **UAT-008 Closed-period pre-check.** Steps: post a scan dated into a closed period (book-specific under
  Multi-Book). Expected: CLOSED_PERIOD_POSTING raised; nothing mis-posted. Traces: FR-145, #16.
- **UAT-009 Negative-inventory control.** Steps: oversell at a default location, then at an `allow_negative`
  location; oversell a serialised item. Expected: default defers; allow_negative posts PLAIN/LOT negative;
  serial always defers (SERIAL_NOT_AVAILABLE). Traces: FR-146, #19/#21, D-48.
- **UAT-010 Deferral vs failure.** Steps: fulfil before its receipt. Expected: DEFERRED and retried, not
  FAILED; escalates to DEFERRAL_TIMEOUT past the limit. Traces: FR-147.
- **UAT-011 Commitment cap.** Steps: attempt to pick more than committed. Expected: COMMITMENT_EXCEEDED;
  eligibility filters uncommitted lines. Traces: FR-181, #15.
- **UAT-012 Wave + pick-path.** Steps: release a wave; walk the pick list. Expected: wave within one location;
  tasks ordered by zone then pick sequence. Traces: FR-182/183.
- **UAT-013 Kit pick.** Steps: pick a kit, leave one component short. Expected: kit flagged incomplete, does
  not ship half-picked; complete when all components picked. Traces: FR-184.
- **UAT-014 Short pick policy.** Steps: unresolvable short pick. Expected: configured policy applied
  (partial/hold/backorder), recorded, not blocked. Traces: FR-185.
- **UAT-015 Despatch + label.** Steps: stage/fulfil; trigger a label. Expected: Item Fulfilment posts
  (one per order+location); label renders template fields and auto-prints on the configured event. Traces:
  FR-186, #4.
- **UAT-016 WO component flow.** Steps: pick components to a PRODUCTION location (transfer screen defaults to
  available), start build, issue, complete. Expected: Inventory Transfer removes warehouse availability
  without consuming; Work Order Issue consumes at build; completion posts. Traces: FR-173/174/175, D-43/44/45.
- **UAT-017 Cross-location vs in-location move.** Steps: move within a location, then across. Expected: within
  posts nothing; across posts an Inventory Transfer. Traces: FR-143, #13/D-31.
- **UAT-018 RMA -> QC -> write-off.** Steps: receive RMA to holding; fail QMS inspection; authorise write-off.
  Expected: RMA Item Receipt; stock held; supervisor-authorised Inventory Adjustment retires serials. Traces:
  FR-171/176/212.
- **UAT-019 QMS pass release.** Steps: pass a receipt inspection. Expected: WMS posts an Inventory Transfer to
  operational; QMS performs no bin/status move. Traces: FR-211/212, D-54.
- **UAT-020 Blind cycle count.** Steps: count a bin blind; review variance by value; approve. Expected: no
  adjustment until approved; approved variance posts an Inventory Adjustment. Traces: FR-193.
- **UAT-021 Reconciliation.** Steps: induce a drift and a serial-count mismatch. Expected: RECONCILIATION_DRIFT
  and serial mismatch raised. Traces: FR-194, #22.
- **UAT-022 Replenishment guard.** Steps: trigger replenishment with a holding candidate present. Expected:
  FEFO from operational only; holding/production never sourced. Traces: FR-161/162, #23.
- **UAT-023 Serial integrity.** Steps: put a serial already live elsewhere; pick a serial from the wrong bin.
  Expected: already-live rejected; wrong-bin pick continues with a discrepancy; one serial, one bin. Traces:
  FR-151/153.
- **UAT-024 Serial adopt (cutover).** Steps: pick a serial known to NetSuite but not the WMS. Expected:
  SERIAL_UNKNOWN stop; supervisor-authorised adopt creates the row (gen 0); never on the fly. Traces: FR-155.
- **UAT-025 Access model.** Steps: exercise PICKER vs MANAGER; attempt a delete. Expected: cumulative
  VIEW<CREATE<EDIT enforced; no delete anywhere; operators need no NetSuite licence. Traces: FR-111/112/113.
- **UAT-026 Exceptions console.** Steps: cause a FAILED event. Expected: a typed, severity-rated exception is
  raised and workable in the Hub. Traces: FR-191.
- **UAT-027 Dashboard snapshots.** Steps: run work, open dashboards. Expected: metrics reflect snapshots, not
  raw events; drill-through works. Traces: FR-202.
- **UAT-028 Intercompany.** Steps: move stock between subsidiaries sharing a site, with the toggle on then off.
  Expected: automatic intercompany inventory honoured per toggle; intercompany TO handled. Traces: FR-223.
- **UAT-029 Retention.** Steps: run the archive/purge job. Expected: POSTED events archived before purge;
  non-POSTED never purged. Traces: FR-221.
- **UAT-030 Migration gate.** Steps: import bin data containing a collision and a mixed bin. Expected: import
  fails with COLLISION and MIXED_BIN; no overwrite. Traces: FR-222.
- **UAT-031 Governance.** Steps: run a large commit batch; measure. Expected: committer yields/reschedules
  within governance; batch bounded by units and value; figures recorded to docs/08. Traces: FR-149.
- **UAT-032 Kill switch.** Steps: set the config kill-switch. Expected: committer pauses at next execution.
  Traces: FR-148.

### 7.7 Traceability
Each UAT case cites its FRs; each FR cites its invariant/decision. The tier-1 Solution Acceptance Tests
(`test/solution_acceptance.test.js`, green) exercise the same scenarios in logic form - UAT confirms them
in-account.

---

## 8. Assumptions, dependencies, sign-off

### 8.1 Assumptions / dependencies
NetSuite sandbox with SDF deploy rights (Q-47); account facts Q-49/50/51/52; QMS SuiteApp installed for the
QMS cases; printers for label cases; a real handheld for offline/camera cases.

### 8.2 Open items
All design questions are closed (register closed, D-46..D-59). Remaining items are in-account verifications
consolidated into Phase 14 (notably Q-40 TO/WO-Issue transforms, Q-47 deploy). No functional scope is open.

### 8.3 Sign-off
| Role | Name | Date | Result |
|---|---|---|---|
| Sponsor | | | |
| Developer | | | |
| Finance (period/write-off) | | | |

Acceptance is granted when all UAT cases Pass and measured governance/latency are recorded.
