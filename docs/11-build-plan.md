# 11 — Build Plan (execution, gates, automation)

*Created 2026-11-27, after the register closed (D-46…D-58, T-0.3 met). This is the **execution layer**
over `docs/delivery-plan.md` (the phase map) and `tasks/*.md` (the Given/When/Then acceptance criteria).
It adds three things the older plan lacks: **two-tier acceptance gates**, the **auto-advance + notification
protocol**, and the **solution acceptance test**. It also folds in the scope added since the delivery plan
was written (D-35…D-58: WO shop-floor flow, kits, blind cycle count, labels, Hub, QMS, zones/pick-paths, UOM,
intercompany, per-location options).*

## 0. The honest constraint (read first)

Every phase has a **Definition of Done that requires a NetSuite sandbox** — "integration verified in the DEV
sandbox; governance consumption measured" (CLAUDE.md). **There is no account in this build environment** (Q-47
open). Therefore each phase has **two gates**, and only one can be cleared here:

- **G1 — buildable-here.** All code/objects for the phase exist; `npm run verify` is green; the phase's
  acceptance criteria that do **not** need an account are demonstrably met (pure-logic unit tests, and
  integration tests against the `test/stubs` `N/*` modules). **Claude assesses G1 and auto-advances on it.**
- **G2 — in-account.** Deploy to the sandbox, records created, real `record.transform` shapes confirmed,
  logged-out Suitelet write (T-0.8/T1), governance measured, offline device sync, QMS round-trip, concurrency
  under load. **Developer-held. Claude records the exact checks as `G2-PENDING` and never marks them passed.**

Consequence: Claude can drive the **entire G1 track** to completion and then run the **here-runnable solution
acceptance tests**, but "all stages complete + accepted" in the full sense needs the sandbox pass. Nothing
below fakes a G2 gate.

**D-59 (sponsor, 2026-11-27):** sandbox verification is **gated as a post-development task** — all **G2**
checks are consolidated into a single closing stage, **Phase 14 — Sandbox Deployment, Integration & Solution
UAT**, run once development completes. **G1 is the accepted development-completion gate**; Claude auto-advances
the whole G1 track on it, accumulating each phase's `G2-PENDING` items into Phase 14.

## 1. Automation & notification protocol

1. Build proceeds **one phase at a time** on the G1 track, in the dependency order of §3.
2. A phase's **G1 clears** when: (a) its listed deliverables exist, (b) `npm run verify` is green, (c) its
   non-account acceptance criteria pass. Claude assesses this against the task file's Given/When/Then.
