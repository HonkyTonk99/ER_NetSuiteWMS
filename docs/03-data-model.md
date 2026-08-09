# 03 — Consolidated Data Model

Merges the schemas from Doc A §3 and Doc B §4, plus additions required by the review findings.
**Bold** rows are additions or changes to what the FRD specified.

---

## 3.1 `customrecord_wms_scan_event` — append-only event log

| Field | Type | Notes |
|---|---|---|
| `custrecord_se_event_id` | Free-Form Text | Client UUID v4. **UNIQUE — this is the idempotency guard (AD-04)** |
| `custrecord_se_type` | List/Record | PICK, PACK, REPLEN_MOVE, BIN_TRANSFER, COUNT, **SHORT_PICK, OVERRIDE, PUTAWAY, EXCEPTION, RECEIPT_PO, RECEIPT_TO, RECEIPT_WO** *(inbound added per D-09)* |
| `custrecord_se_operator` | List/Record → Employee | |
| `custrecord_se_wave` | List/Record → Wave Pick | |
| `custrecord_se_order` | List/Record → Transaction | |
| `custrecord_se_sku` | List/Record → Item | |
| `custrecord_se_batch` | Free-Form Text | Lot/batch number |
| `custrecord_se_source_bin` | List/Record → `customrecord_wms_bin` | |
| `custrecord_se_target_bin` | List/Record → `customrecord_wms_bin` | |
| `custrecord_se_qty` | Decimal | |
| `custrecord_se_status` | List/Record | PENDING, PROCESSING, POSTED, FAILED, **SUPERSEDED, DEFERRED** *(D-11 — deferred is legitimate work in the wrong sequence; failed needs a human. Do not merge them)* |
| `custrecord_se_error_log` | Long Text | |
| **`custrecord_se_location`** | List/Record → Location | Required for M/R grouping (F-13) |
| **`custrecord_se_order_line_key`** | Free-Form Text | SO line unique key — enables correct aggregation (F-14) |
| **`custrecord_se_device_id`** | Free-Form Text | Traceability + device fleet diagnostics |
| **`custrecord_se_client_ts`** | Date/Time | Time of scan on device (differs from server receipt when offline) |
| **`custrecord_se_server_ts`** | Date/Time | Server receipt time |
| **`custrecord_se_posted_txn`** | List/Record → Transaction | Resulting Item Fulfillment / Item Receipt / Adjustment. Empty for bin movements, which post nothing |
| **`custrecord_se_source_doc`** | List/Record → Transaction | **New (D-09)** — the PO / TO / Work Order being received against |
| **`custrecord_se_lot_expiry`** | Date | **New (D-09)** — captured at receipt; the source of all FEFO data |
| **`custrecord_se_posting_period`** | List/Record | **New (D-10)** — period derived from scan date, for the F-23 period control |
| **`custrecord_se_defer_count`** | Integer | **New (D-11)** — cycles deferred; escalates to exception past the configured limit |
| **`custrecord_se_retry_count`** | Integer | |
| **`custrecord_se_uom`** | List/Record | Only if UOM conversion is in scope (Q-07) |

**Indexes:** `custrecord_se_event_id` unique; composite search index on `(status, type, location)`
for the M/R input search — this table reaches ~350k rows at a 7-day retention.

## 3.2 `customrecord_wms_concurrency_lock`

| Field | Type | Notes |
|---|---|---|
| `custrecord_lock_resource_type` | List/Record | BIN, ORDER, LOT, **WAVE**. When `BIN`, `custrecord_lock_resource_id` holds a `customrecord_wms_bin` internal ID |
| `custrecord_lock_resource_id` | Free-Form Text | **UNIQUE — the acquire mechanism (AD-05)** |
| `custrecord_lock_acquired_by` | List/Record → Employee | |
| `custrecord_lock_acquired_time` | Date/Time | |
| **`custrecord_lock_expires_at`** | Date/Time | Reaper target |
| **`custrecord_lock_context`** | Free-Form Text | Script + deployment holding it, for diagnostics |

## 3.2b `customrecord_wms_bin_state` — **new (AD-03, per D-01)**

The operational truth of what is physically in a bin, including work not yet posted to the ledger.
One row per bin. Viable as a single tiny record precisely because of the 1-SKU/1-batch rule.

| Field | Type | Notes |
|---|---|---|
| `custrecord_bs_bin` | List/Record → `customrecord_wms_bin` | **UNIQUE** — one state row per bin |
| `custrecord_bs_item` | List/Record → Item | Current SKU, empty when bin is empty |
| `custrecord_bs_lot` | Free-Form Text | Current batch, empty when bin is empty |
| `custrecord_bs_qty` | Decimal | Current physical quantity |
| `custrecord_bs_version` | Integer | Monotonic; optimistic concurrency check |
| `custrecord_bs_last_event` | List/Record → Scan Event | Last event applied |
| `custrecord_bs_pending_delta` | Decimal | Quantity in accepted-but-unposted events |
| `custrecord_bs_last_reconciled` | Date/Time | Last agreement with `inventorybalance` |
| `custrecord_bs_putaway_ts` | Date/Time | **New (D-09)** — arrival time; the FIFO fallback for PLAIN items |
| `custrecord_bs_negative_since` | Date/Time | **New (D-11)** — when quantity first went negative; drives the age threshold |

