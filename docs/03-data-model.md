# 03 — Consolidated Data Model

Merges the schemas from Doc A §3 and Doc B §4, plus additions required by the review findings.
**Bold** rows are additions or changes to what the FRD specified.

## Location scoping (D-14)

The WMS is **multi-location from day one.** Every record that describes physical stock, physical work,
or an operator action **carries a mandatory Location** and every operational query filters by it:

| Record | Location field |
|---|---|
| `customrecord_wms_bin` (§3.3) | `custrecord_wb_location` |
| `customrecord_wms_bin_state` (§3.2b) | `custrecord_bs_location` *(denormalised from the bin)* |
| `customrecord_wms_scan_event` (§3.1) | `custrecord_se_location` *(captured at scan time; what the committer posts against)* |
| `customrecord_wms_replen_profile` / `_task` (§3.4/§3.5) | `custrecord_replen_location` / `custrecord_rt_location` |
| `customrecord_wms_wave_pick` (§3.6) | `custrecord_wave_location` *(a wave never spans locations)* |
| `customrecord_wms_exception` (§3.8) | `custrecord_exc_location` |
| `customrecord_wms_metric_snapshot` (§3.9) | `custrecord_ms_location` |
| `customrecord_wms_config` (§3.10) | global row + optional `custrecord_cfg_location` override |

**Deliberately location-agnostic — do not add a location:**
- `customrecord_wms_bin_policy` (§3.9b) — policy is a rule *by bin type*, identical in every warehouse.
- `customrecord_wms_operator` (§3.11) — operator *identity*; the location is a **per-session selection**
  (T-3.4), not a property of the person.
- `customrecord_wms_custody_log` (§3.7) — location is inherited from its wave (which is location-scoped).
- The **item cache** (AD-02, `WMS_ITEM_*`) and the **event-handler registry** (AD-15) — item tracking
  mode and handler descriptors are global.

---

## 3.1 `customrecord_wms_scan_event` — append-only event log

| Field | Type | Notes |
|---|---|---|
| **`externalid`** *(standard field)* | — | **= client UUID v4. Platform-enforced UNIQUE (D-12) — the primary idempotency guard (AD-04 layer 1).** Ingestion sets it and attempts the create; a duplicate fails at the platform |
| `custrecord_se_event_id` | Free-Form Text | Mirrors the UUID in `externalid` for convenient search/grouping (custom fields are easy to filter on). **Not itself unique** — the uniqueness lives on `externalid`. The committer groups by UUID as a dedupe safety net (AD-04 layer 2) |
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
| **`custrecord_se_location`** | List/Record → Location | **Mandatory.** Captured at **scan time from the operator's session** and stored on the event; it is **what the committer posts against.** It is **NOT** resolved at commit time and **NOT** read from the operator's currently-selected location at posting. *An event scanned offline in location A and synced while the operator stands in location B posts to A* (D-14, T-12.5 test). Also required for M/R grouping (F-13) |
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

**Idempotency key:** `externalid` = client UUID, **platform-unique** (D-12). `custrecord_se_event_id`
mirrors it, searchable, not unique. **Indexes:** composite search index on `(status, type, location)`
for the M/R input search — this table reaches ~350k rows at a 7-day retention.

> **One `externalid` per record = one platform-unique key.** A record type can enforce exactly one
> uniqueness rule via `externalid`; any *second* uniqueness rule on the same record falls back to
> script validation (D-12).

## 3.2 `customrecord_wms_concurrency_lock` — **DELETED (D-12)**

**This record is withdrawn (D-12) — rejected on simplicity, not impossible.** A lock *could* be built
on `externalid` (which is platform-unique), but the races it would guard are removed more cheaply:
order commits are serialised by AD-06 grouping + `PROCESSING` claiming; bin-affecting commit work is
single-threaded through one Map/Reduce queue (AD-05). So no lock record, no reaper, no `STALE_LOCK` /
`LOCK_TIMEOUT` exception types. Section retained as a tombstone so the deletion is traceable.

## 3.2b `customrecord_wms_bin_state` — **new (AD-03, per D-01)**

The operational truth of what is physically in a bin, including work not yet posted to the ledger.
One row per bin. Viable as a single tiny record precisely because of the 1-SKU/1-batch rule.

