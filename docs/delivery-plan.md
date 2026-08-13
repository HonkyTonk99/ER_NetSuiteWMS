# Advanced Warehouse Management — Delivery Plan

Planning bundle derived from `FRD Advance Warehouse Management.pdf`. **Planning stage only — no
implementation has begun.** Structured for Claude Code: drop this into the repo root and the
conventions in `CLAUDE.md` apply automatically.

> **Revision 9 — 2026-08-11 (serial reissue + platform facts).** The decisions log now runs to **D-33**
> and is authoritative; this plan is a snapshot. **Material scope ADDED since Revision 8 — stated plainly,
> not absorbed silently:**
> - **Serialised items are IN scope (D-29 — supersedes D-08).** New `customrecord_wms_serial_state` with a
>   generation counter; new invariants #21/#22; serial validation (entry vs movement) across the flows;
>   a wave-scoped serial cache on the handheld. **This re-opens the F-21 scan-volume risk** — serialised
>   lines are one scan per *unit*, so T-0.2 sizing grows.
> - **Customer returns (RMA) receipt in scope (D-32 — resolves Q-45):** new Phase-5B task T-5.11.
> - **Inventory write-off path with mandatory authorisation (D-33):** new event type + handler (T-5.12).
> - **Site vs NetSuite location distinction (D-30)**, **movement rules by scope (D-31)**, and the
>   **location class now confirmed required (not conditional).** RQD isolation is an Inventory Transfer
>   (D-28), and A<->B within a site is routine both ways (D-31).
> - **Q-32 refusal withdrawn (Part G):** a multi-location sales order is supported, not an error — waving
>   keys on the line's location.
> - Platform facts recorded in `docs/08` (D-27); ledger shapes CONFIRMED.
> These touch Phase 5B and Phases 6–7. **The sponsor holds the timeline, so this plan carries no
> estimates — it keeps a *scope ledger* instead (below): what was added, on whose ruling, and why.
> Traceability, not scheduling.** Read [`docs/05-decisions-log.md`](05-decisions-log.md) and
> [`docs/08-platform-facts.md`](08-platform-facts.md) first.

### Scope ledger *(dated; traceability, not scheduling — the sponsor holds the timeline)*

