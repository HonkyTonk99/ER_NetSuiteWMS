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

*Item census.* For every in-scope item, classify as **PLAIN** or **LOT** and report by item count
and by share of order lines. Serial is out of scope (D-08), so the census has a second purpose:
**confirm no serialised items exist in WMS-managed locations**, and list any that do so they can be
excluded or re-configured before Phase 1. A serialised item reaching the commit path fails
confusingly (F-21 residual, T-2.7).

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
FRD's figures**, which are unverified. With serial out of scope the one-scan-per-line assumption
broadly holds, but it should still be validated against the census rather than taken on trust.
Slots required = req/s × mean server seconds. **Include inbound receipt scanning (Phase 5B)**, which
the FRD's model excludes entirely. Produce a written allocation table (AD-08) with
≥ 20% headroom. Where the budget does not close, produce costed options: additional SuiteCloud Plus
licences, reduced scan frequency, or client-side event batching.

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

**Acceptance**
- [ ] GIVEN the register, WHEN the decision workshop concludes, THEN every question has a recorded decision, owner and date, or an explicit "deferred, out of scope for release 1".
- [ ] GIVEN Q-01, THEN it is decided (not deferred) before Phase 3 is scheduled.
- [ ] GIVEN Q-16, Q-17, Q-25 and Q-27, THEN each has a named owner and a target date before its dependent phase begins.

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

**Acceptance**
- [ ] GIVEN a clean clone, WHEN the documented deploy command is run against DEV, THEN the project deploys with no manual account changes.
- [ ] GIVEN a pull request, WHEN CI runs, THEN lint and unit tests execute and block merge on failure.
- [ ] GIVEN a new developer, WHEN they follow the README, THEN they reach a working DEV deployment without tribal knowledge.

---

### T-0.6 — Spike: prove or disprove atomic field uniqueness
**Depends on:** T-0.5 · **Gates:** T-1.1 · **De-risks:** AD-04, AD-05 · *(new 2026-08-09 — Critique 1)*

> **ANSWERED 2026-08-09 — DISPROVEN.** Sponsor ruling: **NetSuite has no value-uniqueness constraint**
> (field "unique" is application-layer, not a DB constraint, and is not atomic under concurrent
> saves). Consequences ruled:
> - **AD-04 (idempotency) → committer-side dedupe.** Group scan events by UUID in the committer, keep
>   the first, mark the rest `SUPERSEDED`. The guarantee is "no duplicate *ledger postings*", not "no
>   duplicate rows".
> - **AD-05 (locking) → withdrawn.** Replaced by **single-threaded bin-state settlement** (all
>   bin-affecting commit work through one queue). `customrecord_wms_concurrency_lock` is **deleted.**
>
> ⚠️ **These consequences are NOT yet propagated to the spec.** AD-04, AD-05, invariant #3 & #7
> (CLAUDE.md), `customrecord_wms_concurrency_lock` (§3.2), T-1.1, T-2.2, T-2.4, T-4.1/4.3/4.4, T-11.2
> and the STALE_LOCK/LOCK_TIMEOUT exception types still describe the superseded design. The spike
> below is retained for traceability; **propagation is pending a ruling to record this as a formal
> decision (D-12) and rewrite those sites** — see the reconciliation report. Do not build T-1.1 until
> that lands, since T-1.1 deploys the now-withdrawn lock record and unique-field constraint.

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

# PHASE 1 — Data Model & Configuration

### T-1.1 — Create scan event, lock and config records
**Depends on:** T-0.5, T-0.6 · **Resolves:** F-08 · **Spec:** `03-data-model.md` §3.1, §3.2, §3.10

**Narrative**
As a developer, I want the core custom records deployed with correct field types and uniqueness
constraints, so that idempotency and locking are enforced by the database rather than by application
code.

