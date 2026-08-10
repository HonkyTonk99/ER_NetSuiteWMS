# Phases 3–5 · Ingestion, Ledger Commit, Replenishment

---

# PHASE 3 — Ingestion Layer & Handheld Client

*Blocked until Q-01 (handheld platform) and Q-02 (authentication) are decided.*

### T-3.1 — `wms_sl_scan_ingest.js` — ingestion Suitelet (JSON API)
**Depends on:** T-2.1, T-2.3, T-2.4, T-3.3 · **Resolves:** F-07, F-08 · **Implements:** AD-01, D-19 · *(RESTlet → Suitelet — same origin as the PWA, closes T-0.7)*

**Narrative**
As the handheld PWA, I want to POST a scan to a **same-origin** endpoint and get an immediate
acknowledgement, so that the operator is never left waiting and the browser makes no cross-origin call.

**Requirement**
A **Suitelet** (not a RESTlet — RESTlets are a different host and would force CORS; the PWA is served by
a Suitelet, D-13, so its API is a sibling Suitelet, same origin). POST accepting the scan payload (uuid,
eventType, operatorId, waveId, orderId, orderLineKey, skuCode, batchNumber, sourceBinId, targetBinId,
qty, locationId, deviceId, clientTs) plus the **HMAC session token** (T-3.3). Flow: validate token
(T-3.3) → schema validation → resolve item/bin metadata from cache → read bin state projection (T-2.3)
→ apply bin policy (T-2.3b) → `writeScanEvent` (sets `externalid` = UUID) → update projection → return.
**No saved search on the success path. No `record.transform`. No inventory posting. No lock.**
**Idempotency (AD-04):** a duplicate UUID fails at the platform on `externalid` and returns
`idempotent:true` — plus the committer dedupe safety net. Structured JSON responses for success,
idempotent-duplicate, auth failure, validation failure and platform error, each with a machine-readable
code. Structured logging of execution time. Support an optional **batch payload** (array of events) so
the client can drain its queue in fewer round-trips — a direct mitigation for F-09.

**Acceptance**
- [ ] GIVEN a valid scan payload with a valid session token, WHEN posted, THEN a PENDING scan event is created and a success response returns; measured server time P95 < 600 ms and P99 < 1200 ms under the Phase 12 load profile.
- [ ] GIVEN the PWA and the API are both Suitelets, WHEN the browser POSTs, THEN the call is **same-origin** (no CORS preflight).
- [ ] GIVEN a payload violating bin isolation, WHEN posted, THEN no event is created and the response carries `ERR_WMS_BIN_CONSTRAINT_VIOLATION` with the conflicting item and lot in the message.
- [ ] GIVEN a duplicate UUID, WHEN posted, THEN the create fails at the platform on `externalid` and the response is `SUCCESS` with `idempotent:true` — exactly one row exists.
- [ ] GIVEN a batch of 20 events, WHEN posted in one request, THEN each is processed independently and the response contains a per-event result array.
- [ ] GIVEN a request with a missing or invalid session token, WHEN posted, THEN it is rejected (see T-3.3) and no event is created.
- [ ] GIVEN any request, WHEN governance is measured, THEN the success path executes zero saved searches.

---

### T-3.2 — Offline master-data cache and durable outbound queue
**Depends on:** T-3.1, T-0.2 · **Resolves:** F-09 · **Implements:** AD-08, AD-09 · *(expanded per D-04)*

**Narrative**
As a picker, I want the scanner to work exactly the same with the radio off, so that I keep picking
through a dead spot instead of standing still waiting for a bar of signal.

**Requirement**
Per D-04, connection loss is the **expected** state, not the exception.

*Local cache:* on sync, the device pulls the resolved data needed to validate every scan the
operator could plausibly make this shift — assigned tasks, and the item, bin, lot and bin-policy
subsets they reference. Resolved and pushed by the server, not fetched on demand. A scan that cannot
be validated locally is a design failure, not a runtime condition. Cache carries a staleness limit
and a sync token.

*Outbound queue:* durable, FIFO, survives app kill and battery pull. UUID stamped at creation, never
regenerated on retry. Exponential backoff with jitter. HTTP 429 / `SSS_REQUEST_LIMIT_EXCEEDED`
treated as a normal throttle signal — back off, continue, never drop.

*Batch drain:* reconnection sends through the batch endpoint in few round-trips. A device back from
40 minutes offline must **not** emit 200 individual requests into the concurrency budget.

Persistent on-screen unsynced count and oldest-unsynced age. Hard-block only on configured depth or
staleness limits, with a supervisor-visible reason.

**Acceptance**
- [ ] GIVEN the device is in airplane mode for a full 45-minute pick run, THEN the operator completes every task with no functional difference from online operation.
- [ ] GIVEN 200 events queued offline, WHEN connectivity returns, THEN they sync via batched requests in under 10 round-trips with no duplicates and no loss.
- [ ] GIVEN the app is force-killed with a non-empty queue, WHEN it restarts, THEN the queue is intact and drains.
- [ ] GIVEN the server returns 429 for 30 s, WHEN the client drains, THEN it backs off with jitter and all events post exactly once.
- [ ] GIVEN the local cache exceeds its staleness limit, THEN the operator is warned and, past the hard limit, blocked with a supervisor-visible reason.
- [ ] GIVEN queue depth exceeds the configured limit, THEN the operator is blocked with a clear message visible to a supervisor.