| Date | Added | Ruling | Why |
|---|---|---|---|
| 2026-08-08 | Inbound receipt & putaway (Phase 5B) | D-09 | The WMS receives PO/TO/WO, not just ships |
| 2026-08-09 | Multi-location (location as session context) | D-14 | Multiple warehouses in scope |
| 2026-08-09 | Transfer Order **outbound** (pick/stage/ship) | D-22 | The client moves stock between locations |
| 2026-08-11 | **Serialised items** (schema, invariants #21/#22, flows, cache) | **D-29** | Serial stock is stocked/picked/shipped; D-08 was wrong |
| 2026-08-11 | **Site vs NetSuite-location split**; movement rules by scope | **D-30, D-31** | One building can hold several NetSuite locations (good + RQD) |
| 2026-08-11 | **Customer returns (RMA) receipt** | **D-32** | Returns re-enter through the WMS; a serial entry point |
| 2026-08-11 | **Inventory write-off** path (authorised) | **D-33** | Condemned stock leaves the books with an authorising name |
| 2026-08-11 | **Location class** (operational/holding) reads across picker/wave/replen/putaway | **D-30/D-33** | RQD stock must not be picked, sourced or targeted as good |
| 2026-08-11 | Serial share as a **parameter** (100% envelope) | **D-34** | Every account differs; census tunes config, not gates design |
>
> **Revision 8 — 2026-08-09.** The decisions log now runs to **D-22** and is authoritative; this plan
> is a snapshot. Since Revision 6: multi-location (D-14) and its follow-ups (D-20 location-switch
> exception); PWA + Option C auth confirmed (D-13/D-19) with device auth (D-21), privilege separation
> (AD-19), and concurrency throttling (F-29); and **Transfer Order outbound in scope (D-22)** —
> **which adds tasks to Phases 6–7** (wave/allocation/pick/stage extend to transaction type
> `transferorder` alongside `salesorder`, same engine) **and reshapes Phase 5B** (a TO receipt is now
> the destination half of a WMS-fulfilled transfer, with a new ordering exception F-30). Read
> [`docs/05-decisions-log.md`](05-decisions-log.md) first — it overrides everything below.
>
> **Revision 6 — 2026-08-08.** **Costing is NetSuite's concern and out of WMS scope. The WMS may go
> negative; NetSuite may not. Inbound always posts before outbound** (D-11). This simplifies the
> sequencing design to a two-phase priority and adds a `DEFERRED` event status. Revision 5 applied
> D-08 (serial out — **since superseded by D-29; serial is in scope**), D-09 (inbound via WMS, Phase 5B) and D-10 (authority boundary). Start with
> [`docs/06-netsuite-boundary.md`](06-netsuite-boundary.md) and
> [`docs/05-decisions-log.md`](05-decisions-log.md).

## Read in this order

| File | What it is |
|---|---|
| [`docs/00-objective.md`](00-objective.md) | Confirmed understanding of the objective, scope and target architecture |
| [`docs/05-decisions-log.md`](05-decisions-log.md) | **Read early.** Sponsor rulings D-01…D-11 and what they overrode |
| [`docs/06-netsuite-boundary.md`](06-netsuite-boundary.md) | **Read before any ledger code.** What the WMS owns vs what NetSuite owns, and the three risks that split creates |
| [`docs/01-review-findings.md`](01-review-findings.md) | Review of the FRD — 25 findings, severity-rated, each mapped to a task |
| [`docs/02-architecture.md`](02-architecture.md) | 18 architecture decisions that override or extend the FRD |
| [`docs/03-data-model.md`](03-data-model.md) | Consolidated schema (both addenda merged, plus review-driven additions) |
| [`docs/04-open-questions.md`](04-open-questions.md) | 14 open decisions; **1 hard blocker** — the handheld platform |
| [`CLAUDE.md`](../CLAUDE.md) | Coding conventions and 23 non-negotiable invariants |

## Task backlog

| File | Phases | Tasks |
|---|---|---|
| [`tasks/phase-0-2-foundation.md`](../tasks/phase-0-2-foundation.md) | 0 Discovery · 1 Data model · 2 Core services | 17 |
| [`tasks/phase-3-5-engine.md`](../tasks/phase-3-5-engine.md) | 3 Ingestion & handheld · 4 Ledger commit · 5 Replenishment · **5B Inbound** | 21 |
| [`tasks/phase-6-9-operations.md`](../tasks/phase-6-9-operations.md) | 6 Waves · 7 Pick & pack · 8 Exceptions & custody · 9 Dashboard | 15 |
| [`tasks/phase-10-13-hardening.md`](../tasks/phase-10-13-hardening.md) | 10 Bin remediation · 11 Housekeeping · 12 Performance · 13 Cutover | 13 |

**66 tasks.** Every task carries a **Narrative** (user story), a **Requirement** (what to build), and
**Acceptance** criteria written as verifiable Given/When/Then statements.

## What changed in revision 6

| Ruling | Effect |
|---|---|
| **D-11a** — costing is NetSuite's | **Closes Q-24, withdraws half of F-23.** No costing logic, no event ordering for valuation. The WMS supplies quantity, date and lot. What survives is the *period* requirement — a transaction dated into a closed period cannot post at all |
| **D-11b** — WMS may go negative, NetSuite may not | **Closes Q-26**, new finding **F-25**. Outbound that NetSuite cannot satisfy is **`DEFERRED` and retried, never `FAILED`** — new status, new task T-4.7. Negative bin state is permitted but diagnostic. And a negative bin is **occupied, not empty** — the naive `qty <= 0` test would admit a second SKU into a bin already in error |
| **D-11c** — inbound always before outbound | **Simplifies AD-18**: a global two-phase cycle replaces the per-item dependency graph. Less code, nothing to track per item |
| **D-11d** — WMS runs bin allocation and replenishment | **Confirms** the AD-17 two-layer model: NetSuite decides *how much*, the WMS decides *which bin and batch* |

## What changed in revision 5

| Ruling | Effect |
|---|---|
| ~~**D-08** — serial out, batch in~~ **SUPERSEDED by D-29** | *(historical)* D-08 reduced tracking modes to PLAIN and LOT and closed F-21. **Reversed 2026-08-11 by D-29: serial is IN scope** — F-21 re-opened, `customrecord_wms_serial_state` added, invariants #21/#22 added; there is no "reject serialised item" rule. |
| **D-09** — inbound flows through the WMS | **Scope increase: new Phase 5B, six tasks.** PO / TO / Work Order receipt plus directed putaway. Closes Q-05's receiving portion and Q-15 (lot expiry is now captured at receipt). Largely neutralises F-20. New finding **F-24** — receipt and consumption can post out of order |
| **D-10** — WMS primary, NetSuite keeps commitment and cost | **Two S1 findings.** **F-22**: the wave engine had no reference to NetSuite commitment, so it could allocate stock promised to another order — totals right, attribution wrong. **F-23**: async batched posting fights inventory accounting on period, sequence and negative inventory |

**The authority boundary (AD-17)** — "slave" is operational, not financial:

| Authority | Holder |
|---|---|
| Physical state — what is where, right now | **WMS** |
| Commitment — which order owns which stock | **NetSuite** |
| Cost, and the financial record | **NetSuite** |

## What changed in revision 4

| Ruling | Effect |
|---|---|
| **D-07** — bins live in the WMS, NetSuite has none | **Supersedes D-06 and the whole tier model.** No Bin Management feature, no Advanced Bin / Numbered Inventory Management licence, no lots-in-bins problem. The ledger interface collapses to three shapes — Item Fulfillment, Inventory Adjustment, Inventory Transfer — and **bin movements post nothing**. The only variability is per-item tracking mode |

**What it removed:** five capability tiers, a licensing decision, the T3 trap, and the bin
pre-association problem. The 1-SKU/1-batch rule is now purely a WMS rule with no platform constraint
fighting it.

**What it surfaced — three risks, two of them previously masked:**

- **F-21 · serial items may double the scan volume the design is sized on.** *(Re-opened 2026-08-11 by
  D-29 — serial is back in scope; T-0.2 sizes on one scan per serialised unit.)*
- **F-20 · back-office movements cannot be attributed to a bin.** *(Materially reduced in revision 5
  by D-09 — inbound now flows through the WMS.)* A direct Inventory Adjustment
  changes location quantity with no bin information. Reconciliation detects the mismatch but cannot
  resolve it — the data never existed. Managed by policy plus a blocking User Event.
- **WMS bin data is now irreplaceable.** No NetSuite fallback; loss means a full physical stocktake.
  New task **T-11.3** — daily export, *rehearsed* restore, change audit, mass-change alerting.

## What changed in revision 2

| Ruling | Effect |
|---|---|
| **D-01** — concurrent putaway collision not credible | Bin locks **removed** from the ingestion path. F-01 rewritten around the real defect: the event queue means *every* source of bin contents lags physical reality, so a picker can empty a bin and the next operator be told 2 minutes later that it is full. Replaced with a **bin state projection** — cheaper and faster than what it replaces |
| **D-02** — exception queue needed | Confirmed as core scope. No change |
| **D-03** — no bulk → consume available batches, then out of stock | **Closes Q-03, Q-04 and Q-14.** Replenishment deadlock (F-05) resolved. Summary picking is one task per SKU **per bin**; FEFO across bins; orders may split across batches |
| **D-04** — handheld connection loss is guaranteed | Offline-first elevated from mitigation to mandate. Local master-data cache, batch sync, and **new task T-3.5** for reconnect conflict reconciliation |
| **D-05** — open to flexible solutions | **AD-14** bin policy by bin type and **AD-15** declarative event handler registry. Together these kill five of the six sample-code defects structurally rather than case by case |

## Phase dependency map

```
PHASE 0  Discovery & decisions          ← gates everything
   │
   ├─ PHASE 1  Data model & config
   │     └─ PHASE 2  Core services (cache, lock, validation, idempotency, config)
   │           ├─ PHASE 3  Ingestion + handheld client      [blocked on Q-01]
   │           │     └─ PHASE 4  Async ledger commit         [mode-aware via T-2.7]
   │           │           ├─ PHASE 5  Replenishment
   │           │           ├─ PHASE 5B Inbound receipt & putaway   [new, D-09]
   │           │           ├─ PHASE 6  Wave clustering
   │           │           │     └─ PHASE 7  Summary pick & pack
   │           │           ├─ PHASE 8  Exceptions & custody
   │           │           └─ PHASE 9  Dashboard
   │           └─ PHASE 10 Bin remediation  (runs in parallel, gates go-live)
   │
   ├─ PHASE 11 Housekeeping
   ├─ PHASE 12 Performance & hardening
   └─ PHASE 13 UAT, training, cutover
```

## What still needs a decision

**One hard blocker:**

1. **Q-01 — the handheld application is not specified anywhere.** Doc A assumes it exists. Largest
   single work item in the programme, and D-04's offline-first mandate raised the bar: a browser/PWA
   client cannot dependably deliver local persistence and background sync on rugged Android.

**Close behind:**

2. **Q-16** bin types beyond UNIT/BULK · **Q-17** offline duration limit · **Q-25** Work Order
   Completion vs Assembly Build · **Q-27** over-receipt tolerance · **Q-06** label platform.

Nothing on that second list gates a phase *start* — each is needed during its phase rather than
before it.

## What is not in this bundle

No code. No SDF project. No custom record deployment. This is the plan; `T-0.5` creates the project.
