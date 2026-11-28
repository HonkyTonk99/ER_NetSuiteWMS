# 14 - Marketing Narrative

**Advanced Warehouse Management (with Quality) for NetSuite**
*Companion to `docs/13-frd.md`. Where this narrative summarises capability, the FRD and the decisions log
(`docs/05-decisions-log.md`) are the authority. Status note: development is complete and fully unit/integration
tested; the product enters sandbox + user acceptance before go-live (see `docs/12`, `docs/13` section 7).*

---

## 1. The product in one line

**Run your whole warehouse - and your quality inspections - from inside NetSuite, on a handheld that keeps
working when the Wi-Fi doesn't, without buying a NetSuite licence for every picker.**

It is not a bolt-on system with its own database to reconcile. Every action a picker takes becomes a native
NetSuite transaction. NetSuite stays the single system of record; the WMS makes the floor fast, accurate and
visible.

---

## 2. Who it is for

Distributors and manufacturers running NetSuite who need real warehouse discipline - directed picking, bins,
lots, serials, receiving, replenishment, cycle counting, and shop-floor material flow - and who also want
**quality inspection built into the same flow**, across one or many sites.

It fits a business that has outgrown keying warehouse activity into NetSuite by hand, but does not want a
second platform, a nightly sync, or a licence bill that scales with headcount on the floor.

---

## 3. The problems it solves

| If this is the pain... | ...this is the answer |
|---|---|
| "We don't know what's happening on the floor until it's gone wrong." | Live dashboards, order tracking and an exceptions console in the manager Hub. |
| "The warehouse stops when the Wi-Fi drops." | Offline-first by design - scanning continues with the radio off and syncs when it returns. |
| "Every picker needs a NetSuite licence." | Pickers sign in to the handheld with a lightweight warehouse identity - no NetSuite login. |
| "Stock counts mean shutting down." | Blind cycle counting bin-by-bin while you trade, with variance reviewed and approved before anything posts. |
| "Mis-picks and wrong lots reach customers." | Every bin, item, lot and serial is scanned and confirmed at the point of work; oldest stock goes first. |
| "Quality is a paperwork exercise bolted on afterwards." | Inspections (sampling, pass/fail, certificates) are staged directly from receiving, and the WMS moves the stock on the result. |
| "A new label is a development project." | A configurable label engine - design once, print on demand or automatically. |
| "Our shop floor and warehouse fight over the same stock." | A dedicated work-order flow moves components to the floor, then issues them to the build only when work starts. |

---

## 4. Value proposition

- **One system of record.** No second database, no overnight sync, no reconciliation between two systems.
  Finance and reporting keep working exactly as they do today.
- **The floor never stops.** Offline is the expected state, not a failure mode. A dropped connection, a dead
  zone at the back of the racking - the operator keeps scanning and the queue drains later.
- **No licence tax on the floor.** Operators are identities drawn from the NetSuite employee list with access
  governed inside the app; they consume no NetSuite user licence. Managers use the login they already have.
- **Correct by construction.** The hard, invisible things are built in, not hoped for: no lost updates under
  concurrency, transactions dated by scan time (never the wrong accounting period), never shipping one
  customer's committed stock to another, never letting the ledger go negative when it must not, and a serial
  that is only ever in one place.
- **Segregation of duties.** Floor and management are distinct tiers; write-offs, count approvals and serial
  adoption require supervisor authorisation; access is cumulative and nothing can be deleted.
- **WMS + QMS together.** Quality inspection is part of the same receiving-to-putaway flow, not a separate
  island - the WMS owns every stock movement the inspection outcome triggers.
- **Start simple, grow.** Almost everything is a configuration switch. Turn on zones, serial tracking, the
  shop-floor flow, QMS, direct printing or multi-site as you are ready for them.

---

## 5. Why it is built the way it is (the deliberate stance)

NetSuite's native Bin Management, Advanced Bin/Numbered Inventory and Inventory Status features are **not
used - on purpose** (a recorded design ruling, D-42). The WMS owns bins, lot placement and per-unit serial
state itself, because that ownership gives a cleaner, faster, offline-capable operation than the native
features allow. The trade is explicit and on the record: a lighter NetSuite footprint, a WMS that is the
operational truth of the floor, with NetSuite retaining commitment, cost and the financial ledger.

The result is a system that is **native to NetSuite without being limited to NetSuite's native warehouse
features** - and one whose quality half (QMS) integrates as an inspection layer while the WMS keeps control of
the physical stock.

---

## 6. Base requirements (what it needs to run)

**Platform**
- NetSuite account with SuiteScript 2.1 and SuiteCloud / SDF (the solution deploys as an Account
  Customization Project).
- **Multi-Location Inventory** enabled.
- **Lot Tracking and Serialized Inventory** enabled *per item as the catalogue needs* - tracking mode is a
  property of the item, not an account-wide flag.
- A deployment role for ingestion that is **not Administrator**, with create-only (append) rights on the event
  queue, and the public endpoint audience set so the floor can post without a NetSuite login.

**Explicitly NOT required**
- NetSuite **Bin Management**, **Advanced Bin / Numbered Inventory Management**, or **Inventory Status** - the
  WMS provides bins, lot/serial placement and quality holding itself.

**Devices**
- A browser on standard handhelds, tablets or laptops - no app to install or keep updated. Scan or type; a
  damaged label never stops the job.

**People**
- Operators mapped to NetSuite employee records (no licence); managers on existing NetSuite logins.

With just this, a site can run the core loop: receive, put away, replenish, wave, pick, pack and despatch,
with bins, lots and offline operation.

---

## 7. Optional configurations (turn on what you need)

Each is a setting, adoptable when the business is ready - most are configurable per location:

- **Serialised items** - full per-unit lifecycle, one-serial-one-bin, scan-verified at every step.
- **Zones & pick-paths** - order the pick route by a walk sequence so pickers stop walking miles.
- **Work-order / shop-floor flow** - move components to a segregated production location, then issue them to
  the build at the moment work starts (supports WIP/routing and many shop floors).
- **Quality Management (QMS) integration** - stage inspections from receiving (sampling, pass/fail,
  certificates); the WMS releases, quarantines or writes off on the result.
- **Label & document engine** - design labels on a template, print on demand or automatically on receipt, to
  PDF, network or thermal printers.
- **Blind cycle counting** - directed counts with variance-by-value and a manager approval gate.
- **Multi-site & multi-subsidiary** - one deployment across many sites; a site may even span subsidiaries,
  with automatic intercompany inventory allowed or prevented per location.
- **Negative-inventory policy per location** - prevent by default, or allow where a location needs it (never
  for serialised items).
- **Units of measure** - transact in cases while scanning eaches, with conversion handled in the WMS.
- **Over-receipt tolerance, short-pick policy, offline limits, cart capacity, retention** - all tunable.
- **Management Hub depth** - dashboards, order tracking, exceptions console, print designer, user/role setup.
- **Scale** - add SuiteCloud Plus and route committer work across channels when volume grows; the design runs
  on the base concurrency pool and scales up.

---

## 8. How to go deeper

- **What it does, precisely, and how it is accepted:** `docs/13-frd.md` (functional requirements + UAT).
- **Why each choice was made:** `docs/05-decisions-log.md` (rulings) and `CLAUDE.md` (invariants).
- **The NetSuite boundary:** `docs/06-netsuite-boundary.md`.
- **Deploy & acceptance plan:** `docs/11-build-plan.md`, `docs/12-phase14-sandbox-uat.md`.