---

### T-3.5 — Reconnect conflict reconciliation
**Depends on:** T-3.2, T-8.1 · **Implements:** AD-09 · *(new scope per D-04)*

**Narrative**
As a warehouse supervisor, I want to know when a device that was offline comes back with work that
no longer makes sense, so that we catch it deliberately rather than discovering it at stocktake.

**Requirement**
Events queued offline can be invalid by the time they arrive: the stock was picked by someone else,
the order was cancelled, the wave was reassigned, the bin was re-slotted. On batch ingestion each
event is evaluated against **current** state. Three outcomes, and only three:

1. **Valid** — accept normally.
2. **Stale but harmless** (e.g. a duplicate of work already recorded) — accept idempotently, record
   the fact.
3. **Conflicting** — accept the event into the log for audit but do **not** post it; raise an
   exception (T-8.1) carrying operator, device, offline duration, the conflict, and the current
   state that contradicts it.

Nothing is silently dropped and nothing conflicting is silently posted. Conflicts are attributed to
the offline window so a chronically disconnected device or dead zone becomes visible in the data.

**Acceptance**
- [ ] GIVEN a device offline for 40 minutes returns with a pick event for stock another operator has since picked, THEN the event is logged, not posted, and a conflict exception is raised naming both operators.
- [ ] GIVEN an offline event for an order cancelled in the interim, THEN an exception is raised with the cancellation as the stated cause.
- [ ] GIVEN offline events that are still perfectly valid, THEN they post normally with no exception noise.
- [ ] GIVEN a resolved conflict, THEN the supervisor's decision is recorded against both the event and the exception.
- [ ] GIVEN a month of operation, THEN conflicts are reportable by device and by warehouse zone so dead spots are identifiable.

---

### T-3.3 — Operator authentication and endpoint hardening
**Depends on:** T-1.4 · **Resolves:** scope gap D, Q-02 (subsumed) · **Implements:** D-19 · *(rewritten — Option C, no per-operator NetSuite login)*

**Narrative**
As a security owner, I want operators authenticated without a NetSuite user each, and the public
endpoint hardened, so that we avoid 50 user licences (Q-30) without leaving an open write endpoint.

**Requirement**
Auth model is **Option C (D-19)**: the SPA is served from an **Available Without Login** Suitelet and
its API is a sibling Suitelet — **no NetSuite user per operator**, **no TBA in the browser**. Operator
identity is carried in the payload onto `custrecord_se_operator`. Because the endpoint is
internet-reachable and unauthenticated at the platform level, harden it in application code — **six
controls**:

1. **Operator login** — operator ID + **PIN or badge scan** validated against a **WMS operator custom
   record** (`customrecord_wms_operator`) holding a **hashed PIN** (never plaintext) and an active flag.
2. **Signed session token** — issued on login, **HMAC'd with a script-parameter secret**, carrying
   operator + expiry. Every API call validates **signature, expiry and operator-active**.
3. **IP allowlisting** where feasible (warehouse egress ranges).
4. **Rate limiting** per token and per IP.
5. **Execute-as-role** scoped to **create scan events and read reference data only** — never
   transaction edit (ties to T-1.4).
6. **Audit** — failed authentications and token-validation failures logged.

Documented operator provisioning / PIN-reset / deactivation runbook. See **F-27** (internet-exposed
write endpoint — accepted, mitigated by these controls, must be in the pre-go-live security review).

**Acceptance**
- [ ] GIVEN a POST with **no or an invalid session token**, THEN it is rejected and **no event is created** *(the required negative test)*.
- [ ] GIVEN an expired or tampered (bad-HMAC) token, THEN it is rejected with a distinct code.
- [ ] GIVEN an operator ID for a deactivated `customrecord_wms_operator`, WHEN a scan is posted, THEN it is rejected.
- [ ] GIVEN the operator record, THEN the PIN is stored **hashed** — no plaintext PIN exists anywhere.
- [ ] GIVEN repeated calls above the configured rate, THEN they are throttled per token and per IP.
- [ ] GIVEN the execute-as-role, WHEN it attempts to edit a transaction directly, THEN access is denied (T-1.4).

---

### T-3.4 — Handheld application (task list, scan flows, optimistic UI)
**Depends on:** T-3.1, T-3.2, T-3.3 · **Implements:** AD-09, D-13 *(Q-01 closed — PWA)*

**Narrative**
As a picker, I want a scanner app that shows me my next task and confirms each scan instantly, so
that I can work at scan-every-2-seconds pace without waiting on the system.

**Requirement**
Screens: login/shift start, task list, directed pick (bin → SKU → lot → qty), replenishment move,
bin transfer, putaway, short pick, stage/handoff.
 Local validation against a cached task list so
