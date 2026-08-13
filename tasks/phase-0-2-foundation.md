# Phases 0–2 · Foundation, Data Model, Core Services

---

# PHASE 0 — Discovery & Decision Gate

*No code. Ends with a signed decision register. Everything downstream depends on it.*

### T-0.1 — Confirm the NetSuite boundary and produce the item census
**Depends on:** — · **Resolves:** F-19, F-21, F-23 · **Implements:** AD-16, AD-17 · *(rewritten per D-07/D-08/D-10)*

**Narrative**
As the delivery lead, I want the NetSuite configuration confirmed and the item tracking mix
measured, so that the integration is built against what the account actually is and the throughput
model is sized on a real number.

**Requirement**

*Boundary confirmation.* Verify via `runtime.isFeatureInEffect`: **Bin Management is OFF** (basic
and advanced) and will remain off — this is a standing assumption, not a snapshot; `MULTILOCINVT`
state and location count; `LOTNUMBEREDINVENTORY` and `SERIALIZEDINVENTORY`; Multiple UOM (Q-07).
*Namespace-collision check.* Q-13 is **closed (2026-08-09): the NetSuite WMS SuiteApp is not
installed**, so D-07 is confirmed. The check that survives — and it stands on its own merits for an
Account Customization Project — is **namespace collision**: verify no existing customization,
managed bundle or SuiteApp owns `customrecord_wms_*`, `custrecord_*` or `wms_*` script IDs that would
clash with what this project deploys. A clean namespace is a precondition for a repeatable SDF deploy
with no manual account reconciliation.

*Item census.* For every in-scope item, classify as **PLAIN, LOT or SERIAL** (the record type, PF-14)
and report by item count **and by share of order lines**. **Serial is IN scope (D-29 — supersedes
D-08).** **The census TUNES configuration, it does not GATE the design (D-34):** the design must function
at **up to 100% serialised**, so the serial share is a **parameter** — it sets the wave-scoped serial
cache size, the T-0.2 scan-volume model, the handheld multi-scan flow and the batch size, but no design
decision waits on the number. Also count serialised units in WMS-managed locations so the serial_state
seed (§3.13) is sized.

**Costing is not audited and not designed around (D-11).** NetSuite runs costing; the WMS supplies
quantity, date and lot and has no opinion about valuation. Record the method for information only if
convenient — it changes nothing in the build.

Do confirm the **accounting period calendar and close cadence**, which the period-drain procedure
(T-11.4) depends on.

**Acceptance**
- [ ] GIVEN the target account, WHEN feature detection runs, THEN Bin Management is confirmed disabled and the result is recorded as a standing constraint.
- [ ] GIVEN the item master, WHEN the census runs, THEN PLAIN and LOT counts are reported by item **and** by order-line share.
- [ ] GIVEN any serialised item in a WMS-managed location, THEN it is listed and a decision to exclude or re-configure it is recorded before Phase 1.
- [ ] GIVEN the account, THEN the accounting period calendar and close cadence are recorded for T-11.4.
- [ ] GIVEN the account, THEN the NetSuite WMS SuiteApp is confirmed **not installed** (Q-13) and no existing customization collides with the `customrecord_wms_*` / `wms_*` namespace.
- [ ] GIVEN the audit, THEN SuiteCloud Plus licence count and current concurrency limit are recorded for T-0.2.

---

### T-0.2 — Establish and publish the concurrency budget
**Depends on:** T-0.1 · **Resolves:** F-09 · **Implements:** AD-08

**Narrative**
As the architect, I want a measured allocation of the account's concurrent request slots across all
workloads, so that scan traffic, background posting and integrations do not starve one another in
production.

**Requirement**
Measure current concurrency consumption over a representative week (Application Performance
Management / concurrency monitor). Model peak scan demand **from the T-0.1 item census, not from the
FRD's figures**, which are unverified. **Serial is IN scope (D-29); the scan-volume model is a
PARAMETER with a design envelope (D-34) — it must hold at up to 100% serialised.** For serialised lines
size on **one scan per unit**, and note the payload shape (D-34): **N serialised units on a line are ONE
event carrying N serials**, not N events — one record, one bin-state update, one governance charge — so
the **batch size is bounded by the 10 MB Map/Reduce value limit (PF-10)**, not only by governance units,
at high serial share. The census tunes these values; it does not gate the design.
Slots required = req/s × mean server seconds. **Include inbound receipt scanning (Phase 5B)**, which
the FRD's model excludes entirely. **The scan endpoint is a Suitelet, not a RESTlet (D-19)**
— per-invocation governance and concurrent-slot cost are the same, so the numbers are unchanged; only
the wording. RESTlet-based integrations, if any remain, are separate. Produce a written allocation
table (AD-08) with ≥ 20% headroom. Where the budget does not close, produce costed options: additional
SuiteCloud Plus licences, reduced scan frequency, or client-side event batching.

**Acceptance**
- [ ] GIVEN a week of production concurrency telemetry, WHEN the budget is modelled, THEN a slot allocation table covering scanning, M/R, clustering, dashboard, integrations and headroom is published.
- [ ] GIVEN the T-0.1 item census, THEN the peak scan rate used in the model is derived from it and the derivation is shown — not taken from the FRD's 10–25 req/s.
- [ ] GIVEN the model, THEN inbound receipt and putaway scanning volume is included, not just outbound picking.
- [ ] GIVEN the modelled peak, WHEN required slots exceed available slots, THEN at least two costed remediation options are presented to the sponsor with a recommendation.
- [ ] GIVEN the budget is agreed, THEN it is committed to the repo and referenced by every deployment's queue configuration.

---

### T-0.3 — Close the open-questions register
**Depends on:** — · **Resolves:** `04-open-questions.md` Q-01…Q-09

**Narrative**
As the delivery lead, I want every open functional question answered by an accountable business
owner, so that the build is not blocked mid-sprint by a decision nobody owns.

**Requirement**
Walk `docs/04-open-questions.md` with the sponsor. Each question gets a decision, an owner and a
date.

*Updated 2026-08-08:* eleven questions are now closed by rulings D-03, D-07, D-08 and D-09.
**Q-01 (handheld platform) is the only remaining hard blocker** — Phase 3 cannot start without it,
and D-04's offline-first mandate has narrowed the viable options.

Q-24 (costing) and Q-26 (negative inventory) are **closed by D-11**. Remaining: Q-16 bin types,
Q-17 offline duration, Q-25 manufacturing transaction type, Q-27 over-receipt tolerance.

*Updated 2026-08-10:* the remaining register is now organised into three owner-grouped sheets in
`04-open-questions.md` — **Sheet A (NetSuite developer)** Q-35, Q-40…Q-44; **Sheet B (sponsor)** Q-29,
Q-31, Q-32, Q-36, Q-37, Q-45, Q-46 and the location class (D-14); **Sheet C (you / Todd)** T-0.1 census,
T-0.4 migration, this task, and Q-47 environment. Sheet-B items carry an *assumption-if-no-response*
fallback with a review date; Sheet-A items have **no safe default** and stay held.

