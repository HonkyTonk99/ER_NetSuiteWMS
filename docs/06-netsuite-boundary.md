# 06 — The NetSuite Boundary

**Ruling D-07 (TK, 2026-08-07)** *(supersedes D-06 and the capability-tier model entirely)*:

> *"Assume that BINs are NOT ENABLED in NetSuite, that bins are managed in the WMS. So the
> foundation configuration of NetSuite is: Locations are enabled, and Serial/Batch numbers might be
> enabled or might not be, and these will be defined by the item config in NetSuite."*

**Extended by D-08** (serial out of scope, batch in scope), **D-09** (inbound receipt and putaway
flow through the WMS), **D-10** (WMS primary) and **D-11** (NetSuite runs costing; the WMS may go
negative and NetSuite may not; inbound always posts before outbound).

A real simplification — it removes an entire class of platform problems. It also brings four risks
into the open: §5 irreplaceable bin data, §5b the authority boundary, §6 back-office attribution,
and §7 receipt/consumption ordering.

> **D-07 confirmed (Q-13 closed 2026-08-09).** The Oracle NetSuite WMS SuiteApp — which would have
> required Bin Management enabled and contradicted this boundary — is **not installed** in the target
> account. D-07 is settled, not provisional.

---

## 1. The boundary

```
┌─────────────────────── WMS OWNS ───────────────────────┐   ┌────── NETSUITE OWNS ──────┐
│                                                        │   │                            │
│  Bins — definition, policy, zone, pick sequence         │   │  Locations (warehouses)    │
│  Bin contents — SKU, batch, quantity                    │   │  Item master               │
│  Bin-to-bin movement          ← no ledger impact, ever  │   │  Item tracking mode        │
│  Putaway slotting & receiving                           │   │  Qty on hand per location  │
│  Waves, pick tasks, custody                             │   │  Lot numbers               │
│  Physical topology of the warehouse                     │   │  COMMITMENT (which order)  │
│                                                        │   │  COST & financial record   │
└────────────────────────────────────────────────────────┘   └────────────────────────────┘
                         │                                                  ▲
                         └──── qty per item per location, + lot detail ─────┘
                              (WMS allocates WITHIN NetSuite's commitment)
```

**NetSuite never knows a bin exists.** No bin-transfer record. No bin-number field on any inventory-detail
line. No Bin Management feature, basic or advanced. No Advanced Bin / Numbered Inventory Management
licence.

## 2. What this removes

The previous revision defined five capability tiers because bins and lots interact badly in
NetSuite. By taking bins out of NetSuite entirely, all of that disappears:

| Previously a problem | Status now |
|---|---|
| Basic Bin Management cannot associate lots with bins | **Moot** — no NetSuite bins |
| Tier T3 trap (bins + lots enabled, still can't combine) | **Moot** |
| Advanced Bin / Numbered Inventory Management licence | **Not required** |
| Bin pre-association to items (basic Bin Management) | **Moot** |
| Five-tier ledger adapter | **Collapses to two item modes** (§3) |

The bin isolation rule (1 SKU / 1 batch per bin) is now **purely a WMS rule**, enforced by the WMS,
with no platform constraint fighting it. That is a cleaner place for it to live than it was before.

## 3. The one remaining axis: item tracking mode

Variability moves from *account-level* to *item-level*, which is how NetSuite actually models it.
Read from the item record and cached as static data (`WMS_ITEM_<sku>`).

| Mode | Item config | Inventory detail on posting | Qty semantics |
|---|---|---|---|
| **PLAIN** | Neither serial nor lot | None required | Quantity is a number |
| **LOT** | Track Lot Numbers | `inventorydetail` with lot number + qty | Quantity per lot |
| ~~SERIAL~~ | Track Serial Numbers | — | **Out of scope (D-08)** |

**Mixed-mode orders are normal, not an edge case.** A single sales order can carry both a plain item
and a lot item, and the commit must handle both within one `record.transform`. The adapter (T-2.7)
resolves each line's mode from the item cache and shapes the inventory detail accordingly — no
account-level switch, no configuration flag, no assumption.

**Serialised items are rejected, not guessed at.** They may still exist in the account. If one
reaches a WMS-managed location, T-2.7 raises an explicit out-of-scope exception rather than
attempting a posting that will fail confusingly (D-08).

## 4. The complete ledger interface

**Six shapes since D-09 put inbound through the WMS** — three outbound, three inbound.

| Direction | WMS event | NetSuite posting |
|---|---|---|
| Out | PICK / PACK (order complete) | **Item Fulfillment** — location, item, qty, + lot detail for LOT items |
| Out | COUNT variance | **Inventory Adjustment** |
| Out | Genuine location-to-location move | **Inventory Transfer** — only if multi-location is in scope (Q-08) |
| In | PO receipt | **Item Receipt** against the PO |
| In | Transfer Order receipt | **Item Receipt** against the TO |
| In | Production output | **Work Order Completion / Assembly Build** (Q-25) |
| — | BIN_TRANSFER / REPLEN_MOVE / PUTAWAY | **Nothing.** Stock has not changed location — no financial event |

**Inbound postings are real financial events** and must reach the ledger, unlike bin movements.

> **All shapes CONFIRMED against the platform (D-27, `08-platform-facts.md` PF-16..PF-21).** Inventory
> detail is the `inventorydetail` subrecord's `inventoryassignment` sublist — `receiptinventorynumber`
> (in) / `issueinventorynumber` (out) + `quantity`; **no bin-number field** (invariant #13). Standard mode
> works, including on a transformed record. **Item Fulfilment cannot span locations — one per (order,
> location)** (PF-18). **`transferorder`→`itemfulfillment` transform is supported**; the TO **receipt
> transforms from the transfer order**, cannot precede fulfilment (`CANT_RCEIV_BEFORE_FULFILL`, F-30), and
> `PARTIAL_FULFILL_RCEIV_DISALLWD` applies only cross-subsidiary (Q-52). Inventory Adjustment/Transfer
> field lists are in T-2.7; **`unitcost` is ignored on negative adjustments** (invariant #17, PF-21).
>
> **Receipt-quarantine (RQD) isolation is an Inventory Transfer, not a Transfer Order (D-28).** The move
> that isolates a non-fulfillable receipt is same-roof and same-minute; a Transfer Order's approval /
> fulfil / in-transit / receipt steps cannot complete in one committer cycle (a TO receipt cannot precede
> its fulfilment, PF-19), and the usual Inventory-Transfer objection — needing exact lots/serials at entry
> — does not apply because the operator already scanned them.

**Reconciliation contract** (T-8.3) follows directly:

- For every item and location: `SUM(WMS bin quantities)` **must equal** NetSuite quantity on hand.
- For LOT items, additionally per lot.
- **Bins themselves have nothing to reconcile against** — see §5.

## 5. ⚠️ Risk: WMS bin data is now irreplaceable

Previously the bin state projection was an optimisation, with NetSuite bins as a theoretical
fallback. Under D-07 there is no fallback. **`customrecord_wms_bin_state` is the only record
anywhere of what is in which bin.** If it is lost or corrupted, it cannot be reconstructed from
NetSuite — NetSuite will happily tell you there are 4,000 units of SKU ABC in the warehouse and have
no opinion whatsoever about where they are.

Recovery from total loss means a **full physical stocktake**. That is days of lost shipping.

Required controls (new task **T-11.3**):

1. Daily export of full bin state to durable storage outside NetSuite, retained on a rolling window.
2. Point-in-time restore procedure — **rehearsed, not merely documented**.
3. Change-audit on bin state so a bad script can be identified and its effects bounded.
4. Alerting on implausible mass changes (e.g. >5% of bins emptied in one run).

This is not paranoia. A single defective Map/Reduce deployment iterating the wrong search can zero
the warehouse's entire location map in one execution.

## 5b. Authority boundary — WMS primary, NetSuite retains commitment and cost *(D-10, AD-17)*

The WMS is the primary inventory tool and NetSuite locations follow it. That is an **operational**
statement, not a financial one — NetSuite does not stop being the book of record.

| Authority | Holder | Meaning |
|---|---|---|
| Physical state — what is where, right now | **WMS** | Bins, quantities, lots, movement sequence |
| **Commitment** — which order owns which stock | **NetSuite** | The WMS allocates *within* it, never around it |
| **Bin allocation & replenishment rules** | **WMS** | Which bin, which batch, when to replenish (D-11) |
| **Cost** | **NetSuite** | **The WMS does not model or sequence for cost at all** (D-11) |
| Financial record | **NetSuite** | Book of record for audit |

**Two-layer allocation, both real.** NetSuite decides *how much* an order is entitled to; the WMS
decides *which bin and batch* satisfies it and runs all replenishment logic. Skip the NetSuite gate
and you ship one customer's stock to another (F-22); skip the WMS gate and you direct pickers to
empty bins.

Three consequences that change the build:

**Allocation (F-22).** The wave engine filters on NetSuite committed quantity, and picked quantity
per line may not exceed it. Without this the WMS will allocate stock NetSuite promised to a
different order — totals stay right, **attribution goes wrong**, and one customer's stock ships to
another.

**Period (F-23).** A pick scanned at 23:58 and posted at 00:04 lands in the wrong **period**; if that
period has closed it cannot post at all. Mitigations: date by scan time, and drain the queue before
period close as a monitored finance procedure (T-11.4). **Costing itself is out of scope** — the WMS
supplies quantity, date and lot and has no opinion about valuation (D-11).

**Negative inventory asymmetry (F-25).** *The WMS may go negative; NetSuite may not.* The floor is
allowed to be ahead of the books; the financial record is not. See §7.

## 6. ⚠️ Risk: back-office movements can no longer be attributed to a bin *(materially reduced by D-09)*

> **Reduced 2026-08-08.** With inbound receipt, putaway and all bin transfers now flowing through the
> WMS (D-09), a direct NetSuite posting is a **policy exception rather than routine traffic**. The
> analysis below still holds for that exception path, and the blocking User Event (T-10.2) remains
> as the backstop — but this is no longer an everyday occurrence.

A back-office user posting an Inventory Adjustment or Item Fulfillment directly in NetSuite changes
quantity at the **location** level. The WMS has no way to know **which bin** that stock left.

Reconciliation will correctly detect the discrepancy — WMS bin total no longer matches NetSuite
location total — but it **cannot resolve it automatically**, because the information needed to
resolve it was never captured. Somebody has to physically go and look.

Previously (T-10.2) a `beforeSubmit` User Event could validate against NetSuite's own bin dimension.
That dimension no longer exists, so the control changes shape:

- **Preferred: policy.** All inventory movement for WMS-managed locations goes through the WMS. Back
  office does not adjust stock in those locations directly.
- **Enforced: User Event.** `beforeSubmit` on Inventory Adjustment, Item Fulfillment, Item Receipt
  and Inventory Transfer **blocks** direct posting against a WMS-managed location unless flagged as
  WMS-originated, or the user holds an audited override role.
- **Fallback: attribution exception.** Where an override is used, raise an
  `UNATTRIBUTED_MOVEMENT` exception routing to a supervisor to identify the bin physically.

Logged as **F-20**. This is the single largest operational risk introduced by D-07 and it is
managed by process as much as by code.

## 7. Sequencing rule: inbound always posts before outbound *(D-11, AD-18)*

*Replaces the serial throughput risk, which D-08 closed, and the dependency-graph design, which
D-11 simplified.*

**The rule:** the WMS may go negative; NetSuite may not.

The floor is legitimately ahead of the books — an operator has physically moved stock the ledger has
not caught up with. NetSuite, being the financial record, gets no such latitude. Since inbound and
outbound events share one queue and the committer runs groups in parallel, a fulfillment could
otherwise post before the receipt that supplied it and be rejected outright.

**Two-phase committer cycle:**

```
cycle N:
  PHASE A — post every PENDING inbound event    (Item Receipt, WO Completion)
  PHASE B — post every PENDING outbound event   (Item Fulfillment, Adjustment)
             │
             └─ NetSuite quantity insufficient?
                  → status = DEFERRED, retry next cycle    ← not FAILED
                  → past the retry limit → DEFERRAL_TIMEOUT exception
```

No per-item dependency graph — a global priority is sufficient, and much less to get wrong. Within
each phase, groups still run fully parallel.

**`DEFERRED` and `FAILED` are different things and must stay different.** Deferred is legitimate
work in the wrong sequence that will succeed on its own. Failed needs a human. Merging them fills
the supervisor queue with noise that resolves itself in four minutes, and trains people to stop
looking.

**Negative bin state is permitted but diagnostic.** Transient small negatives during the queue window
are normal. Persistent or large ones raise `NEGATIVE_BIN_STATE` on magnitude and age thresholds — a
bin at −3 means an event double-counted, stock left without a scan, or a receipt was never captured.

**A negative bin is occupied, not empty.** The naive `qty <= 0` test would let a different SKU into a
bin that is already in an error state, compounding the fault and destroying the evidence needed to
diagnose it. A negative bin accepts only the SKU and lot already recorded against it.

## 8. What the bin invariant means for each mode

The rule is "1 SKU and 1 batch per bin". Its meaning per mode:

| Mode | Rule as applied |
|---|---|
| **PLAIN** | 1 SKU per bin. No batch dimension exists |
| **LOT** | 1 SKU **and** 1 lot per bin — the FRD's full rule |

Both are expressible in the existing bin policy model (AD-14) without change — the policy asks
"single batch?" and for a PLAIN item there is no batch to be single about.