| Field | Type | Notes |
|---|---|---|
| `custrecord_bs_bin` | List/Record → `customrecord_wms_bin` | One state row per bin. **`externalid` = the bin identifier makes this platform-UNIQUE (D-12)** — a second state row for a bin cannot be created. The module still upserts by bin (read-then-write on the single settlement queue) |
| **`custrecord_bs_location`** | List/Record → Location | **New (D-14). Mandatory. Denormalised from the bin at create, never mutated.** Every operational query filters by location; a joined lookup through the bin on this hot record would violate invariant #1's spirit (a second read on the hottest path). **Do not "normalise" this away** — it is denormalised deliberately |
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
| `name` | Text | Bin code **prefixed with the location code** (D-14), e.g. `WH1-A-01-03`. **`externalid` = this location-prefixed code makes it platform-UNIQUE (D-12)** — no duplicate bin codes across locations |
| `custrecord_wb_location` | List/Record → Location | NetSuite location the bin physically sits in. **IMMUTABLE after creation (D-14)** — it is embedded in `name` and therefore `externalid`; re-pointing it would silently orphan the naming contract and every `custrecord_bs_location` copy. Relocating a bin = **deactivate-and-create-new**, permitted only when the bin is **empty** (`custrecord_bs_item` cleared, invariant #20) |
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

> **Why the location-code prefix on `name` (D-14).** The WMS is multi-location, and **bin codes may
> legitimately repeat between warehouses** (both `WH1` and `WH2` can have an `A-01-03`). The
> `<LOCATIONCODE>-<BINCODE>` prefix is what keeps `externalid` globally unique across locations — it is
> not cosmetic. Migration must enforce it: **two source bins that collapse to the same prefixed name
> fail the import, not overwrite** (T-0.4).

## 3.4 `customrecord_wms_replen_profile`

Implied by Doc B §2.2 but never defined as a record. Explicit here.

| Field | Type |
|---|---|
| **`custrecord_replen_location`** | List/Record → Location — **new (D-14), mandatory.** Source and target bins are both within this location; replenishment never crosses locations |
| `custrecord_replen_unit_bin` | List/Record → `customrecord_wms_bin` |
| `custrecord_replen_item` | List/Record → Item |
| `custrecord_replen_trigger_qty` | Decimal |
| `custrecord_replen_optimum_qty` | Decimal |
| `custrecord_replen_bulk_zone` | List/Record — zone name is location-scoped (may repeat across locations) |
| `custrecord_replen_active` | Checkbox |

## 3.5 `customrecord_wms_replen_task`

| Field | Type |
|---|---|
| **`custrecord_rt_location`** | List/Record → Location — **new (D-14), mandatory.** `_source_bin` and `_target_bin` must both resolve to this location |
| `custrecord_rt_item` / `_source_bin` / `_target_bin` / `_lot` / `_qty` | as named; `_source_bin` and `_target_bin` are `List/Record → customrecord_wms_bin` |
| `custrecord_rt_status` | OPEN, ASSIGNED, IN_PROGRESS, COMPLETE, CANCELLED, **BLOCKED** |
| `custrecord_rt_priority` | Integer |
| `custrecord_rt_assigned_to` | List/Record → Employee |
| **`custrecord_rt_block_reason`** | Free-Form Text — carries the F-05 deadlock case |

## 3.6 `customrecord_wms_wave_pick`

| Field | Type | Notes |
|---|---|---|
| `name` | Text | e.g. WAVE-1001 |
| **`custrecord_wave_location`** | List/Record → Location | **New (D-14), mandatory. A wave never spans locations** — clustering partitions by location before scoring (AD-10 / T-6.1). All its orders, bins and the stage bin are in this location |
| `custrecord_wave_orders` | Long Text | JSON array of order IDs |
| `custrecord_wave_assigned_picker` | List/Record → Employee | |
| `custrecord_wave_assigned_packer` | List/Record → Employee | |
| `custrecord_wave_stage_location` | List/Record → `customrecord_wms_bin` | Stage bin (in `custrecord_wave_location`) |
| `custrecord_wave_status` | List/Record | Pending, Picking, **Staged_For_Packing**, Packing, Complete, **Cancelled, Exception** |
| **`custrecord_wave_zone`** | List/Record | Zone name is **location-scoped** — may repeat across locations |
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

> **Location:** inherited from `custrecord_custody_wave` (waves are location-scoped, §3.6) and the
> stage bin — no own field needed (D-14).

## 3.8 `customrecord_wms_exception` — **new (AD-11)**

| Field | Type |
|---|---|
| `custrecord_exc_source_event` | List/Record → Scan Event |
| **`custrecord_exc_location`** | List/Record → Location — **new (D-14), mandatory.** So the exception queue can be filtered and worked by the warehouse that owns it |
| `custrecord_exc_type` | INVARIANT_VIOLATION, POST_FAILURE, SHORT_PICK, OVER_PICK, RECONCILIATION_DRIFT, REPLEN_BLOCKED, **UNATTRIBUTED_MOVEMENT, OVER_RECEIPT, RECEIPT_DISCREPANCY, NO_PUTAWAY_LOCATION, MISSING_LOT_DATA, SERIALISED_ITEM_OUT_OF_SCOPE, PO_LINE_MISMATCH, CLOSED_PERIOD_POSTING, COMMITMENT_EXCEEDED, DEFERRAL_TIMEOUT, NEGATIVE_BIN_STATE, CROSS_LOCATION_MOVE** *(LOCK_TIMEOUT, STALE_LOCK removed — locks withdrawn, D-12)* |
| `custrecord_exc_severity` | LOW, MEDIUM, HIGH, CRITICAL |
| `custrecord_exc_status` | OPEN, IN_PROGRESS, RESOLVED, WRITTEN_OFF |
| `custrecord_exc_assigned_to` | List/Record → Employee |
| `custrecord_exc_resolution_action` | RETRY, REVERSE, MANUAL_ADJUST, WRITE_OFF, NO_ACTION |
| `custrecord_exc_resolution_notes` | Long Text |
| `custrecord_exc_detected_at` / `_resolved_at` / `_resolved_by` | as named |

## 3.9 `customrecord_wms_metric_snapshot` — **new (AD-12)**

| Field | Type |
|---|---|
| **`custrecord_ms_location`** | List/Record → Location — **new (D-14), mandatory.** Metrics are location-scoped so a dashboard can show one warehouse |
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

> **Location-agnostic (D-14):** a policy is a rule *by bin type*, identical in every warehouse — no
> location field. (If one warehouse ever needs a different rule, that is a per-location *config*
> override (§3.10), not a per-location policy record.)

## 3.10 `customrecord_wms_config` — **new** *(global defaults + optional per-location override, D-14)*

Settings record removing every magic number from code: similarity threshold, max cluster size, cart
tote capacity, SKU fan-out cap, M/R batch size, event retention days, replenishment scan interval,
ingestion advisory-check toggle, dashboard refresh seconds, session-token TTL, rate-limit thresholds.
*(`lock TTL seconds` removed — locks withdrawn, D-12.)*

**Not a single global row (D-14).** There is a **global-defaults row** plus **optional per-location
override rows** (`custrecord_cfg_location` — blank on the global row, set on an override). **Precedence:
the location row wins field-by-field; a value absent on the location row inherits the global default.**
`getConfig(locationId)` in `wms_lib_config.js` (T-2.5) resolves this — never expose config as
global-only, or per-location cart capacity and thresholds (which genuinely differ between warehouses)
become impossible without a code change.

## 3.11 `customrecord_wms_operator` — **new (D-19)**

Operator auth for Option C — operators have **no NetSuite user** (Q-30). Login is validated against
this record; identity flows into `custrecord_se_operator` (→ Employee).

| Field | Type | Notes |
|---|---|---|
| `name` | Text | Operator display name |
| `custrecord_op_code` | Free-Form Text | Operator ID / badge value. `externalid` = this code makes it platform-UNIQUE (D-12) |
| `custrecord_op_employee` | List/Record → Employee | Links to the Employee record used for attribution (no login licence needed) |
| `custrecord_op_pin_hash` | Free-Form Text | **Hashed** PIN (salted). **Never plaintext** (T-3.3) |
| `custrecord_op_active` | Checkbox | Deactivating cuts the operator off; every API call checks it |
| `custrecord_op_role` | List/Record | Picker / Packer / Supervisor — drives on-device capability |
| `custrecord_op_allowed_locations` | Multi-select → Location | **New (D-14).** Which locations this operator may select at login. **Location is a per-session selection, not a property of the operator** — the record itself is location-agnostic (§ Location scoping). **WMS-ENFORCED (D-19 confirmed):** the Suitelet runs under one fixed Execute-As role, so per-operator authorisation is WMS-owned by definition — this list is validated at login and at session-token issuance (T-3.3), and the token carries the selected location. Not advisory |

> The PIN hash and the HMAC session-token secret (a script parameter) are the two secrets in the
> system. Neither is ever returned to the browser. See T-3.3 and F-27.

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
