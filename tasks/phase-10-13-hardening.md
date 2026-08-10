# Phases 10–13 · Remediation, Housekeeping, Performance, Cutover

---

# PHASE 10 — Bin Data Migration & Remediation

*Cannot be skipped. The bin master and opening bin state are migrated from the third-party
application (T-0.4 case b); if the migrated bins are non-compliant, the single-SKU/single-batch
invariant fails on day 1 and every downstream feature misbehaves.*

> **T-0.4 answered — case (b): migration.** Bin definitions and contents live in a third-party app and
> are migrated into `customrecord_wms_bin` + opening `customrecord_wms_bin_state`. This phase is a data
> **migration plus compliance remediation of what arrives** — not greenfield slotting. Its defining
> risk is **cutover staleness**: stock moves between export and go-live, so the export is stale on
> arrival. Resolve by freezing movement during cutover or an immediate delta reconciliation (T-10.1,
> and the cutover runbook T-13.3).

### T-10.1 — Bin migration, remediation plan and re-slotting tooling
**Depends on:** T-0.4, T-1.3 · *(rewritten 2026-08-09 — T-0.4 answered case (b); this is a migration)*

**Narrative**
As a warehouse manager, I want the third-party bin data migrated into NetSuite and any invariant
violations in it cleaned up, so that the floor starts go-live compliant without stopping shipping.

**Requirement**
**Migrate** the third-party export (T-0.4) into `customrecord_wms_bin` (definitions: code, location,
type, zone, pick sequence, capacity) and opening `customrecord_wms_bin_state` (contents: SKU, lot,
quantity per bin). Type the migrated bins with the Q-16 set (UNIT, BULK, STAGE, RECEIVING, QUALITY,
RETURN, DEFECT). Then **audit the migrated data** for single-SKU/single-batch compliance and produce a
**remediation plan** for what fails it: which bins split, which SKUs move where, new bins required,
sequencing by velocity (fastest movers first), labour estimate. Build a saved search and a supervisor
screen tracking progress. Provide directed move tasks on the handheld reusing the Phase 5 execution
flow. Bins under remediation are marked `custrecord_wb_blocked`.

**Cutover staleness (new, per T-0.4).** The export is stale the moment it is taken — stock keeps
moving in the third-party system until go-live. The migration needs a defined **cutover point**:
either **freeze bin movement** in the source system during cutover, or plan an **immediate delta
reconciliation** capturing everything that moved between export and go-live. Without one, opening bin
state is wrong on day 1. This is coordinated with, and evidenced in, the cutover runbook (T-13.3).

**Acceptance**
- [ ] GIVEN the third-party export, WHEN migration runs, THEN `customrecord_wms_bin` and opening `customrecord_wms_bin_state` are populated and every bin carries a Q-16 type and policy.
- [ ] GIVEN the migrated data, THEN a compliance audit + per-bin remediation plan with target bins and sequencing exists and is signed off by the warehouse manager.
- [ ] GIVEN remediation moves, THEN they execute through the standard directed-move flow with full event traceability.
- [ ] GIVEN a bin marked blocked, THEN no wave, replenishment or putaway allocates to it.
- [ ] GIVEN a defined cutover point, THEN either a movement freeze or a delta reconciliation is in place, and opening bin state matches the physical floor at go-live within an agreed tolerance.
- [ ] GIVEN remediation completes, WHEN the compliance search runs, THEN zero bins hold more than one SKU or lot.

---

### T-10.2 — Invariant enforcement on all inbound paths
**Depends on:** T-2.3, T-10.1

**Narrative**
As an inventory controller, I want the single-SKU rule enforced on *every* path into a bin, so that a
back-office user cannot undo the floor's compliance through the NetSuite UI.

**Requirement**
User Event `beforeSubmit` validation on Item Receipt, Inventory Transfer, Bin Transfer, Inventory
Adjustment, Work Order Completion and any CSV import path — anything that can place stock in a bin.
Blocks with `ERR_WMS_BIN_CONSTRAINT_VIOLATION`. Documented, role-gated, audited override for
genuine exceptions.

