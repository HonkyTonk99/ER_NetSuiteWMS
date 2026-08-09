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
> **Updated 2026-08-09 — recorded as decisions D-12…D-18 (see `05-decisions-log.md`).** Every ruling
> below now has a D-number and the log is current for the first time since D-11.
> - **D-12** — no value-uniqueness constraint in NetSuite → AD-04 committer-side dedupe, AD-05
>   withdrawn, `customrecord_wms_concurrency_lock` deleted. **Propagated across the spec** (~15 sites).
> - **D-13** — Q-01: handheld = responsive PWA, Android-first, served from NetSuite; iOS out of scope.
>   AD-09's "PWA cannot deliver persistence" claim corrected; residual risk accepted in writing.
> - **D-14** — Q-08: multi-location in scope; location is mandatory session context; bin names
>   location-prefixed; switching location requires connectivity.
> - **D-15** — delivery is an Account Customization Project, not a SuiteApp.
> - **D-16** — Q-16: seven bin types + `availableForFulfilment`; surfaces F-26 → Q-29.
> - **D-17** — T-0.4 case (b): bin data migrates from a third-party app.
> - **D-18** — Q-13: NetSuite WMS SuiteApp not installed; D-07 confirmed.
> - Also closed: **Q-10** (moot). New questions: **Q-29** (F-26), **Q-30** (auth licensing).
>
> **No hard blocker remains for a phase *start*.** Q-02, Q-06, Q-07, Q-09, Q-11, Q-12, Q-17, Q-25,
> Q-27, Q-29, Q-30 are needed *during* their phases; Q-05 residual (cycle counting / structured RMA)
> is a release-scope call. **Phase 1 gates on T-0.3 closing this register with owners + dates.**
> D-14 (multi-location) and D-13 (PWA) have propagation still to do beyond the spec touch-ups already
> made — location scoping across the data/wave model, and the Phase 3 PWA design — flagged on their
> rows and tasks.