success renders in < 150 ms. Barcode symbologies and scan-to-field mapping defined per screen.
Explicit sad paths: wrong bin scanned, wrong SKU, wrong lot, insufficient quantity, unknown barcode.
Large-touch-target, glove-friendly layout.

**SPA performance budget (stated ceilings, agreed with the sponsor).** The PWA is served from NetSuite
and first-loaded over warehouse Wi-Fi on the **target rugged Android device** — the login-and-warm-up
experience is governed by this budget and nothing else in the plan constrains it. Measure on the
target device, not a developer laptop:
- **JS/CSS bundle ≤ 500 KB gzipped** (app shell); assets lazy-loaded beyond that.
- **Cold first load (empty cache) to interactive ≤ 3 s** over representative warehouse Wi-Fi.
- **Login → cache warmed → first task actionable ≤ 10 s** (includes the D-14 location cache warm).
- **Warm load (service-worker cached shell) ≤ 1 s.**
These are the agreed ceilings; regressions past them fail the build (measured in T-12.5).

**Acceptance**
- [ ] GIVEN a directed pick task, WHEN the operator scans the correct bin, SKU, lot and quantity, THEN the UI confirms and advances in < 150 ms measured on the target device.
- [ ] GIVEN the operator scans a bin other than the directed bin, THEN the app blocks with a clear message and does not enqueue an event.
- [ ] GIVEN the operator cannot find the stock, WHEN they select short pick, THEN a SHORT_PICK event is enqueued with quantity found and reason.
- [ ] GIVEN the target device over warehouse Wi-Fi, THEN bundle size, cold first-load, warm-load and login-to-first-task are measured and all within the stated budget.
- [ ] GIVEN 30 minutes of continuous use, THEN no memory growth or degradation is observed on the target device.

---

# PHASE 4 — Asynchronous Ledger Commit

### T-4.1 — `wms_mr_ledger_commit.js` — Map/Reduce skeleton, dedupe and grouping
**Depends on:** T-2.3, T-2.4 · **Resolves:** F-12, F-15, F-08 · **Implements:** AD-06, AD-04 · *(updated per D-12)*

**Narrative**
As the system, I want all events for one sales order processed by exactly one reduce invocation, so
that a single `record.transform` per order eliminates the record-changed exceptions the architecture
exists to prevent — with no locks (D-12), because grouping and a single settlement queue remove the
races structurally.

**Requirement**
`getInputData` searches PENDING events (indexed, paged). `map` emits a **JSON** group key —
`{k:'ORDER', orderId}` for PICK/PACK, `{k:'MOVE', locationId, sourceBinId}` for REPLEN_MOVE /
BIN_TRANSFER / PUTAWAY — never an underscore-delimited string. Events are flipped to `PROCESSING` on
claim so a concurrent run cannot pick them up. **Dedupe by UUID within the group (AD-04, D-12): keep
the earliest, mark the rest `SUPERSEDED`, post from the survivor** — this is the **safety-net** layer;
the primary idempotency guard is the platform-unique `externalid` set at ingest (T-2.4), so duplicates
should be rare here but are handled if they occur. **Bin-affecting work
(`{k:'MOVE',...}` and any bin-state settlement) runs on a single dedicated M/R queue** so two threads
never touch the same bin (AD-05 withdrawn; single-threaded bin-state settlement). `summarize` logs
counts by outcome and feeds T-9.2. **No locks are taken anywhere.**

**Acceptance**
- [ ] GIVEN PICK and PACK events for the same order, WHEN the M/R runs, THEN both land in one reduce invocation and exactly one Item Fulfillment is created.
- [ ] GIVEN duplicate rows with the same `custrecord_se_event_id`, WHEN the group is processed, THEN exactly one is posted and the rest are marked `SUPERSEDED` (no duplicate ledger posting).
- [ ] GIVEN REPLEN_MOVE and BIN_TRANSFER events, WHEN keys are parsed, THEN event type and identifiers are recovered correctly despite the underscores in the enum values.
- [ ] GIVEN two overlapping M/R executions, THEN no event is processed twice (verified by POSTED count equalling distinct UUID count), and no lock record exists or is referenced.
- [ ] GIVEN a run completes, THEN `summarize` records processed, posted, failed, superseded and skipped counts.

---

### T-4.2 — Fulfillment commit with correct line aggregation
**Depends on:** T-4.1, T-2.7 · **Resolves:** F-14, F-19 · **Implements:** AD-07, AD-16

> **Mode-aware.** Aggregation logic below is independent of item tracking mode. **Writing**
> inventory detail is delegated entirely to the ledger adapter (T-2.7) — this task contains no lot
> field writes of its own, and no `binnumber` anywhere.

**Narrative**
As a finance controller, I want the Item Fulfillment to reflect exactly what was picked — including
partial and unpicked lines — so that we never ship on paper what was not shipped in fact.

**Requirement**
Aggregate all events for the order into `Map<orderLineKey, {qty, lots:[{lot, bin, qty}]}>` **before**
touching the record. Transform SO → IF, then walk the item sublist once: line with an aggregate gets
`itemreceive = true`, quantity = aggregate total, and **inventory detail delegated to the adapter**
(none for PLAIN items, lot number + quantity for LOT items); line
without an aggregate gets `itemreceive = false` explicitly. Set `shipstatus = 'A'` (Picked). Reject
and raise an OVER_PICK exception when an aggregate exceeds the ordered quantity. Handle the same item
appearing on multiple SO lines by keying on line unique key, never on item ID.

