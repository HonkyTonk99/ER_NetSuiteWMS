# 08 — Platform Facts (canonical NetSuite behaviour reference)

**Purpose.** One place for every verified NetSuite platform behaviour the design depends on, so nobody
re-derives, re-asks, or guesses. **Every other document cites a `PF-nn` id here instead of restating a
platform behaviour.** If a behaviour is not in this file, it has not been established.

**Provenance and trust.** These facts came from **NetSuite product documentation via a
documentation-grounded assistant** — *not* from the project's NetSuite developer and *not* from the live
account. Documentation describes the platform in general; it does not know this account's tier,
installed SuiteApps, features or preferences. Therefore:

- **`CONFIRMED`** = documented platform behaviour, safe to design against.
- **`SANDBOX-PENDING`** = must be proven in *this account's* sandbox before any code depends on it. A
  `SANDBOX-PENDING` row is a design input, not a settled fact; the Phase-0 sandbox-verification task
  (T-0.8) is where these are discharged, and **T-0.8/T1 gates Phase 1** for the ingestion-critical ones.

Account-specific unknowns that these facts *size against* (service tier, SuiteCloud Plus count, installed
SuiteApps, Multi-Book, OneWorld) are tracked as **Sheet C** questions in `04-open-questions.md`, not here.

---

## Concurrency, transport and governance

| # | Fact | Status | Depends on it |
|---|---|---|---|
| **PF-01** | The **Integration (SuiteCloud Plus) concurrency pool is account-wide**, shared by Suitelets-without-login, RESTlets and web services. Base limit by tier: **Standard 5, Premium 15, Enterprise 20, Ultimate 20**, **+10 per SuiteCloud Plus licence** (to tier maximums). | CONFIRMED (documented); the account's tier + licence count is **Sheet C** | F-29, T-3.2, T-0.2 |
| **PF-02** | A **Suitelet request has a 1,000-unit** governance budget. | CONFIRMED | F-29, T-3.1, T-12.1 |
| **PF-03** | A **Suitelet cannot set a non-200 HTTP status**; an application-level "busy" signal must travel in a **200 body**. | CONFIRMED | F-29, T-3.1, T-3.2 |
| **PF-04** | When the concurrency pool is exhausted, **NetSuite itself returns HTTP 429 with `EXCEEDED_MAX_CONCUR_RQST`** (no body of ours). Client must treat **both** the 200-body busy signal (PF-03) and a raw 429 as retry-with-backoff, never a failed event. | CONFIRMED | F-29, T-3.2 |
| **PF-05** | A **File Cabinet file marked Available Without Login is served without script execution, consumes ZERO integration concurrency, and is CDN-cacheable.** Checking **Generate URL Time Stamp** puts the last-modified timestamp in the URL (a cache-buster). | CONFIRMED | Q-35→D-27, T-3.2, T-3.4 (cache warm), D-13 update path |
| **PF-06** | `search.lookupFields` costs **1 unit**; **SuiteQL costs 10**. SuiteQL **enforces role permissions** — a least-privilege role may return **empty** where a broader role would not. | CONFIRMED | AD-19, hot-path queries, dashboards |

## Map/Reduce

| # | Fact | Status | Depends on it |
|---|---|---|---|
| **PF-07** | A **Scheduled** Map/Reduce deployment cannot run more often than **every 15 minutes**. | CONFIRMED | AD-20, invariant #1 lag window |
| **PF-08** | A Map/Reduce script can be triggered **on demand** via `task.MapReduceScriptTask`, passing `scriptId` and **omitting `deploymentId`** so NetSuite routes to an **idle** deployment. NetSuite **cannot submit while that deployment is already running**, so a **pool of `Not Scheduled` deployments** is needed for concurrency. | CONFIRMED | AD-20 |
| **PF-09** | **Yielding happens only between map/reduce invocations.** A single invocation exceeding its limit dies with **`SSS_USAGE_LIMIT_EXCEEDED`**. Per-stage limits: **map 1,000 u / 5 min; reduce 5,000 u / 15 min; getInputData & summarize 10,000 u / 60 min.** `getInputData` must emit **one unit of work per key/value** — never loop a batch inside one `map`/`reduce`. | CONFIRMED | committer design (Phase 4), T-4.x |
| **PF-10** | Persisted data **between stages** is capped at **200 MB total**; **key ≤ 3,000 chars; value ≤ 10 MB.** Exceeding it throws **`PERSISTED_DATA_LIMIT_FOR_MAPREDUCE_SCRIPT_EXCEEDED`** and **skips straight to `summarize`.** | CONFIRMED | committer chunking, group-key 3,000-char bound (T-2.6a) |

## Records, concurrency control and idempotency