> **Rewritten per D-07 (F-20, `06-netsuite-boundary.md` §6).** NetSuite has no bin dimension, so
> there is nothing bin-shaped to validate against. The control changes from *validation* to
> *prevention*: `beforeSubmit` on Inventory Adjustment, Item Fulfillment, Item Receipt and Inventory
> Transfer **blocks** direct posting against a WMS-managed location unless the transaction is
> WMS-originated or the user holds an audited override role. Where an override is used, raise an
> `UNATTRIBUTED_MOVEMENT` exception — the bin can only be identified by someone physically looking.
>
> This is backed by **policy**: all inventory movement for WMS-managed locations goes through the
> WMS. Code enforces it; the operating procedure is what makes it stick.

**Acceptance**
- [ ] GIVEN a back-office user attempts a direct Inventory Adjustment against a WMS-managed location, THEN the save is blocked with a message directing them to the WMS.
- [ ] GIVEN a WMS-originated posting from the ledger adapter, THEN it passes the same User Event without obstruction.
- [ ] GIVEN a CSV import touching a WMS-managed location, THEN the offending rows are rejected and reported.
- [ ] GIVEN a user with the override role and a stated reason, THEN the save proceeds, an audited override record is created, and an `UNATTRIBUTED_MOVEMENT` exception is raised for bin identification.

---

# PHASE 11 — Housekeeping & Archiving

### T-11.1 — Scan event archiving and purge
**Depends on:** T-1.1, T-0.3 (Q-09)

**Narrative**
As a system administrator, I want POSTED events archived on a schedule, so that the event table stays
fast without destroying the audit trail.

**Requirement**
Implement the retention decided in Q-09 (FRD proposes 7 days). Archive **before** purge to the agreed
target — the FRD says "purges or archives", which is not a specification; the archive destination must
be decided and built first. Never purge PENDING, PROCESSING, FAILED, or any event linked to an open
exception. Report rows archived and purged per run.

**Acceptance**
- [ ] GIVEN POSTED events older than the retention period with no open exception, WHEN the job runs, THEN they are archived to the agreed target and then deleted.
- [ ] GIVEN a FAILED or exception-linked event of any age, THEN it is never purged.
- [ ] GIVEN an archived event, THEN it is retrievable by UUID for audit within the agreed timeframe.
- [ ] GIVEN each run, THEN counts archived, purged and skipped are logged and reported.

---

### T-11.2 — Pipeline health monitor
**Depends on:** T-4.6 · *(stale-lock reaper removed per D-12 — no locks)*

**Narrative**
As an operations owner, I want a stalled pipeline cleared and surfaced automatically, so that a
crashed committer does not silently strand events for the rest of the shift.

**Requirement**
Scheduled job every 60 s: **reset events stuck in `PROCESSING` beyond a threshold back to `PENDING`**
(a crashed committer leaves them claimed); alert when `PENDING` depth or oldest-`PENDING` age breaches
thresholds; alert when the M/R has not completed a run within its expected window. **No lock reaper** —
`customrecord_wms_concurrency_lock` was withdrawn (D-12); there are no orphaned locks to reap.

**Acceptance**
- [ ] GIVEN an event stuck in PROCESSING beyond threshold, THEN it returns to PENDING and is reprocessed exactly once (dedupe by UUID guarantees no double posting).
- [ ] GIVEN the backlog breaches threshold, THEN an alert reaches the named on-call owner.
- [ ] GIVEN the monitor runs, THEN it references no lock record (none exists).

---

### T-11.3 — Bin state backup, restore and change audit
**Depends on:** T-2.3, T-1.1 · **Resolves:** D-07 risk · **Implements:** AD-16 · *(new per D-07)*

**Narrative**
As an operations owner, I want bin state exported and restorable, so that losing it means restoring
a file rather than shutting the warehouse for a full physical stocktake.

**Requirement**
Under D-07, `customrecord_wms_bin_state` is the **only record anywhere** of what is in which bin.
NetSuite holds quantity per location and has no opinion about position. If this data is lost or
corrupted it cannot be reconstructed — only re-counted, physically, across the whole warehouse.

