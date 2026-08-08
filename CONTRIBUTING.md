# Contributing & branch policy

## Branching model

- **`main`** is the default, protected, always-deployable branch. No direct pushes.
- **Feature branches** branch off `main` and merge back via pull request:
  - `claude/<topic>` for agent-driven work (e.g. `claude/netsuite-sdf-foundation-wf21ep`)
  - `feature/<task-id>-<short-desc>` for human work (e.g. `feature/T-1.1-core-records`)
- Keep one branch per task where practical; reference the task ID (`T-x.y`) in the
  branch name and PR title so work traces back to `tasks/`.

## Pull request flow

1. Branch, commit, push.
2. Open a PR into `main`. Title: `T-x.y — <what>`.
3. CI (`.github/workflows/ci.yml`) runs **lint + unit tests + the invariant guard**
   on the PR. All must pass.
4. At least one review approval.
5. Squash or merge once green and approved.

Before opening a PR, run the same checks locally:
```bash
npm run verify
```

## Definition of done

Per [`CLAUDE.md`](CLAUDE.md): the task's acceptance criteria all pass; pure logic
has unit tests; no new hard-coded tuning values; failure paths raise an actionable
exception rather than a silent log; governance is measured for anything on the scan
or commit path.

## Enabling branch protection (repo admin, one-time)

CI runs automatically, but **blocking merge on failure requires branch protection**
— a GitHub repository setting, not something the repo can configure for itself:

1. Settings → Branches → Add branch ruleset (or classic protection) for `main`.
2. Require a pull request before merging (≥ 1 approval).
3. Require status checks to pass → select **“Lint, unit tests & invariant guard”**
   (the `verify` job in CI).
4. Require branches to be up to date before merging.

Until this is enabled, CI reports status but does not enforce it.

## Commit messages

Imperative mood, scoped to one logical change. Reference the task ID where it
applies, e.g. `T-1.1: add customrecord_wms_scan_event with unique event id`.