**D-23 (2026-08-10) narrows — does not open — this gate.** Three pure-logic tasks (T-6.1, T-2.3b,
T-2.6) are carved out and buildable before the register closes, under a CI-enforced no-`N/`-import
boundary. Every other task stays held on this register. A fourth carve-out needs a new ruling.

**Acceptance**
- [ ] GIVEN the register, WHEN the decision workshop concludes, THEN every question has a recorded decision, owner and date, or an explicit "deferred, out of scope for release 1".
- [ ] GIVEN Q-01, THEN it is decided (not deferred) before Phase 3 is scheduled.
- [ ] GIVEN Q-16, Q-17, Q-25 and Q-27, THEN each has a named owner and a target date before its dependent phase begins.
- [ ] GIVEN Sheets A, B and C, THEN every open question carries a named owner and a date; Sheet-B fallbacks carry a review date past which the recommendation becomes a recorded assumption; the three D-23 carve-out tasks are explicitly noted as not gated by this register.

---

### T-0.4 — Establish where bin data lives today, and what state it is in
**Depends on:** T-0.1 · **Feeds:** Phase 10, T-1.3 · **Answered 2026-08-09: case (b)** · *(rewritten 2026-08-09 — the original "audit inventorybalance grouped by bin" assumed a NetSuite bin dimension that D-07 removed)*

> **ANSWERED — case (b): another system.** Bin data lives in a **third-party application** today and
> will be **migrated into NetSuite** (as `customrecord_wms_bin` + `customrecord_wms_bin_state`).
> Phase 10 is therefore a **migration, not initial slotting**. What remains open is the *scope* of
> that export (below) and the cutover mechanics (T-10.1, T-13.3).

**Narrative**
As the delivery lead, I want to know whether bin location data exists anywhere today, so that Phase 10
can be scoped as cleanup, migration, or greenfield slotting.

**Requirement**
The original task audited `inventorybalance` grouped by bin — a dead premise under D-07 (no NetSuite
bin dimension). Discovery instead identifies the **source of truth**. **The answer is case (b): a
third-party application.** For completeness the cases were:

- **(a) NOWHERE** — location-level only; Phase 10 would be initial slotting. *(Not the case.)*
- **(b) ANOTHER SYSTEM** — a third-party app holds bin assignments. **← the answer.** Audit its export
  for single-SKU/single-batch compliance and plan a **migration**.
- **(c) PHYSICAL ONLY** — labelled racks, no system; floor survey needed. *(Not the case.)*

**Now confirm the export's scope — definitions vs contents (both are needed):**
- **Bin DEFINITIONS** (code, location, type, zone, pick sequence, capacity) seed the **bin master**
  `customrecord_wms_bin` (T-1.3).
- **Bin CONTENTS** (which SKU/lot/quantity is in which bin *right now*) seed **opening bin state**
  `customrecord_wms_bin_state`.
- Determine whether the third-party app holds **both**. If it holds definitions only, opening bin
  state must come from a physical count at cutover — which changes the Phase 10 / T-13.3 plan.

Then quantify: number of bins, SKUs affected, units to move, and estimated migration labour hours.

**Acceptance**
- [ ] GIVEN the discovery, THEN case (b) is recorded with evidence (which third-party app, export format, refresh capability).
- [ ] GIVEN the export, THEN it is audited for single-SKU/single-batch compliance and a **migration** plan is produced (Phase 10).
- [ ] GIVEN the export, THEN it is confirmed whether it carries bin **contents** as well as **definitions**; if definitions only, an opening-count plan for bin state is recorded.
- [ ] GIVEN the migration, THEN the bin-master data source for T-1.3 is named (the third-party app export) with an owner — T-0.4 and T-1.3 cross-reference each other.
- [ ] GIVEN two source bins that collapse to the **same `<LOCATIONCODE>-<BINCODE>` name**, WHEN the import runs, THEN it **fails that row, never overwrites** — bin-code uniqueness is per the location-prefixed `externalid` (D-14/D-12), and a collision is a data error to resolve, not silently merge.

---

### T-0.5 — Stand up the SDF project and environments
**Depends on:** T-0.1 · **Implements:** AD-13

**Narrative**
As a developer, I want a source-controlled SDF project deploying cleanly to a sandbox, so that all
subsequent work is versioned and repeatable rather than clicked into an account.

**Requirement**
SuiteCloud CLI project scaffolded; git repo with branch policy; DEV and UAT sandboxes provisioned
and refreshed; CI running lint + unit tests on push; a documented deploy command per environment;
jest harness with SuiteScript module stubs so pure logic is unit-testable.

**Suitelet deployment checklist (developer platform facts — both fail silently if missed):**
- **The deployment's Audience subtab MUST include the `Online Form User` role (PF-35).** Omit it on a
  Released deployment and NetSuite blocks the request *before the script runs* — *"You do not have
  privileges to view this page"* — which reads as a script failure but is a deployment-config error. This
  is exactly what T-0.8's **T1** proves.
- **The `Execute As Role` MUST be the dedicated least-privilege role, NOT `Administrator` — which the
  platform will not let you select anyway (PF-36).** Reinforces AD-19.

**Acceptance**
- [ ] GIVEN a clean clone, WHEN the documented deploy command is run against DEV, THEN the project deploys with no manual account changes.
- [ ] GIVEN a pull request, WHEN CI runs, THEN lint and unit tests execute and block merge on failure.
- [ ] GIVEN a new developer, WHEN they follow the README, THEN they reach a working DEV deployment without tribal knowledge.
- [ ] GIVEN the ingest Suitelet's Released deployment, THEN its Audience includes `Online Form User` (PF-35) and its Execute-As role is the dedicated least-privilege role, not Administrator (PF-36) — verified by the T-0.8/T1 logged-out create.

---

### T-0.6 — Spike: prove or disprove atomic field uniqueness
**Depends on:** T-0.5 · **Gates:** T-1.1 · **De-risks:** AD-04, AD-05 · *(new 2026-08-09 — Critique 1)*

> **ANSWERED 2026-08-09 (corrected).** Two-part answer (see D-12): **custom text fields have no
> value-uniqueness constraint (TK), but the standard `externalid` field IS platform-unique
> (developer).** Consequences ruled:
> - **AD-04 (idempotency) → `externalid` = UUID as the primary guard (attempt create, catch duplicate)
>   PLUS committer-side dedupe (keep first, rest `SUPERSEDED`) as a safety net.** Both layers.
> - **AD-05 (locking) → withdrawn *by choice*.** A lock is *possible* on `externalid` but **rejected on
>   simplicity** — single-threaded bin-state settlement is correct by construction. `customrecord_wms_concurrency_lock`
>   is **deleted.** *(Not "impossible" — do not reinstate the lock on discovering `externalid`.)*
>
> ✅ **Recorded as D-12 and propagated 2026-08-09.** AD-04, AD-05, CLAUDE.md #3 & #7,
> `customrecord_wms_concurrency_lock` (§3.2, deleted), T-1.1 (real `externalid` uniqueness test), T-2.2
> (deleted), T-2.4, T-3.1, T-4.1/4.3/4.4, T-11.2, T-12.3, F-02, F-08 all updated. The spike below is
> retained for traceability only — **the answer is known; T-0.6 need not be run.**

