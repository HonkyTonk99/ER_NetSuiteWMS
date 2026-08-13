# 09 — Vertical Slice (build spec)

**Purpose:** prove the spine of the architecture end to end, in the real account, before building
Phase 1 in breadth.

**Not a prototype.** This is the first real code of Phase 1, built in order of risk rather than order
of layer. Everything else hangs off it. Write it to the standards in `CLAUDE.md` — invariants,
naming, error shapes, no hard-coded tuning values — because it stays.

**Shape:** a purchase-order receipt. One PO, one line, into one bin. Scanned on a phone, queued,
committed asynchronously, posted to NetSuite. Then the same receipt for a lot item, then a serial
item.

> **Authority note.** This file is the authority for the vertical-slice work. It was committed at the
> sponsor's instruction as the first real code of Phase 1. The planning-only constraint is lifted for the
> components named under **Components** and for nothing else; the **out-of-scope** list stays held.

---

## What it proves

Each of these is currently an assumption the whole design rests on:

1. An Available Without Login Suitelet, under Execute As Role, can write a custom record from an
   unauthenticated browser. *(Subsumes T-0.8/T1 — proven by construction on day one.)*
2. `externalid` gives real idempotency, and the duplicate error is what we think it is
   (`UNIQUE_RCRD_ID_REQD`, PF-13).
3. `record.save` throws on a concurrent edit (`RCRD_HAS_BEEN_CHANGED`, PF-11), so the bin-state
   projection can retry rather than silently lose an update.
4. A Map/Reduce committer can be triggered on demand (`task.MapReduceScriptTask`, PF-08) and drains
   fast enough to be useful.
5. `record.transform` produces a valid Item Receipt, and `inventorydetail` populates correctly in
   standard mode (PF-16) — for plain, lot **and** serial items.
6. A durable browser queue survives the app being killed, and replays exactly once.

It also produces the first **measured** numbers. Every governance figure, latency figure and batch
size in the plan is currently an estimate.

---

## Explicitly out of scope

Not because they don't matter — because they aren't on the spine, and including them defeats the
purpose:

waves - clustering - allocation - replenishment - putaway strategy - pick paths - the exception
dashboard - metric snapshots - sites and the location class - RQD isolation - write-off - RMA -
transfer orders - multi-location - cache warm - service worker - device authentication beyond a
hard-coded token - the three carved-out modules

If something on that list turns out to be *required* to make the slice work, stop and say so — that
would be a finding worth more than the slice itself.

---

## Components

Minimal versions only. Fields not listed are not built.

**Records**

- `customrecord_wms_scan_event` — `externalid` (client UUID), type, item, quantity, bin, location,
  status (PENDING / PROCESSING / POSTED / FAILED / DEFERRED), raw payload, error name, error message,
  scan timestamp, source document.
- `customrecord_wms_bin` — name (`<LOCATIONCODE>-<BINCODE>`), location, active.
- `customrecord_wms_bin_state` — bin, item, lot, quantity, version, location.
- `customrecord_wms_serial_state` — item, serial, bin, location, status, generation. *(Day 7 only.)*
- `customrecord_wms_config` — enough rows for batch size, retry bound, and the committer's polling
  fallback.

**Scripts**

- `wms_sl_scan_ingest.js` — Suitelet. GET serves the page; POST accepts a batch, writes events,
  triggers the committer. Device token check is the first operation, even as a hard-coded stub.
- `wms_mr_committer.js` — Map/Reduce. `getInputData` selects PENDING; `map` handles **one event**
  (thin invocation, per the stage limits); `reduce` groups by source document and posts.
- `wms_lib_ledger_adapter.js` — receipt shaping, including `inventorydetail`.
- `wms_lib_bin_state.js` — the projection update with optimistic-concurrency retry.

**Client**

One page, no framework required. Scan or type a PO number, scan a bin, enter a quantity, submit.
IndexedDB write **before** the operator sees confirmation. Replay on reconnect. A visible unsynced
count.

---

## Sequence

Ordered by risk, highest first. Roughly two weeks with slack.

