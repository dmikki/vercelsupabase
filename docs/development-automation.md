# App-request development workflow

## What is implemented

Logged-in users open **Request a change**, describe the requested behavior, and submit it. The server verifies the Supabase user, stores the request with row-level isolation, and creates a GitHub issue. Requests use stable UUIDs for retries and are limited to five per user per day. Failed GitHub publication is retryable without losing the request.

Only an administrator identified by Supabase user ID can authorize implementation, either by accepting the estimate when submitting their own request or with **Approve estimate & implement** on another user's request. Alternatively, the repository owner adds `codex-approved` to the issue. Complex requests remain manual. The GitHub workflow runs Codex in a separate job without repository write credentials, validates its patch against allowed paths and forbidden content (environment access, server actions, privileged server imports), and publishes a branch and PR. Validation runs in a fresh runner without production or OpenAI secrets. Vercel builds a preview through the existing Git integration.

Every PR requires the owner to review the release readiness report and approve the exact head commit; there is no automatic merge path. Owner rejection blocks merge. Merge also requires successful **Development CI**, validation against the current `main`, a successful **Preview verification** against staging, and a successful Vercel preview. Production database migrations are applied just before the merge, then Vercel deploys `main`. Account pages poll the deployed version every minute and on window focus, reloading idle pages or presenting **Update now** when there are unsaved profile/request edits. Local and preview builds do not force refreshes. GitHub login may be required to open private issue/PR links.

The request panel is a structured request interface with a chat icon, not a separate LLM chatbot. Clarifications can be added on the linked GitHub issue; Codex includes the last 20 comments when it runs. Status refreshes while the panel is open. GitHub status outages do not silently mark requests successful.

## Release pipeline: test on staging, then approve for production

Nothing reaches production until it has been tested on a separate staging environment and the owner has approved the exact commit. The administrator only has to read one report and choose: approve, remedy, reject, or roll back.

```text
request -> Codex PR -> automated tests -> staging database + Vercel preview -> verification
        -> release readiness report on the PR -> owner approves -> production database -> merge -> Vercel deploy -> production verification
```

What runs automatically for every request PR:

1. **Code checks** (`Development validation`): merge with current `main`, migration policy, types, lint, unit tests, production build.
2. **Database upgrade test** (only when the PR adds migrations): `scripts/development/database-check.sh` builds the schema `main` has today on a throwaway local Supabase stack, loads existing data, applies only the new migrations, then proves the data survived, the security invariants hold (`integration/schema-invariants.sql`) and the integration tests pass (`integration/`: row-level security, request quota, private storage).
3. **Staging database and preview verification** (`Preview verification`, runs when Vercel finishes the preview): brings the staging database to `main` plus the PR's migrations, runs the invariants and integration tests there, and smoke-tests the preview: right commit, Preview environment, connected to staging and **not** to the production database, Supabase reachable, login page renders, protected pages and APIs require login.
4. **Release readiness report**: one bot comment on the PR (kept up to date) and a status line in the portal's change request list for the administrator. Verdicts: waiting, ready, blocked, setup required, approved.
5. **Automatic repair**: if a check fails because of the change itself, Codex is asked once to repair the PR (never for missing setup). Everything is then tested again from scratch.

Administrator options, as comments on the PR:

| Command | Effect |
| --- | --- |
| `/approve <full commit SHA>` (or GitHub Review, Approve) | Releases that exact commit. Production database migrations are applied first, then the code merges and Vercel deploys. |
| `/remedy <instructions>` | Codex revises the PR with your instructions; approval of the old commit no longer applies and all tests run again. |
| `/reject` | Stops the release. |
| `/rollback` (on the merged PR) | Opens a PR that reverts the release's code. It ships automatically after its own checks, with no second approval. |

After deployment, `Production verification` checks that production serves the merged commit, is in the Production environment, uses the production database and passes the same smoke tests. The result is posted on the PR and shown in the portal. A failed verification tells you to comment `/rollback`; it never rolls back by itself.

### How database changes are automated safely

Codex may now add **new** migration files (`supabase/migrations/<timestamp>_<name>.sql`) when a request needs schema changes. `scripts/development/migration-policy.mjs` enforces, in the publish step, in CI, on staging and again before production:

- Additive only: create tables, indexes, functions, policies, views; add columns (a `NOT NULL` column needs a default). No drop, rename, retype, `SET NOT NULL`, `UPDATE`, `DELETE`, `TRUNCATE`, `DO` blocks, extensions, roles, schemas other than `public`, or changes to `auth` or `storage` tables.
- Every new table enables row level security in the same migration; policies name `authenticated` or `service_role`, never `using (true)`; grants only go to `authenticated` or `service_role`; `security definer` functions set `search_path`; views use `security_invoker`.
- Existing migrations are immutable; new versions must be newer than the latest one on `main`; at most 3 per request.

Because migrations are additive, production runs them **before** the merge: the version already live keeps working, the new version finds its schema, and a code rollback never needs a database rollback (rollback PRs deliberately keep the migration files). Requests that need anything the policy rejects stay manual engineering. The production step refuses to run if the database would apply any migration other than the ones in the approved PR (a sign its migration history drifted); see "Baseline" below.

### One-time setup

The pipeline fails closed: until this is configured the report shows **Setup required** and nothing merges.

1. **Staging Supabase project.** Create a second Supabase project. It can start empty: every verification brings it up to `main`'s schema plus the PR's migrations (history entries left by abandoned PRs are repaired automatically). Staging is disposable and holds only test data.
2. **Vercel environment variables.** In Vercel, scope the Supabase values per environment. Production: the production project's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. **Preview: the staging project's values**, plus its own `ESTIMATE_SIGNING_SECRET` and `DEVELOPMENT_ADMIN_USER_IDS`. The preview check fails if a preview points at the production database.
3. **Vercel Deployment Protection.** If previews are protected, create a Protection Bypass for Automation secret in Vercel and store it as `VERCEL_AUTOMATION_BYPASS_SECRET`.
4. **GitHub repository variable** `PRODUCTION_SUPABASE_URL`: the production project URL (public value, used to prove isolation).
5. **GitHub secrets** (repository secrets, or secrets of the `release-staging` and `release-production` environments, which GitHub creates on first use):

| Secret | Environment | Value |
| --- | --- | --- |
| `STAGING_DATABASE_URL` | `release-staging` | Staging **Session pooler** connection string (GitHub runners have no IPv6, so not the direct host). |
| `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` | `release-staging` | Staging project API URL and keys, used by the integration tests (they create and delete their own test users). |
| `PRODUCTION_DATABASE_URL` | `release-production` | Production Session pooler connection string. Only used after owner approval. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | either | Only if previews or production URLs are protected. |

   Optionally add required reviewers to the `release-production` environment for a second click before production changes. The existing `AUTOMATION_GITHUB_TOKEN` also needs **Actions: read and write** to dispatch the revision and rollback workflows.
6. **Baseline (only if production or staging were migrated by hand).** Supabase tracks applied migrations in `supabase_migrations.schema_migrations`. If you ran earlier migrations in the SQL editor, run **Actions, Baseline database migration history** once per database with the newest migration already applied and the word `BASELINE`. It records them as applied without running them. Otherwise the production guard stops the release and tells you so.
7. Keep `main` protected as described below. Vercel's preview and production deployments must stay enabled so `deployment_status` events reach the verification workflows. If a PR predates this pipeline, run **Actions, Preview verification** manually with its number.

Run the pipeline's database tests yourself with a local stack (`npx supabase start`): `BASE_SHA=$(git merge-base HEAD origin/main) npm run test:database`.

## One-time activation checklist

The initial implementation PR must be reviewed and merged before issue-triggered workflows are available on the default branch. Configure credentials directly in GitHub/Vercel; never commit them or send them in chat.

### 1. Database migration

Apply `supabase/migrations/20261014180000_change_requests.sql` to the same Supabase database the app uses. On local Docker Supabase, pull the feature branch and run from the app folder:

```bash
npx supabase migration up --local
```

For the existing cloud example, run this new migration in Supabase SQL Editor, or use your established linked migration workflow. Do not blindly replay the original migration: its profiles table may already exist from the dashboard setup. Apply the new migration before deploying the feature. It creates a new request table and a narrow submission function; it does not change or delete profiles.