**Acceptance**
- [ ] GIVEN an SO with the same item on two separate lines, WHEN both are picked, THEN both lines are fulfilled with their own quantities.
- [ ] GIVEN three scan events against one line, WHEN committed, THEN the fulfilled quantity is their sum, not the last event's quantity.
- [ ] GIVEN an SO line with no scan events, WHEN committed, THEN that line has `itemreceive = false` and zero quantity.
- [ ] GIVEN a picked quantity greater than ordered, THEN no fulfillment is saved and an OVER_PICK exception is raised.
- [ ] GIVEN a line picked from two lots, THEN the inventory detail subrecord carries both lot assignments with correct bins and quantities.

---

### T-4.3 — Bin transfer and inventory adjustment commit
**Depends on:** T-4.1 · **Resolves:** F-13 · *(locks removed per D-12)*

**Narrative**
As an inventory controller, I want bin-to-bin moves posted correctly and grouped safely, so that
transfers do not fail on location mismatch or silently combine stock from different sites.

**Requirement**
Set `location` from `custrecord_se_location` — **never** from a bin internal ID. Group by
`(locationId, sourceBinId)` so every transfer is constructible. This work runs on the **single
bin-affecting settlement queue (T-4.1), so no locks are needed** (AD-05 withdrawn, D-12) — one thread
means no interleaving. Re-check the target bin's policy against the projection, then reconcile the
projection after posting. **Bin-to-bin moves post nothing to NetSuite, ever** —
NetSuite has no concept of a bin (D-07) and the stock has not changed location, so there is no
financial event. The commit updates WMS bin state only. `inventoryadjustment` is used solely for
count variances, through the adapter, with a documented adjustment account.

**Non-fulfillable bins reached via this flow (Q-16, release 1).** Stock reaches RETURN, QUALITY and
DEFECT bins through the **generic bin-transfer flow** — an operator moves stock out of UNIT/BULK and
it becomes non-fulfillable. That is already in scope here; nothing extra to build. *(Structured RMA
receipt — receiving a customer return against an RMA document with disposition rules — is deferred to
release 2, Q-05.)* Like any bin move it posts nothing to NetSuite; the only effect is that the stock
now sits in a bin with `availableForFulfilment: false`.

**Acceptance**
- [ ] GIVEN move events across two locations, WHEN the M/R runs, THEN separate Bin Transfers are created per location and each saves successfully.
- [ ] GIVEN a bin transfer, WHEN inspected, THEN the `location` field holds a Location internal ID.
- [ ] GIVEN any move event, WHEN it commits, THEN the WMS projection updates, **no NetSuite transaction is created**, and the event is marked POSTED rather than FAILED.
- [ ] GIVEN a bin transfer targeting a non-fulfillable bin type (RETURN/QUALITY/DEFECT), THEN the transfer **succeeds** and the moved stock is thereafter **excluded from allocation (T-7.1) and replenishment sourcing (T-5.2)**.
- [ ] GIVEN a target bin whose contents changed after ingestion, WHEN commit re-asserts the invariant, THEN the transfer is rejected and an INVARIANT_VIOLATION exception is raised naming the conflict.
- [ ] GIVEN opposing transfers between the same two bins, WHEN they run on the single settlement queue, THEN they process one after another with no interleaving and no lock — deadlock is structurally impossible.

---

### T-4.4 — Commit-time projection reconciliation
**Depends on:** T-2.3, T-2.3b, T-4.2, T-4.3 · **Resolves:** F-01, F-03 · **Implements:** AD-03 · *(revised per D-01)*

**Narrative**
As the system, I want the bin state projection reconciled against the ledger at the moment of
posting, so that the operational and financial views of a bin converge as soon as the queue drains.

**Requirement**
After each successful ledger post, clear the corresponding `custrecord_bs_pending_delta` and stamp
`custrecord_bs_last_reconciled` on the affected bins. This runs on the **single bin-affecting
settlement queue (T-4.1), so no lock is needed** (AD-05 withdrawn, D-12). Re-check
the target bin's policy before posting — cheap, since the projection is already loaded — and treat a
conflict as an exception (T-8.1) carrying the event, the operator and the current bin state, never
as a silent FAILED status. Emit the commit-stage rejection count as a KPI: it should be near zero,
and a rising rate means ingestion and commit are seeing different worlds.

**Acceptance**
- [ ] GIVEN an event accepted at ingestion that conflicts at commit time, WHEN committed, THEN nothing posts, the event is FAILED, and an INVARIANT_VIOLATION exception exists naming the current bin state.
- [ ] GIVEN a successful post, THEN `pending_delta` is cleared and `last_reconciled` is stamped for every affected bin.
- [ ] GIVEN the reconciliation, THEN it executes on the single bin-affecting settlement queue (no lock; assertion in DEV builds that no lock record is referenced).
- [ ] GIVEN a run, THEN the commit-stage rejection count is written to the metric snapshot.
- [ ] GIVEN a fully drained queue, THEN the summed WMS bin quantity equals NetSuite quantity on hand for every item and location — additionally per lot for LOT items (reconciliation is item/location grain; NetSuite has no bin dimension).