**Narrative**
As the architect, I want the uniqueness assumption tested before two architecture decisions are
built on it. AD-04 (idempotency) and AD-05 (locking) both depend on NetSuite enforcing field
uniqueness **atomically under concurrent saves** — a property that was asserted, never verified.
Documentation cannot settle it: uniqueness enforced by application-layer validation behaves
differently from a database constraint under two simultaneous `record.save()` calls. Only an
experiment answers it.

**Requirement**
In a DEV sandbox, create a throwaway custom record with a unique text field. Drive concurrent
creates of the **same** value from at least two simultaneous execution contexts (e.g. parallel
scheduled/Map-Reduce deployments or concurrent RESTlet calls), repeated enough times to be
statistically meaningful rather than a single lucky pass. Count the resulting rows. Repeat for the
lock-record shape (`custrecord_lock_resource_id`). Record row counts, the error raised to the loser,
and whether it is catchable.

**Acceptance**
- [ ] GIVEN N concurrent creates of an identical unique value, THEN exactly one row exists and the losers raise a catchable error — **or** the failure is documented with the observed row count.
- [ ] GIVEN the result, THEN AD-04 and AD-05 are either confirmed **in writing**, or the fallbacks below are adopted **in writing**.

**Fallbacks if it fails**
- **Idempotency (AD-04):** move dedupe to the committer. Group by UUID, keep the first, mark the rest
  `SUPERSEDED`. This degrades the guarantee from "no duplicate rows" to "no duplicate *ledger
  postings*" — which is the property that actually matters. **Consider adopting this regardless, as
  belt and braces**, since it makes the ingestion write safe even if uniqueness holds.
- **Locking (AD-05):** drop the distributed lock and route all bin-affecting commit work through a
  **single Map/Reduce queue**. Costs parallelism on that work, removes the primitive entirely.

---

### T-0.7 — Confirm the browser→server transport (same-origin)
**Depends on:** — · **Implements:** D-19 · *(created 2026-08-09 — was missing from the tree; recorded now)*

> **CLOSED 2026-08-09 (D-19).** Question: can the PWA call a RESTlet directly? **No** — Suitelets and
> RESTlets are served from **different hosts**, so a browser→RESTlet call is cross-origin (CORS).
> **Answer: make the Suitelet the API.** The PWA is served by a Suitelet (D-13) and its JSON API is a
> **sibling Suitelet — same origin, no CORS**. RESTlets leave the browser path (kept for
> server-to-server integration only). `wms_rl_scan_ingest.js` → `wms_sl_scan_ingest.js` (T-3.1).
> Governance and concurrent-slot cost are identical to a RESTlet — T-0.2 numbers unchanged.

**Acceptance**
- [ ] GIVEN the PWA and its API are both Suitelets, THEN browser calls are same-origin with no CORS preflight (demonstrated in DEV).
- [ ] GIVEN the transport decision, THEN the ingestion entry point is a Suitelet (`wms_sl_scan_ingest.js`) and no RESTlet is on the browser path.

---

### T-0.8 — Sandbox verification of SANDBOX-PENDING platform facts
**Depends on:** T-0.5 · **Implements:** D-27 · **Reference:** `08-platform-facts.md` SANDBOX-PENDING roster · *(new 2026-08-11)*

**Narrative**
As the delivery lead, I want the platform facts this account cannot confirm from documentation proven in
its own sandbox, so that no code is built on an assumption the account quietly violates.

**Requirement**
Small, discrete sandbox tests, each discharging a `SANDBOX-PENDING` row in `08-platform-facts.md`. Three
are gating and named here; the rest of the roster is worked alongside them.

- **T1 — the ingestion architecture proof (GATES ALL OF PHASE 1).** An **Available Without Login**
  Suitelet with an **Execute As Role** must **create a custom record when called while logged out**. If
  this fails, the entire ingestion design (D-19/AD-19) is invalid. **Nothing in Phase 1 starts until T1
  passes.**
- **T4 — the `Indexed` custom-field setting (PF-30)** exists and has an **SDF representation**. If it
  does, hot-path filter fields assert it in SDF XML and a CI check enforces the assertion (T-18); if not,
  say so and propose an alternative.
- **T6 — the preference identifiers of PF-28** (`ALLOWPERLINELOCATIONS`, `CENTRALIZEPURCHASING`, the
  allow-date-outside-period preference) are the real ids in this account, read via `config.load`.

**Acceptance**
- [ ] GIVEN T1, WHEN an Available-Without-Login Suitelet under an Execute-As role is called logged out, THEN it creates a `customrecord_wms_*` row — and **Phase 1 remains blocked until this passes**. *(gates Phase 1)*
- [ ] GIVEN T4, THEN the `Indexed` setting's existence and SDF representation is recorded as CONFIRMED or its absence documented with an alternative. *(PF-30)*
- [ ] GIVEN T6, THEN the three preference identifiers are confirmed against the account, resolving the SANDBOX-PENDING mark on PF-28.
- [ ] GIVEN every other SANDBOX-PENDING row (PF-22 SuiteApp, PF-26/27 features, PF-25 Multi-Book), THEN each is proven or its owning Sheet-C question answered before code depends on it.

---

### T-0.9 — Startup precondition assertion (features + preferences), self-verifying
**Depends on:** T-0.5, T-0.8 · **Implements:** D-27 · *(new 2026-08-11; extends the Bin-Management assertion of T-0.1)*

**Narrative**
As an operator of the system, I want the app to refuse to run against a misconfigured account, so that a
silent feature/preference drift cannot corrupt inventory before anyone notices.

**Requirement**
Extend the existing Bin-Management assertion into a full precondition check run at startup.
- **Features via `runtime.isFeatureInEffect` (PF-27):** `BINS` OFF, `ADVBINNUM` OFF, `MULTILOCINVT` ON,
  `AUTOLOCATIONASSIGNMENT` (record actual state — it changes behaviour, AD-21).
- **Preferences via `config.load({ type: config.Type.COMPANY_PREFERENCES })` (PF-28):**
  `ALLOWPERLINELOCATIONS` ON, `CENTRALIZEPURCHASING` OFF (**when ON, NetSuite forces all receipts into one
  location and the receiving design breaks silently**), allow-transaction-date-outside-period permitted.
- **Three states, not two.** The assertion must distinguish **enabled / disabled / identifier not
  recognised.** A wrong preference id reads as nothing; that must **fail loudly as a configuration error**,
  not be read as "disabled". This makes the assertion self-verifying and covers the residual doubt on the
  exact identifiers (SANDBOX-PENDING until T-0.8/T6).

