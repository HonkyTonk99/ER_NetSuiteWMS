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
a Suitelet, D-13, so its API is a sibling Suitelet, same origin; GET serves the SPA, POST is this API,
D-19 confirmed). POST accepting the scan payload (uuid,
eventType, operatorId, waveId, orderId, orderLineKey, skuCode, batchNumber, sourceBinId, targetBinId,
qty, locationId, deviceId, clientTs) plus the **device credential (D-21)** and the **HMAC session
token** (T-3.3). Flow: **device credential check (D-21) — the FIRST operation, before any record load,
on a cheap path** → **concurrency admission (F-29)** → validate token
(T-3.3) → schema validation → resolve item/bin metadata from cache → read bin state projection (T-2.3)
→ apply bin policy (T-2.3b) → **cross-location check (D-14)** → `writeScanEvent` (sets `externalid` = UUID,
and `custrecord_se_location` = the **session location**) → update projection → return.
**No saved search on the success path. No `record.transform`. No inventory posting. No lock.**

**Device auth is the first gate (D-21).** An unknown or revoked device is rejected **before any cache or
projection read**, on a path that consumes minimal governance — so a hostile flood cannot make the
endpoint do expensive work. Device identity (transport credential) is separate from operator identity
(badge/PIN in the payload → `custrecord_se_operator`); do not merge them.

**Concurrency admission (F-29).** When the shared pool is saturated the Suitelet returns a
**distinguishable *busy* response** (e.g. HTTP 429-equivalent code); the client treats it as
**retry-with-backoff**, never as a failed event. **A concurrency rejection is NOT an exception** — it
never creates a `customrecord_wms_exception` and never marks an event FAILED.

