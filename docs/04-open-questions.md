# 04 — Open Questions / Decision Register

Owner and date to be filled in during `T-0.3`. **Blockers must be decided before their dependent
phase is scheduled** — they are not "we'll work it out in the sprint" questions.

> **Updated 2026-08-08 per rulings D-08 (serial out of scope), D-09 (inbound via WMS) and D-10 (WMS
> primary, NetSuite retains commitment and cost authority).**
>
> **Closed:** Q-03, Q-04, Q-14 (D-03) · Q-18, Q-19, Q-20 (D-07) · Q-21, Q-22, Q-23 (D-08) ·
> Q-05 receiving portion and Q-15 (D-09 — expiry is now captured at receipt).
> **New:** Q-24 costing method, Q-25 manufacturing transaction type, Q-26 negative inventory
> setting, Q-27 over-receipt tolerance.
>
> **Updated 2026-08-08 per D-11** — costing is NetSuite's concern and out of WMS scope; negative
> inventory is permitted in the WMS and forbidden in NetSuite. **Closes Q-24 and Q-26.**
>
> **One hard blocker remains: Q-01 (handheld platform).** Nothing else gates a phase start —
> Q-16, Q-17, Q-25 and Q-27 are needed during their phases rather than before them.

| ID | Question | Why it matters | Blocks | Recommendation | Owner | Decision |
|---|---|---|---|---|---|---|
| **Q-01** | What is the handheld platform? Rugged Android (Zebra/Honeywell), consumer Android/iOS, or browser-based? Native app, PWA, or NetSuite mobile? | **Largest unspecified work item in the programme.** Determines whether the optimistic-UI + durable-queue design of AD-09 is even buildable. A browser-based client cannot reliably persist a queue across a battery pull. | Phase 3 | Native or hybrid app on rugged Android with a hardware scan trigger. Consumer devices in a warehouse are a false economy. | | |
| **Q-02** | RESTlet authentication: Token-Based Auth or OAuth 2.0 machine-to-machine? Per-device or shared credentials? | Determines device provisioning and whether a lost handheld can be revoked without touching the other 49. | Phase 3 | Per-device TBA tokens. Shared credentials are not revocable in any useful sense. | | |
| ~~Q-03~~ | **CLOSED 2026-08-07 (D-03).** No bulk → picking consumes available bin batches directly, FEFO; when exhausted the SKU is out of stock. No blocked task, no escalation. | — | — | — | TK | **Closed** |
| ~~Q-04~~ | **CLOSED 2026-08-07 (D-03).** One bin = one batch, so demand spanning bins spans batches. Summary picking is one task per SKU **per bin**. FEFO across bins; orders may split across batches. | — | — | — | TK | **Closed** |
| **Q-05** | *(Reduced by D-09.)* **Receiving and putaway are now IN scope** (Phase 5B). Still open: are **cycle counting** and **returns/RMA putaway** in release 1? | `COUNT` sits in the event enum with no specification; returns have lot and bin implications. Both are smaller now that the inbound framework exists. | Release scope | Defer both to release 2 — the Phase 5B putaway engine makes them much cheaper to add later. | | |
| **Q-06** | Packing label and packing slip: which printer/label platform, and what routing by pack station? | §2.4 says packing "triggers packing label generation" with no further specification. Despatch cannot operate without it. | T-7.5 | Confirm the incumbent label platform before designing anything new. | | |
| **Q-07** | Is UOM conversion in scope? The cache spec holds base UOM and conversion factors but nothing in any flow uses them. | If orders are in cases and pickers scan eaches, every quantity in the system needs conversion — a pervasive change, not a local one. | Phase 2 & 4 | Confirm early. If eaches-only, remove UOM from the cache spec to avoid implying capability that does not exist. | | |
| **Q-08** | Single or multiple warehouse locations/subsidiaries in scope? | Every flow in the FRD implicitly assumes one location. Bin numbers, wave zones and stage areas all need location scoping if not. | Phase 1 | Confirm before the data model is frozen — retrofitting location scoping is expensive. | | |
| **Q-09** | Scan event retention: is 7 days acceptable, and what is the archive destination? What are the audit and regulatory retention obligations (lot traceability, food/pharma)? | The FRD says "purges or archives" — those are very different things. Purging destroys the only record of who scanned what. | T-11.1 | Archive to an external store before purge. Confirm lot-traceability retention obligations with compliance. | | |
| **Q-10** | Does *reserved but not available* stock count as occupying a bin for the single-SKU test? | Changes the semantics of the core invariant. Both readings are defensible; the two validation entry points must agree. | T-2.3 | Reserved stock occupies the bin. It is physically present. | | |
| **Q-11** | What is the partial-fulfilment policy on an unresolvable short pick — ship partial, hold the order, or backorder? | Drives T-7.4 behaviour and has direct customer-experience consequences. | T-7.4 | Confirm with customer service; likely varies by customer or order type. | | |
| **Q-12** | Cart/tote capacity — how many order positions does a pick cart hold? | Hard cap on wave cluster size (AD-10). Without it, clustering can produce a wave no picker can physically carry. | Phase 6 | Measure the actual carts. | | |
| **Q-13** | Is the NetSuite WMS SuiteApp installed in the target account? | It ships its own bin/wave/task records that collide conceptually and sometimes literally with this design. | T-0.1 | Determine coexistence or removal before Phase 1. | | |
| ~~Q-14~~ | **CLOSED 2026-08-07 (D-03).** Direct picking from non-pick-face bins is permitted. Allocation prefers the UNIT pick face, then falls through to any bin holding the SKU. | — | — | — | TK | **Closed** |
| ~~Q-15~~ | **CLOSED 2026-08-08 (D-09).** Lot expiry is captured at receipt on the handheld (T-5.5), so FEFO data is created correctly at source rather than needing a back-fill. Existing stock still needs a one-off check during Phase 10 remediation. | — | — | — | TK | **Closed** |
| ~~Q-18~~ | **CLOSED 2026-08-08 (D-07).** Lot recall traceability: LOT items post lot detail to NetSuite normally, so standard lot traceability is intact wherever items are lot-numbered. The exposure was a consequence of the tier model, which no longer exists. *(Traceability of **which bin** remains WMS-only — but that was never a regulatory question.)* | — | — | — | TK | **Closed** |
| ~~Q-19~~ | **CLOSED 2026-08-08 (D-07).** Advanced Bin / Numbered Inventory Management is **not required** — no NetSuite bins. No licence decision, no cost. | — | — | — | TK | **Closed** |
| ~~Q-20~~ | **CLOSED 2026-08-08 (D-07).** Lot costing works normally for lot-numbered items; the constraint was tier-derived. | — | — | — | TK | **Closed** |
| ~~Q-21~~ | **CLOSED 2026-08-08 (D-08).** Serial numbers are out of scope; tracking modes are PLAIN and LOT only. The scan-volume risk is removed. | — | — | — | TK | **Closed** |
| ~~Q-22~~ | **CLOSED 2026-08-08 (D-08).** No serialised items, so no serial bin rule and bin state stays scalar. | — | — | — | TK | **Closed** |
| ~~Q-23~~ | **CLOSED 2026-08-08 (D-08).** Moot — serial out of scope. | — | — | — | TK | **Closed** |
| **Q-16** | *(New, from F-18.)* Which physical areas need bin types beyond UNIT/BULK — staging, receiving dock, QC hold, returns, cross-dock? | AD-14 makes these configuration, but the list must be known to seed the policy table and to type bins during Phase 10. **Pending T-0.4 (asymmetric):** "type existing bins" assumes bins exist today; if T-0.4 returns case (a)/(c) there are no existing bins to type — the bins are created fresh as part of initial slotting of the whole warehouse (larger, physical, likely critical path). | Phase 1, Phase 10 | Walk the floor with the warehouse manager and enumerate. | | |
| **Q-17** | *(New, from D-04.)* What is the maximum acceptable **offline duration** for a handheld before the operator is blocked? | Sets the local cache staleness limit and the reconnect conflict window (T-3.2, T-3.5). Too short blocks pickers in dead spots; too long lets conflicts accumulate. | Phase 3 | Start at 30 minutes warn / 60 minutes block, then tune from measured Wi-Fi coverage. | | |
| ~~Q-24~~ | **CLOSED 2026-08-08 (D-11).** NetSuite runs costing; the WMS supplies quantity, date and lot and designs nothing around valuation. No per-item event ordering is required for costing. | — | — | — | TK | **Closed** |
| **Q-25** | *(New, from D-09.)* For Work Order output, does the account use **Work Order Completion** or **Assembly Build**? | Different transaction types with different subrecord shapes. T-5.7 needs to target the right one. | Phase 5B | Confirm the manufacturing configuration during T-0.1. | | |
| ~~Q-26~~ | **CLOSED 2026-08-08 (D-11).** **The WMS may go negative; NetSuite may not.** Outbound never posts where NetSuite lacks quantity — it defers and retries (T-4.7). Negative bin state is permitted but diagnostic (F-25). | — | — | — | TK | **Closed** |
| **Q-27** | *(New, from D-09.)* What **over-receipt tolerance** applies against a PO line, and who may approve beyond it? | T-5.5 blocks or accepts based on this. Warehouses routinely receive slightly more than ordered. | Phase 5B | Confirm with procurement; a percentage tolerance with supervisor override above it is typical. | | |