**Acceptance**
- [ ] GIVEN each required feature/preference, THEN the assertion reports enabled, disabled, or **identifier-not-recognised** distinctly — the third fails startup as a config error.
- [ ] GIVEN `CENTRALIZEPURCHASING` ON or `MULTILOCINVT` OFF or `BINS` ON, THEN startup fails with an actionable message naming the offending setting.
- [ ] GIVEN a mistyped preference id, THEN the assertion fails loudly rather than silently treating it as disabled.

---

# PHASE 1 — Data Model & Configuration

### T-1.1 — Create scan event and config records
**Depends on:** T-0.5 · **Resolves:** F-08 · **Spec:** `03-data-model.md` §3.1, §3.10 · *(rewritten per D-12 — idempotency via `externalid`; lock record withdrawn)*

**Narrative**
As a developer, I want the core custom records deployed with correct field types, so that the ingestion
and commit pipeline has its schema — with idempotency enforced by the platform-unique `externalid`
(AD-04) and a committer safety net, and no lock record (rejected on simplicity, D-12).

**Requirement**
Deploy `customrecord_wms_scan_event` and `customrecord_wms_config` exactly per §3.1/§3.10 including all
additions marked bold. **Idempotency key = `externalid`** (the record's standard field, platform-unique
per D-12), set to the client UUID by ingestion. `custrecord_se_event_id` mirrors the UUID, **searchable,
not unique**. `custrecord_se_status` must include `SUPERSEDED` (the committer safety-net outcome).
**No `customrecord_wms_concurrency_lock`** — withdrawn (D-12). Seed the config record with agreed
defaults. Create the composite search index `(status, type, location)` supporting the M/R input search.

**Acceptance**
- [ ] GIVEN two scan events created with the **same `externalid`**, WHEN the second is saved, THEN NetSuite **rejects it as a duplicate** (platform-enforced uniqueness — the real test the earlier revision wrongly dropped).
- [ ] GIVEN the deployed scan-event record, THEN every field in §3.1 exists with the specified type, `custrecord_se_status` includes `SUPERSEDED`, and `custrecord_se_event_id` is searchable.
- [ ] GIVEN no lock record is deployed, THEN the project contains no `customrecord_wms_concurrency_lock` and no code references it (CI-greppable).
- [ ] GIVEN the deployed config record, THEN every value listed in §3.10 is present and readable via the config module.

---

### T-1.2 — Extend event type enum for exception telemetry
**Depends on:** T-1.1 · **Resolves:** F-11 gap, dashboard metric source

**Narrative**
As a warehouse supervisor, I want short picks, overrides and exceptions captured as first-class scan
events, so that scan accuracy can actually be measured rather than estimated.

**Requirement**
Add SHORT_PICK, OVERRIDE, PUTAWAY, EXCEPTION to `custrecord_se_type`. Define for each: which fields
are mandatory, whether it posts to the ledger, and how it contributes to the scan accuracy metric
(accuracy = 1 − (error + override scans) / total scans).

**Acceptance**
- [ ] GIVEN the enum, THEN all nine event types are present with a documented ledger-posting behaviour.
- [ ] GIVEN a mix of event types in a period, WHEN scan accuracy is computed, THEN the formula uses only OVERRIDE and EXCEPTION events in the numerator and matches a hand-calculated figure.

---

### T-1.3 — Create warehouse operational records
**Depends on:** T-1.1 · **Spec:** §3.3–§3.9

**Narrative**
As a developer, I want the bin extensions, replenishment, wave, custody, exception and metric records
deployed, so that the functional phases have a schema to build against.

**Requirement**
Deploy `customrecord_wms_bin` — the **bin master record** (§3.3), `customrecord_wms_replen_profile`
(§3.4), `customrecord_wms_replen_task` (§3.5), `customrecord_wms_wave_pick` (§3.6),
`customrecord_wms_custody_log` (§3.7), `customrecord_wms_exception` (§3.8),
`customrecord_wms_metric_snapshot` (§3.9). Standardise wave status on `STAGED_FOR_PACKING`.

> **Consequence of Correction 3 (D-07).** §3.3 is no longer "custom fields on an existing bin record"
> — under D-07 NetSuite has no bin record. `customrecord_wms_bin` is a **first-class WMS record the
> WMS creates and owns.** There is nothing in NetSuite to enrich or import from. **Populating the bin
> master is therefore a distinct Phase 1 data-load task, not a field default** — bin codes, types,
> zones, pick sequences and capacities have to originate somewhere.
>
> **Where that data originates — named by T-0.4 (answered: case b).** The bin master is seeded by
> **migrating the third-party application's export** (bin definitions → `customrecord_wms_bin`; bin
> contents → opening `customrecord_wms_bin_state`, per T-0.4). It cannot come from NetSuite (no bins).
> Bin **types** are the Q-16 set — UNIT, BULK, STAGE, RECEIVING, QUALITY, RETURN, DEFECT — each with a
> policy row (§3.9b) carrying `availableForFulfilment`. **Flagged dependency: without the migrated
> export, T-1.3 deploys an empty record and every allocation, wave and putaway task downstream has no
> bins to work with.** The migration itself, and its cutover freeze / delta reconciliation, are Phase
> 10 (T-10.1) and cutover (T-13.3).

**Acceptance**
- [ ] GIVEN each record, THEN every field in §3.3–§3.9 exists with the specified type and list values.
- [ ] GIVEN `customrecord_wms_bin`, THEN every field in §3.3 (`custrecord_wb_*`) is present with the specified type, and `name` carries the location-code prefix (D-14); bin-code uniqueness is enforced by the migration/data-load (D-12 — no DB unique constraint), not a platform flag.
- [ ] GIVEN the wave status list, THEN it contains exactly Pending, Picking, STAGED_FOR_PACKING, Packing, Complete, Cancelled, Exception — with no duplicate "Staged" value.
- [ ] GIVEN a documented bin-master source with a named owner, WHEN the data load runs, THEN active bins exist in `customrecord_wms_bin` with location, type, policy, zone and pick sequence populated.
- [ ] GIVEN an existing bin, WHEN an edit attempts to change `custrecord_wb_location`, THEN it is **rejected** — a bin's location is immutable (D-14). Relocating is deactivate-and-create-new, and creating the replacement is allowed only when the old bin is empty (`custrecord_bs_item` cleared, invariant #20).

---

### T-1.4 — Define roles, permissions and record-level access
**Depends on:** T-1.3 · **Resolves:** scope gap D

**Narrative**
As a compliance owner, I want WMS roles scoped to least privilege, so that a picker's handheld token
cannot post an inventory adjustment or view financial data.

**Requirement**
Define WMS Picker, WMS Packer, WMS Supervisor roles, and the **WMS Scan-Endpoint execute-as role**
(the role the Available-Without-Login ingestion Suitelet runs under, D-19/T-3.3 — replaces the old
"Integration (RESTlet)" role). That execute-as role gets **create on scan events and read on reference
data only — not transaction edit**; the M/R committer runs under a separate elevated deployment role.
Operators authenticate at the application layer (T-3.3), **not** via NetSuite login — they have no
user. Supervisors get the exception queue and manual adjustment. Document the permission matrix.