**Requirement**
Deploy `customrecord_wms_scan_event`, `customrecord_wms_concurrency_lock`, `customrecord_wms_config`
exactly per §3.1/§3.2/§3.10 including all additions marked bold. `custrecord_se_event_id` and
`custrecord_lock_resource_id` **must** be flagged unique. Seed the config record with agreed defaults.
Create the composite search index supporting the M/R input search.

**Acceptance**
- [ ] GIVEN two records with the same `custrecord_se_event_id`, WHEN the second is saved, THEN NetSuite raises `UNIQUE_FIELD_VALUE_ALREADY_EXISTS`.
- [ ] GIVEN two concurrent creates of the same `custrecord_lock_resource_id`, WHEN both are attempted, THEN exactly one succeeds.
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
- [ ] GIVEN `customrecord_wms_bin`, THEN `name` (bin code) is flagged unique and every field in §3.3 (`custrecord_wb_*`) is present with the specified type.
- [ ] GIVEN the wave status list, THEN it contains exactly Pending, Picking, STAGED_FOR_PACKING, Packing, Complete, Cancelled, Exception — with no duplicate "Staged" value.
- [ ] GIVEN a documented bin-master source with a named owner, WHEN the data load runs, THEN active bins exist in `customrecord_wms_bin` with location, type, policy, zone and pick sequence populated.

---

### T-1.4 — Define roles, permissions and record-level access
**Depends on:** T-1.3 · **Resolves:** scope gap D

**Narrative**
As a compliance owner, I want WMS roles scoped to least privilege, so that a picker's handheld token
cannot post an inventory adjustment or view financial data.

**Requirement**
Define WMS Picker, WMS Packer, WMS Supervisor, WMS Integration (RESTlet) roles. The integration role
gets create on scan events and read on reference data only — **not** transaction edit; the M/R script
runs under an elevated deployment role. Supervisors get the exception queue and manual adjustment.
Document the permission matrix.

**Acceptance**
- [ ] GIVEN the WMS Integration role, WHEN it attempts to create an Item Fulfillment directly, THEN access is denied.
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

### T-2.2 — `wms_lib_lock.js` — distributed lock *(commit stage only, per D-01)*
**Depends on:** T-1.1 · **Resolves:** F-02 · **Implements:** AD-05

> **Scope reduced.** Locks are no longer used on the ingestion path — operator collision is not a
> credible risk and the projection's version check covers it. This module serves the Map/Reduce
> commit stage only, where parallel queues create a genuine machine-machine race.

**Narrative**
As a developer, I want a race-free lock primitive with ordering and TTL, so that concurrent commits
against the same bin or order cannot interleave and corrupt inventory.

**Requirement**
`acquire(resourceType, resourceId, ttlSeconds)` attempts a create and treats
`UNIQUE_FIELD_VALUE_ALREADY_EXISTS` as "not acquired"; exponential backoff with jitter, capped
attempts. `release(lockId)` deletes, always callable from `finally`. `acquireAll(resources)` sorts by
`(resourceTypeOrdinal, resourceId)` ascending before acquiring and releases in reverse on partial
failure. `withLock(resources, fn)` wrapper. Scheduled reaper deletes expired locks and raises a
STALE_LOCK exception per reaped lock.

**Acceptance**
- [ ] GIVEN two concurrent `acquire` calls for the same resource, WHEN both run, THEN exactly one returns a lock and the other returns not-acquired after backoff.
- [ ] GIVEN `acquireAll` called with the same two resources in opposite argument order by two threads, WHEN both run, THEN neither deadlocks and both eventually complete.
- [ ] GIVEN a lock older than its TTL, WHEN the reaper runs, THEN the lock is deleted and one STALE_LOCK exception record is created.
- [ ] GIVEN `withLock` and a callback that throws, THEN the lock is released before the error propagates.

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

**Narrative**
As a warehouse operator, I want bin rules enforced according to what kind of bin it is, so that pick
faces stay single-SKU while staging areas can hold a mixed tote — which is the whole point of a
staging area.