> **No hard delete (D-07 / T-11.3).** Bin state rows are never deleted — an emptied bin has item,
> lot and quantity cleared and the row persists. Delete permission is removed from every role
> including administrator, so accidental deletion has no code path.

Read on every scan; written on every accepted scan. **This is the hot record in the system** — it
must be a single-record lookup by bin internal ID, never a search.

## 3.3 `customrecord_wms_bin` — bin master **(rewritten per D-07; corrects the former "Bin record — custom fields")**

**Bins are a first-class WMS record, not a NetSuite feature.** Under D-07 the NetSuite Bin Management
feature is off, so there is no native Bin record to hang custom fields off — the previous version of
this section was a leftover from before that ruling. The WMS owns the bin master outright. **Every
`→ customrecord_wms_bin` reference elsewhere in this document points here** (`custrecord_bs_bin`,
`custrecord_se_source_bin`, `custrecord_se_target_bin`, `custrecord_wave_stage_location`,
`custrecord_replen_unit_bin`, the replen-task bins in §3.5, and the `BIN` resource in §3.2).

| Field | Type | Notes |
|---|---|---|
| `name` | Text | Bin code, e.g. `A-01-03`. **UNIQUE** |
| `custrecord_wb_location` | List/Record → Location | NetSuite location the bin physically sits in |
| `custrecord_wb_type` | List/Record | **UNIT, BULK, STAGE, RECEIVING, QUALITY, RETURN, DEFECT** (AD-14 / F-18; Q-16 closed 2026-08-09) |
| `custrecord_wb_policy` | List/Record → `customrecord_wms_bin_policy` | Carries `singleSku`, `singleBatch`, `allowDirectPick`, `replenTarget` (AD-14) — validation loads policy, never a hardcoded type check (invariant #2) |
| `custrecord_wb_zone` | List/Record | Wave zone constraint (AD-10) |
| `custrecord_wb_pick_sequence` | Integer | Walk-path ordering (T-6.3) |
| `custrecord_wb_capacity` | Decimal | Optional; directed putaway uses it (T-5.4) |
| `custrecord_wb_blocked` | Checkbox | Excludes the bin from allocation (damage, count in progress, remediation) |
| `custrecord_wb_active` | Checkbox | Inactive bins are retained but never allocated |

> **Bin contents are NOT stored here.** SKU, lot and quantity live only in
> `customrecord_wms_bin_state` (§3.2b), the operational truth. This record is the *static master* —
> identity, location, type, policy, zone, walk order, capacity. Keeping the two apart is deliberate
> (invariant #1): never shadow the projection with a second, staler copy.

> **Dropped from the old section:** `custrecord_wms_bin_current_sku` and `_current_batch` — they
> duplicated bin_state and are gone entirely, not merely deprecated. The remaining old
> `custrecord_wms_bin_*` fields (type, policy, zone, pick_sequence, blocked) are re-homed onto this
> record with the `custrecord_wb_*` prefix.

## 3.4 `customrecord_wms_replen_profile`

Implied by Doc B §2.2 but never defined as a record. Explicit here.

| Field | Type |
|---|---|
| `custrecord_replen_unit_bin` | List/Record → `customrecord_wms_bin` |
| `custrecord_replen_item` | List/Record → Item |
| `custrecord_replen_trigger_qty` | Decimal |
| `custrecord_replen_optimum_qty` | Decimal |
| `custrecord_replen_bulk_zone` | List/Record |
| `custrecord_replen_active` | Checkbox |

## 3.5 `customrecord_wms_replen_task`

| Field | Type |
|---|---|
| `custrecord_rt_item` / `_source_bin` / `_target_bin` / `_lot` / `_qty` | as named; `_source_bin` and `_target_bin` are `List/Record → customrecord_wms_bin` |
| `custrecord_rt_status` | OPEN, ASSIGNED, IN_PROGRESS, COMPLETE, CANCELLED, **BLOCKED** |
| `custrecord_rt_priority` | Integer |
| `custrecord_rt_assigned_to` | List/Record → Employee |
| **`custrecord_rt_block_reason`** | Free-Form Text — carries the F-05 deadlock case |

## 3.6 `customrecord_wms_wave_pick`

| Field | Type | Notes |
|---|---|---|
| `name` | Text | e.g. WAVE-1001 |
| `custrecord_wave_orders` | Long Text | JSON array of order IDs |
| `custrecord_wave_assigned_picker` | List/Record → Employee | |
| `custrecord_wave_assigned_packer` | List/Record → Employee | |
| `custrecord_wave_stage_location` | List/Record → `customrecord_wms_bin` | |
| `custrecord_wave_status` | List/Record | Pending, Picking, **Staged_For_Packing**, Packing, Complete, **Cancelled, Exception** |
| **`custrecord_wave_zone`** | List/Record | |
| **`custrecord_wave_ship_by`** | Date | Clustering constraint |
| **`custrecord_wave_similarity_score`** | Decimal | Audit of why these orders grouped |
| **`custrecord_wave_line_count`** / **`_unit_count`** | Integer | Cart-capacity constraint |

> Status naming: Doc B §2.5 uses `STAGED_FOR_PACKING` while §4.1 lists `Staged`. Standardised on
> `STAGED_FOR_PACKING`.

## 3.7 `customrecord_wms_custody_log`

| Field | Type |
|---|---|
| `custrecord_custody_wave` / `_reassigned_from` / `_reassigned_to` / `_timestamp` / `_stage_bin` | as FRD; `_stage_bin` is `List/Record → customrecord_wms_bin` |
| **`custrecord_custody_action`** | HANDOFF, ACCEPT, **REJECT**, REASSIGN |
| **`custrecord_custody_tote_id`** | Free-Form Text |
| **`custrecord_custody_reject_reason`** | Free-Form Text |

## 3.8 `customrecord_wms_exception` — **new (AD-11)**

| Field | Type |
|---|---|
| `custrecord_exc_source_event` | List/Record → Scan Event |
| `custrecord_exc_type` | INVARIANT_VIOLATION, POST_FAILURE, SHORT_PICK, OVER_PICK, LOCK_TIMEOUT, RECONCILIATION_DRIFT, REPLEN_BLOCKED, STALE_LOCK, **UNATTRIBUTED_MOVEMENT, OVER_RECEIPT, RECEIPT_DISCREPANCY, NO_PUTAWAY_LOCATION, MISSING_LOT_DATA, SERIALISED_ITEM_OUT_OF_SCOPE, PO_LINE_MISMATCH, CLOSED_PERIOD_POSTING, COMMITMENT_EXCEEDED, DEFERRAL_TIMEOUT, NEGATIVE_BIN_STATE** |
| `custrecord_exc_severity` | LOW, MEDIUM, HIGH, CRITICAL |
| `custrecord_exc_status` | OPEN, IN_PROGRESS, RESOLVED, WRITTEN_OFF |
| `custrecord_exc_assigned_to` | List/Record → Employee |
| `custrecord_exc_resolution_action` | RETRY, REVERSE, MANUAL_ADJUST, WRITE_OFF, NO_ACTION |
| `custrecord_exc_resolution_notes` | Long Text |
| `custrecord_exc_detected_at` / `_resolved_at` / `_resolved_by` | as named |

## 3.9 `customrecord_wms_metric_snapshot` — **new (AD-12)**

| Field | Type |
|---|---|
| `custrecord_ms_interval_start` / `_interval_end` | Date/Time |
| `custrecord_ms_operator` | List/Record → Employee (blank = team-level row) |
| `custrecord_ms_lines_picked` / `_units_picked` / `_orders_packed` | Integer |
| `custrecord_ms_scans_total` / `_scans_error` / `_scans_override` | Integer |
| `custrecord_ms_active_task` / `_zone` | Text / List |

## 3.9b `customrecord_wms_bin_policy` — **new (AD-14)**

| Field | Type | Notes |
|---|---|---|
| `name` | Text | UNIT, BULK, STAGE, RECEIVING, QUALITY, RETURN, DEFECT (Q-16 closed 2026-08-09) |
| `custrecord_bp_single_sku` | Checkbox | |
| `custrecord_bp_single_batch` | Checkbox | |
| `custrecord_bp_allow_direct_pick` | Checkbox | True for BULK per D-03 |
| `custrecord_bp_replen_target` | Checkbox | True for UNIT only |
| `custrecord_bp_allow_putaway` | Checkbox | |
| **`custrecord_bp_available_for_fulfilment`** | Checkbox | **New (Q-16).** True for UNIT and BULK only. False bins hold physical stock that is not pickable until moved into UNIT/BULK — enforced in T-7.1, T-5.2, T-5.4; **not** filtered out of reconciliation (T-8.3). Surfaces F-26 |

Seeded per the AD-14 table. Changing the bulk-bin rule later is an edit here, not a code change.

## 3.10 `customrecord_wms_config` — **new**

Single-row settings record. Ends the F-16 threshold ambiguity and removes every magic number from
code: similarity threshold, max cluster size, cart tote capacity, SKU fan-out cap, lock TTL seconds,
M/R batch size, event retention days, replenishment scan interval, ingestion advisory-check toggle,
dashboard refresh seconds.

---

## Volume & retention

| Table | Daily rows | 7-day retention | Notes |
|---|---|---|---|
| Scan events | ~50,000–60,000 | ~400k | Archive/purge POSTED > N days (`T-11.1`) |
| Bin state | 1 per bin (fixed) | — | Hot read/write path; never archived |
| Waves | ~300–600 | — | Retain 90 days |
| Custody logs | ~600–1,200 | — | Retain per audit policy (Q-09) |
| Metric snapshots | ~1,500 (15-min × operators) | — | Roll up to daily after 30 days |
| Exceptions | target < 50 | — | Retain 12 months |

Archive strategy must be decided before go-live, not after: a purge of POSTED events destroys the
only record of *who scanned what* unless the archive target is defined first (Q-09).