**Acceptance**
- [ ] GIVEN the scan-endpoint execute-as role, WHEN it attempts to create an Item Fulfillment directly, THEN access is denied.
- [ ] GIVEN a Picker role, WHEN they open the exception queue Suitelet, THEN access is denied.
- [ ] GIVEN the permission matrix, THEN it is reviewed and signed off by the compliance owner.

---

# PHASE 2 — Core Services Library

*Pure, unit-testable modules. Everything else consumes these. Build first, build well.*

### T-2.1 — `wms_lib_cache.js` — static reference cache
**Depends on:** T-1.1 · **Resolves:** F-01 · **Implements:** AD-02

**Narrative**
As a developer, I want a cache module that only ever holds static reference data, so that no future
change can accidentally reintroduce cache-based enforcement of a mutable invariant.

**Requirement**
Implement `getItem(sku)`, `getBinMeta(binId)`, `getReplenProfile(binId)`, `getConfig()` per AD-02
with the stated keys and TTLs, `cache.Scope.PROTECTED`, loader functions, and safe JSON handling
including cache-miss and malformed-payload paths. The module **must not** expose any method
returning bin quantity, current SKU or current lot. Include a header comment stating this
prohibition and the reason (F-01).

**Acceptance**
- [ ] GIVEN the module's public interface, THEN no exported function returns live bin contents or quantity.
- [ ] GIVEN a cache miss, WHEN a getter is called, THEN the loader populates from search and returns correct data.
- [ ] GIVEN a malformed cached payload, WHEN a getter is called, THEN it recovers via the loader rather than throwing.
- [ ] GIVEN an Item, Bin or Replenishment Profile is edited, WHEN the User Event fires, THEN the corresponding cache key is invalidated and the next read reflects the change.

---

### T-2.2 — ~~`wms_lib_lock.js` — distributed lock~~ **DELETED (D-12)**
**Resolves:** F-02

> **This task is withdrawn (D-12) — rejected on simplicity, not impossible.** A race-free lock *could*
> be built on `externalid` (which is platform-unique), but there is no lock module because the races it
> would guard are removed more cheaply (AD-05, withdrawn by choice):
> - **Order commits** — serialised by AD-06 grouping + flipping events to `PROCESSING` on claim.
> - **Bin-affecting commit work** — **single-threaded through one Map/Reduce queue** (single-threaded
>   bin-state settlement, T-4.1/T-4.3).
>
> No `wms_lib_lock.js`, no `customrecord_wms_concurrency_lock`, no reaper (was T-11.2), no
> `STALE_LOCK`/`LOCK_TIMEOUT`. Section retained as a tombstone.

---

### T-2.3 — `wms_lib_bin_state.js` — bin state projection
**Depends on:** T-1.1 · **Resolves:** F-01 · **Implements:** AD-03 · *(revised per D-01)*

**Narrative**
As a warehouse operator, I want the system's view of a bin to match what I can see on the shelf, so
that I am never told a visibly empty bin is occupied because the ledger has not caught up.

**Requirement**
Maintain `customrecord_wms_bin_state` as the operational truth of bin contents, including
accepted-but-unposted events. `read(binId)` is a **single record lookup by internal ID, never a
search** — this is the hottest read in the system. `apply(binId, delta, eventId)` performs a
**read-check-write** on `custrecord_bs_version` (optimistic version check — *not* an atomic
compare-and-set, which SuiteScript does not offer; the lost-update window is bounded and accepted per
AD-03); on version mismatch, re-read and re-evaluate **once**, then proceed (no locking, no blocking —
collisions are rare per D-01).

`reconcile(itemId, locationId)` — **not `reconcile(binId)`**: NetSuite has no bin dimension, so a
single bin has nothing to reconcile against. Reconciliation is at **item/location grain** — sum the
WMS bin quantities for that item and location, compare to NetSuite quantity on hand, **additionally
per lot for LOT items** — and report divergence (per `06-netsuite-boundary.md` §4, the same contract
as T-8.3).

**Negative quantity is permitted (D-11)** — the floor is allowed to be ahead of the books, and
blocking a picker because the queue has not drained would defeat the whole architecture. But it is
**diagnostic, not silent**: transient small negatives during the queue window are normal, while
negatives beyond configurable magnitude or age thresholds raise a `NEGATIVE_BIN_STATE` exception. Bin becomes empty → item and lot cleared so
the next putaway of any SKU is accepted.

**Acceptance**
- [ ] GIVEN a pick empties a bin, WHEN a putaway of a different SKU is validated 2 minutes later and before the ledger has posted, THEN it is **accepted** — the false-rejection case in F-01 does not occur.
- [ ] GIVEN a bin state read, WHEN governance is measured, THEN it consumes a record lookup and no saved search.
- [ ] GIVEN a version mismatch on apply, THEN the module re-reads once and completes without blocking or erroring.
- [ ] GIVEN a drained event queue, WHEN `reconcile(itemId, locationId)` runs, THEN the summed WMS bin quantity equals NetSuite quantity on hand for that item and location — additionally per lot for LOT items.
- [ ] GIVEN persistent divergence for an item/location, THEN it is reported for exception handling rather than silently corrected.
- [ ] GIVEN a pick that drives bin quantity negative, THEN the update succeeds and the operator is not blocked.
- [ ] GIVEN a bin negative beyond the configured magnitude or age threshold, THEN a `NEGATIVE_BIN_STATE` exception is raised.

---

### T-2.3b — `wms_lib_bin_policy.js` — policy-driven bin validation
**Depends on:** T-2.3, T-1.3 · **Resolves:** F-18 · **Implements:** AD-14