TK has accepted this risk, with the specific requirement that **accidental deletion be protected
against.** Six controls, the first three of which address deletion directly:

1. **No hard delete, ever.** Bin state records are never deleted — an emptied bin has its item, lot
   and quantity cleared and the row persists. The delete permission is removed from every role
   including administrators for this record type, so "accidental delete" has no code path.
2. **Mass-change circuit breaker.** Halt and alert when a single execution modifies more than a
   configured share of bins (recommend 5%). One defective Map/Reduce iterating the wrong search can
   zero the warehouse's entire location map in a single run — this is the control that stops it
   mid-flight rather than after.
3. **Soft-delete recovery window.** Any bin cleared to empty retains its prior contents in an audit
   row for a configured window (recommend 7 days), so a wrongly-emptied bin can be restored without
   going to backup.
4. **Daily export** of complete bin state to durable storage outside NetSuite, rolling retention
   (recommend 30 days), timestamped and integrity-checked.
5. **Point-in-time restore** procedure — **rehearsed, not merely documented**. An untested restore
   is not a control.
6. **Change audit** identifying which script or user caused any given change, and bounding its blast
   radius.

**Acceptance**
- [ ] GIVEN any role including administrator, WHEN deletion of a bin state record is attempted, THEN it is refused — there is no code path to a hard delete.
- [ ] GIVEN a script modifies more than the configured share of bins in one run, THEN it halts and alerts **before completing**, leaving the remainder untouched.
- [ ] GIVEN a bin wrongly cleared to empty, WHEN a supervisor restores it within the recovery window, THEN prior contents are recovered without going to backup.
- [ ] GIVEN a normal day, THEN a complete, integrity-checked bin state export exists outside NetSuite.
- [ ] GIVEN a simulated total loss of bin state in sandbox, WHEN the restore procedure is followed, THEN state is recovered to a known point and the elapsed time is recorded.
- [ ] GIVEN any bin state change, THEN its originating script or user is identifiable from the audit trail.
- [ ] GIVEN the restore procedure, THEN it has been rehearsed at least once before go-live and signed off.

---

### T-11.4 — Period-close drain procedure
**Depends on:** T-4.6, T-8.3 · **Resolves:** F-23 · **Implements:** AD-17 · *(new per D-10; narrowed by D-11)*

**Narrative**
As a finance controller, I want the event queue proven empty before a period closes, so that the
month's COGS is complete and I am not chasing warehouse transactions that posted after I closed the
books.

> **This is about postability, not valuation.** Costing is NetSuite's concern (D-11) and the WMS
> designs nothing around it. But a transaction dated into a **closed** period cannot post at all —
> that is a hard stop, and it turns a six-minute queue delay into a stuck event.

**Requirement**
A documented, monitored finance procedure — **not an informal habit**:

1. At period cutoff, stop accepting new scans for the closing period or hold the queue.
2. Drain the committer to zero PENDING and zero PROCESSING for that period.
3. Run reconciliation (T-8.3) and confirm zero open exceptions with financial impact, **and zero
   `DEFERRED` events** — a deferral spanning a period close becomes a closed-period problem.
4. Produce a **sign-off report** evidencing all three, retained with the period close pack.
5. Only then close the period in NetSuite.

Add a dashboard tile showing "unposted events for the current period" — including deferrals — so
finance can see the position at any time rather than asking. Where an event's scan-date period has already closed, it
posts to the current period and raises an exception (T-4.6) — this procedure is what keeps that
exceptional rather than routine.

**Acceptance**
- [ ] GIVEN period cutoff, WHEN the procedure is followed, THEN a sign-off report evidences zero PENDING, zero PROCESSING, zero DEFERRED and zero financially-material open exceptions for that period.
- [ ] GIVEN the dashboard, THEN unposted event count for the current period is visible to finance at any time without asking the warehouse.
- [ ] GIVEN a period is closed with events still queued, THEN the procedure has failed and the gap is detectable from the sign-off report.
- [ ] GIVEN the procedure, THEN it is agreed in writing with the finance controller before go-live.

