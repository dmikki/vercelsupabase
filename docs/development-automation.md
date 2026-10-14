# App-request development workflow

## What is implemented

Logged-in users open **Request a change**, describe the requested behavior, and submit it. The server verifies the Supabase user, stores the request with row-level isolation, and creates a GitHub issue. Requests use stable UUIDs for retries and are limited to five per user per day. Failed GitHub publication is retryable without losing the request.

An administrator identified by Supabase user ID can authorize implementation from the panel. Alternatively, the repository owner adds `codex-approved` to the issue. The GitHub workflow runs Codex in a separate job without repository write credentials, validates its patch against allowed paths, and publishes a branch and PR. Validation runs in a fresh runner without production or OpenAI secrets. Vercel builds a preview through the existing Git integration.

The owner reviews the PR and preview and approves the exact head commit. Merge requires successful **Development CI**, validation against the current `main`, and a successful Vercel preview. Vercel then deploys `main`. Account pages poll the deployed version every minute and on window focus, reloading idle pages or presenting **Update now** when there are unsaved profile/request edits. Local and preview builds do not force refreshes. GitHub login may be required to open private issue/PR links.

The request panel is a structured request interface with a chat icon, not a separate LLM chatbot. Clarifications can be added on the linked GitHub issue; Codex includes the last 20 comments when it runs. Status refreshes while the panel is open. GitHub status outages do not silently mark requests successful.

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
| `DEVELOPMENT_ADMIN_USER_IDS` | Your **app user's Supabase UUID**, not your GitHub username. Comma-separated if there are multiple admins. Get it from Authentication → Users. Local and cloud IDs can differ. |

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
4. If checks are pending, the Vercel status event or validation completion rechecks eligibility. If `main` changed, run **Development validation** from Actions with the PR number and latest head SHA, then rerun **Owner approval and merge** if needed. Only code with passing checks can merge.
5. To ask Codex for a revision, run **Implement app request with Codex** from Actions with the original issue number, `revision_pr`, and revision instructions. Codex starts from the PR's current head and updates the same branch. New approval is then required. Add issue comments for clarifications before a new implementation run.

## Scope and failure behavior

- Automated requests may modify application code and tests only. Automation infrastructure, authentication helpers, dependency/config changes, and database migrations are excluded by an enforced patch allowlist. Requests requiring those changes stop for a separately reviewed engineering change.
- Codex has a 20-minute timeout. Failure labels and workflow links appear on the issue. Retry using Actions after resolving configuration or task issues. A generated PR may exist even if a later publication step failed; inspect branches/PRs before retrying.
- Publish retries reconcile existing issues with the request UUID. Concurrent retries use a two-minute database lease. If reconciliation exceeds 1,000 issues, publishing stops rather than guessing and creating a duplicate.
- GitHub issue and PR links do not expose Supabase UUIDs or email addresses. Request contents are sent to the private repository and to Codex for implementation.
- No database credentials or production API keys are supplied to generated-code validation jobs. Only the Codex job receives the API credential through the official action's proxy.
- A failed deployment keeps the prior production version active; no successful-deployment version appears to users. `merged` is distinct from `deployed` in request status.
- UI refresh preserves server-backed login sessions, but intentionally delays while known unsaved inputs or uploads are active. New editable components should participate using `data-unsaved="true"` while dirty/busy.

## Rollback

Use Vercel's previous successful deployment to restore service immediately. Then revert the offending merge through a reviewed GitHub PR so Git history matches the desired release. Verify Vercel's auto-assignment state after a rollback before promoting the next release. Database rollback is a separate explicit migration decision; the autonomous path does not execute schema changes.

## Verification / first test

```bash
npm run typecheck
npm test
npm run build
```

Then log into a test environment, submit **Add a small welcome heading above the profile form**, authorize it, watch Actions, review the preview, approve the exact SHA, and confirm the deployed heading appears after the release notification/reload. Also test logged-out submission, another user's request access, a failed Codex run, stale approval, and an unsaved profile edit during release.

The bootstrap implementation has build and unit-test coverage, but the live request → Codex → approval → deployment loop cannot be validated until the above credentials and migration are configured.