> **Carved out of the T-0.3 gate — buildable now (D-23, 2026-08-10).** Pure function of
> `(policy, currentState, proposedItem, proposedLot)`. Conditions: imports **no `N/` module** (not even
> `N/error`; CI-enforced by `guard-carveout-imports.js`); **unit tests of the acceptance criteria below
> are the deliverable**; **no hard-coded tuning** (invariant #9) — the policy object is passed in, never
> read from config inside the module. The **caller** (the not-yet-built validation entry point) loads
> the bin policy and projection from cache and hands them in; **do not write that caller here.**
> **Error shape (D-23):** a bin rejection is a **normal outcome, not an exception** — `check(...)`
> **returns a structured verdict** `{ allowed, reasonCode }` (e.g. `WMS_BIN_CONSTRAINT_VIOLATION`,
> `WMS_BIN_NEGATIVE_STATE`, `WMS_BIN_BLOCKED`), never throws for it. Only a **programmer error** (bad
> argument, impossible state) throws — a plain `Error` with `err.name` set to `ERR_WMS_INVALID_ARGUMENT`.
> The ingestion Suitelet (T-3.1) maps a `{allowed:false}` verdict to its `ERR_WMS_*` response code.

**Narrative**
As a warehouse operator, I want bin rules enforced according to what kind of bin it is, so that pick
faces stay single-SKU while staging areas can hold a mixed tote — which is the whole point of a
staging area.

**Requirement**
The pure core is `check(policy, currentState, proposedItem, proposedLot)` — the **caller** resolves the
bin's policy (AD-14 table) and projection (T-2.3) from cache and hands them in (D-23; the pure module
reads no cache and imports no `N/` module). **One code path for all bin types** — no `if (binType ===
'UNIT' || binType === 'BULK')` anywhere in the codebase. **`check` returns a structured verdict, it does
not throw for a business rejection (D-23):** `{ allowed: false, reasonCode: 'WMS_BIN_CONSTRAINT_VIOLATION',
conflictItem, conflictLot }` when a rule is violated, `{ allowed: false, reasonCode: 'WMS_BIN_NEGATIVE_STATE' }`
for a negative-and-different-SKU bin, `{ allowed: false, reasonCode: 'WMS_BIN_BLOCKED' }` when
`custrecord_wb_blocked`, and `{ allowed: true }` otherwise. An **empty bin always returns `allowed:true`
— and "empty" means `custrecord_bs_item` is cleared, never a `qty` comparison** (invariant #20; a Decimal
float compare is fragile and a negative bin with an item set is *occupied*). A **programmer error** (e.g.
a missing policy argument) throws a plain `Error` with `err.name = 'ERR_WMS_INVALID_ARGUMENT'`. Fully
unit-testable with no NetSuite account; the ingestion Suitelet (T-3.1) maps a `{allowed:false}` verdict
onto its `ERR_WMS_*` response code.