---

# PHASE 12 — Performance Testing & Hardening

### T-12.1 — Load test harness
**Depends on:** T-3.1, T-4.6 · **Resolves:** F-07, F-09 · **Reference:** Doc A §6

**Narrative**
As the architect, I want the stated production load simulated against a real sandbox, so that the
throughput claims are proven before the warehouse depends on them.

**Requirement**
JMeter or Locust harness per Doc A §6: 50 virtual terminals posting concurrently, 5,000 SOs /
50,000 lines over a 10-hour shift (~1.4 lines/sec average, 15/sec peak), realistic event-type mix
including short picks and exceptions. Must run against a sandbox with **production-representative
data volume** — a load test against an empty account proves nothing about search performance at 400k
event rows. Instrument: response percentiles, error rates by code, 429 counts, event-to-ledger
latency, concurrency utilisation, M/R queue depth.

**Acceptance**
- [ ] GIVEN the harness, WHEN run against a production-representative sandbox, THEN it sustains the full 10-hour profile and reports all instrumented metrics.
- [ ] GIVEN the run, THEN 429 counts and concurrency utilisation are reported against the T-0.2 budget.
- [ ] GIVEN the harness, THEN it is repeatable in CI so regressions are caught before release.

---

### T-12.2 — Meet re-baselined performance targets
**Depends on:** T-12.1 · **Resolves:** F-07

**Narrative**
As the sponsor, I want the system to meet agreed, achievable performance targets, so that we are
holding delivery to a standard that is real rather than to a number that no NetSuite system can hit.

**Requirement**
Targets, revised from Doc A §6 per F-07 and agreed with the sponsor before test execution:

| Metric | FRD target | Agreed target | Why changed |
|---|---|---|---|
| Handheld UI acknowledgement | < 300 ms | **< 150 ms (client-side, optimistic)** | Achievable on-device; the operator experience the FRD wants |
| Server ingestion | < 150 ms / < 200 ms P99 | **P95 < 600 ms, P99 < 1200 ms** | NetSuite Suitelet round-trip floor (same as RESTlet) |
| Event → ledger latency | *(unstated)* | **P95 < 5 min** | Was never specified; must be |
| Scan processing failure rate | < 0.01% | **< 0.01%** | Retained |
| DB lock exceptions | Zero | **Zero** | Retained |
| Unresolved exceptions at shift end | *(unstated)* | **Zero** | The FRD's silence here is the F-04 gap |

**Acceptance**
- [ ] GIVEN the load test, THEN every agreed target above is met and evidenced with instrumented output.
- [ ] GIVEN a target is missed, THEN a remediation plan is produced and the test re-run before sign-off.
- [ ] GIVEN the revised targets, THEN they are formally accepted by the sponsor in writing before UAT.

---

### T-12.3 — Concurrency and failure-injection testing
**Depends on:** T-12.1 · **Resolves:** F-01, F-03 · *(lock/uniqueness cases removed per D-12)*

**Narrative**
As the architect, I want the race conditions the design is built to prevent deliberately provoked, so
that we know the guards work rather than assuming they do.

**Requirement**
Targeted adversarial tests: the same UUID posted concurrently from two threads *(the committer must
supersede all but one — this is the D-12 dedupe, replacing the old unique-constraint test)*; opposing
bin-to-bin transfers on the single settlement queue; network kill mid-POST followed by retry; M/R
killed mid-reduce; cache poisoned with stale bin data; a bin's contents changed between ingestion and
commit. **No lock-holder-killed test** — there are no locks (D-12).

**Acceptance**
- [ ] GIVEN the same UUID posted from two threads at once, THEN the platform's `externalid` uniqueness admits **exactly one row** (the loser gets a duplicate error); and even if a duplicate ever landed, the committer supersedes all but one so **exactly one posting** results.
- [ ] GIVEN opposing bin-to-bin transfers, THEN the single settlement queue serialises them with no interleaving and no deadlock.
- [ ] GIVEN the M/R is killed mid-reduce, WHEN it restarts, THEN no event posts twice and none is stranded in PROCESSING (the health monitor, T-11.2, resets stragglers).
- [ ] GIVEN deliberately stale cache data, THEN the commit-time authoritative check catches the conflict and no invalid inventory posts.