---

### T-4.5 — Governance management and yielding
**Depends on:** T-4.2, T-4.3 · **Resolves:** F-17

**Narrative**
As a developer, I want the reduce stage to yield before exhausting its governance, so that a large
order never leaves a batch half-posted.

**Requirement**
Check `runtime.getCurrentScript().getRemainingUsage()` before each transform/save. When remaining
falls below a configured floor, stop cleanly and leave unprocessed events PENDING for the next
invocation. **Never** leave an event in PROCESSING after a yield. Configurable batch size. Governance
consumption per order size measured and documented.

**Acceptance**
- [ ] GIVEN a reduce key containing more work than one invocation's governance allows, WHEN it runs, THEN it yields cleanly and the remainder is processed on the next run with no duplicates.
- [ ] GIVEN a yield occurs, THEN no event remains in PROCESSING status.
- [ ] GIVEN an order with 200 lines and inventory detail, WHEN committed, THEN governance consumption is measured and stays under the reduce limit or triggers a documented yield.

---

### T-4.6 — Deployment, scheduling and queue allocation
**Depends on:** T-4.1, T-0.2 · **Implements:** AD-08

**Narrative**
As an operations owner, I want the committer to run continuously across the allocated queues, so
that events post within the target latency without starving scan traffic.

**Requirement**
Deploy across the SuiteCloud Plus queues allocated in T-0.2. Configure restart cadence so the
pipeline is effectively continuous. Alert when PENDING backlog depth or oldest-PENDING age exceeds a
threshold. Documented pause/drain procedure for maintenance windows.

**Transaction dating (F-23, AD-17).** Post every transaction dated by **scan time**, not commit
time, wherever that accounting period is still open. Where the scan-time period has closed, post to
the current period **and raise a `CLOSED_PERIOD_POSTING` exception** so finance sees it rather than
finding it in a variance report. A pick scanned at 23:58 on the last day of the month must not land
in the next month's COGS because the queue took six minutes.

**The WMS does not reason about cost (D-11).** We supply quantity, date and lot; NetSuite computes
cost however the account is configured. No event ordering is performed for costing purposes — the
only ordering rule is inbound-before-outbound (T-5.8), and that exists to keep NetSuite non-negative,
not to influence valuation.

**Acceptance**
- [ ] GIVEN steady-state load, WHEN measured over a shift, THEN event-to-ledger latency P95 < 5 minutes.
- [ ] GIVEN the backlog exceeds threshold, THEN an alert fires to the named operations owner.
- [ ] GIVEN the drain procedure is followed, THEN the pipeline stops with zero events stuck in PROCESSING.
- [ ] GIVEN an event scanned at 23:58 and committed at 00:04, THEN the posted transaction is dated to the scan date and falls in the correct accounting period.
- [ ] GIVEN an event whose scan-date period has closed, THEN it posts to the current period and an exception is raised naming both dates.

---

# PHASE 5 — Bulk-to-Unit Replenishment

*Unblocked 2026-08-07 — Q-03 closed by D-03. Note the new prerequisite in T-5.2: FEFO requires
expiry dates on inventory numbers (Q-15).*

### T-5.1 — `wms_mr_replen_monitor.js` — trigger detection
**Depends on:** T-1.3, T-2.1

**Narrative**
As a picker, I want pick faces refilled before they run dry, so that I am not sent to an empty bin
mid-wave.

**Requirement**
Scan active replenishment profiles; compare available qty in each UNIT bin against
`custrecord_replen_trigger_qty`. Where below, create a `customrecord_wms_replen_task` for
`optimum_qty − current_qty`. **Suppress duplicates** — do not raise a second task for a bin with an
OPEN or IN_PROGRESS task. Priority rises as the deficit approaches zero and when the SKU appears in
a wave that is currently releasable.

**Acceptance**
- [ ] GIVEN a UNIT bin below its trigger, WHEN the monitor runs, THEN exactly one OPEN replenishment task is created for the correct top-up quantity. *(FRD TC-REP-01)*
- [ ] GIVEN an OPEN task already exists for that bin, WHEN the monitor runs again, THEN no duplicate is created.
- [ ] GIVEN a bin at zero with the SKU on a releasable wave, THEN the task priority exceeds that of a bin merely below trigger.
- [ ] GIVEN 5,000 active profiles, WHEN the monitor runs, THEN it completes within its window without governance failure.

---

### T-5.2 — Lot-matching, FEFO sourcing and fall-through to direct pick
**Depends on:** T-5.1 · **Resolves:** F-05 · **Implements:** D-03 · *(rewritten — Q-03 now closed)*

**Narrative**
As an inventory controller, I want replenishment to rotate stock correctly and to get out of the way
when there is no bulk to draw from, so that picking continues from whatever batches exist rather
than stalling on an empty pick face.