### 2. GitHub credentials

Create a fine-grained personal access token restricted to **dmikki/vercelsupabase**. For the initial implementation, the publishing/merge token needs repository **Contents, Issues, Pull requests, Actions: read and write**, and **Commit statuses: read**. Check runs are read using the workflow’s built-in GitHub token with **checks: read**, so the personal token does not need a Checks permission. Choose an expiration and replace it before expiry. Store it in GitHub repository **Settings → Secrets and variables → Actions → New repository secret** as:

- `AUTOMATION_GITHUB_TOKEN`: publishes branches/PRs, dispatches validation, and merges owner-approved code. A personal token makes the PR author that account. Use the exact-SHA approval comment below because GitHub prohibits self-review approval.
- `OPENAI_API_KEY`: an API-project key with API billing enabled and an appropriate project budget. The automated workflow uses API access; a local Codex sign-in is not the CI credential.

The normal GitHub Actions token handles issue status and check recording. Repository workflows must be enabled. The automation does not require GitHub's native auto-merge setting.

For production at larger scale, replace the personal-token publishing credential with a repository-scoped GitHub App installation token. This separates bot authorship from owner review and avoids a human token with a long lifetime. The current code accepts bearer tokens but does not mint/refresh GitHub App installation tokens.

### 3. App environment variables

In Vercel **vercelsupabase → Settings → Environment Variables**, add these server-only values. Also add them to your untracked `.env.local` for local testing:

| Variable | Value / scope |
| --- | --- |
| `DEVELOPMENT_GITHUB_REPOSITORY` | `dmikki/vercelsupabase` |
| `DEVELOPMENT_GITHUB_TOKEN` | A separate fine-grained repository token with Issues read/write, Contents read, Pull requests read. Used to publish requests and read status; no code write/merge access needed. |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret/service-role key of the database for this environment. Server-only bookkeeping and administrator reads. Never use a `NEXT_PUBLIC_` prefix. |
| `ESTIMATE_SIGNING_SECRET` | A random value of at least 32 characters (for example `openssl rand -hex 32`) used only to sign cost estimates. Rotating it invalidates outstanding estimates. Never use a `NEXT_PUBLIC_` prefix. |
| `DEVELOPMENT_ADMIN_USER_IDS` | Your **app user's Supabase UUID**, not your GitHub username. Comma-separated if there are multiple admins. Get it from Authentication → Users. Local and cloud IDs can differ. Admins with a confirmed email also see GitHub issue and PR links. |

