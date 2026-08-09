# Phases 10–13 · Remediation, Housekeeping, Performance, Cutover

---

# PHASE 10 — Bin Data Remediation

*Cannot be skipped. If today's bins are non-compliant, the invariant fails on day 1 and every
downstream feature misbehaves.*

### T-10.1 — Remediation plan and re-slotting tooling
**Depends on:** T-0.4, T-1.3

> ⚠️ **Scope pending T-0.4 outcome (flagged 2026-08-09, not yet rewritten).** This task as written
> assumes existing non-compliant bins to split ("which bins split, which SKUs move where"). That holds
> only in T-0.4 **case (b)** — bin data already exists in another system. Under **case (a) NOWHERE**
> or **case (c) PHYSICAL ONLY**, there is nothing to remediate: this task becomes *design the bin
> scheme, create the bin master (`customrecord_wms_bin`), label the racks physically, and perform
> first putaway* — initial slotting, not remediation, with a different critical-path position. **Do
> not build to the text below until T-0.4 selects the case.** Left unrewritten deliberately.

**Narrative**
As a warehouse manager, I want a worked plan for splitting mixed bins into compliant ones, so that
the floor can be made ready without stopping shipping.

**Requirement**
From the T-0.4 audit, produce a remediation plan: which bins split, which SKUs move where, new bins
required, sequencing by velocity (fastest movers first), and labour estimate. Build a saved search
and a supervisor screen tracking progress. Provide directed move tasks on the handheld reusing the
Phase 5 execution flow. Bins under remediation are marked `custrecord_wms_bin_blocked`.

**Acceptance**
- [ ] GIVEN the audit, THEN a per-bin remediation plan with target bins and sequencing exists and is signed off by the warehouse manager.
- [ ] GIVEN remediation moves, THEN they execute through the standard directed-move flow with full event traceability.
- [ ] GIVEN a bin marked blocked, THEN no wave, replenishment or putaway allocates to it.
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

### T-11.2 — Stale lock reaper and pipeline health monitor
**Depends on:** T-2.2, T-4.6

**Narrative**
As an operations owner, I want orphaned locks and stalled pipelines cleared and surfaced
automatically, so that a crashed script does not silently freeze a bin for the rest of the shift.

**Requirement**
Scheduled job every 60 s: delete locks past `custrecord_lock_expires_at`, raise a STALE_LOCK
exception for each; reset events stuck in PROCESSING beyond threshold back to PENDING; alert when
PENDING depth or oldest-PENDING age breaches thresholds; alert when the M/R has not completed a run
within its expected window.

**Acceptance**
- [ ] GIVEN a lock past its TTL, WHEN the reaper runs, THEN it is deleted and a STALE_LOCK exception is created.
- [ ] GIVEN an event stuck in PROCESSING beyond threshold, THEN it returns to PENDING and is reprocessed exactly once.
- [ ] GIVEN the backlog breaches threshold, THEN an alert reaches the named on-call owner.

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
| Server ingestion | < 150 ms / < 200 ms P99 | **P95 < 600 ms, P99 < 1200 ms** | NetSuite RESTlet round-trip floor |
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
**Depends on:** T-12.1 · **Resolves:** F-01, F-02, F-03

**Narrative**
As the architect, I want the race conditions the design is built to prevent deliberately provoked, so
that we know the guards work rather than assuming they do.

**Requirement**
Targeted adversarial tests: two devices putting away different SKUs into the same empty bin
simultaneously; the same UUID posted concurrently from two threads; opposing bin-to-bin transfers;
network kill mid-POST followed by retry; M/R killed mid-reduce; cache poisoned with stale bin data;
lock holder killed without release; a bin's contents changed between ingestion and commit.

**Acceptance**
- [ ] GIVEN two simultaneous putaways of different SKUs to the same empty bin, THEN exactly one succeeds and the other produces a clean, actionable rejection.
- [ ] GIVEN the same UUID posted from two threads at once, THEN exactly one event row exists.
- [ ] GIVEN the M/R is killed mid-reduce, WHEN it restarts, THEN no event posts twice and none is stranded in PROCESSING.
- [ ] GIVEN deliberately stale cache data, THEN the commit-time authoritative check catches the conflict and no invalid inventory posts.
- [ ] GIVEN a lock holder killed without release, THEN the reaper frees it within TTL and work resumes.

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
lock timeout, governance yield, archive-then-audit-retrieval. Unit tests for all pure logic
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
provisioning, credential rotation, backlog alerts, pause/drain, stale locks. Train-the-trainer
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

**Acceptance**
- [ ] GIVEN the runbook, WHEN rehearsed in sandbox, THEN it completes within the planned window and the rollback is proven to work.
- [ ] GIVEN go-live, THEN the pre-cutover inventory snapshot is captured and retained.
- [ ] GIVEN hypercare, THEN reconciliation is reviewed daily and exceptions are cleared to zero each day before close.
- [ ] GIVEN hypercare exit criteria are met, THEN the system transitions to business-as-usual support with a signed handover.