**Requirement**
Per D-03, source selection is:

1. BULK bin with the **same lot** as the UNIT bin.
2. If the UNIT bin is empty, BULK bin with the **earliest expiry** (FEFO), from
   `inventorynumber.expirationdate`. **For PLAIN items there are no lots at all**, so FEFO
   degrades to **FIFO by WMS putaway timestamp** held on the projection — functional, but rotating
   by arrival rather than by expiry. The business must know which is running for which items.
3. **If no BULK stock exists for that SKU: do not raise a task, do not block, do not escalate.**
   Picking falls through to direct allocation from any bin holding that SKU (policy
   `allowDirectPick`), batch by batch in FEFO order. When those are exhausted the SKU is out of
   stock — a normal inventory state, not an exception.

Exclude blocked bins. Never select a source that would violate the target bin's policy on arrival.
**Never source from a non-fulfillable bin** (`availableForFulfilment: false` — QUALITY, RETURN,
DEFECT, STAGE, RECEIVING): that stock is physically present but not pickable until it is physically
moved into a UNIT/BULK bin (Q-16). `allowDirectPick` already excludes these from the step-3
fall-through; `availableForFulfilment` is the explicit invariant, checked directly.

> **Prerequisite (LOT items):** FEFO needs expiry dates on inventory numbers. Confirm
> coverage before this task starts — partial coverage silently degrades FEFO to arbitrary ordering.
> For PLAIN items the prerequisite does not apply; FIFO by WMS putaway date is used and should be
> stated as such to the business.

**Acceptance**
- [ ] GIVEN a UNIT bin holding lot A and BULK stock of lot A available, THEN the task sources lot A.
- [ ] GIVEN an empty UNIT bin and BULK lots with differing expiry dates, THEN the earliest-expiring lot is selected.
- [ ] GIVEN a non-empty UNIT bin holding lot A and no lot A anywhere in BULK, THEN **no replenishment task is raised** and picking allocates directly from other bins holding the SKU in FEFO order.
- [ ] GIVEN no bin anywhere holds the SKU, THEN it reports as out of stock with no exception raised and no blocked task created.
- [ ] GIVEN the only stock for a SKU sits in a QUALITY/RETURN/DEFECT bin, THEN replenishment sources nothing and the SKU reports out of stock — non-fulfillable stock is never drawn from.
- [ ] GIVEN inventory numbers missing expiry dates, THEN the condition is reported rather than silently ordering arbitrarily.
- [ ] GIVEN items without lot tracking, THEN selection falls back to FIFO by bin without error.

---

### T-5.3 — Replenishment task execution on the handheld
**Depends on:** T-5.2, T-3.4

**Narrative**
As a replenishment operator, I want the scanner to direct me to the source bin and confirm the move,
so that stock lands in the right pick face with the right lot.

**Requirement**
Task list filtered to replenishment, priority-ordered. Directed flow: scan source bin → scan SKU →
scan lot → enter qty → scan target UNIT bin. Validate each scan against the task. Emit a REPLEN_MOVE
event. Support partial completion (source bin short) leaving a residual task. Cancel path with reason.

**Acceptance**
- [ ] GIVEN an assigned task, WHEN the operator completes the directed sequence, THEN a REPLEN_MOVE event is created and the task moves to COMPLETE.
- [ ] GIVEN the operator scans a bin other than the directed source, THEN the app blocks and no event is emitted.
- [ ] GIVEN only part of the quantity is available, WHEN partial completion is confirmed, THEN the moved quantity is recorded and a residual task remains OPEN.
- [ ] GIVEN a completed replenishment, WHEN the M/R commits it, THEN a Bin Transfer posts and the UNIT bin's available quantity rises accordingly.

---

# PHASE 5B — Inbound Receipt & Putaway

*New scope per D-09.* All inbound stock enters through the WMS: Purchase Orders, Transfer Orders and
Work Order completions. This closes Q-05 (previously deferred to release 2) and largely neutralises
F-20, because with inbound and bin movement both originating in the WMS, a direct NetSuite posting
becomes a policy exception rather than routine.

Unlike bin movements, **inbound postings are real financial events** and must reach the ledger.

### T-5.4 — `wms_lib_putaway.js` — directed putaway strategy
**Depends on:** T-2.3, T-2.3b · **Implements:** AD-14

**Narrative**
As a receiving operator, I want the system to tell me exactly which bin to put a pallet in, so that
stock is slotted correctly without me having to know the warehouse layout.

**Requirement**
Given `(item, lot, quantity, location)`, select a target bin honouring the 1-SKU/1-batch rule:

1. An existing bin already holding **this SKU and this lot** with capacity — consolidate.
2. Otherwise an **empty** bin in the correct zone, preferring the item's home zone, then by pick
   sequence proximity.
3. Otherwise an **overflow** bin, flagged for later re-slotting.
4. If nothing is available, raise a `NO_PUTAWAY_LOCATION` exception rather than directing the
   operator to an invalid bin.