Production should use cloud Supabase. Local Docker uses local Supabase keys. Preview builds should use a separate test Supabase project and its own administrator ID and service key. Do not give arbitrary preview code production secrets. Keep the existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` values appropriate to each environment.

Redeploy after changing Vercel environment variables; restart `npm run dev` after changing `.env.local`.

### 4. Labels

From your authenticated Mac Terminal, create the workflow labels once:

```bash
gh label create codex-approved --repo dmikki/vercelsupabase --color 0E8A16 --force
gh label create codex-running --repo dmikki/vercelsupabase --color 1D76DB --force
gh label create codex-ready --repo dmikki/vercelsupabase --color 5319E7 --force
gh label create codex-failed --repo dmikki/vercelsupabase --color B60205 --force
```

### 5. Main-branch rules

Where supported by your GitHub plan, require PRs, require **Development CI** and the Vercel check, require the branch to be up to date, dismiss stale reviews, and prevent ordinary users/bots from bypassing these rules or pushing directly to `main`. Use a bot account if native independent-owner review is required; the command approval supplements the workflow but does not bypass repository branch rules.

Without strict branch rules, the workflow checks current main before merging but cannot prevent an unrelated direct push racing the merge. Do not describe that as a repository-wide protection guarantee. Native branch rules on private repositories may depend on account plan. This setup has not changed billing or upgraded the plan.

## Review, approve, revise

1. Open the PR's **Files changed** and Vercel preview. Verify the requested behavior.
2. If the PR author is different from you, use **Review changes → Approve**. Otherwise, as `dmikki`, post the exact command printed in the PR:

   ```text
   /approve FULL_40_CHARACTER_COMMIT_SHA
   ```

3. Approval of an older commit is rejected. To stop a pending command approval, comment `/reject`. A changes-requested review also blocks merge. A comment approval must be renewed after new commits; formal review must approve the current head.
4. If checks are pending, the Vercel status event or validation completion rechecks eligibility. If `main` changed, the merge workflow dispatches fresh Development validation once per head/base pair. Only code with passing checks can merge.
5. To ask Codex for a revision, run **Implement app request with Codex** from Actions with the original issue number, `revision_pr`, and revision instructions. Codex starts from the PR's current head and updates the same branch. New approval is then required. Add issue comments for clarifications before a new implementation run.

## Scope and failure behavior

- Automated requests may modify application code and tests, and add new additive database migrations that satisfy `migration-policy.mjs`. Automation infrastructure, authentication helpers, API routes and other route handlers, proxies, dependency/config changes, and edits to existing migrations are excluded by an enforced patch allowlist. Added lines that read `process.env`, declare `'use server'`, or import service-role/GitHub server modules are rejected. Requests requiring those changes, or migrations the policy rejects, stop for a separately reviewed engineering change.
- Codex has a 20-minute timeout. Failure labels and workflow links appear on the issue. Retry using Actions after resolving configuration or task issues. A generated PR may exist even if a later publication step failed; inspect branches/PRs before retrying.
- Publish retries reconcile existing issues with the request UUID. Concurrent retries use a two-minute database lease. If reconciliation exceeds 1,000 issues, publishing stops rather than guessing and creating a duplicate.
- GitHub issue and PR links do not expose Supabase UUIDs or email addresses. Request contents are sent to the private repository and to Codex for implementation.
- No database credentials or production API keys are supplied to generated-code validation jobs. Only the Codex job receives the API credential through the official action's proxy.
- A failed deployment keeps the prior production version active; no successful-deployment version appears to users. `merged` is distinct from `deployed` in request status.
- UI refresh preserves server-backed login sessions, but intentionally delays while known unsaved inputs or uploads are active. New editable components should participate using `data-unsaved="true"` while dirty/busy.

## Rollback

Comment `/rollback` on the merged PR. The pipeline opens a revert PR that keeps the migration files (the schema is additive and compatible with the previous code), tests it, and ships it without a second approval. For an immediate restore while that runs, use Vercel's previous successful deployment; verify Vercel's auto-assignment state afterwards. Database rollback is never automatic: a destructive change needs its own reviewed migration.

## Verification / first test

```bash
npm run typecheck
npm test
npm run build
```

Then log into a test environment, submit **Add a small welcome heading above the profile form**, authorize it, watch Actions, review the preview, approve the exact SHA, and confirm the deployed heading appears after the release notification/reload. Also test logged-out submission, another user's request access, a failed Codex run, stale approval, and an unsaved profile edit during release.

The bootstrap implementation has build and unit-test coverage, but the live request → Codex → approval → deployment loop cannot be validated until the above credentials and migration are configured.


## Estimates and spending approval

Apply only the new `supabase/migrations/20261014200000_change_request_costs.sql` migration before merging the cost-estimates PR. It adds an estimate column and a service-role-only singleton spending policy; existing profile/request records remain intact. Neither the earlier database threshold nor a dollar threshold authorizes work automatically; only administrator acceptance does. This policy update needs no new migration.

The panel estimates without making an OpenAI API call. It uses explicit, conservative heuristic ranges for this example app, not a codebase analysis or guaranteed quote. Published standard GPT-5.4 Mini rates checked 2026-10-14 are $0.75 input, $0.075 cached input, $4.50 output per million tokens: https://developers.openai.com/api/docs/models/gpt-5.4-mini. The workflow selects `gpt-5.4-mini` with medium reasoning. There is no automatic model fallback with a different price. Confirm the API project can access this model before a paid run.

Estimates expire after 15 minutes and are signed on the server against the authenticated user and exact request text. Editing the request invalidates the estimate. Clicking Estimate & submit saves the request. Admins' eligible requests launch implementation; other users' requests wait for administrator authorization. Code merge always remains manual. Complex/schema/auth/infrastructure requests stay manual. Estimates are not a billing cap; there is no enforced token/dollar stop within a Codex run. Five requests per user per day and the existing 20-minute job timeout still apply. Pricing/model changes must update both the cost module and workflow; renew estimates after changes.

Older queued requests show a newly calculated estimate; the admin must accept it before launch. Retries reuse the same request ID and GitHub issue; automatic labeling does not restart running, ready, failed or already-approved issues. GitHub labels are applied after issue creation so the existing labeled-event workflow triggers.

The separate `usage` job reads the completed implementation job's logs using GitHub Actions' built-in token, extracts only top-level `turn.completed` JSON events, and posts numeric usage as a bot comment on the request. It never sends raw logs or production credentials to the app. Logs are read from the current run attempt. Reports are deduplicated by run/attempt; revisions remain separate runs. Cached tokens are subtracted from total input before pricing. No completion events means usage unavailable, never zero billed. Failed/interrupted jobs are marked incomplete. Calculated costs are model-token charges at published rates, not reconciled billing invoices; discounts, regional surcharges, taxes, hosting and GitHub minutes are excluded. No OpenAI admin/billing credential is required or exposed. Treat reports as best-effort telemetry: the app accepts reports only from github-actions[bot], but repository maintainers can modify workflows and generated job output is not a billing audit trail.

For activation: apply the migration, review and merge the PR, wait for production deployment, then test a small admin request. Verify one issue, one implementation run, bot usage report, one PR, CI and Vercel preview, exact-head owner approval, merge and release refresh. Also submit a request from a non-admin account: it must wait for administrator authorization, and its PR must wait for owner approval. Full paid execution and billing reconciliation require live verification after deployment.


## Dashboard and reference attachments

Apply only `supabase/migrations/20261014203000_request_attachments.sql` before merging the dashboard/attachments PR. It creates a private `change-request-attachments` bucket, owner-readable/service-writable attachment metadata, an atomic upload quota function callable only by service_role, and a request type field. No new secrets or bucket policies need to be entered manually. The service role is used only in authenticated server routes. Existing profiles and requests remain intact.

Logged-in users get a responsive sidebar (Overview, Profile, Change requests, Suggestions), a top-right Request a change action, and a profile dropdown with profile management and sign out. Suggestions use the same estimate, authorization, GitHub review and deployment flow, with their request type recorded. The profile editor stays available without discarding unsaved fields when navigating.

The request form supports up to 5 attachments: PNG/JPEG/WebP up to 2 MB each; UTF-8 TXT/MD/CSV/JSON up to 100 KB each. PDF, Office files, executables, SVG and archives are not supported in this version. A per-user quota allows 25 retained/reserved uploads in 24 hours; removed successful uploads still count toward the daily quota. Images are checked against file signatures; text must be valid UTF-8 without NUL bytes. Pending files can be removed. After submission the references are immutable through the app. Unsubmitted draft files remain stored until removed; no automatic draft-retention cleanup is configured.

App download/preview links expire after one hour and refresh when requests reload. GitHub issue reference links expire after 24 hours. These signed links grant temporary access to their holders; the bucket is private and URLs are shared with repository reviewers and the implementation job. Do not attach credentials or unrelated personal records. The owner can renew expired reference links on failed requests before retrying the Actions workflow. Preparing a run fails visibly if references are missing, expired or invalid, before making a model call.

The estimate is bound to the request kind plus selected attachment IDs, names, types, sizes and SHA-256 hashes. Attaching/removing files invalidates the quote, and estimates add a conservative context allowance. Changing the references requires a fresh estimate. The workflow downloads only signed objects from this project's configured cloud Supabase origin, refuses redirects and foreign hosts, limits bytes and verifies SHA-256. Images are passed through Codex's --image option; text is included as untrusted reference data. Reference files live outside the git checkout, are never committed to the app, and temporary GitHub artifacts expire after one day. Local Docker attachment URLs cannot be fetched by a cloud GitHub runner.

Activation checks after migration and deployment: open/close the sidebar and profile dropdown on mobile and desktop; verify sign out and profile editing; upload a screenshot and text requirements; remove a pending file; estimate and submit; verify ownership isolation using a second account; check that a paid run receives the references, produces one PR and reports usage. Database/storage/live paid-run checks are pending until deployment.