3. **On G1 clear, automatically:** commit + push; post a **"Phase N — G1 CLEARED"** notification (chat
   summary: what was built, test counts, and the phase's `G2-PENDING` checklist); then **start the next phase
   without waiting for input.**
4. **On G1 fail:** do not advance. Fix, or if blocked by a genuine design gap, **raise it as a flagged
   question** (new Q + D-number on ruling) — never resolve scope in passing (CLAUDE.md).
5. **G2 never auto-passes.** Each cleared phase appends its in-account checks to the **Sandbox Acceptance
   Checklist** (§5, tier 2).
6. **End state:** when every phase's G1 is cleared, run the **Solution Acceptance Tests** (§5, tier 1) and
   report; then **Phase 14 (Sandbox Deployment & Solution UAT, D-59)** begins — the consolidated G2 pass,
   handed to the developer as a runbook (§5, tier 2).
7. Push-to-phone notification per phase is **off by default** (chat only); enable on request.

## 2. What is already built (baseline)

Vertical slice + D-23 carve-outs, `npm run verify` green: `wms_sl_scan_ingest.js`, `wms_mr_committer.js`
(PO-receipt path), `wms_lib_ledger_adapter.js` (PO receipt), `wms_lib_ingest.js`, `wms_lib_item_mode.js`,
`wms_lib_inventory_detail.js`, `wms_lib_receipt.js`, and the carved pure-logic `wms_lib_clustering.js`
(T-6.1), `wms_lib_bin_policy.js` (T-2.3b), `wms_lib_event_registry.js` (T-2.6). Objects:
`customrecord_wms_scan_event`, `customrecord_wms_config`, + two script deployments. 14 test files.
**None deployed — all G2 still pending.**

## 3. Phases, deliverables and gates

Legend per phase: **Depends** · **Deliverables (G1)** · **G2-PENDING (sandbox)**. Task IDs reference
`tasks/*.md`. New-scope items carry their D-number.

### Phase 0 — Discovery & decisions · *design DONE*
- **G1: CLEARED** — register closed (04), decisions current (05), SDF project exists (src/).
- **G2-PENDING:** account facts only — Q-40 (TO/WO-Issue transforms), Q-47 (sandbox + SDF deploy rights +
  refresh), Q-49 (tier + SuiteCloud Plus), Q-50 (Enhanced Validations), Q-51 (Multi-Book), Q-52 (OneWorld),
  T-0.1 (item census), T-0.4 (migration source). These tune config; they do not block G1 of later phases.

### Phase 1 — Data model & config
- **Depends:** Phase 0 design.
- **Deliverables:** every `customrecord_wms_*` + field in `docs/03-data-model.md` as SDF objects —
  `bin`, `bin_state`, `bin_policy`, `serial_state` (§3.13), `exception`, `operator` (+ employee link,
  role level — D-40/D-50), `config` (extended), `metric_snapshot`; Location fields `custrecord_loc_class`
  (OPERATIONAL/HOLDING/PRODUCTION — D-30/D-43) and `custrecord_loc_site` (list, D-30); **per-location config
  options** — WO output type (D-47), `allow_negative` default false (D-48), auto-intercompany toggle (D-51),
  multi-location-session flag (D-53); **bin zone + pick-sequence** fields (D-55); UOM fields (D-46). A
  schema-consistency test (objects ↔ data-model doc).
- **G2-PENDING:** SDF deploy; records instantiate; `Indexed` field setting (T-0.8/T4).

### Phase 2 — Core services
- **Depends:** 1. **Deliverables:** item-mode cache (`wms_lib_item_mode` — built; add cache wrapper),
  config loader, idempotency classifier (built), validation, bin-policy eval (built), event registry (built),
  **UOM conversion lib (D-46)**; all pure, unit-tested.
- **G2-PENDING:** `N/cache` + `search.lookupFields(recordtype)` behaviour (PF-14a); governance of create/
  submitFields (Q-42).

### Phase 3 — Ingestion + handheld PWA · *Q-01 CLOSED (D-13) — not blocked*
- **Depends:** 2. **Deliverables:** ingest Suitelet (built — harden: 200-with-body contract D-56, batch,
  externalid idempotency); PWA client (offline IndexedDB queue + sync T-3.2/T-3.4/T-3.5); auth — operator
  from employee record, cumulative role levels, no delete (D-40/D-50); camera scan path (D-58/Q-48); the
  `allow_negative`/UOM/site context in session. Unit tests for all client logic.
- **G2-PENDING:** Available-Without-Login create logged out (**T-0.8/T1 — gates real Phase-1 go-live**);
  offline/reconnect on a real device; File-Cabinet cache-warm (PF-05).

### Phase 4 — Async ledger commit
- **Depends:** 3 (events exist). **Deliverables:** committer across **all** registered event types (not just
  PO); ledger adapter for **all seven shapes** — Item Fulfilment, Inventory Adjustment, Inventory Transfer
  (incl. cross-location D-31 + WO pick-to-floor D-43), Item Receipt (PO/TO), WO Completion/Assembly Build
  (per-location type D-47), **Work Order Issue (D-35/D-43, WIP)**; mode-aware inventory detail (built);
  **two-phase inbound-before-outbound** (#18); **closed-period pre-check** (#16); **negative pre-check +
  per-location `allow_negative`** (#19/D-48); DEFERRED/retry (T-4.7). Pure shaping + committer logic tested
  against `N/` stubs.
- **G2-PENDING:** real transforms (Q-40, WO-Issue shape Q-64), conflict/period/negative behaviour in-account,
  governance per batch (T-12.1), M/R concurrency pool (Q-44/D-49).

### Phase 5 — Replenishment
- **Depends:** 4. **Deliverables:** FEFO sourcing, **holding/production never a source** (#23), config
  thresholds. Pure + tests. **G2-PENDING:** end-to-end move in sandbox.

### Phase 5B — Inbound receipt & putaway (+ WO shop-floor, intercompany)
- **Depends:** 4. **Deliverables:** PO/TO/WO/RMA receipt handlers + directed putaway; **WO component
  pick-to-floor → issue-at-build** flow with the four-figure transfer screen (D-43/44/45); over-receipt
  tolerance config (Q-27); **intercompany TOs + shared-subsidiary sites + auto-IC toggle** (D-51); serial
  entry at receipt (#21). Pure + tests. **G2-PENDING:** TO/receipt + WO-Issue transforms (Q-40/Q-64),
  intercompany postings (Q-52).

### Phase 6 — Waves + zones/pick-paths
- **Depends:** 4. **Deliverables:** wave clustering (built T-6.1) + wave generation keyed on **NetSuite
  committed qty** (#15); **zones + pick-sequence routing (D-55)**; cart-capacity cap (Q-12 config). Pure +
  tests. **G2-PENDING:** wave release in sandbox.

### Phase 7 — Pick, pack, despatch (+ kits, labels)
- **Depends:** 6. **Deliverables:** directed pick, short-pick policy config (Q-11), staging/fulfilment
  (one transform per order+location #4), **kits picked as a set (D-36)**, **label/document engine +
  print management (D-38/Q-06)**. Pure + engine config + tests. **G2-PENDING:** fulfilment transform,
  real printers.

### Phase 8 — Exceptions, custody + blind cycle count
- **Depends:** 4. **Deliverables:** exception record for every FAILED event (#8); custody/handover;
  **blind cycle count → variance-by-value → manager approval → Inventory Adjustment (D-37)**; reconciliation
  (T-8.3, incl. serial #22). Pure + tests. **G2-PENDING:** adjustment posting, approval gate in-account.

### Phase 9 — Dashboard + Manager Hub (D-39)
- **Depends:** 8. **Deliverables:** metric-snapshot writer + reader (#10); **Hub** — dashboards,
  Transaction 360, exceptions console, wave release/assignment, count approval, Print Designer, setup, and
  **user/role management** (employee-linked, cumulative perms, no delete — D-40/D-50). UI builds; snapshot
  logic tested. **G2-PENDING:** live data, role enforcement in-account.

### Phase 9Q — QMS integration (D-54)
- **Depends:** 5B, 8. **Deliverables:** inspection-queue staging + result capture + pass/fail → **WMS**
  movement (quarantine via Inventory Transfer to RQD/HOLDING D-28/D-31; fail via write-off D-33) through
  `qm_rest_queue` / `qm_integration_module`; **QMS bin/Inventory-Status workflows NOT used**. Adapters +
  logic tested against stubs. **G2-PENDING:** QMS SuiteApp installed in sandbox; round-trip; COA/sampling.

### Phase 10 — Bin remediation / migration *(gates go-live; G2-dominant)*
- **Depends:** 1. **Deliverables (G1):** migration transform/validation logic + 1-SKU/1-batch compliance
  check, from the third-party source (D-17/T-0.4). **G2-PENDING:** real data load, cutover freeze/delta.

### Phase 11 — Housekeeping
- **Deliverables:** **scan-event archive-before-purge (D-57)** + retention config (Q-09); bin-state backup
  (T-11.3); drain-before-period-close procedure (T-11.4). Logic + tests. **G2-PENDING:** scheduled scripts,
  external archive target.

### Phase 12 — Performance & hardening *(G2-dominant)*
- **Deliverables (G1):** governance-budget logic, config-driven channel routing (D-49), batch sizing
  (serial 100% envelope D-34). **G2-PENDING:** governance measured (T-12.1), concurrency under device load,
  tier/SuiteCloud-Plus sizing (Q-49).

### Phase 13 — UAT, training, cutover *(G2-dominant)*
- **Deliverables (G1):** **serial adopt path (D-58/Q-54)** logic; cutover seeding/reconciliation scripts
  (T-13.3). **G2-PENDING:** UAT, parallel run, go-live.

### Phase 14 — Sandbox Deployment, Integration & Solution UAT *(D-59; the consolidated G2 gate)*
- **Depends:** G1 of all phases cleared. **This is the post-development stage** that holds every `G2-PENDING`
  item from §3 plus the tier-2 SAT runbook (§5). Not run here — it is the developer's in-account pass:
  deploy via SDF, create records, confirm real transforms, measure governance, verify offline/concurrency/QMS
  round-trip, migrate + reconcile, then Solution UAT sign-off. **Acceptance of the whole solution lives here.**

## 4. Build order (what Claude executes)

`1 → 2 → 3 → 4 → 5 · 5B → 6 → 7 · 8 → 9 · 9Q → 10 · 11 · 12 → 13`, following §3 dependencies, then the
**Phase 14** sandbox/UAT stage (developer). Phases joined by `·` have no hard dependency on each other and may
be built back-to-back. Phases 10/12/13 are mostly G2 — their small G1 slices are built in place, the rest
handed to Phase 14.

## 5. Solution Acceptance Tests (the final gate)

**Tier 1 — here-runnable (Claude runs at the end of the G1 track; must be green):** cross-phase scenarios in
`test/` against `N/` stubs —
- Mixed-mode PO receipt (PLAIN+LOT+SERIAL) → bin-state projection → fulfilment, one transform per
  (order, location).
- WO flow: pick-to-floor (Inventory Transfer) → issue-at-build (Work Order Issue) → completion; stock leaves
  warehouse availability at the transfer, consumed only at issue.
- RMA receipt → quarantine (Inventory Transfer to HOLDING) → write-off (Inventory Adjustment, authorised).
- Blind cycle count → variance-by-value → manager approval → adjustment.
- Serial invariants: one serial in one bin (#21); bin qty = serial-row count (#22); serial never negative.
- Negative-inventory: default PREVENT (defer); per-location `allow_negative=true` posts PLAIN/LOT negative.
- Closed-period pre-check defers/raises correctly (#16).
- Idempotency: duplicate `externalid` → `UNIQUE_RCRD_ID_REQD` treated as success (#3).
- Offline queue replay + reconnect conflict reconciliation (T-3.5).
- Permission model: cumulative View⊂Create⊂Edit, no delete; ingest role = Create (D-50).

**Tier 2 — Phase 14 Sandbox Deployment & Solution UAT (developer; the real acceptance, D-59):** deploy via
SDF; T-0.8/T1 logged-out write;
all seven ledger transforms incl. WO Issue; governance measured under batch; M/R + Suitelet concurrency under
device load; QMS queue round-trip; offline sync on a real handheld; migration load + reconcile; period-close
drain. Each item traces to a phase's `G2-PENDING`.

## 6. Status ledger *(updated as phases clear)*

| Phase | G1 | G2 |
|---|---|---|
| 0 Discovery | CLEARED | account facts pending (Phase 14) |
| 1 Data model & config | **CLEARED** (9 record objects + schema-consistency test; replen/wave/custody records authored in their phases 5/6/7) | SDF deploy + `Indexed` setting (Phase 14) |
| 2 Core services | **CLEARED** (UOM + config loader built & tested; cache/idempotency/validation/policy/registry in place) | N/ fetch wrappers for config rows + item cache (Phase 14) |
| 3 Ingestion + PWA | **CLEARED (logic)** — offline queue + sync/reconcile + session/auth built & tested; Suitelet 200-with-body (D-56); PWA UI shell thin | on-device offline/sync + logged-out write (T-0.8/T1, Phase 14) |
| 4 Ledger commit | in progress (PO path built; extending to all shapes) | — |
| 5 / 5B / 6 / 7 / 8 / 9 / 9Q | not started | — |
| 10 / 11 / 12 / 13 | not started | — |