**Routing by receipt disposition (Q-16, `availableForFulfilment`).** The target bin **type** is chosen
by the receipt's disposition, and the strategy honours `availableForFulfilment`:
- **Good stock** targets a **fulfillable** bin (UNIT/BULK, `availableForFulfilment: true`) so it can
  be picked — steps 1–3 above select among those.
- **Quality-hold / defective / returned stock** targets its matching non-fulfillable type (QUALITY,
  DEFECT, RETURN) and is **never** routed into UNIT/BULK, because that would make unpickable stock
  look pickable.
- Inbound receiving lands in RECEIVING (pre-putaway); putaway is the move out of it.

Pure function over bin state and policy wherever possible, so it is unit-testable without NetSuite.
Never proposes a bin whose policy the placement would violate, and never proposes a blocked bin.
Supports splitting one receipt line across several bins when quantity exceeds a bin's capacity.

**Acceptance**
- [ ] GIVEN a bin already holding the same SKU and lot with capacity, WHEN putaway is directed, THEN that bin is selected.
- [ ] GIVEN no matching bin but an empty bin in the item's home zone, THEN the empty bin is selected.
- [ ] GIVEN a receipt quantity exceeding one bin's capacity, THEN the putaway splits across bins and the sum equals the received quantity.
- [ ] GIVEN no valid bin anywhere, THEN a `NO_PUTAWAY_LOCATION` exception is raised and no invalid direction is given.
- [ ] GIVEN good stock, THEN putaway targets a bin with `availableForFulfilment: true` (UNIT/BULK); GIVEN quality-hold or defective stock, THEN it targets QUALITY/DEFECT and never a fulfillable bin.
- [ ] GIVEN any proposal, THEN it satisfies the target bin's policy — verified by unit tests across every policy combination.

---

### T-5.5 — Purchase Order receipt on the handheld
**Depends on:** T-5.4, T-3.4, T-2.7 · **Implements:** D-09

**Narrative**
As a receiving operator, I want to scan goods against an open purchase order and be told where to
put them, so that stock is booked in and slotted in one pass.

**Requirement**
Scan or select an open PO. For each line: scan SKU, enter or scan **lot number and expiry date**,
enter quantity, receive the directed putaway bin from T-5.4, confirm by scanning that bin. Emits a
`RECEIPT` event; the committer posts an **Item Receipt** against the PO.

**Lot expiry is captured here.** This is the point at which lot data enters the system and the only
practical moment to capture expiry — FEFO across the whole solution depends on it (Q-15).

Handle the real cases the FRD never mentions: **over-receipt** against PO quantity (tolerance from
config, else block), **under-receipt** leaving the PO line open, **damaged goods** routed to a
QUALITY bin (held for disposition, `availableForFulfilment: false`), and receiving against a PO line
whose item is serialised (reject explicitly per D-08).

**Acceptance**
- [ ] GIVEN an open PO, WHEN the operator receives a line with lot and quantity, THEN an Item Receipt posts against that PO and WMS bin state reflects the putaway.
- [ ] GIVEN a receipt quantity above the PO line quantity, THEN it is accepted only within the configured tolerance and otherwise blocked with a clear message.
- [ ] GIVEN a partial receipt, THEN the PO line remains open for the balance.
- [ ] GIVEN a lot-tracked item, THEN lot number **and expiry date** are mandatory and are written to the inventory number record.
- [ ] GIVEN damaged goods, THEN they are routed to a QUALITY bin (`availableForFulfilment: false`) and are therefore never allocated — but still counted in reconciliation (T-8.3).
- [ ] GIVEN a serialised item on the PO, THEN the receipt is rejected with an explicit out-of-scope message rather than a platform error.

---

### T-5.6 — Transfer Order receipt
**Depends on:** T-5.5 · **Implements:** D-09

**Narrative**
As a receiving operator, I want to receive an inbound transfer from another location the same way I
receive a purchase order, so that there is one receiving process rather than two.

**Requirement**
Same flow as T-5.5 against an open Transfer Order. Lot numbers arrive with the transfer and are
**carried through, not re-keyed** — the sending location already assigned them. Handle in-transit
quantity, partial receipt, and discrepancy against what was shipped (raise an exception; do not
silently accept a different quantity).

**Acceptance**
- [ ] GIVEN an inbound Transfer Order, WHEN received, THEN an Item Receipt posts against the TO and bin state reflects the putaway.
- [ ] GIVEN lot-tracked stock on the TO, THEN the original lot numbers are carried through without re-entry.
- [ ] GIVEN a received quantity differing from the shipped quantity, THEN a discrepancy exception is raised naming both figures.

---

### T-5.7 — Work Order completion receipt
**Depends on:** T-5.4, T-2.7 · **Implements:** D-09

**Narrative**
As a production operator, I want to book finished goods into a bin as they come off the line, so
that output is available to pick without a separate back-office step.

**Requirement**
Scan against an open Work Order, enter quantity and the output **lot number and expiry**, receive
the directed putaway bin. The committer posts a **Work Order Completion** (or Assembly Build,
depending on the manufacturing configuration — confirm in Q-25). Handle partial completion across a
run, and scrap quantity if in scope.

