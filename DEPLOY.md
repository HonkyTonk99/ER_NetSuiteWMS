# Deployment

The WMS is an **SDF Account Customization Project** (`src/`, project type
`ACCOUNTCUSTOMIZATION`). One project is deployed to whichever account an
`--authid` points at; environments are distinguished by their authid, not by
separate project copies (AD-13).

| Environment | authid (convention) | Purpose |
|---|---|---|
| DEV sandbox | `wms_dev` | Day-to-day development and integration testing |
| UAT / staging sandbox | `wms_uat` | UAT with production-data refresh |
| Production | `wms_prod` | Go-live |

> **What can and cannot be run from this repo.** The commands below deploy code
> to a NetSuite account. **Provisioning the DEV/UAT sandboxes, refreshing them,
> and running an actual deploy all require a licensed NetSuite account and admin
> access** — they cannot be performed from the planning/CI environment and are
> not automated here. This document is the runbook a developer or admin follows
> against a real account.

---

## 1. One-time prerequisites

- **Node.js ≥ 20** and **npm ≥ 10**.
- **JDK 17** (Temurin/OpenJDK). The SuiteCloud CLI wraps the SDF SDK, which is a
  Java tool; `java -version` must work.
- **SuiteCloud CLI**:
  ```bash
  npm install -D @oracle/suitecloud-cli
  # or globally: npm install -g @oracle/suitecloud-cli
  ```
  (Kept out of the project's default devDependencies so `npm ci` for lint/tests
  stays fast and Java-free. The `deploy:*` npm scripts call `suitecloud`, which
  resolves once the CLI is installed.)

## 2. Provision the sandboxes (account admin)

1. In NetSuite, ensure a **DEV sandbox** and a **UAT/staging sandbox** exist
   (Setup → Company → Sandbox Accounts).
2. Enable the assumed platform features (see [`docs/06-netsuite-boundary.md`](docs/06-netsuite-boundary.md)):
   Locations (`MULTILOCINVT` as applicable), and per-item Lot tracking. **Bin
   Management stays OFF** (D-07) — T-0.1 verifies this via `runtime.isFeatureInEffect`.
3. Establish the **refresh cadence** (e.g. UAT refreshed from Production before
   each UAT cycle). Record the cadence alongside the T-0.1 findings.

## 3. Authenticate each environment (one authid per sandbox)

Interactive (developer workstation):
```bash
npx suitecloud account:setup
# create/select the authid: wms_dev  (repeat for wms_uat, wms_prod)
```

Non-interactive (CI / headless), using a token from an integration record:
```bash
npx suitecloud account:savetoken \
  --authid wms_dev --account <ACCOUNT_ID> \
  --tokenid <TOKEN_ID> --tokensecret <TOKEN_SECRET>
```
Credentials are stored by the CLI **outside** the repo and are git-ignored.
Never commit tokens.

## 4. Deploy

```bash
npm run validate:dev     # suitecloud project:validate --server --authid wms_dev
npm run deploy:dev       # suitecloud project:deploy   --authid wms_dev
npm run deploy:uat       # --authid wms_uat
npm run deploy:prod      # --authid wms_prod
```

`project:deploy` applies `src/manifest.xml` + `src/deploy.xml` — the FileCabinet
scripts under `SuiteScripts/WMS/` and every object under `Objects/`. Deployment
is fully described by the project, so **a clean clone deploys with no manual
point-and-click changes** (AD-13). Validate first; deploy second.

## 5. Acceptance-criteria verification (needs a live account)

T-0.5's first and third acceptance criteria are verified against a real DEV
sandbox — check them off once §3–§4 have been run there:

- [ ] Clean clone + `npm run deploy:dev` deploys with no manual account changes.
- [ ] A new developer reaches a working DEV deployment by following this file and
      the README, with no tribal knowledge.

The second criterion (CI runs lint + tests and blocks merge) is satisfied by
`.github/workflows/ci.yml` plus branch protection — see [CONTRIBUTING.md](CONTRIBUTING.md).