**Requirement**
`check(binId, itemId, lotNumber)` loads the bin's policy (AD-14 table) from cache and applies it
against the projection from T-2.3. **One code path for all bin types** — no `if (binType === 'UNIT'
|| binType === 'BULK')` anywhere in the codebase. Throws
`ERR_WMS_BIN_CONSTRAINT_VIOLATION` naming the bin, conflicting item and conflicting lot. Empty bin
always passes. `custrecord_wb_blocked` fails with a distinct code. Policy is a pure function of
`(policy, currentState, proposedItem, proposedLot)` — fully unit-testable with no NetSuite account.

**Acceptance**
- [ ] GIVEN a UNIT bin holding item ABC, WHEN putaway of item XYZ is checked, THEN `ERR_WMS_BIN_CONSTRAINT_VIOLATION` is thrown naming ABC. *(FRD TC-BIN-01)*
- [ ] GIVEN a BULK bin holding BATCH-001 of item ABC, WHEN putaway of BATCH-002 of the same item is checked, THEN it is blocked. *(FRD TC-BIN-02)*
- [ ] GIVEN a **STAGE** bin already holding three SKUs, WHEN a fourth SKU is added during wave handoff, THEN it is **accepted** — resolving the §2.1 / §2.5 contradiction in F-18.
- [ ] GIVEN the BULK policy is changed to `singleBatch: false` in configuration, WHEN a mixed-batch putaway is retried, THEN it succeeds **with no code deployment**.
- [ ] GIVEN a bin with **negative** quantity, WHEN a different SKU is validated, THEN it is rejected with `ERR_WMS_BIN_NEGATIVE_STATE` — the bin is treated as occupied, not empty.
- [ ] GIVEN a bin with negative quantity, WHEN the **same** SKU and lot are validated, THEN it passes so corrective putaway is possible.
- [ ] GIVEN a bin holding stock NetSuite has committed elsewhere, THEN it is treated as **occupied** — the WMS tracks physical quantity only and never sees NetSuite's available/committed split (Q-10 closed, moot).
- [ ] GIVEN the validator, THEN it is exercised by unit tests covering every policy combination without a NetSuite connection.

---

### T-2.4 — `wms_lib_idempotency.js` and event writer
**Depends on:** T-1.1 · **Resolves:** F-08 · **Implements:** AD-04

**Narrative**
As a handheld operator on unreliable Wi-Fi, I want retrying a failed scan to be harmless, so that a
dropped connection never double-counts a pick.

**Requirement**
`writeScanEvent(payload)` performs a direct create/save with no pre-read. Catch the unique violation
and return `{status:'SUCCESS', idempotent:true, eventId:<existing>}`. Classify every other error as
retryable or terminal and return `retryable` in the response so the client's queue can decide. Set
server timestamp, preserve client timestamp, record device ID.

**Acceptance**
- [ ] GIVEN the same UUID posted twice, WHEN both are processed, THEN exactly one scan event row exists and both responses report SUCCESS.
- [ ] GIVEN the same UUID posted twice concurrently, WHEN both are processed, THEN exactly one row exists and neither request returns an error to the operator.
- [ ] GIVEN the writer runs, WHEN governance usage is measured, THEN no saved search is executed on the success path.
- [ ] GIVEN a transient platform error, THEN the response sets `retryable: true`; given a validation error, `retryable: false`.

---

### T-2.6 — `wms_lib_event_registry.js` — declarative event handlers
**Depends on:** T-2.5 · **Resolves:** F-12, F-13, F-15, F-16, F-17 · **Implements:** AD-15

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
- [ ] GIVEN a search of the RESTlet, mapper and reducer, THEN none contains a `switch` or `if` branching on event type. *(F-15)*
- [ ] GIVEN a handler whose `requiredFields` are not all present, WHEN an event is dispatched, THEN it is rejected before any record I/O with a field-level message. *(F-13)*
- [ ] GIVEN `governanceEst` exceeds remaining usage, WHEN the reducer dispatches, THEN it yields **before** attempting the work rather than failing partway. *(F-17)*
- [ ] GIVEN a new event type is registered with a handler and nothing else is edited, THEN it ingests, groups and commits end to end — demonstrated with a throwaway type in test.