**Acceptance**
- [ ] GIVEN an open Work Order, WHEN output is booked, THEN the correct NetSuite completion transaction posts and bin state reflects the putaway.
- [ ] GIVEN a lot-tracked finished good, THEN the output lot and expiry are captured and written.
- [ ] GIVEN multiple partial completions against one Work Order, THEN each posts correctly and the order closes only when complete.

---

### T-5.8 — Two-phase committer sequencing: inbound before outbound
**Depends on:** T-4.1, T-5.5 · **Resolves:** F-24 · **Implements:** AD-18 · *(simplified per D-11)*

**Narrative**
As the system, I want every committer cycle to post all receipts before any fulfillments, so that
NetSuite is never asked to go negative for work the warehouse performed in a perfectly sensible
order.

**Requirement**
Per D-11, **the WMS may go negative; NetSuite may not.** The sequencing rule is therefore absolute
rather than dependency-driven:

```
PHASE A — post every PENDING inbound event    (Item Receipt, WO Completion)
PHASE B — post every PENDING outbound event   (Item Fulfillment, Adjustment)
```

No per-`(item, location)` dependency graph — a global priority is sufficient, simpler and cheaper
than the tracking it replaces. Phase B does not begin until Phase A has drained. Within each phase
groups still run fully parallel, so throughput is preserved.

**Acceptance**
- [ ] GIVEN stock received and picked within the same minute, WHEN the cycle runs, THEN the Item Receipt posts in Phase A and the fulfillment succeeds in Phase B.
- [ ] GIVEN a cycle with both inbound and outbound events pending, THEN no outbound posting occurs until every inbound posting has completed or been accounted for.
- [ ] GIVEN only outbound events pending, THEN Phase A completes trivially and Phase B runs without added latency.
- [ ] GIVEN many unrelated events within a phase, THEN they process in parallel with no throughput loss attributable to the sequencing rule.
- [ ] GIVEN the load-test profile with inbound included, THEN zero insufficient-quantity failures occur.

---

### T-4.7 — Deferred posting when NetSuite lacks quantity
**Depends on:** T-5.8, T-8.1 · **Resolves:** F-25 · **Implements:** AD-18 · *(new per D-11)*

**Narrative**
As a warehouse supervisor, I want an out-of-sequence fulfillment to wait and retry rather than fail,
so that my exception queue holds real problems instead of things that fix themselves in four
minutes.

**Requirement**
Before posting any outbound transaction, check NetSuite has sufficient quantity at that location for
that item and lot. Where it does not:

- Set the event to **`DEFERRED`** — a **new status, distinct from `FAILED`**. Deferred means
  *legitimate work in the wrong sequence, will succeed once its receipt lands*. Failed means *will
  never succeed without a human*. Collapsing the two fills the supervisor queue with noise that
  resolves itself and trains people to ignore it.
- Retry on the next cycle. After a configured number of cycles or elapsed time, escalate to a
  `DEFERRAL_TIMEOUT` exception — at that point the expected receipt genuinely is not coming.
- Surface current deferral count and oldest deferral age on the dashboard, separately from
  exceptions.

**WMS bin state is not held back by any of this.** The projection already reflects the pick; only
the NetSuite posting waits. The floor keeps moving.

**Acceptance**
- [ ] GIVEN an outbound event whose supporting receipt has not yet posted, WHEN the cycle runs, THEN it is set `DEFERRED`, **not** `FAILED`, and no exception is raised.
- [ ] GIVEN a deferred event whose receipt posts in the next cycle, THEN it posts successfully with no human involvement.
- [ ] GIVEN a deferred event exceeding the configured retry limit, THEN a `DEFERRAL_TIMEOUT` exception is raised naming the item, location and shortfall.
- [ ] GIVEN any deferral, THEN WMS bin state is unaffected and the operator is not blocked.
- [ ] GIVEN the dashboard, THEN deferral count and oldest deferral age are shown separately from the exception count.
- [ ] GIVEN NetSuite quantity is insufficient, THEN no posting is attempted that would drive NetSuite negative.

---

### T-5.9 — Inbound exception handling
**Depends on:** T-5.5, T-8.1

**Narrative**
As a receiving supervisor, I want inbound problems queued for me the same way outbound ones are, so
that there is one place to look when something is wrong.

**Requirement**
Route inbound failures into the T-8.1 exception queue with their own types: `OVER_RECEIPT`,
`RECEIPT_DISCREPANCY`, `NO_PUTAWAY_LOCATION`, `MISSING_LOT_DATA`, `SERIALISED_ITEM_OUT_OF_SCOPE`,
`PO_LINE_MISMATCH`. Each carries the source document, operator, item and quantities. Resolution
actions extend those in T-8.2 with **re-direct putaway** and **accept variance**.

**Acceptance**
- [ ] GIVEN any inbound failure, THEN exactly one exception exists carrying the source document, operator, item and both expected and actual quantities.
- [ ] GIVEN a `NO_PUTAWAY_LOCATION` exception, WHEN a supervisor re-directs it to a chosen bin, THEN the receipt completes without re-scanning the goods.
- [ ] GIVEN inbound and outbound exceptions, THEN both appear in one supervisor queue filterable by direction.