| Day | Work | Proves |
|---|---|---|
| 1 | Unauthenticated Suitelet writes one custom record, called logged out | The endpoint. **If this fails, stop — nothing else matters** |
| 2 | Scan event record; ingest endpoint accepting a batch; minimal page, online only | Ingestion path, batch shape |
| 3 | Committer, on-demand trigger, PO -> Item Receipt for a **plain** item | The ledger write, the first real posting |
| 4 | Bin-state projection with optimistic-concurrency retry | That `RCRD_HAS_BEEN_CHANGED` behaves as documented |
| 5 | IndexedDB durable queue; replay; post the same event twice | Idempotency via `externalid`, queue survival |
| 6 | Same receipt for a **lot** item | `inventorydetail` lot shape |
| 7 | Same receipt for a **serial** item, two units | `inventorydetail` serial shape, quantity-1-per-line, serial state |

Days 6 and 7 are where I expect a surprise. They're last only because they can't run until the spine
works.

---

## Measurements to capture

Record each in `docs/08-platform-facts.md`, replacing the estimate it supersedes:

- Governance units: one event create; one full committer cycle per receipt; one bin-state update via
  load-and-save.
- Latency: scan submitted -> Item Receipt posted, best and worst of at least twenty runs.
- Concurrency: five to ten browser tabs posting simultaneously — what actually happens at the pool
  limit, and whether the client's retry handles it.
- Queue: does IndexedDB survive an app kill and a browser restart with the queue intact.
- Batch size: the largest batch that fits comfortably inside the 1,000-unit Suitelet budget, measured
  rather than derived.

---

## Exit criteria

- A receipt posts correctly for all three tracking modes, with the bin state and serial state
  matching NetSuite.
- The same event submitted twice produces one posting.
- A queued event survives the app being killed and posts on reconnect.
- A concurrent bin-state update is detected and retried, not lost.
- Every measurement above is recorded, and the config values it feeds are updated from the real
  numbers.
- Any assumption that failed is written up as a finding before anything is built on it.

---

## What it deliberately does not prove

Say this plainly in the write-up so nobody over-reads the result:

- Clustering performance at realistic wave sizes.
- Sixty concurrent devices — ten tabs is a smoke test, not a load test.
- A full shift offline.
- Anything about sites, holding locations, transfer orders or returns.
- Migration.

Those come in Phase 1 proper, on a spine that's been proven to hold.

---

## Build status and the deploy/measure boundary *(2026-08-11)*

**Days 1-3 code is written to this spec.** The pieces that can be authored and unit-tested without an
account are done and committed: the ingest Suitelet, the Map/Reduce committer, the ledger adapter, the
pure inventory-detail and ingest-validation libraries (unit-tested), the minimal client page, the SDF
object definitions, and the config rows.

**What is NOT done, and cannot be done from the build environment:** deploying to a sandbox, the Day-1
logged-out write (T1), and every measurement above. There is no NetSuite account or SDF deploy target in
the environment this code was written in, and **Q-47 (which sandbox, SDF deploy rights, refresh) is still
open.** Those steps are the developer's, in-account — see the **Runbook** below. **No measurement has
been invented; every measurement row in `docs/08` is left as an explicit placeholder for the run.**

### Runbook — deploy and measure (developer, in-account)

1. **Validate + deploy.** `suitecloud project:validate --server` then `project:deploy` to the DEV
   sandbox. Field IDs/types in `src/Objects/*.xml` were authored without an account — validation will
   surface any that need correcting.
2. **Day-1 (T1) — the endpoint.** Confirm the Suitelet deployment is **Released**, **Available Without
   Login**, **Execute As Role = the dedicated least-privilege role** (never Administrator, PF-36), and
   **Audience includes `Online Form User` (PF-35)**. From a browser with **no NetSuite session**, GET the
   Suitelet URL, submit the form, confirm one `customrecord_wms_scan_event` row is created. **If this
   fails, stop and report — nothing downstream matters.**
3. **Day-2 — ingestion.** POST a batch of events; confirm each writes with `externalid` = the client
   UUID; POST the same UUID twice and confirm the second is caught as `UNIQUE_RCRD_ID_REQD` (PF-13) and
   returns `idempotent:true` — one row.
4. **Day-3 — first posting.** Confirm the committer is triggered on demand, drains the PENDING event,
   transforms the PO to an Item Receipt for a plain item, and stock appears in NetSuite.
5. **Measure and record in `docs/08`** (replace each placeholder): governance units for one event
   create and one committer cycle; scan->posting latency (best/worst of >= 20 runs); the largest batch
   comfortably inside the 1,000-unit budget; and **anything that differed from what `docs/08` predicts —
   a wrong platform fact is worth more than a clean run.**