---

### T-2.7 — `wms_lib_ledger_adapter.js` — the NetSuite boundary
**Depends on:** T-0.1, T-2.5, T-2.6 · **Resolves:** F-19 · **Implements:** AD-16 · *(rewritten per D-07)*

**Narrative**
As a developer, I want every NetSuite posting to go through one module that knows how each item is
tracked, so that no bin ever leaks into the ledger and mixed-mode orders post correctly.

**Requirement**
The complete ledger interface, and nothing else, per `06-netsuite-boundary.md` §4:

**Outbound:**
- **Item Fulfillment** — location, item, quantity, plus inventory detail shaped by the line item's
  tracking mode: none for PLAIN, lot number and quantity for LOT.
- **Inventory Adjustment** — count variances only, documented adjustment account.
- **Inventory Transfer** — genuine location-to-location moves only (Q-08).

**Inbound (D-09):**
- **Item Receipt** against a Purchase Order or Transfer Order.
- **Work Order Completion / Assembly Build** (Q-25) for production output.

**Neither:**
- **Bin movements post nothing.** `BIN_TRANSFER`, `REPLEN_MOVE` and `PUTAWAY` update WMS state and
  create no NetSuite transaction, because stock has not changed location.

Tracking mode is resolved per line from the item cache — **never** from an account-level flag.
**Mixed-mode orders are the normal case** and one `record.transform` must handle PLAIN and LOT lines
together. **A serialised item is rejected with an explicit out-of-scope exception** (D-08), never
posted on a guess.

**Transaction date comes from scan time, not commit time** (F-23, AD-17); where that period has
closed, post current and raise a `CLOSED_PERIOD_POSTING` exception.

**`binnumber` must not appear anywhere in the codebase**, including this module. Enforced by a CI
grep.

**Acceptance**
- [ ] GIVEN an order with both a PLAIN and a LOT line, WHEN it commits, THEN one Item Fulfillment is created with correct inventory detail for each line and no error.
- [ ] GIVEN a serialised item reaching the commit path, THEN it is rejected with an explicit out-of-scope exception, not a raw platform error.
- [ ] GIVEN a PO receipt event, WHEN it commits, THEN an Item Receipt posts against the correct PO with lot and expiry recorded.
- [ ] GIVEN an event whose scan-date period has closed, THEN it posts to the current period and raises a `CLOSED_PERIOD_POSTING` exception.
- [ ] GIVEN a bin transfer or replenishment event, WHEN it commits, THEN **no** NetSuite transaction is created, the WMS projection updates, and the event is marked POSTED rather than FAILED.
- [ ] GIVEN a CI grep for `binnumber`, `BIN_TRANSFER` record type or Bin Management feature checks, THEN there are **zero** matches in the codebase.
- [ ] GIVEN an item whose tracking mode changes in NetSuite, WHEN the item cache refreshes, THEN subsequent postings use the new mode with no deployment.

---

### T-2.5 — `wms_lib_config.js` and shared constants
**Depends on:** T-1.1 · **Resolves:** F-16

**Narrative**
As a warehouse manager, I want tuning values changeable without a code deployment, so that the
similarity threshold and cart capacity can be adjusted from operational experience.

**Requirement**
Read `customrecord_wms_config` through the cache with a short TTL, exposing typed getters with
documented defaults. **No magic numbers anywhere else in the codebase** — enforced by a lint rule
where practical and by code review otherwise. Single source of truth for the similarity threshold,
ending the 50%/60%/0.50 conflict.

**Acceptance**
- [ ] GIVEN the similarity threshold is changed on the config record, WHEN the next clustering run executes (after TTL), THEN it uses the new value with no deployment.
- [ ] GIVEN a code search for the literals `0.5`, `0.6`, `120`, `50000`, THEN none appear as behavioural constants outside the config module and its tests.