| ID | Question | Why it matters | Blocks | Recommendation | Owner | Decision |
|---|---|---|---|---|---|---|
| ~~Q-01~~ | **CLOSED 2026-08-09 (D-13).** Handheld is a **responsive PWA, Android-first, served from NetSuite; iOS out of scope.** ⚠️ *This overrides the plan's recommendation of a native app and runs against AD-09's stated position that a browser/PWA client cannot dependably deliver durable offline persistence and background sync on rugged Android — AD-09, T-3.2 (durable queue), T-3.4 (client) and T-3.5 (reconnect) must be revisited to a PWA delivery (IndexedDB + Service Worker / Background Sync), with the residual offline-durability risk accepted or mitigated in writing.* | Phase 3 | *(superseded by the ruling above)* | TK | **Closed** |
| **Q-02** | RESTlet authentication: Token-Based Auth or OAuth 2.0 machine-to-machine? Per-device or shared credentials? | Determines device provisioning and whether a lost handheld can be revoked without touching the other 49. | Phase 3 | Per-device TBA tokens. Shared credentials are not revocable in any useful sense. | | |
| ~~Q-03~~ | **CLOSED 2026-08-07 (D-03).** No bulk → picking consumes available bin batches directly, FEFO; when exhausted the SKU is out of stock. No blocked task, no escalation. | — | — | — | TK | **Closed** |
| ~~Q-04~~ | **CLOSED 2026-08-07 (D-03).** One bin = one batch, so demand spanning bins spans batches. Summary picking is one task per SKU **per bin**. FEFO across bins; orders may split across batches. | — | — | — | TK | **Closed** |
| **Q-05** | *(Reduced by D-09.)* **Receiving and putaway are now IN scope** (Phase 5B). Still open: are **cycle counting** and **returns/RMA putaway** in release 1? | `COUNT` sits in the event enum with no specification; returns have lot and bin implications. Both are smaller now that the inbound framework exists. | Release scope | Defer both to release 2 — the Phase 5B putaway engine makes them much cheaper to add later. | | |
| **Q-06** | Packing label and packing slip: which printer/label platform, and what routing by pack station? | §2.4 says packing "triggers packing label generation" with no further specification. Despatch cannot operate without it. | T-7.5 | Confirm the incumbent label platform before designing anything new. | | |
| **Q-07** | Is UOM conversion in scope? The cache spec holds base UOM and conversion factors but nothing in any flow uses them. | If orders are in cases and pickers scan eaches, every quantity in the system needs conversion — a pervasive change, not a local one. | Phase 2 & 4 | Confirm early. If eaches-only, remove UOM from the cache spec to avoid implying capability that does not exist. | | |
| ~~Q-08~~ | **CLOSED 2026-08-09 (D-14).** **Multi-location in scope.** Location is **mandatory session context**; bin names are **prefixed with the location code**; the handheld cache **warms on location selection**, so **switching location requires connectivity** (a bounded exception to offline-first — you work offline *within* a location). ⚠️ *Propagation of location scoping across the data model, wave/zone model and handheld login is still to do — flagged in D-14.* | — | — | — | TK | **Closed** |
| **Q-09** | Scan event retention: is 7 days acceptable, and what is the archive destination? What are the audit and regulatory retention obligations (lot traceability, food/pharma)? | The FRD says "purges or archives" — those are very different things. Purging destroys the only record of who scanned what. | T-11.1 | Archive to an external store before purge. Confirm lot-traceability retention obligations with compliance. | | |
| ~~Q-10~~ | **CLOSED 2026-08-09 — moot.** WMS bin state tracks **physical** quantity only and never sees NetSuite's available/committed split. A bin holding committed stock is **occupied**, because the stock is physically there. There is no reserved-but-not-available dimension in the WMS to test against. | — | — | — | TK | **Closed** |
| **Q-11** | What is the partial-fulfilment policy on an unresolvable short pick — ship partial, hold the order, or backorder? | Drives T-7.4 behaviour and has direct customer-experience consequences. | T-7.4 | Confirm with customer service; likely varies by customer or order type. | | |
| **Q-12** | Cart/tote capacity — how many order positions does a pick cart hold? | Hard cap on wave cluster size (AD-10). Without it, clustering can produce a wave no picker can physically carry. | Phase 6 | Measure the actual carts. | | |
| ~~Q-13~~ | **CLOSED 2026-08-09 (D-18).** The Oracle NetSuite WMS SuiteApp is **not installed** in the target account. It would have required Bin Management enabled, contradicting D-07 — so this confirms **D-07 is settled, not provisional.** T-0.1 retains a general namespace-collision check on its own merits (ACP hygiene). | — | — | — | TK | **Closed** |
| ~~Q-14~~ | **CLOSED 2026-08-07 (D-03).** Direct picking from non-pick-face bins is permitted. Allocation prefers the UNIT pick face, then falls through to any bin holding the SKU. | — | — | — | TK | **Closed** |
| ~~Q-15~~ | **CLOSED 2026-08-08 (D-09).** Lot expiry is captured at receipt on the handheld (T-5.5), so FEFO data is created correctly at source rather than needing a back-fill. Existing stock still needs a one-off check during Phase 10 remediation. | — | — | — | TK | **Closed** |
| ~~Q-18~~ | **CLOSED 2026-08-08 (D-07).** Lot recall traceability: LOT items post lot detail to NetSuite normally, so standard lot traceability is intact wherever items are lot-numbered. The exposure was a consequence of the tier model, which no longer exists. *(Traceability of **which bin** remains WMS-only — but that was never a regulatory question.)* | — | — | — | TK | **Closed** |
| ~~Q-19~~ | **CLOSED 2026-08-08 (D-07).** Advanced Bin / Numbered Inventory Management is **not required** — no NetSuite bins. No licence decision, no cost. | — | — | — | TK | **Closed** |
| ~~Q-20~~ | **CLOSED 2026-08-08 (D-07).** Lot costing works normally for lot-numbered items; the constraint was tier-derived. | — | — | — | TK | **Closed** |
| ~~Q-21~~ | **CLOSED 2026-08-08 (D-08).** Serial numbers are out of scope; tracking modes are PLAIN and LOT only. The scan-volume risk is removed. | — | — | — | TK | **Closed** |
| ~~Q-22~~ | **CLOSED 2026-08-08 (D-08).** No serialised items, so no serial bin rule and bin state stays scalar. | — | — | — | TK | **Closed** |
| ~~Q-23~~ | **CLOSED 2026-08-08 (D-08).** Moot — serial out of scope. | — | — | — | TK | **Closed** |
| ~~Q-16~~ | **CLOSED 2026-08-09 (D-16).** Bin types are **UNIT, BULK, STAGE, RECEIVING, QUALITY, RETURN, DEFECT.** New policy attribute **`availableForFulfilment`** — TRUE for UNIT and BULK only; stock in any other type is physically present but must be moved into UNIT/BULK before it can be picked. Enforced in T-7.1 (allocation), T-5.2 (replenishment), T-5.4 (putaway); **not** filtered from reconciliation (T-8.3). Surfaces new finding **F-26** (NetSuite over-commits non-fulfillable stock). Seeds §3.9b policy table and types the migrated bins (T-0.4 case b, Phase 10). | — | — | — | TK | **Closed** |
| **Q-17** | *(New, from D-04.)* What is the maximum acceptable **offline duration** for a handheld before the operator is blocked? | Sets the local cache staleness limit and the reconnect conflict window (T-3.2, T-3.5). Too short blocks pickers in dead spots; too long lets conflicts accumulate. | Phase 3 | Start at 30 minutes warn / 60 minutes block, then tune from measured Wi-Fi coverage. | | |
| ~~Q-24~~ | **CLOSED 2026-08-08 (D-11).** NetSuite runs costing; the WMS supplies quantity, date and lot and designs nothing around valuation. No per-item event ordering is required for costing. | — | — | — | TK | **Closed** |
| **Q-25** | *(New, from D-09.)* For Work Order output, does the account use **Work Order Completion** or **Assembly Build**? | Different transaction types with different subrecord shapes. T-5.7 needs to target the right one. | Phase 5B | Confirm the manufacturing configuration during T-0.1. | | |
| ~~Q-26~~ | **CLOSED 2026-08-08 (D-11).** **The WMS may go negative; NetSuite may not.** Outbound never posts where NetSuite lacks quantity — it defers and retries (T-4.7). Negative bin state is permitted but diagnostic (F-25). | — | — | — | TK | **Closed** |
| **Q-27** | *(New, from D-09.)* What **over-receipt tolerance** applies against a PO line, and who may approve beyond it? | T-5.5 blocks or accepts based on this. Warehouses routinely receive slightly more than ordered. | Phase 5B | Confirm with procurement; a percentage tolerance with supervisor override above it is typical. | | |
| **Q-29** | *(New, from F-26 / D-16.)* How should the system prevent NetSuite **over-committing stock held in non-fulfillable bins** (QUALITY/RETURN/DEFECT)? NetSuite counts it toward quantity on hand and commits it; the WMS cannot pick it, so those orders short-pick. Mirror of F-22. | Breaks the AD-17 commitment contract from the NetSuite side; NetSuite availability becomes fiction by the quarantine volume. | Phase 6/7 (allocation), Phase 1 if (a) chosen | **(a) RECOMMENDED** — a separate NetSuite **location** for non-fulfillable stock (moves across the boundary post an Inventory Transfer); (b) same location, accept permanent over-commit + short-pick handling; (c) NetSuite inventory status (Advanced Inventory, likely unavailable). Cross-refs Q-08 (multi-location). **Status: with sponsor.** | | |
| **Q-30** | *(New, from Q-02 / D-13.)* **Commercial:** if the PWA authenticates via NetSuite session, every warehouse operator needs a **NetSuite user** — potentially the largest recurring cost in the programme. | 50 pickers/packers × full user licence is a real cost. Alternatives: **Employee Center** licences, or **a single integration user with operator identity carried in the payload** — but the latter trades away NetSuite-level audit attribution, which much of this design relies on (knowing who scanned what). | Phase 3 (before the auth model, Q-02, is settled) | Price the options before settling Q-02. Weigh licence cost against audit attribution. | | |
