# AI development team

Specialised roles (Architect, Frontend, Backend, Database, Testing, Security, DevOps) work on one goal together. They plan as a task graph, share context, propose file changes, and **nothing is applied until the project owner approves it**. Page: `/app/projects/<workspace>/<project>/team`.

> **All numbers below are placeholders** (`DEV_TEAM_DEFAULTS` in `lib/dev-team/types.ts`; override with the `DEV_TEAM_LIMITS` env JSON). Credit prices are not final. Nothing here was tested against a live model.

## Flow

1. **Start** (`startRun`): kill switch check, goal validation (length, no secrets), one active run per project, credit estimate, reservation (hard cap per run), audit log. Execution then runs after the response (`after()`).
2. **Plan**: the Architect returns a task list. `validatePlan` rejects cycles, unknown roles/keys/dependencies, oversize plans and plans that are too deep. One repair retry.
3. **Schedule** (`runSchedule`): ready tasks (all dependencies DONE) run with a concurrency limit, per-task timeout and run deadline. A failed task makes its dependents SKIPPED. The kill switch, a cancel, and the credit/call budget are checked before every start and every attempt.
4. **Context** (`buildTaskCall`): project brief (project memory), outputs of upstream tasks, the team message log and files are wrapped as untrusted and token-limited. Files with instruction-like text are shown read-only.
5. **Permissions** (`permissions.ts`, enforced in `parseTaskOutput`): Architect, Testing and Security are read-only reviewers. Other roles may only propose changes in their own path scopes. No role can apply, publish, send messages, or spend marketing or development credits. Secrets, `.env`, `.git`, lockfiles, `node_modules`, absolute and `..` paths are always refused.
6. **Merge** (`merge.ts`): proposals for a file share the run-wide base hash. Disjoint hunks merge deterministically (CRLF preserved). Differing base hashes, overlapping/touching hunks, create/create, delete vs modify are a **CONFLICT**: nothing is guessed or overwritten. The Architect may *suggest* a merge; a person must pick a version, accept the suggestion, paste content, or drop the file.
7. **Verify** (`verify.ts`): the existing code-scan scanners run on merged files and only **new** findings count; new HIGH/CRITICAL findings block. If the scanner cannot run it blocks, and files that cannot be scanned are shown as "not run". The regression gate (tests/build) is **always shown as not run**: it executes on saved files and the proposals are not saved yet. It is never reported as passed.
8. **Approve** (`approveAndApply`): owner only, reason required, kill switch respected, fresh re-verification, explicit acknowledgement that tests were not run (and of protected-feature touches). A project checkpoint is saved first; files are written with rollback on error. Recorded in the audit log and project memory; code map refreshed. Reject is audit-logged too.

## Credits

Estimate = planner + (max tasks × task) + one resolver call, capped per run (placeholders: 3 / 4 / 3 / cap 40). Credit-metered users are charged the reservation up front through the existing ledger; the unused part is refunded when the run ends, and a failed or cancelled run is refunded in full. Unmetered users get the same budget cap but are not charged. Runs stuck active past the timeout are failed and refunded when the page loads.

## Data

`DevTeamRun`, `DevTeamTask`, `DevTeamChangeProposal`, `DevTeamMessage`, `DevTeamMergedFile` (migration `20261020490000_dev_team`). They use a plain `projectId` column (no Project relation), so project deletion does not cascade to them.

## Known limits

- Tasks do not see files created by other tasks in the same run, only their summaries.
- No tests/build run before apply; run the Quality page regression check after applying.
- Whole files only (no partial-range edits from the model); files over the size limit are not shown to roles.
- Approval is owner only.