---

### T-12.4 — Full functional regression suite
**Depends on:** all functional phases · **Reference:** Doc B §5

**Narrative**
As the QA lead, I want an executable regression suite well beyond the FRD's five test cases, so that
each release is verified rather than spot-checked.

**Requirement**
Automate the FRD's TC-BIN-01, TC-BIN-02, TC-REP-01, TC-WAV-01, TC-PCK-01, TC-CUS-01, plus the
negative and edge cases the FRD omits: short pick, over pick, partial wave, cancelled order mid-wave,
replenishment deadlock (F-05), multi-lot summary pick (F-06), duplicate pack click, tote rejection,
duplicate-UUID dedupe to `SUPERSEDED` (D-12), governance yield, archive-then-audit-retrieval. Unit tests for all pure logic
(clustering, aggregation, similarity, allocation) with meaningful coverage.

**Coverage (AD-16).** Every commit-path scenario runs against **PLAIN and LOT items, and against a
mixed-mode order carrying both.** Add **inbound scenarios** (PO, TO and Work Order receipt, directed
putaway) and the **ordering case** from F-24 — receive and pick the same stock within one minute.

**Acceptance**
- [ ] GIVEN the suite, THEN all six FRD test cases pass automatically.
- [ ] GIVEN the suite, THEN at least the listed additional scenarios are covered and passing.
- [ ] GIVEN each of PLAIN and LOT, THEN the full commit path passes for that mode.
- [ ] GIVEN stock received and picked within one minute, THEN the receipt posts first and the fulfillment succeeds (F-24).
- [ ] GIVEN a serialised item, THEN it is rejected with an explicit out-of-scope exception.
- [ ] GIVEN a single order carrying one PLAIN and one LOT line, THEN it commits as one Item Fulfillment with correct detail per line.
- [ ] GIVEN any test run, THEN no NetSuite transaction is created for a bin movement and no `binnumber` is written.
- [ ] GIVEN a pull request, THEN unit tests run in CI and block merge on failure.

---

### T-12.5 — Browser-side (PWA) test strategy
**Depends on:** T-3.2, T-3.4, T-3.5 · **Resolves:** gap — nothing tests the client · *(new 2026-08-09)*

**Narrative**
As the QA lead, I want the PWA's offline and sync behaviour tested automatically, so that the failure
modes most likely to bite on the warehouse floor are caught before UAT rather than during it.

**Requirement**
T-12.4 covers SuiteScript regression; **nothing currently tests the browser client.** The PWA's
load-bearing behaviours are exactly the ones that are hard to get right and invisible in a
happy-path demo. Automate (headless browser / device lab) at least:

