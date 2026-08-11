# 00 — Objective & Confirmed Understanding

**Source:** `FRD Advance Warehouse Management.pdf` (49 pp). Contains two documents; the first is
duplicated inside the PDF (pp. 1–15 repeated at pp. 16–32).

| # | Document | Pages | Purpose |
|---|---|---|---|
| A | High-Throughput High-Concurrency Architecture Addendum | 1–15 (dup. 16–32) | Non-functional: how the system survives 50k lines/day on NetSuite |
| B | FRD Addendum: Specialized Warehouse Execution Engine | 32–49 | Functional: what the warehouse actually does |

Confirmed with the sponsor: **these two documents are the entire scope.** There is no separate core
WMS FRD. This matters — see `04-open-questions.md`, several foundational warehouse processes are
referenced by these addenda but never specified anywhere.

---

## 1. The objective in one paragraph

Build a **native NetSuite (SuiteScript 2.1) warehouse execution engine** that runs a 50-person
warehouse floor at 5,000 sales orders / 50,000 order lines per day, without the ERP's transactional
ledger becoming the bottleneck. It does this by physically separating *what the operator scans* from
*what NetSuite posts*: the handheld writes an immutable scan event and gets an instant acknowledgement;
a background Map/Reduce pipeline later aggregates those events into the six ledger shapes (Item
Fulfillment, Inventory Adjustment, Inventory Transfer, Item Receipt, WO Completion) — **bin movements
post nothing** (D-07, AD-16). On top of that engine sit six warehouse capabilities: strict single-SKU /
single-batch bin isolation, automated bulk-to-unit replenishment, item-commonality wave clustering,
consolidated summary picking with a de-consolidation pack screen, picker-to-packer chain of custody,
and a real-time performance dashboard.

## 2. What "done" looks like

**Operational targets (from Doc A):**

- 5,000 sales orders / 50,000 order lines per day
- 50 concurrent floor staff (35 pickers, 15 packers), scanning every 2–5 seconds → 10–25 scans/sec peak
- Sub-300 ms handheld UI response
- Zero database lock timeouts (`RCRD_HAS_BEEN_CHANGED`)
- Zero UI blocks caused by ERP transaction posting

> ⚠️ The 150 ms ingestion / 300 ms UI figures are **not achievable as a server round-trip** on
> NetSuite. See `01-review-findings.md` F-02. The plan re-baselines these against an
> optimistic-UI handheld client, which is the only design that actually delivers the stated
> operator experience.

**Functional capabilities (from Doc B):**

1. **Bin isolation** — every UNIT and BULK bin holds exactly 1 SKU and 1 lot/batch at a time; any
   receipt, putaway, transfer or replenishment that would violate this is blocked at the scanner.
2. **Bulk-to-unit replenishment** — when a UNIT pick face drops below its trigger qty, the system
   raises a move task sourcing from a BULK bin, preferring the same lot, else FEFO.
3. **Wave clustering** — pending sales orders are grouped by item commonality (Jaccard similarity
   over their SKU sets) so one picker walks once for many orders.
4. **Summary picking + de-consolidation** — the picker sees one consolidated qty per SKU/lot; the
   packer expands that summary row per order and commits fulfillments order by order.
5. **Chain of custody** — picker scans a stage/tote barcode to hand off; packer scans it to accept;
   both sides logged.
6. **Real-time dashboard** — team metrics (open waves, replen queue, staged orders, on-time %) and
   individual metrics (pick rate, pack rate, scan accuracy, current task/zone).

## 3. Architecture as I understand it

```
50 PWA clients ─HTTP POST─> [L1] Ingestion Suitelet (same origin; D-19)
                                  · validate against cache (advisory)
                                  · write customrecord_wms_scan_event (PENDING, externalid = UUID)
                                  · return 200 immediately
                                        │
                                        ▼
                            [L2] N/cache + concurrency locks
                                  · static maps: item, bin type, replen profile
                                  · lock records for contended resources
                                        │
                                        ▼
                            [L3] Map/Reduce ledger commit
                                  · group events by order / transfer batch
                                  · RE-ASSERT invariants against live ledger
                                  · one record.transform per Sales Order
                                  · mark POSTED / FAILED
```

**The single most important design property:** the operator is never made to wait for a NetSuite
transaction save. Everything the floor does is an append to an event log; the ledger catches up.

**The single biggest consequence of that property**, which the FRD does not address: the operator can
be told "OK" for a scan that the ledger later rejects. Physical stock has already moved. The plan
therefore treats the **exception queue and supervisor resolution workflow as core scope, not a
nice-to-have** (Phase 8).

## 4. Environment assumptions (confirmed)

- NetSuite with **SuiteCloud Plus licensed** — Map/Reduce concurrency and multiple queues available.
- **Bins do not exist in NetSuite — they live only in the WMS** (ruling D-07). Locations are
  enabled; serial/lot numbering is set **per item** on the item record. This is a change from the
  FRD, which silently assumes Advanced Bin / Numbered Inventory Management throughout — see F-19 and
  `06-netsuite-boundary.md`.
- The ledger interface is **six** transaction shapes — three outbound, three inbound since D-09 put
  receiving through the WMS. Bin movements post nothing.
- **Serial, lot and plain items are all in scope** (D-29 — supersedes D-08). Item tracking mode is
  **PLAIN, LOT or SERIAL**, per item (the record type, PF-14). Serialised units carry a per-unit
  lifecycle record (`customrecord_wms_serial_state`).
- **Inbound is in scope** (D-09): PO, Transfer Order and Work Order receipt plus directed putaway,
  all through the WMS. Phase 5B.
- **The WMS is operationally primary, but NetSuite retains authority over commitment and cost**
  (D-10, AD-17). The WMS allocates *within* NetSuite's commitment and runs all bin-level allocation
  and replenishment rules. **Costing is entirely NetSuite's** — the WMS supplies quantity, date and
  lot and models no valuation (D-11).
- **The WMS may go negative; NetSuite may not** (D-11). Inbound always posts before outbound, and an
  outbound posting NetSuite cannot satisfy is deferred and retried rather than failed.
- SuiteScript 2.1, SuiteCloud CLI / SDF project for source control and deployment.

## 5. What I am *not* assuming

- That the handheld application exists. Doc A says "handheld terminals POST to a RESTlet" and stops
  there. The mobile client is the largest single unspecified work item in this programme and is
  carried as Phase 3 with its own decision gate.
- That existing bin data is compliant. Single-SKU/single-batch is a hard invariant; if the migrated
  bin data has mixed bins, day-1 go-live is blocked until remediated (Phase 10).
  > **T-0.4 answered — case (b).** Bin data lives in a **third-party application** and is **migrated**
  > into NetSuite (`customrecord_wms_bin` + opening `customrecord_wms_bin_state`). Phase 10 is a
  > migration, not greenfield slotting. The open risk is now cutover staleness — stock moves between
  > export and go-live — handled by a freeze or delta reconciliation (T-10.1, T-13.3).
- That the sample code in the FRD is production-intended. It reads as illustrative pseudo-code —
  there are several defects in it (`01-review-findings.md`), which is normal for an FRD and not a
  criticism of the document.