**Acceptance**
- [ ] GIVEN a UNIT bin holding item ABC, WHEN putaway of item XYZ is checked, THEN the verdict is `{ allowed:false, reasonCode:'WMS_BIN_CONSTRAINT_VIOLATION', conflictItem:'ABC' }` — a returned verdict, not a throw. *(FRD TC-BIN-01; D-23 error shape)*
- [ ] GIVEN a BULK bin holding BATCH-001 of item ABC, WHEN putaway of BATCH-002 of the same item is checked, THEN the verdict is `{ allowed:false, reasonCode:'WMS_BIN_CONSTRAINT_VIOLATION' }`. *(FRD TC-BIN-02)*
- [ ] GIVEN a **STAGE** bin already holding three SKUs, WHEN a fourth SKU is added during wave handoff, THEN the verdict is `{ allowed:true }` — resolving the §2.1 / §2.5 contradiction in F-18.
- [ ] GIVEN the BULK policy is changed to `singleBatch: false` in configuration, WHEN a mixed-batch putaway is retried, THEN it returns `{ allowed:true }` **with no code deployment**.
- [ ] GIVEN a bin with **negative** quantity, WHEN a different SKU is validated, THEN the verdict is `{ allowed:false, reasonCode:'WMS_BIN_NEGATIVE_STATE' }` — the bin is treated as occupied, not empty.
- [ ] GIVEN a bin with negative quantity, WHEN the **same** SKU and lot are validated, THEN the verdict is `{ allowed:true }` so corrective putaway is possible.
- [ ] GIVEN a bin whose item is set but `qty` is a tiny fractional residue (e.g. `0.0000001`), WHEN a different SKU is validated, THEN the verdict is `{ allowed:false }` — emptiness is decided by `custrecord_bs_item` being cleared, not by `qty` (invariant #20).
- [ ] GIVEN a bin holding stock NetSuite has committed elsewhere, THEN it is treated as **occupied** — the WMS tracks physical quantity only and never sees NetSuite's available/committed split (Q-10 closed, moot).
- [ ] GIVEN a call with a missing `policy` argument (a programmer error, not a business case), THEN a plain `Error` with `err.name === 'ERR_WMS_INVALID_ARGUMENT'` is thrown. *(D-23 error shape)*
- [ ] GIVEN the validator, THEN it is exercised by unit tests covering every policy combination and both verdict branches without a NetSuite connection.

---

### T-2.4 — `wms_lib_idempotency.js` and event writer
**Depends on:** T-1.1 · **Resolves:** F-08 · **Implements:** AD-04 · *(rewritten per D-12 — `externalid` primary + committer dedupe safety net)*

**Narrative**
As a handheld operator on unreliable Wi-Fi, I want retrying a failed scan to be harmless, so that a
dropped connection never double-counts a pick.

**Requirement**
**Layer 1 — `externalid` (primary).** `writeScanEvent(payload)` sets the record's standard `externalid`
to the client UUID and attempts a direct create with **no pre-read** (no hot-path search). A duplicate
UUID **fails at the platform with `UNIQUE_RCRD_ID_REQD` (PF-13, D-12)** — catch **that specific error**
(NOT `DUP_CSTM_RCRD_ENTRY`, which is a duplicate-*name* error under "Require Unique Names") and return
`{status:'SUCCESS', idempotent:true, eventId:<existing>}`. Set server timestamp, preserve client
timestamp, record device ID. Classify every other error as retryable or terminal and return `retryable`
so the client's queue can decide.

**Layer 2 — committer dedupe (safety net).** Provide `dedupeByEventId(events)` as a pure helper the
committer (T-4.1) calls: group by UUID, keep the earliest, return survivors + superseded ids. This
guarantees "no duplicate *ledger posting*" even if a duplicate row ever slips past layer 1. It is the
unit-testable core.

**Acceptance**
- [ ] GIVEN the same UUID written twice, WHEN the second is saved, THEN it fails with `UNIQUE_RCRD_ID_REQD` (not `DUP_CSTM_RCRD_ENTRY`) and the writer returns `idempotent: true` — exactly one row exists. *(PF-13)*
- [ ] GIVEN `dedupeByEventId` over events with duplicate UUIDs, THEN it returns exactly one survivor per UUID (the earliest) and the rest flagged `SUPERSEDED` — verified by unit test with no NetSuite account.
- [ ] GIVEN the writer runs, WHEN governance usage is measured, THEN no saved search is executed on the success path.
- [ ] GIVEN a transient platform error, THEN the response sets `retryable: true`; given a validation error, `retryable: false`.

---

### T-2.6 — `wms_lib_event_registry.js` — declarative event handlers
**Depends on:** T-2.5 · **Resolves:** F-12, F-13, F-15, F-16, F-17 · **Implements:** AD-15

> **Carved out of the T-0.3 gate — buildable now (D-23, 2026-08-10).** The registry data structure and
> the pure key serialisation/parsing are the carve-out. Conditions: imports **no `N/` module** (not even
> `N/error`; CI-enforced by `guard-carveout-imports.js`). **Error shape (D-23):** a handler's `validate`
> reports a field/business failure as a **returned verdict** (`{ ok:false, reasonCode, field }`), not a
> throw; a **programmer error** (a handler registered without `requiredFields`, a malformed key object)
> throws a plain `Error` with `err.name` set to an `ERR_WMS_*` value. **Unit tests of the acceptance
> criteria below are the deliverable** — especially the F-12 group-key round-trip through underscored
> enum values;
> **no hard-coded tuning** (invariant #9) — `governanceEst` values and thresholds are declared per
> handler as data, and live thresholds reach handlers via injected context from T-2.5, never as
> literals. **The RESTlet/mapper/reducer dispatchers that consume the registry stay held — do not write
> them.** Each handler's `commit` may be declared as a stub/signature; its NetSuite body is not carved
> out.

**Narrative**
As a developer, I want each event type to declare its own validation, grouping and commit behaviour
in one place, so that adding an event type later does not mean editing four scripts and
rediscovering the same class of bug.

**Requirement**
Registry per AD-15. Each handler declares `requiredFields`, `validate`, `groupKey` (returns an
**object**, serialised centrally — never string concatenation), `commit`, and `governanceEst`.
Registration for all nine event types from T-1.2. The RESTlet, mapper and reducer become generic
dispatchers holding **no per-event-type conditionals**. Thresholds reach handlers via injected
context from T-2.5, never as literals.

**Acceptance**
- [ ] GIVEN `REPLEN_MOVE` and `BIN_TRANSFER` events, WHEN group keys are produced and parsed, THEN identifiers round-trip correctly despite the underscores — verified by unit test. *(F-12)*
- [ ] GIVEN a search of the ingestion Suitelet, mapper and reducer, THEN none contains a `switch` or `if` branching on event type. *(F-15)*
- [ ] GIVEN a handler whose `requiredFields` are not all present, WHEN an event is dispatched, THEN it is rejected before any record I/O with a field-level message. *(F-13)*
- [ ] GIVEN `governanceEst` exceeds remaining usage, WHEN the reducer dispatches, THEN it yields **before** attempting the work rather than failing partway. *(F-17)*
- [ ] GIVEN a new event type is registered with a handler and nothing else is edited, THEN it ingests, groups and commits end to end — demonstrated with a throwaway type in test.

---

### T-2.6a — Bound the group-key serialiser to 3,000 characters *(carved-out module change — its own pass)*
**Depends on:** T-2.6 · **Implements:** PF-10 · *(new 2026-08-11; do NOT edit the module in this pass)*

**Narrative**
As a developer, I want the group key to be provably shorter than the Map/Reduce key ceiling, so that a
pathological key never trips `PERSISTED_DATA_LIMIT_FOR_MAPREDUCE_SCRIPT_EXCEEDED` mid-run.

**Requirement**
A Map/Reduce **key is capped at 3,000 characters (PF-10)**. `serializeGroupKey` lives in the carved-out
`wms_lib_event_registry.js` (D-23) — **not editable in the platform-facts pass.** This task, run on its
own, adds a **bound + assertion** so a serialised key exceeding 3,000 chars is a caught programmer error
(plain `Error`, `ERR_WMS_*` name — D-23 error shape), plus a unit test. The carve-out guard still forbids
any `N/` import.

**Acceptance**
- [ ] GIVEN a group key that serialises beyond 3,000 characters, THEN `serializeGroupKey` throws a plain `Error` with an `ERR_WMS_*` name, covered by a unit test.
- [ ] GIVEN the change, THEN `guard-carveout-imports` and `guard-src-encoding` still pass.

---

### T-2.6b — Register the ALA line-freeze event handler *(carved-out module change — its own pass)*
**Depends on:** T-2.6, T-6.x (wave release) · **Implements:** AD-21 · *(new 2026-08-11; do NOT edit the module in this pass)*

**Narrative**
As a wave planner, I want a released wave's lines frozen against Automatic Location Assignment, so that
NetSuite cannot re-home a line's location under a wave the WMS has already committed to.

**Requirement**
Per AD-21 (PF-26): wave release emits a **line-freeze event**; the committer processes it and sets
`noautoassignlocation` on the affected sales-order lines, **through the committer** (invariant #4 — no
write-to-SO exception) with the AD-03 optimistic-concurrency retry. The handler is **registered** in the
declarative registry — but that module is carved-out (D-23), so **the handler definition + tests are this
task, run on its own pass**, not an edit here. Dormant if `AUTOLOCATIONASSIGNMENT` is off (SANDBOX-PENDING).

**Acceptance**
- [ ] GIVEN a wave release, THEN a line-freeze event is emitted, committed, and `noautoassignlocation` is set on the wave's lines via the committer (never a direct SO write).
- [ ] GIVEN the handler, THEN it is a registry registration with unit tests, and the carved-out guards still pass.
- [ ] GIVEN `AUTOLOCATIONASSIGNMENT` off in the account, THEN the event type is defined but dormant (no-op), verified.

---

### T-2.6c — Serial-array validation in the affected handlers *(carved-out registry change — its own pass)*
**Depends on:** T-2.6, C-3.13 (serial_state) · **Implements:** D-29, invariant #21 · *(new 2026-08-11; do NOT edit the carved-out registry module here)*

**Narrative**
As a developer, I want serial handling declared per event type in the registry, so that entry and movement
enforce opposite serial rules without a special case leaking into the dispatchers.

**Requirement**
`PICK`, `PUTAWAY`, `BIN_TRANSFER` and the receipt types (`RECEIPT_PO/TO/WO/RMA`) plus `WRITE_OFF` accept a
**serial array** (`custrecord_se_serials`). The handler `validate` enforces: **array length == quantity;
every serial resolves; no serial already sits elsewhere (invariant #21)**. **Entry vs movement is
OPPOSITE (Part D):** an **entering** serial (receipts) must **not** already exist as an active row; a
**referenced** serial (PICK/PUTAWAY/BIN_TRANSFER) **must** exist and be **in the bin the operator claims**.
A **lot** follows the same movement rule but carries a quantity rather than being fixed at 1 (PF-31).
**Verdicts use the typed serial exception set (data model §3.13b, D-29), applying the data-wrong vs
action-wrong split:** `SERIAL_WRONG_BIN` is *data-wrong* — the verdict **continues** (accept, move the
serial, raise a discrepancy); `SERIAL_ALREADY_LIVE` / `SERIAL_UNKNOWN` / `SERIAL_NOT_AVAILABLE` /
`SERIAL_WRONG_ITEM` / `SERIAL_COUNT_MISMATCH` are *action-wrong* — the verdict **stops**. The
registry module is carved out (D-23) — **this is a task, run on its own pass; do not edit the module here.**

**Acceptance**
- [ ] GIVEN a serialised PICK naming a serial not in the claimed bin, THEN `validate` returns a rejection verdict; GIVEN a receipt naming a serial that already exists live, THEN entry validation rejects it — the two rules are opposite.
- [ ] GIVEN a serial array whose length != quantity, THEN it is rejected.
- [ ] GIVEN the changes, THEN the carved-out guards (`guard-carveout-imports`, `guard-src-encoding`) still pass and the handlers have unit tests.

---

### T-2.7 — `wms_lib_ledger_adapter.js` — the NetSuite boundary
**Depends on:** T-0.1, T-2.5, T-2.6 · **Resolves:** F-19 · **Implements:** AD-16 · *(rewritten per D-07; shapes CONFIRMED and UNBLOCKED per D-27 — PF-14..PF-21)*

**Narrative**
As a developer, I want every NetSuite posting to go through one module that knows how each item is
tracked, so that no bin ever leaks into the ledger and mixed-mode orders post correctly.

**Requirement**
The complete ledger interface, and nothing else, per `06-netsuite-boundary.md` §4. **All shapes are now
CONFIRMED against `08-platform-facts.md` (PF-14..PF-21, D-27) — the "pending developer confirmation"
markers are removed.**

**Inventory detail (all postings, PF-16):** the `inventorydetail` subrecord's **`inventoryassignment`**
sublist — **`receiptinventorynumber`** when stock enters, **`issueinventorynumber`** when stock leaves,
plus **`quantity`**. **The NetSuite bin-number and destination-bin-number fields are never used** (Bin Management off — invariant #13).
**Standard mode works, including on a transformed record — dynamic mode is not required.** Per tracking
mode (PF-17): **SERIAL** = one sublist line per serial, `quantity` exactly 1; **LOT** = one line,
`quantity` may exceed 1 and may be fractional; **PLAIN** = no inventory detail.

**Outbound:**
- **Item Fulfillment** — **one per (sales order, location); a single fulfilment cannot span locations
  (PF-18)** — confirming the AD-01 / invariant #4 amendment. Sourced from a Sales Order OR a Transfer
  Order (D-22), the same shape parameterised by source transaction type.
- **Transfer Order fulfilment (D-22, PF-19)** — **`transferorder` → `itemfulfillment` transform is
  supported** (confirmed). The **receipt transforms from the transfer order**, passing the **fulfilment
  id as an auxiliary reference** so costing links. Partial fulfil/receipt is supported **within a single
  subsidiary**; **`PARTIAL_FULFILL_RCEIV_DISALLWD` applies only cross-subsidiary** (Q-52). Receipt is
  capped at quantity fulfilled to date (`TRANSORD_SHIP_REC_MISMATCH`) and **cannot precede fulfilment
  (`CANT_RCEIV_BEFORE_FULFILL` — the code F-30 keys on).**
- **Inventory Adjustment (PF-21)** — body `subsidiary`, `account`, `adjlocation`, `trandate`; lines
  `item`, **negative** `adjustqtyby`, `location`; lot/serial via `issueinventorynumber`. **`unitcost` is
  ignored on negative adjustments — do not compute it** (invariant #17).
- **Inventory Transfer (PF-20)** — body `subsidiary`, `location`, `transferlocation`, `trandate`; lines
  `item`, `adjustqtyby`; lot/serial via `issueinventorynumber`. **This is the shape for RQD receipt
  isolation (D-28), not a Transfer Order.**

**Inbound (D-09):**
- **Item Receipt** against a Purchase Order or Transfer Order (TO receipt per PF-19 above).
- **Work Order Completion / Assembly Build** (Q-25) for production output.

**Neither:**
- **Bin movements post nothing.** `BIN_TRANSFER`, `REPLEN_MOVE` and `PUTAWAY` update WMS state and
  create no NetSuite transaction, because stock has not changed location.

Tracking mode is resolved per line from the item cache as **`recordtype`, not an account-level flag and
not a field (PF-14)** — the **six types** (`inventoryitem`/`lotnumberedinventoryitem`/`serializedinventoryitem`
+ assembly equivalents) → **PLAIN/LOT/SERIAL, all in scope (D-29)**. **Mixed-mode orders are the normal
case** and one `record.transform` (per order, per location — invariant #4, PF-18) must handle PLAIN, LOT
and SERIAL lines together. Per PF-17: **SERIAL** = one `inventoryassignment` line per serial, quantity
exactly 1; **LOT** = one line, quantity may exceed 1 / be fractional; **PLAIN** = no detail. **There is no
"reject serialised item" path — that rule is withdrawn (D-29 supersedes D-08).**

**Transaction date comes from scan time, not commit time** (F-23, AD-17). This is a **pre-check**
(PF-24): read `closed` on the `accountingperiod` record and decide before posting; where the scan-date
period is closed, post current and raise `CLOSED_PERIOD_POSTING` (`CLOSED_TRAN_PRD` is the backstop). If
Multi-Book is enabled the pre-check inspects book-specific status (PF-25, Q-51).

**The NetSuite bin-number field must not appear anywhere in the codebase**, including this module. Enforced by a CI
grep.

**Acceptance**
- [ ] GIVEN an order with both a PLAIN and a LOT line, WHEN it commits, THEN one Item Fulfillment is created with correct inventory detail for each line and no error.
- [ ] GIVEN a serialised line at commit, THEN it posts with one `inventoryassignment` line per serial (quantity 1, PF-17) and the named serials update in `customrecord_wms_serial_state` — it is **committed, not rejected** (D-29).
- [ ] GIVEN a PO receipt event, WHEN it commits, THEN an Item Receipt posts against the correct PO with lot and expiry recorded.
- [ ] GIVEN an event whose scan-date period has closed, THEN it posts to the current period and raises a `CLOSED_PERIOD_POSTING` exception.
- [ ] GIVEN a bin transfer or replenishment event, WHEN it commits, THEN **no** NetSuite transaction is created, the WMS projection updates, and the event is marked POSTED rather than FAILED.
- [ ] GIVEN the CI guard (`scripts/guard-forbidden-tokens.js`) scanning for the NetSuite bin-number field, the bin-transfer record type and Bin Management feature checks, THEN there are **zero** matches in the codebase.
- [ ] GIVEN an item whose tracking mode changes in NetSuite, WHEN the item cache refreshes, THEN subsequent postings use the new mode with no deployment.

---

### T-2.5 — `wms_lib_config.js` and shared constants
**Depends on:** T-1.1 · **Resolves:** F-16

**Narrative**
As a warehouse manager, I want tuning values changeable without a code deployment, so that the
similarity threshold and cart capacity can be adjusted from operational experience.

**Requirement**
Read `customrecord_wms_config` through the cache with a short TTL, exposing typed getters with
documented defaults. **Getters take a location: `getConfig(locationId)` (D-14)** — resolve the
**global-defaults row overlaid by the location override row, field-by-field** (§3.10 precedence: a
value present on the location row wins, absent inherits global). **No magic numbers anywhere else in
the codebase** — enforced by a lint rule where practical and by code review otherwise. Single source of
truth for the similarity threshold, ending the 50%/60%/0.50 conflict.

**Acceptance**
- [ ] GIVEN the similarity threshold is changed on the config record, WHEN the next clustering run executes (after TTL), THEN it uses the new value with no deployment.
- [ ] GIVEN a per-location override for cart capacity and no override for similarity threshold, WHEN `getConfig(locationId)` runs, THEN cart capacity comes from the location row and similarity threshold inherits the global default. *(D-14)*
- [ ] GIVEN a code search for the literals `0.5`, `0.6`, `120`, `50000`, THEN none appear as behavioural constants outside the config module and its tests.