**Cross-location movement is forbidden (D-14).** For any move event (BIN_TRANSFER / REPLEN_MOVE /
PUTAWAY), if the source and target bins resolve to **different locations**, reject with
`ERR_WMS_CROSS_LOCATION_MOVE`, create **no** event, mutate **no** bin state on either side, and raise a
`CROSS_LOCATION_MOVE` exception. Inter-location movement is a NetSuite Transfer Order received through
the inbound path at the destination — never a WMS bin transfer. The event's location comes from the
operator's session, from the cache; it is not trusted from the payload alone.
**Client version compatibility — drain always, new work gated (D-13, D-25).** The payload carries a
**client version**. **A queue drain (POST of already-scanned events) is always accepted while the event
*schema* version is supported** — those events are physical stock movements that already happened, and
refusing them would lose inventory truth with no recovery (invariant #19). **Only *new work* is gated:**
requests for **new tasks or cache warms** from a too-old client are refused with
`ERR_WMS_CLIENT_UPDATE_REQUIRED` so the app forces a shell refresh. The rule is one-directional: the
server may add optional fields without breaking older clients; a breaking change bumps the required
version (T-3.4). A stale client therefore **flushes its queue, then updates** — it never fails closed on
the ingest path.
**Idempotency (AD-04):** a duplicate UUID fails at the platform on `externalid` and returns
`idempotent:true` — plus the committer dedupe safety net. Structured JSON responses for success,
idempotent-duplicate, auth failure, validation failure, **client-update-required** and platform error,
each with a machine-readable code. Structured logging of execution time. Support an optional **batch payload** (array of events) so
the client can drain its queue in fewer round-trips — a direct mitigation for F-09.

**Acceptance**
- [ ] GIVEN a valid scan payload with a valid session token, WHEN posted, THEN a PENDING scan event is created and a success response returns; measured server time P95 < 600 ms and P99 < 1200 ms under the Phase 12 load profile.
- [ ] GIVEN the PWA and the API are both Suitelets, WHEN the browser POSTs, THEN the call is **same-origin** (no CORS preflight).
- [ ] GIVEN a payload violating bin isolation, WHEN posted, THEN no event is created and the response carries `ERR_WMS_BIN_CONSTRAINT_VIOLATION` with the conflicting item and lot in the message.
- [ ] GIVEN a transfer event whose source and target bins resolve to **different locations**, WHEN posted, THEN it is rejected with `ERR_WMS_CROSS_LOCATION_MOVE`, **no event is created, and bin state is mutated on neither side**; a `CROSS_LOCATION_MOVE` exception is raised. *(D-14)*
- [ ] GIVEN a duplicate UUID, WHEN posted, THEN the create fails at the platform on `externalid` and the response is `SUCCESS` with `idempotent:true` — exactly one row exists.
- [ ] GIVEN a POST with a missing or revoked **device credential**, WHEN posted, THEN it is rejected as the **first** operation, before any cache/projection read, and governance consumed is minimal (measured). *(D-21)*
- [ ] GIVEN the shared concurrency pool is saturated, WHEN a POST arrives, THEN it receives the **busy** response and the client retries with backoff; **no event is created, no exception is raised, nothing is marked FAILED**. *(F-29)*
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

*PWA persistence primitives (D-13).* The handheld is a **responsive PWA served from NetSuite**
(D-13, Q-01 closed), so the durable storage below is browser storage, named concretely:
- **`IndexedDB` holds both the local master-data cache and the durable outbound queue** — it survives
  app kill and battery pull, which `localStorage`/in-memory state do not.
- **`navigator.storage.persist()` is requested** to protect that store against eviction under storage
  pressure.
- **A service worker caches the static app shell only** (JS/CSS/assets, for the warm-load and offline
  reload path) — it does **not** cache master data. The per-location master-data warm goes through the
  **throttled** GET/POST path (F-29), never the service-worker cache; do not conflate the two.
- **Residual risk, accepted in writing (D-13):** there is **no background sync while the app is not
  foregrounded**, and the store can still be **evicted if `persist()` is denied**. Accepted because an
  operator who is actively picking has the app open, so the queue drains as they work; mitigated by the
  persistent on-screen unsynced count and the hard-block on queue depth/age below. *(If a per-device
  credential (D-21/T-3.6) is stored in this same evictable store, its provisioning flow must tolerate
  eviction — see T-3.6.)*

*Local cache — scoped to the selected location (D-14):* on sync, the device pulls the resolved data
needed to validate every scan the operator could plausibly make this shift **in the selected
location** — assigned tasks, and the item, and the **bin, bin-policy, zone, pick-sequence and open-work
subsets for that location**. Resolved and pushed by the server, not fetched on demand. A scan that
cannot be validated locally is a design failure, not a runtime condition. Cache carries a staleness
limit and a sync token.

*Serial cache is scoped to the WAVE, not the location (D-29); its size is a config value (D-34).* Caching
every serial in a warehouse is unbounded and would wreck the T-3.4 budget. Caching the serials for the
**bins in the operator's assigned wave** is bounded (tens of bins) and preserves **offline** serial
validation. **The cache size is a `customrecord_wms_config` value (D-34)** so the design holds at up to
100% serialised without a code change — so **invariant #11 holds
with no new exception.** Serial cache warm happens **at wave assignment**, is **scoped to that wave's
bins**, and is **discarded on wave completion.** Event payloads (`PICK`, `PUTAWAY`, `BIN_TRANSFER`, the
receipt types) carry a **serial array**; the client validates offline that **count == quantity, every
serial resolves, and no serial already sits elsewhere** (invariant #21) before enqueuing.
**Offline nuance (§3.13b):** with only the wave's serials cached, the handheld **cannot tell "unknown
serial" from "valid serial not in this wave"** — so **offline it reports *"not expected in this wave"*,
never `SERIAL_UNKNOWN`.** Definitive classification (unknown vs elsewhere) happens at **ingest**, where the
full serial state is available. `SERIAL_COUNT_MISMATCH` is caught **at the handheld** (submission blocked);
the server re-validates as a backstop.

*Staleness refresh vs in-progress work (D-13).* A staleness refresh (or a background re-warm) replaces
**reference data only** — item, bin, policy, zone, pick-sequence subsets. It **must not discard
in-progress operator work**: the durable outbound queue and the operator's current-task state (position
in the task, quantities already entered) survive a refresh untouched. A refresh that would orphan a task
the operator is mid-way through (e.g. the wave was reassigned server-side) does **not** silently wipe it
— it routes through the same reconnect-reconciliation path as any stale event (T-3.5). Only a **location
switch** (D-14/D-20) is a full purge, and that is an explicit operator action, never an implicit refresh.

*Location switch (D-14, D-20):* selecting a different location is a **full purge and re-warm of the
cache, not a delta**. **A switch requires connectivity** — the **one sanctioned exception to
offline-first (invariant #11, formalised as D-20)**. It is **atomic**: if connectivity drops mid-warm,
the app **keeps the previous location and its cache intact** and reports failure — a **half-warmed cache
is a defect, not a degraded state**. An **offline switch attempt is refused cleanly** with an
operator-readable message, **never queued**. Assume **one location per session** (register Q-31);
switching is an explicit action, not implicit.

*Outbound queue — not purged on location switch (D-14):* durable, FIFO, survives app kill and battery
pull. UUID stamped at creation, never regenerated on retry. **Queued events keep the location they were
scanned under** — an event scanned offline in location A and synced while the operator has since
switched to location B still posts to **A** (T-3.1 stamps `custrecord_se_location` at scan time). The
queue is **never** purged on a location switch. Exponential backoff with jitter. HTTP 429 /
`SSS_REQUEST_LIMIT_EXCEEDED` treated as a normal throttle signal — back off, continue, never drop.

*Batch drain and per-event acknowledgement (sync protocol):* reconnection sends through the batch
endpoint in few round-trips. A device back from 40 minutes offline must **not** emit 200 individual
requests into the concurrency budget. **The batch response is a per-event result array (T-3.1), and the
client reconciles it against the queue by UUID:** an event is removed from the queue **only** when its
own result comes back `SUCCESS` or `idempotent:true`; a `retryable` result stays queued for the next
drain; a terminal `validation`/`auth` failure is moved to a **local dead-letter** (surfaced to the
operator, never silently dropped). A partial-batch outcome (some succeed, some fail) therefore prunes
**exactly** the acknowledged events — never the whole batch, never nothing. Because the UUID is the
idempotency key (AD-04), re-sending an un-acknowledged event that *did* in fact land is harmless.

**Concurrency-pool constraints — binding (F-29, D-19).** The endpoint shares the account's
RESTlet/web-services pool; two burst modes (reconnect flush across all devices; shift-start cache warm)
must be throttled or they starve scan ingestion:
- **Batched POSTs — N events per request, not N requests.** Max batch size is a
  `customrecord_wms_config` value **bounded by the 1,000-unit/request governance budget with headroom**;
  T-12.1 **measures and records the actual governance units per event** so the bound is real. **At high
  serial share the batch is also bounded by the 10 MB Map/Reduce value limit (D-34/PF-10)** — a serialised
  line is one event carrying N serials, so payload *size*, not only governance units, can be the binding
  constraint.
- **One in-flight request per device, ever** — the client never has two POSTs outstanding.
- **The cache warm is served off the pool as a File Cabinet file (Q-35→D-27, PF-05).** The per-location
  reference payload is a **File Cabinet Available-Without-Login file**, regenerated by a scheduled script,
  downloaded by the device — **served without script execution and consuming ZERO integration concurrency**.
  This is the **required** design, not an optimisation: at the F-29 pool sizes (PF-01) the shift-start
  burst is otherwise unsurvivable. Versioning via **Generate URL Time Stamp** (cache-buster), aligned with
  the D-13 app-update path. Jittered reconnect still applies to the **POST drain**.
- **Two rejection paths, both retry-with-backoff, neither a failed event (PF-03/PF-04).** A Suitelet
  cannot set a non-200 status, so the app-level *busy* signal rides in a 200 body; NetSuite itself returns
  **HTTP 429 `EXCEEDED_MAX_CONCUR_RQST`** with no body when the pool is exhausted. The client treats both
  the same. A concurrency rejection must **never** surface as an exception or a lost scan (T-3.1).

Persistent on-screen unsynced count and oldest-unsynced age. Hard-block only on configured depth or
staleness limits, with a supervisor-visible reason.

**Acceptance**
- [ ] GIVEN the device is in airplane mode for a full 45-minute pick run, THEN the operator completes every task with no functional difference from online operation.
- [ ] GIVEN 200 events queued offline, WHEN connectivity returns, THEN they sync via batched requests in under 10 round-trips with no duplicates and no loss.
- [ ] GIVEN a batch where some events succeed and some return `retryable`, WHEN the response is processed, THEN **exactly** the acknowledged (`SUCCESS`/`idempotent`) events are pruned by UUID and the `retryable` ones stay queued — never the whole batch, never nothing. *(per-event ack, D-13)*
- [ ] GIVEN an event that returns a terminal `validation`/`auth` failure, THEN it moves to a local dead-letter surfaced to the operator, and is never silently dropped.
- [ ] GIVEN a staleness refresh or background re-warm while the operator is mid-task, THEN reference data updates but the durable queue and the operator's in-progress task state are preserved (only a location switch purges). *(D-13)*
- [ ] GIVEN a wave assignment, THEN the serial cache warms only for that wave's bins (bounded), a serialised scan validates offline (count==qty, resolves, not elsewhere), and the serial cache is discarded on wave completion. *(D-29; invariant #11 holds)*
- [ ] GIVEN the app is force-killed with a non-empty queue, WHEN it restarts, THEN the queue is intact and drains (IndexedDB-backed, D-13).
- [ ] GIVEN `navigator.storage.persist()` is **denied**, THEN the app still functions, warns that storage is best-effort, and the unsynced-count / hard-block controls remain the safety net — the accepted D-13 residual is handled, not ignored.
- [ ] GIVEN the network is fully offline, WHEN the app is reloaded, THEN the **service-worker-cached shell** brings it back up, and it operates against the **IndexedDB** cache — while the master-data warm (which needs connectivity) is not served from the service worker. *(D-13; shell ≠ data)*
- [ ] GIVEN the server returns 429 for 30 s, WHEN the client drains, THEN it backs off with jitter and all events post exactly once.
- [ ] GIVEN a device draining a queue, THEN it has **at most one request in flight** and sends events **batched** (≤ the config max), never one request per event. *(F-29)*
- [ ] GIVEN the whole floor reconnecting or warming caches at shift start, THEN client-side jitter spreads the requests so no synchronised spike hits the pool. *(F-29)*
- [ ] GIVEN the local cache exceeds its staleness limit, THEN the operator is warned and, past the hard limit, blocked with a supervisor-visible reason.
- [ ] GIVEN queue depth exceeds the configured limit, THEN the operator is blocked with a clear message visible to a supervisor.
- [ ] GIVEN the operator switches location, THEN the cache is fully purged and re-warmed for the new location (not a delta), and the switch requires connectivity — offline, the switch is refused cleanly with an operator-readable message, not queued. *(D-14/D-20)*
- [ ] GIVEN connectivity drops **mid-warm** during a switch, THEN the app keeps the **previous** location and its cache intact and reports failure — no half-warmed state, and the outbound queue is untouched. *(D-20)*
- [ ] GIVEN an event queued offline in location A and a subsequent switch to location B, WHEN the queue drains, THEN the event posts to **A** and the queue is not purged by the switch. *(D-14)*

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

**Device authentication is a SEPARATE concern (D-21), designed in T-3.6.** T-3.3 proves *who is
scanning* (operator badge/PIN → `custrecord_se_operator`); it does **not** prove *which device* is
talking to the endpoint. The per-device credential (issued at provisioning, checked first, revocable,
rate-capped) is D-21 / T-3.6 — **do not merge device identity into the operator/session-token model
here.** `custrecord_op_allowed_locations` is **WMS-enforced** (D-19 confirmed — one fixed Execute-As
role): validate the selected location against it at login and bind it into the session token.

**Acceptance**
- [ ] GIVEN a POST with **no or an invalid session token**, THEN it is rejected and **no event is created** *(the required negative test)*.
- [ ] GIVEN a login selecting a location **not** in the operator's `allowed_locations`, THEN it is refused; the issued token binds only an allowed location. *(D-14/D-19)*
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
Screens: login/shift start **(includes location select, D-14)**, task list, directed pick (bin → SKU →
lot → qty), replenishment move, bin transfer, putaway, short pick, stage/handoff.
**Site select at login (D-30):** the operator picks a **site** (a physical building), not a bare
NetSuite location. **Cache warm covers every NetSuite location at that site (D-30)** — so the holding/RQD
location's bins **are reachable** by the operator who walks to them, without a second login. **But the
session defaults to an OPERATIONAL location — never a HOLDING one (D-30).** The holding location is
reachable when an operator physically works there (e.g. an RQD isolation or a defect giveaway), not as the
default context. The scan's location is still resolved per bin (a bin belongs to exactly one location,
D-14/D-30) and stamped onto every scan (T-3.1). **One site per session** (Q-31, restated for sites);
switching sites is an explicit action that triggers a full purge + re-warm and needs connectivity. A
visible indicator shows the current site (and the active location) at all times.
 Local validation against a cached task list so
success renders in < 150 ms. Explicit sad paths: wrong bin scanned, wrong SKU, wrong lot, insufficient
quantity, unknown barcode. Large-touch-target, glove-friendly layout.

**Responsive across desktop, tablet and phone — same operations (D-24).** The supported surface is
**desktop, tablet and phone**, and **capability is identical** on all three — a desktop user and a
handheld user perform the **same operations** (the desktop is **not** a read-only or supervisor-only
view unless the sponsor rules otherwise). What changes across breakpoints is **layout and density, not
capability**:
- **Phone (portrait, ≈ ≤ 640 px):** single column, one primary action per view, largest touch targets,
  card layout — the glove-friendly handheld experience.
- **Tablet (≈ 641–1024 px):** two-pane (task list beside the active task), medium density, touch-first.
- **Desktop (≈ ≥ 1025 px):** multi-column with denser tables and keyboard-first entry (scan fields still
  accept a wedge); the same task flows, more visible at once.

The **rugged-Android portrait handheld is the *primary target* for the performance budget and field
testing** (see the SPA budget below and T-12.5) — that names the device that must feel fast; it does
**not** narrow the supported surface. *(If this responsive requirement is ever judged unaffordable, it is
raised as a flagged conflict with a cost — never resolved silently. D-24.)*

**Scanner input path.** The **primary scan input on every surface is a hardware imager acting as a
keyboard-wedge** (HID keystrokes terminated by a configurable suffix), read through a focused hidden
input with a per-screen scan-to-field mapping; barcode symbologies are enumerated per screen. **Whether
a camera-based scan path is *also* required is an open sponsor question (Q-48)** — it is a live
dependency of phone support (a phone operator may have no wedge hardware, in which case camera is the
only input path), **not** something scoped out here. Keyboard-wedge remains the primary path regardless
of how Q-48 resolves.

**Storage model (D-13, detail in T-3.2).** The cached task list, master-data cache and durable outbound
queue live in **IndexedDB** (protected by `navigator.storage.persist()`); a **service worker caches the
static shell only** — it powers the warm-load and offline-reload path but never holds master data. The
accepted D-13 residual (no background sync when un-foregrounded; possible eviction if `persist()` is
denied) is carried in T-3.2, not re-litigated here.

**Operator-facing state.** The screen persistently shows: **connectivity (online / offline)**, the
**unsynced-event count and oldest-unsynced age** (T-3.2), the **current location** (D-14), and any
**hard-block reason** in supervisor-readable terms. **The committer's `DEFERRED` status is NOT shown to
the operator (F-25/invariant #19).** A `DEFERRED` posting is legitimate work in the wrong sequence,
retried server-side — the operator was already acknowledged optimistically at scan time and did nothing
wrong. Only two things reach the operator about a synced event: a **local dead-letter** for a terminal
`validation`/`auth` rejection (T-3.2), and a **reconnect *conflict*** (T-3.5). `DEFERRED` is neither —
surfacing it would train operators to re-scan correct work. It stays in the committer and, if it exceeds
its retry budget, becomes a **supervisor** exception (`DEFERRAL_TIMEOUT`, T-4.7), never an operator one.

**App update path and client/Suitelet version compatibility (D-13, D-25).** A service-worker-cached
shell can strand an operator on a stale client. Requirement:
- (a) the service worker uses a **cache-versioned, update-on-reload** strategy — a new shell is fetched
  in the background and activated on the next **safe reload, never mid-task**;
- (b) **the version check is split so a stale client can never strand a queue (D-25).** Every request
  carries a **client version**. **Draining the outbound queue is always permitted while the event
  *schema* is supported** — those events are stock that already physically moved; refusing them loses
  inventory truth with no recovery. The endpoint gates **new work only**: it refuses to issue **new
  tasks or cache warms** to an out-of-date client with `ERR_WMS_CLIENT_UPDATE_REQUIRED`, and the app
  tells the operator to update. Drain first, block forward work;
- (c) the compatibility rule is **one-directional** — the server may add optional fields without
  breaking older clients; a breaking change bumps the required version.

An **offline** device on an old version keeps working against its cache, **flushes its queue on
reconnect**, and is updated on its next safe reload — the update path never blocks offline picking or
queue drain.

**The served bundle carries NO secrets (D-19).** The GET response is **public** (Available-Without-Login).
It must contain **no account identifiers, no role hints, no internal URLs, and no configuration beyond
what a public page may carry.** The HMAC secret, PIN hashes and device credentials never reach the
browser; the app obtains only a session token *after* login. Verified by inspecting the shipped bundle.

**SPA performance budget (stated ceilings, agreed with the sponsor).** The PWA is served from NetSuite
and first-loaded over warehouse Wi-Fi on the **rugged Android device — the primary target for this
budget and field testing (D-24), not the limit of the supported surface** (desktop/tablet/phone are all
supported). The login-and-warm-up experience is governed by this budget. Measure on the target device,
not a developer laptop:
- **JS/CSS bundle ≤ 500 KB gzipped** (app shell); assets lazy-loaded beyond that.
- **Cold first load (empty cache) to interactive ≤ 3 s** over representative warehouse Wi-Fi.
- **Login → cache warmed → first task actionable ≤ 10 s** — this is the **per-location** warm (D-14),
  and a **location switch re-incurs it** (full purge + re-warm, not a delta). Budget applies to the
  largest in-scope location's data volume.
- **Warm load (service-worker cached shell, D-13) ≤ 1 s** — shell only; master data still loads from
  the IndexedDB cache or a connected warm.
These are the agreed ceilings; regressions past them fail the build (measured in T-12.5).

**Acceptance**
- [ ] GIVEN a directed pick task, WHEN the operator scans the correct bin, SKU, lot and quantity, THEN the UI confirms and advances in < 150 ms measured on the target device.
- [ ] GIVEN the operator scans a bin other than the directed bin, THEN the app blocks with a clear message and does not enqueue an event.
- [ ] GIVEN the operator cannot find the stock, WHEN they select short pick, THEN a SHORT_PICK event is enqueued with quantity found and reason.
- [ ] GIVEN the target device over warehouse Wi-Fi, THEN bundle size, cold first-load, warm-load and login-to-first-task are measured and all within the stated budget.
- [ ] GIVEN 30 minutes of continuous use, THEN no memory growth or degradation is observed on the target device.
- [ ] GIVEN the shipped public GET bundle is inspected, THEN it contains no account identifiers, role hints, internal URLs, secrets or configuration beyond what a public page may carry. *(D-19)*
- [ ] GIVEN a scan event whose commit later goes `DEFERRED` (F-25), THEN the operator's app shows **nothing** about it — no error, no re-scan prompt; it is retried server-side and escalates only to a **supervisor** on `DEFERRAL_TIMEOUT`. *(D-13/invariant #19)*
- [ ] GIVEN the same task flow run on a **phone, a tablet and a desktop**, THEN the **operations are identical** — every action available on one is available on the others; only layout and density differ across the breakpoints. *(D-24)*
- [ ] GIVEN a site with an operational and a holding (RQD) location, WHEN the operator logs in, THEN the picker lists **all** the site's locations (RQD bins reachable) but **defaults to the operational location, never the holding one**. *(D-30)*
- [ ] GIVEN a hardware-imager scan (keyboard-wedge) on each screen and surface, THEN it maps to the correct field via the per-screen mapping; **whether a camera scan path is also required is tracked as Q-48**, not assumed absent. *(scanner input path)*
- [ ] GIVEN a new app version is deployed, WHEN a foregrounded device reloads, THEN it activates the new shell on a safe reload (never mid-task); an offline device keeps working and updates on its next connected reload. *(app update path)*
- [ ] GIVEN a client on the **previous version holding queued events**, WHEN it reconnects, THEN it **drains its queue successfully** and is **then refused new work** with an operator-readable "update required" message — the queue is never stranded. *(D-25, T-3.1)*

---

### T-3.6 — Device credential design *(stub — D-21)*
**Depends on:** T-3.3 · **Implements:** D-21 · *(new 2026-08-09 — requirement recorded, design deferred to Phase 3)*

**Narrative**
As a security owner, I want every device individually identified and revocable, so that the public
ingest endpoint cannot be driven by anything the fleet does not include.

**Requirement (recorded per D-21; the mechanism is Phase 3 design work, NOT specified here).** A
**per-device credential** issued at provisioning, **checked as the first operation in the POST handler
before any record load** (T-3.1), on a **cheap rejection path** that consumes minimal governance;
**revocable per device**; with a **per-device rate cap** (distinct from F-29's per-token/per-IP caps).
**Device identity is separate from operator identity (D-21)** — a transport credential, not the
badge/PIN. Design choices to make in Phase 3: credential type and storage on rugged Android, rotation,
revocation propagation, and how the cheap-reject path avoids cache/projection reads. **Storage must
tolerate the D-13 residual** — if the credential lives in the same evictable browser store as the
cache/queue (IndexedDB), an eviction or a denied `persist()` must degrade to a clean **re-provisioning**
path, never a silently dead device.

**Acceptance** *(placeholder — completed when the mechanism is chosen)*
- [ ] GIVEN the design, THEN a credential type, provisioning, rotation and revocation flow are documented and reviewed.
- [ ] GIVEN a revoked device, WHEN it POSTs, THEN it is rejected first, cheaply, before any record load (measured).

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
> field writes of its own, and no bin-number field anywhere.

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
means no interleaving. **Re-assert the cross-location invariant (D-14): if a move's source and target
bins resolve to different locations, do not post — raise a `CROSS_LOCATION_MOVE` exception** (ingestion
should already have blocked it at T-3.1, but the committer re-checks like every other invariant, F-03).
Re-check the target bin's policy against the projection, then reconcile the
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
- [ ] GIVEN move events in two different locations (each move within its own location), WHEN the M/R runs, THEN each settles in WMS bin state under its own location and **no NetSuite transaction is created** (bin moves post nothing, D-07) — corrects a pre-D-07 acceptance that expected a "Bin Transfer" record.
- [ ] GIVEN a **cross-location** move event that reached commit, WHEN the committer re-asserts (D-14), THEN it is **not posted**, bin state is mutated on neither side, and a `CROSS_LOCATION_MOVE` exception is raised.
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
`optimum_qty − current_qty`, **stamping `custrecord_rt_location` from the profile (D-14) — source and
target bins are both within that one location; replenishment never crosses locations.** **Suppress
duplicates** — do not raise a second task for a bin with an OPEN or IN_PROGRESS task. Priority rises as
the deficit approaches zero and when the SKU appears in a wave that is currently releasable.

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

Exclude blocked bins. **All candidate source bins are within the UNIT bin's location (D-14) — never
source across locations; that stock is an inbound Transfer Order, not a replenishment.** Never select a
source that would violate the target bin's policy on arrival.
**Never source from a non-fulfillable bin** (`availableForFulfilment: false` — QUALITY, RETURN,
DEFECT, STAGE, RECEIVING): that stock is physically present but not pickable until it is physically
moved into a UNIT/BULK bin (Q-16). `allowDirectPick` already excludes these from the step-3
fall-through; `availableForFulfilment` is the explicit invariant, checked directly.

**Never source from a HOLDING location — a HARD GUARD, invariant #23 (D-30/D-33).** Distinct from the
bin-type check above: an entire **HOLDING location (RQD, `custrecord_loc_class === HOLDING`)** is
off-limits as a replenishment source, because its stock is not fit to sell and sourcing from it physically
ships defective goods to a customer. Every candidate is filtered on `custrecord_loc_class === OPERATIONAL`
**before selection**, and a task that would source from a holding location is **refused outright, not
de-prioritised.** This is the one location-class rule that is **absolute** (the picker/wave/putaway
exclusions are overridable defaults; this is not).

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
- [ ] GIVEN stock for a SKU held in a **HOLDING location** (RQD), THEN replenishment **never** selects it — the candidate is filtered on `custrecord_loc_class === OPERATIONAL` and a task that would source from holding is refused outright (invariant #23, hard guard). *(the rule that physically prevents shipping defective stock)*
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

**Location class (D-30).** Beyond bin type, the target's **location class** is honoured: **good stock is
never targeted into a HOLDING location** (`custrecord_loc_class === HOLDING`, RQD) — a holding location's
bins are for isolated/condemned stock only. A holding location may be a putaway target **only** when the
disposition is explicitly quarantine/defect for that location (the RQD isolation flow, T-5.10), never as a
default for good stock.

Pure function over bin state and policy wherever possible, so it is unit-testable without NetSuite.
Never proposes a bin whose policy the placement would violate, and never proposes a blocked bin.
Supports splitting one receipt line across several bins when quantity exceeds a bin's capacity.

**Acceptance**
- [ ] GIVEN a bin already holding the same SKU and lot with capacity, WHEN putaway is directed, THEN that bin is selected.
- [ ] GIVEN no matching bin but an empty bin in the item's home zone, THEN the empty bin is selected.
- [ ] GIVEN a receipt quantity exceeding one bin's capacity, THEN the putaway splits across bins and the sum equals the received quantity.
- [ ] GIVEN no valid bin anywhere, THEN a `NO_PUTAWAY_LOCATION` exception is raised and no invalid direction is given.
- [ ] GIVEN good stock, THEN putaway targets a bin with `availableForFulfilment: true` (UNIT/BULK); GIVEN quality-hold or defective stock, THEN it targets QUALITY/DEFECT and never a fulfillable bin.
- [ ] GIVEN good stock, THEN putaway **never** proposes a bin in a HOLDING location (`custrecord_loc_class === HOLDING`); a holding location is targeted only under an explicit quarantine/defect disposition (T-5.10). *(D-30)*
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

**Per-line locations (PF-33).** Under standard Multi-Location Inventory a **single consolidated Item
Receipt handles lines destined for different locations** (`inventorylocation` per line, read via PF-34's
`line.inventorylocation || line.location`). Splitting into per-location receipts occurs **only** under
Centralised Purchasing (`CENTRALIZEPURCHASING`, which must be OFF, PF-28) or cross-subsidiary (Q-52).
This is **distinct from RQD isolation (T-5.10)** — that is a post-inspection Inventory Transfer, not a
per-line plan.

Handle the real cases the FRD never mentions: **over-receipt** against PO quantity (tolerance from
config, else block), **under-receipt** leaving the PO line open, and **damaged goods** routed to a
QUALITY bin (held for disposition, `availableForFulfilment: false`).

**Serialised lines are a serial ENTRY point (D-29, PF-14).** A PO receipt is one of the three points
where serials enter the system (with WO completion and RMA). Capture the serial array (`custrecord_se_serials`);
**validation is the ENTRY form (opposite of movement, Part D):** each entering serial **must NOT already
exist as an active row** in `customrecord_wms_serial_state` — a re-entered RETIRED serial reactivates its
row and increments `generation` (never a second row); array length must equal quantity. The committer
writes one `inventoryassignment` line per serial, quantity 1 (PF-17).

**Acceptance**
- [ ] GIVEN an open PO, WHEN the operator receives a line with lot and quantity, THEN an Item Receipt posts against that PO and WMS bin state reflects the putaway.
- [ ] GIVEN a receipt quantity above the PO line quantity, THEN it is accepted only within the configured tolerance and otherwise blocked with a clear message.
- [ ] GIVEN a partial receipt, THEN the PO line remains open for the balance.
- [ ] GIVEN a lot-tracked item, THEN lot number **and expiry date** are mandatory and are written to the inventory number record.
- [ ] GIVEN damaged goods, THEN they are routed to a QUALITY bin (`availableForFulfilment: false`) and are therefore never allocated — but still counted in reconciliation (T-8.3).
- [ ] GIVEN a serialised item on the PO, THEN the operator captures one serial per unit, the array length equals quantity, and each serial is written as an `inventoryassignment` line (quantity 1) — the item is **received, not rejected** (D-29).
- [ ] GIVEN an entering serial that already exists as an ACTIVE serial-state row, THEN the receipt is rejected (duplicate live serial); GIVEN a RETIRED serial re-received, THEN its row reactivates with `generation` incremented and no second row is created. *(invariant #21, PF-23)*

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

**Now the destination half of a WMS-fulfilled transfer (D-22).** With TO outbound in scope, the TO this
receives may have been **picked and shipped by the WMS itself at the source**. Confirm this path end to
end: the source fulfilment (T-6/T-7 via `transferorder`) and this receipt are the two legs of one
transfer, and the committer defers this receipt until the source fulfilment is `POSTED` (**F-30**).
Whether an **in-transit** NetSuite location sits between them is **Q-36** (if so, it is a holding
location, not a warehouse — location class).

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

**Transfer-Order ordering exception (F-30, D-22) — the one exception to the absolute rule.** A transfer
produces a **source fulfilment** (outbound, Phase B) and a **destination receipt** (inbound, Phase A)
for the same stock. If both land in one cycle, Phase A would attempt the **receipt before the source
fulfilment** — which cannot post (nothing shipped yet; forcing it drives the source negative, F-25).
So **within Phase A, a TO receipt whose corresponding source TO fulfilment is not yet `POSTED` is set
`DEFERRED` and retried next cycle — never `FAILED`** (reuses the T-4.7 deferral path). This is the only
place inbound waits on outbound, and it is bounded to the two legs of one transfer.

**Acceptance**
- [ ] GIVEN stock received and picked within the same minute, WHEN the cycle runs, THEN the Item Receipt posts in Phase A and the fulfillment succeeds in Phase B.
- [ ] GIVEN a **TO receipt** committed in the same cycle as its **unposted source TO fulfilment**, WHEN Phase A runs, THEN the receipt is set `DEFERRED` (not FAILED); WHEN the source fulfilment reaches `POSTED` (a later cycle), THEN the receipt posts. *(F-30/D-22)*
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
that item and lot. **The sufficiency test, `DEFERRED` retry and negative-bin evaluation are all per
`(item, location)` (D-14)** — NetSuite quantity on hand is per location, so a shortfall in one location
must not defer an event in another. Where it does not:

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

### T-4.8 — Reconcile committer task bodies with the AD-level platform rulings *(tracked follow-up)*
**Depends on:** T-4.1, T-4.6 · **Implements:** D-27 (AD-20/AD-22, invariants #16/#19) · *(new 2026-08-11 — tracked so it cannot be lost)*

**Narrative**
As the delivery lead, I want the committer task bodies to state the platform-fact rulings they must
implement, so that a ruling recorded at the architecture level is not silently missing from the task that
builds it.

**Requirement**
The platform-facts pass (D-27) recorded four committer behaviours at the AD/invariant level but did **not**
rewrite the individual T-4.x task bodies. Fold each into the owning task, with acceptance:
- **On-demand triggering + deployment pool + measured lag window (AD-20/PF-07/PF-08)** -> T-4.6.
- **Proactive negative pre-check, asymmetric by tracking mode; serial never negative (invariant #19/PF-22, D-29)** -> T-4.7 / T-4.3.
- **Closed-period pre-check reading `accountingperiod.closed`, Multi-Book book-specific (invariant #16/PF-24/PF-25)** -> T-4.2 / T-2.7.
- **Kill switch as a config flag read at execution start (AD-22/PF-29)** -> T-4.6.

**Acceptance**
- [ ] GIVEN each of the four rulings, THEN its owning T-4.x task body states it with a verifiable acceptance criterion, and no ruling lives only at AD level.
**Depends on:** T-5.5, T-8.1

**Narrative**
As a receiving supervisor, I want inbound problems queued for me the same way outbound ones are, so
that there is one place to look when something is wrong.

**Requirement**
Route inbound failures into the T-8.1 exception queue with their own types: `OVER_RECEIPT`,
`RECEIPT_DISCREPANCY`, `NO_PUTAWAY_LOCATION`, `MISSING_LOT_DATA`, `PO_LINE_MISMATCH`, and **the serial
set (data model §3.13b, D-29): `SERIAL_ALREADY_LIVE`, `SERIAL_UNKNOWN`, `SERIAL_WRONG_BIN`,
`SERIAL_NOT_AVAILABLE`, `SERIAL_WRONG_ITEM`, `SERIAL_COUNT_MISMATCH`** (replaces the withdrawn
`SERIALISED_ITEM_OUT_OF_SCOPE`). **The governing split (§3.13b): data-wrong CONTINUES and corrects
(`SERIAL_WRONG_BIN`); action-wrong STOPS.** Each carries the source document, operator, item and
quantities. Resolution actions extend those in T-8.2 with **re-direct putaway**, **accept variance**, and
**serial reconciliation** (adopt / correct-bin).

**Acceptance**
- [ ] GIVEN any inbound failure, THEN exactly one exception exists carrying the source document, operator, item and both expected and actual quantities.
- [ ] GIVEN a `NO_PUTAWAY_LOCATION` exception, WHEN a supervisor re-directs it to a chosen bin, THEN the receipt completes without re-scanning the goods.
- [ ] GIVEN inbound and outbound exceptions, THEN both appear in one supervisor queue filterable by direction.

---

### T-5.10 — Receipt with RQD isolation (Inventory Transfer A -> B, and B -> A on review)
**Depends on:** T-5.5, T-2.7 · **Implements:** D-28, D-30, D-31 · *(new 2026-08-11)*

**Narrative**
As a receiving operator, I want defective stock isolated into the RQD warehouse after inspection, so that
it cannot be picked for a customer while staying fully counted.

**Requirement**
**NetSuite cannot receive a PO marked to Location A into Location B.** So: the WMS **receives 100% into
Location A**, then the RQD quantity **transfers A -> B as an Inventory Transfer** (committer-posted, D-31).
**One physical receipt, two WMS events; Location A's count is correct throughout.** The **reverse (B -> A)
on fit-for-sale review is equally canonical** (D-31). For serialised items, **named serials move** (their
`custrecord_ss_bin`/`location` update) rather than a quantity.

**Do NOT conflate this with per-line locations (Part G).** A PO may be *planned* to arrive at two
locations (PF-33) — but the RQD flow exists because **defect status is determined at inspection, AFTER
receipt, when goods are already physically in Location A.** At PO-entry time nobody knows which units are
bad, so **nobody may later "optimise" this into a per-line receipt.** Written down so it is not.

**Acceptance**
- [ ] GIVEN a PO receipt of 100 with 10 later condemned, THEN 100 is received into Location A and 10 transfers A -> B as an Inventory Transfer; Location A's count is correct at every step (one physical receipt, two WMS events).
- [ ] GIVEN RQD stock in Location B reviewed fit-for-sale, THEN a B -> A Inventory Transfer returns it to an operational bin — as routine as A -> B (D-31).
- [ ] GIVEN serialised stock isolated, THEN the named serials move to Location B (bin/location updated), not a quantity.
- [ ] GIVEN the same-roof / same-minute nature, THEN the isolation completes within one committer cycle (it is an Inventory Transfer, not a Transfer Order — D-28).

---

### T-5.11 — Customer return (RMA) receipt
**Depends on:** T-5.5, T-2.7 · **Implements:** D-32 · *(new 2026-08-11 — resolves Q-45)*

**Narrative**
As a receiving operator, I want to receive a customer return against its RMA and put it away, so that
returned stock re-enters the system in a controlled bin with its serials captured.

**Requirement**
RMA receipt joins PO, TO and WO receipts in Phase 5B. Emits `RECEIPT_RMA`; the committer posts the
appropriate receipt. Returned goods route by disposition to a **RETURN or QUALITY bin**
(`availableForFulfilment: false`) pending review; a subsequent Inventory Transfer (T-5.10) moves
fit-for-sale stock back to an operational bin. **RMA is one of the three serial ENTRY points (D-29)** —
serial validation is the entry form (must not already exist as an active row).

**Acceptance**
- [ ] GIVEN an open RMA, WHEN the operator receives the returned line, THEN a receipt posts and the stock lands in a RETURN/QUALITY bin, not an operational one.
- [ ] GIVEN a serialised return, THEN each serial is captured and validated as an entry (invariant #21), reactivating a RETIRED row with `generation` incremented if it had previously shipped.
- [ ] GIVEN reviewed-fit return stock, THEN a B -> A / QUALITY -> operational Inventory Transfer returns it to pickable stock (T-5.10).

---

### T-5.12 — Write-off (scrap) event and handler *(carved-out registry change recorded as a task)*
**Depends on:** T-2.6, T-2.7, T-8.1 · **Implements:** D-33 · *(new 2026-08-11; do NOT edit the carved-out registry module here)*

**Narrative**
As a warehouse supervisor, I want condemned stock written off with an auditable reason, so that value
leaving the books always has an authorising name against it.

**Requirement**
A **`WRITE_OFF` event type**, registered as a handler (**recorded here as a task — the registry module is
carved out, D-23; do not edit it**). Posts an **Inventory Adjustment (PF-21)** with a **mandatory reason
code** and **supervisor authorisation** (not a bare operator scan). For serialised items the named serials
move to **RETIRED** in `customrecord_wms_serial_state` (status change, never deletion — PF-23). **Committer
ordering: same phase as Inventory Transfers.** Offset GL account and any finance-approval threshold are
**open (Q-53)** — do not hard-code.

**Acceptance**
- [ ] GIVEN a write-off without supervisor authorisation or without a reason code, THEN it is refused — no Inventory Adjustment posts.
- [ ] GIVEN an authorised write-off of serialised units, THEN the named serials move to RETIRED (one row each, not deleted) and an Inventory Adjustment posts.
- [ ] GIVEN the handler, THEN it is a registry registration with unit tests, and the carved-out guards still pass.
- [ ] GIVEN the offset GL account is unresolved (Q-53), THEN it is read from config, never hard-coded.
