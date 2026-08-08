# ER NetSuite WMS — Advanced Warehouse Management

A native **NetSuite (SuiteScript 2.1)** warehouse execution engine that decouples
the operator's scan (an immutable, append-only event with an instant optimistic-UI
acknowledgement) from NetSuite ledger posting (an asynchronous Map/Reduce
committer). Bins live only in the WMS; NetSuite retains commitment and costing
authority. See [`docs/00-objective.md`](docs/00-objective.md) for the full picture.

> **Status: planning bundle + Phase 0 foundation.** This repository currently
> contains the delivery plan (`docs/`, `tasks/`) and the source-controlled project
> foundation established by task **T-0.5** (this commit): the SDF project skeleton,
> the CI pipeline, and the jest test harness. **No production SuiteScript has been
> written yet.** Phase 1 onward is gated on Phase 0 completing; Phase 3 is blocked
> on Q-01 (the handheld platform). Read [`CLAUDE.md`](CLAUDE.md) before writing code.

---

## Quickstart (developer)

**Prerequisites**

| Tool | Version | Needed for |
|---|---|---|
| Node.js | ≥ 20 (CI uses 22) | lint, tests, tooling |
| npm | ≥ 10 | dependency install |
| JDK | 17 (Temurin/OpenJDK) | SuiteCloud SDF CLI only — not needed for lint/tests |
| SuiteCloud CLI | `@oracle/suitecloud-cli` | deploying to a NetSuite account — see [DEPLOY.md](DEPLOY.md) |

**Get to green locally**

```bash
git clone <this-repo>
cd ER_NetSuiteWMS
npm install          # or `npm ci` for an exact, lockfile-pinned install
npm run verify       # lint + unit tests + invariant guard — all must pass
```

`npm run verify` is exactly what CI runs. If it's green locally, CI will be green.

**Get to a DEV deployment** → follow [DEPLOY.md](DEPLOY.md). Deploying requires a
NetSuite DEV sandbox and the SuiteCloud CLI; it is intentionally a separate,
account-dependent step and is not part of `npm ci`.

---

## Repository layout

```
.
├── CLAUDE.md                 # Coding conventions + 20 non-negotiable invariants — read first
├── README.md                 # You are here
├── DEPLOY.md                 # Deploy command per environment + sandbox runbook
├── CONTRIBUTING.md           # Branch policy, PR flow, CI gates
├── docs/                     # The delivery plan (read 05 before 01/02 — see below)
│   ├── 00-objective.md
│   ├── 01-review-findings.md
│   ├── 02-architecture.md
│   ├── 03-data-model.md
│   ├── 04-open-questions.md
│   ├── 05-decisions-log.md
│   ├── 06-netsuite-boundary.md
│   └── delivery-plan.md
├── tasks/                    # Task backlog with Given/When/Then acceptance criteria
│   ├── phase-0-2-foundation.md
│   ├── phase-3-5-engine.md
│   ├── phase-6-9-operations.md
│   └── phase-10-13-hardening.md
├── src/                      # SDF Account Customization Project (deployed by SDF)
│   ├── manifest.xml
│   ├── deploy.xml
│   ├── FileCabinet/SuiteScripts/WMS/lib/
│   │   └── wms_lib_example.js   # scaffold-only; proves the harness. Delete in Phase 2.
│   └── Objects/                 # customrecord_wms_* land here from T-1.1 onward
├── test/                     # Unit tests (jest) — never require a NetSuite account
│   ├── stubs/N/              # SuiteScript module stubs (N/error, N/record, …)
│   └── example.test.js
├── scripts/
│   └── guard-forbidden-tokens.js   # CI guard for invariant #13 (no bins in code)
├── suitecloud.config.js      # SDF project → src/
├── babel.config.js           # AMD→CommonJS for jest only (not for deployed code)
├── jest.config.js
├── .eslintrc.json
└── .github/workflows/ci.yml
```

---

## Testing — pure logic without a NetSuite account

Business logic lives in `lib_` modules as pure functions (CLAUDE.md convention),
so it can be unit-tested with no account. The harness makes that work:

- **`jest.config.js`** maps every `N/*` import to a stub in `test/stubs/N/` via
  `moduleNameMapper`.
- **`babel.config.js`** rewrites SuiteScript's AMD `define([...], factory)` into
  CommonJS at test time (`babel-plugin-transform-amd-to-commonjs`) so `src/`
  modules are `require()`-able. This transform is **test-only** — SDF deploys the
  source unchanged.
- See [`test/stubs/README.md`](test/stubs/README.md) for how to add or extend a stub.

```bash
npm test                 # run once
npm test -- --watch      # TDD loop
npm run test:coverage    # coverage over src/FileCabinet/SuiteScripts
```

---

## Planning documents — read in this order

1. [`docs/00-objective.md`](docs/00-objective.md) — objective, scope, target architecture
2. [`docs/05-decisions-log.md`](docs/05-decisions-log.md) — **read early.** Sponsor rulings D-01…D-11 and what they overrode
3. [`docs/06-netsuite-boundary.md`](docs/06-netsuite-boundary.md) — **read before any ledger code**
4. [`docs/01-review-findings.md`](docs/01-review-findings.md) — 25 findings (some superseded — the log says which)
5. [`docs/02-architecture.md`](docs/02-architecture.md) — 18 architecture decisions
6. [`docs/03-data-model.md`](docs/03-data-model.md) — consolidated schema
7. [`docs/04-open-questions.md`](docs/04-open-questions.md) — open decisions; **1 hard blocker (Q-01)**
8. [`CLAUDE.md`](CLAUDE.md) — conventions + the 20 invariants

> ⚠️ **05 before 01/02.** The findings and architecture docs contain superseded
> material (a five-tier capability model, a per-item dependency graph, serial-number
> handling). The decisions log marks what was overruled. Do not build from the
> superseded sections.

The full backlog is **66 tasks across four phase files** in `tasks/`, covering
Phases 0–13: discovery, data model, core services, ingestion & handheld, ledger
commit, replenishment, inbound, waves, pick & pack, exceptions & custody,
dashboard, bin remediation, housekeeping, performance, and cutover.