- **Offline operation, radio off** — a full pick run completes with the network disabled; no scan
  requires a server round-trip to validate (AD-09 / invariant #11).
- **Durable-queue survival** — events queued offline survive **app kill and battery pull** (IndexedDB
  + `navigator.storage.persist()`, D-13); on relaunch the queue is intact and drains.
- **Cache warm-up on location select** — switching location warms the new location's master-data
  cache and requires connectivity (D-14); operating offline *within* a location works.
- **Sync-on-reconnect** — a device back from N minutes offline drains via the **batch endpoint** in few
  round-trips, exactly once, no duplicates, honouring 429 backoff (T-3.2).
- **Reconnect conflict handling** — offline events invalid on arrival route to the exception queue,
  not silently dropped or posted (T-3.5).
- **Idempotency across retry** — the same UUID replayed after a crash yields one posting (`externalid`
  + committer dedupe, AD-04).

**Acceptance**
- [ ] GIVEN the radio off for a full pick run, THEN every task completes and no scan blocks on the server (automated).
- [ ] GIVEN the app is killed / battery pulled with a non-empty queue, WHEN it relaunches, THEN the queue is intact and drains exactly once with no duplicates.
- [ ] GIVEN a location switch with no connectivity, THEN the operator is warned/blocked per policy; with connectivity, the new cache warms.
- [ ] GIVEN offline events that conflict on reconnect, THEN they raise exceptions rather than posting.
- [ ] GIVEN the suite, THEN it runs in CI (headless) and blocks merge on failure.

---

# PHASE 13 — UAT, Training & Cutover

### T-13.1 — UAT with real warehouse staff
**Depends on:** T-12.4, T-10.1

**Narrative**
As a warehouse manager, I want my pickers and packers to run real waves on the new system before
cutover, so that we find the workflow problems that no test script would catch.

**Requirement**
Structured UAT in a production-refreshed sandbox with actual floor staff, actual stock, actual
handhelds, over a representative shift. Scripted scenarios plus deliberate free exploration. Log
every defect, usability complaint and workaround. Explicitly test the exception paths — most UAT
failures in WMS projects are exception-path failures.

**Acceptance**
- [ ] GIVEN a full simulated shift, THEN pickers and packers complete waves end to end without developer intervention.
- [ ] GIVEN UAT, THEN all defects are logged, triaged and either fixed or accepted with a documented workaround.
- [ ] GIVEN the warehouse manager, THEN they sign off UAT in writing before cutover is scheduled.

---

### T-13.2 — Training, runbooks and floor documentation
**Depends on:** T-13.1

**Narrative**
As a new picker, I want clear training material, so that I can be productive on the handheld on day
one without shadowing someone for a week.

**Requirement**
Role-based quick-reference cards (picker, packer, replenishment, supervisor). Supervisor runbook for
the exception queue with a worked example of every resolution action. IT runbook: device
provisioning, credential rotation, backlog alerts, pause/drain, stuck-PROCESSING recovery. Train-the-trainer
session. Laminated floor cards at each station.

**Acceptance**
- [ ] GIVEN an untrained operator with only the quick-reference card, THEN they complete a directed pick unaided.
- [ ] GIVEN each exception resolution action, THEN the supervisor runbook contains a worked example.
- [ ] GIVEN training completion, THEN attendance and competency are recorded per operator.

---

### T-13.3 — Cutover plan and hypercare
**Depends on:** T-13.1, T-13.2, T-10.1

**Narrative**
As the sponsor, I want a rehearsed cutover with a real rollback option, so that a bad go-live does
not stop shipping.

**Requirement**
Cutover runbook with a timed sequence, a named owner per step, and go/no-go criteria. Bin compliance
achieved and frozen before cutover. Inventory snapshot immediately before. Rollback procedure
defined **and rehearsed** — not merely documented. Phased option assessed (one zone or one order type
first). Two-week hypercare with daily reconciliation review, on-site support and a defined escalation
path.

**Bin-data migration cutover (new, per T-0.4 case b / T-10.1).** The bin master and opening bin state
come from a third-party export that is stale the moment it is taken. The runbook must pin a **cutover
point** for bin data: either **freeze bin movement** in the source system for the cutover window, or
run an **immediate delta reconciliation** capturing every move between export and go-live. Confirm
opening `customrecord_wms_bin_state` matches the physical floor (or the pre-cutover snapshot) within
an agreed tolerance **before** go/no-go. A stale bin migration is a silent way to start day 1 already
diverged.

**Acceptance**
- [ ] GIVEN the runbook, WHEN rehearsed in sandbox, THEN it completes within the planned window and the rollback is proven to work.
- [ ] GIVEN the bin-data migration, THEN the cutover point is defined (freeze or delta reconciliation) and opening bin state is confirmed against physical within tolerance before go/no-go.
- [ ] GIVEN go-live, THEN the pre-cutover inventory snapshot is captured and retained.
- [ ] GIVEN hypercare, THEN reconciliation is reviewed daily and exceptions are cleared to zero each day before close.
- [ ] GIVEN hypercare exit criteria are met, THEN the system transitions to business-as-usual support with a signed handover.