| # | Fact | Status | Depends on it |
|---|---|---|---|
| **PF-11** | NetSuite throws **`RCRD_HAS_BEEN_CHANGED`** when a record changed between load and save (optimistic concurrency). | CONFIRMED | AD-03, bin-state write, invariant #1 |
| **PF-12** | **`record.load` + `record.save` costs 6 units** and runs record validation **including conflict detection**. **`record.submitFields` costs 2 units** but on an inline-editable field **bypasses validation and therefore bypasses conflict detection — it silently last-write-wins.** The bin-state write must use load+save. | CONFIRMED | AD-03, T-2.3, invariant #1 |
| **PF-13** | A duplicate **`externalid`** raises **`UNIQUE_RCRD_ID_REQD`**. This is the idempotency signal. **`DUP_CSTM_RCRD_ENTRY` is a *different* error** — a duplicate *name* when "Require Unique Names" is set on the record type — and **must not** be used as the idempotency signal. | CONFIRMED | AD-04, D-12, T-2.4 |

## Inventory, tracking and the ledger interface

| # | Fact | Status | Depends on it |
|---|---|---|---|
| **PF-14** | **Item tracking mode is the RECORD TYPE, not a field.** Six types: `inventoryitem`, `lotnumberedinventoryitem`, `serializedinventoryitem`, and the assembly equivalents `assemblyitem`, `lotnumberedassemblyitem`, `serializedassemblyitem`. The item cache resolves **`recordtype`** → PLAIN / LOT / SERIAL. | CONFIRMED | item cache (§3.x), AD-16/T-2.7 |
| **PF-15** | **`N/cache`**: TTL **≥ 300 s**; **no persistence guarantee** (early eviction under memory pressure); value **≤ 500 KB**; key **≤ 4 KB**. Needs a loader and must tolerate a cold miss on any call; a >500 KB payload must be chunked. | CONFIRMED | item cache, config cache |
| **PF-16** | Inventory detail is the **`inventorydetail` subrecord's `inventoryassignment` sublist**: **`receiptinventorynumber`** when stock enters, **`issueinventorynumber`** when stock leaves, plus **`quantity`**. **The NetSuite bin-number and destination-bin-number fields are not used** (Bin Management off — invariant #13 unaffected). **Standard mode works, including on a transformed record — dynamic mode is not required.** | CONFIRMED | T-2.7, AD-16, invariant #13 |
| **PF-17** | **Serial**: one `inventoryassignment` line per serial, **`quantity` exactly 1**. **Lot**: one line, **quantity may exceed 1 and may be fractional**. | CONFIRMED | T-2.7, T-9 (serial), lot handling |
| **PF-18** | **A single Item Fulfilment cannot span locations** — **one Item Fulfilment per (sales order, location)**. | CONFIRMED | AD-01, invariant #4, T-2.7 |
| **PF-19** | **`transferorder` → `itemfulfillment` transform is supported.** The **receipt transforms from the transfer order**, passing the **fulfilment id as an auxiliary reference** so costing links. **Partial line fulfilment/receipt is supported within a single subsidiary**; **`PARTIAL_FULFILL_RCEIV_DISALLWD` applies only cross-subsidiary.** Receipt is **capped at quantity fulfilled to date (`TRANSORD_SHIP_REC_MISMATCH`)** and **cannot precede fulfilment (`CANT_RCEIV_BEFORE_FULFILL`** — the code **F-30** keys on). | CONFIRMED (single-subsidiary); cross-subsidiary applicability is **Sheet C** (OneWorld) | D-22, F-30, T-2.7, T-5.6 |
| **PF-20** | **Inventory Transfer**: body `subsidiary`, `location`, `transferlocation`, `trandate`; lines `item`, `adjustqtyby`; lot/serial via `issueinventorynumber`. | CONFIRMED | T-2.7, RQD isolation (D-28) |
| **PF-21** | **Inventory Adjustment**: body `subsidiary`, `account`, `adjlocation`, `trandate`; lines `item`, **negative** `adjustqtyby`, `location`; lot/serial via `issueinventorynumber`. **`unitcost` is ignored on negative adjustments — do not compute it** (invariant #17). | CONFIRMED | T-2.7 |
| **PF-22** | **Core NetSuite permits negative inventory.** Prevention is a preference in the **Enhanced Validations and Defaulting SuiteApp (bundle 213294)**, which this account **may not have installed**. By tracking mode: **serial/lot items genuinely refuse** (`NOT_IN_INVT`, `NUM_ITEMS_GRTR_THAN_QTY`); **plain items post negative if not pre-checked.** | CONFIRMED (platform behaviour); **whether the SuiteApp is installed / Prevent Negative Inventory is on is Sheet C / SANDBOX-PENDING** | invariant #19, F-25, committer negative pre-check |
| **PF-23** | The **`inventorynumber` record is never deleted**; a serial string that leaves stock **becomes available for re-use**. So `externalid = item+serial` **collides on re-entry** — serial state needs a generation counter (see T-9 design). | CONFIRMED | serial handling (T-9), invariant #14 |

## Periods, features, preferences

| # | Fact | Status | Depends on it |
|---|---|---|---|
| **PF-24** | A script can **read `closed` on the `accountingperiod` record**, so a closed-period posting can be decided **in advance** (pre-check). The posting error, kept as a backstop, is **`CLOSED_TRAN_PRD`**. **Posting period derives from `trandate`; backdating within an *open* period is permitted** (so scan-time dating works); guard against **`DATEPERIODMISMATCH`** by aligning posting period to scan date. | CONFIRMED | invariant #16, F-23, T-11.4 |
| **PF-25** | **Multi-Book caveat:** with **Extended Accounting Period Close**, the shared `closed` flag is true only when the period is closed **in all books**, so a **partially-closed** period reads as open and the save still fails. If Multi-Book is enabled, the pre-check must inspect **book-specific** status. | CONFIRMED (behaviour); **whether Multi-Book is enabled is Sheet C** | F-23, T-11.4 |
| **PF-26** | **Automatic Location Assignment (`AUTOLOCATIONASSIGNMENT`) can reassign a line's location after order approval**, racing a wave the WMS already released. Mitigation is the **line-level `noautoassignlocation` flag**. | CONFIRMED (behaviour); the feature's actual on/off state is **SANDBOX-PENDING** | AD-21, new event type (T-2.6b), T-6.x |
| **PF-27** | Feature state is read via **`runtime.isFeatureInEffect`**: **`BINS`** (must be OFF), **`ADVBINNUM`** (OFF), **`MULTILOCINVT`** (ON), **`AUTOLOCATIONASSIGNMENT`** (record actual state — PF-26). | CONFIRMED (API); each feature's **actual state is SANDBOX-PENDING** | startup assertion (T-0.9) |
| **PF-28** | Preferences read via **`config.load({ type: config.Type.COMPANY_PREFERENCES })`**: **`ALLOWPERLINELOCATIONS`** (must be ON), **`CENTRALIZEPURCHASING`** (must be OFF — when ON, NetSuite forces all receipts into one location and the receiving design breaks silently), and **"Allow Transaction Date Outside of Posting Period"** (must permit). **A wrong/unknown preference id reads as nothing and must fail loudly as a config error, not be read as "disabled".** | CONFIRMED (API); **the exact preference identifiers are SANDBOX-PENDING** | startup assertion (T-0.9) |
| **PF-29** | **A script deployment record cannot be edited while that script is executing.** A continuously-running committer therefore **cannot be reliably switched off at the deployment record** during an incident — the kill switch must be a **config-record flag** read at the start of every execution. | CONFIRMED | AD-22 (kill switch), C4, T-0.2 config |
| **PF-30** | Custom record types **scale to millions of rows**; **non-indexed filters degrade first**. An **`Indexed`** setting is reported on a custom field's **Validation & Defaulting** tab, with an SDF equivalent. | Row scaling CONFIRMED; **the `Indexed` setting's existence and SDF representation is SANDBOX-PENDING** | T-18 retention/archiving, hot-path index CI check |

---

## SANDBOX-PENDING roster (must be proven before code depends on them)

| Item | Where proven | Blocks |
|---|---|---|
| Enhanced Validations SuiteApp installed / Prevent Negative Inventory on (PF-22) | T-0.8 + Sheet C | whether the WMS negative pre-check is the *only* control or has a backstop (invariant #19) |
| `AUTOLOCATIONASSIGNMENT` actual state (PF-26/PF-27) | T-0.8 / T-0.9 | AD-21 line-freezing event necessity |
| Feature states `BINS`/`ADVBINNUM`/`MULTILOCINVT` (PF-27) | T-0.9 (startup assertion) | ingestion + boundary assumptions |
| Exact preference identifiers `ALLOWPERLINELOCATIONS`/`CENTRALIZEPURCHASING`/date-outside-period (PF-28) | T-0.8 (T6) + T-0.9 | receiving design, closed-period pre-check |
| `Indexed` field setting + SDF representation (PF-30) | T-0.8 (T4) | hot-path index assertion + CI check (T-18) |
| Available-Without-Login Suitelet with Execute-As-Role creates a custom record when called logged-out | **T-0.8 (T1) — gates all of Phase 1** | the entire ingestion architecture |

> **T-0.8 (T1) runs first and nothing in Phase 1 starts until it passes.** Cross-referenced from
> `04-open-questions.md` (Sheet C) and `tasks/phase-0-2-foundation.md`.

---

## Deferred design recorded (do not build now)

**Serial state needs a generation counter (from PF-23).** Serial is **out of scope (D-08)**, so this is
**not built now** — recorded here so the design is not lost if serial ever enters scope. Because the
`inventorynumber` record is never deleted and a retired serial string becomes re-usable (PF-23),
`externalid = item+serial` **collides on re-entry**. The design:

- **One permanent row per `(item, serial)`**, carrying a **status** and an integer **generation
  counter**. No hard delete, ever.
- **Re-entry of a retired serial reactivates the existing row and increments the generation** — it never
  inserts a second row.
- **Movement history keys on `(row, generation)`** so prior lifecycles stay legible and separate.
- **Acceptance (when built):** retire then re-receive the same serial → **one row, generation
  incremented, prior history intact and attributed to the earlier generation.**

Owner note: this becomes a real task only if D-08 is revisited; until then it is a recorded intention.
