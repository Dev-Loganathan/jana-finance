# Jana Finance: Decisions Log

Format: decision, reason. Newest at the bottom of each section.

Status tags: **[built]** in the code today, **[decided]** agreed but not built yet, **[open]** still needs an answer from the owner. Current build status is in `docs/progress.md`.

## Product and scope

- **Name:** Jana Finance. Users: 3-4 staff, 100+ customers, scalable to several thousand.
- **Chit model (default, until real rules are supplied):** auction chit. Winner bids a discount; foreman commission 5% of chit value; remaining discount is shared equally as dividend. All parameters are per-group configuration.
- **Loan model (default):** flat, reducing balance, interest-only; 365-day basis; penalty is a percent per month on the overdue amount. All configurable per product.
- **[open]** **Loan conventions** are defaults only until the owner supplies real rules (see Open decisions below).
- **Legal:** commission caps, max chit value and interest caps are configuration only. The business must confirm the rules for its state (Chit Funds Act, 1982; money-lending rules) with a legal advisor.

## Architecture

- **[built]** Modular monolith: NestJS API, React (Vite) web, shared package. Monorepo with pnpm workspaces.
- **[decided]** **Queue:** pg-boss (Postgres-backed) instead of BullMQ and Redis. One less service to run and pay for at this scale. Revisit if job volume grows a lot.
- **[built: local disk; R2/B2 driver decided]** **Storage:** `StorageDriver` interface. Local disk in dev and small deployments; S3-compatible (Cloudflare R2 or Backblaze B2) when ready. No MinIO in production.
- **[built]** **Money:** BIGINT paise plus decimal.js. Half-up rounding; any schedule rounding residue goes to the last installment.
- **[built]** **IDs:** UUIDv7 primary keys; separate human-readable codes (e.g. CUS1007).
- **[built]** **Ledger:** append-only, double-entry. Corrections by reversal only. Single posting service with idempotency keys.
- **[built for duplicate detection; general fuzzy search decided]** **Search:** Postgres pg_trgm for fuzzy name and phone search.
- **[decided]** **PDF:** server-side HTML to PDF (Tamil font support).
- **[built]** **Sensitive data:** AES-256-GCM field encryption plus HMAC blind index for duplicate detection; masked by default; permissioned, audited reveal.
- **[decided]** **Notifications:** provider interfaces. WhatsApp Cloud API (mock in dev). Auction reminders to all group members at T-3, T-1 and auction day, plus the result. Meta template approval is required for business-initiated messages. Fallback: `wa.me` manual send button.

## RBAC

- **Permission format:** `module:action` (colon), matching the existing app's screens.
- Default roles: Super Admin (locked, single, 2FA mandatory), Admin, Staff, Manager. Others are created from the UI.
- Super Admin cannot be assigned through the Create User form.
- Password policy: at least 12 characters with uppercase, lowercase, digit and special character. Forced change on first login.

## UI

- Tailwind + shadcn/ui, lucide, Inter (tabular numerals) with Noto Sans Tamil fallback.
- All design tokens live in one theme file. Light theme first, dark mode via tokens later.
- Customer wizard follows the existing 6 steps: Basic, Address, KYC & Documents, Employment (with bank), References, Evaluation. Consent and signature are captured in step 6.
- Risk level and category are auto-calculated from CIBIL and debt-to-income; bands are configurable (initial default: high risk if CIBIL < 650 or DTI > 50%).

## Hosting (cheap)

- Single VPS in India (about Rs 400-600/month), Docker Compose plus Caddy for HTTPS. Nightly pg_dump to R2 or B2.

## Environment notes

- `corepack enable` needs admin rights on this machine; use `corepack pnpm ...` or install pnpm globally.

## Engineering

- **Lint/format:** ESLint (typescript-eslint, react-hooks) + Prettier (120 cols). `parseFloat` is banned to keep floating point away from money.
- **Tests:** Jest integration tests hit a real Postgres (`jana_test`); Playwright e2e uses a throwaway `jana_e2e` database dropped on every run. The e2e suite uses the locally installed Chrome; CI installs Chromium.
- **CI audit gate:** fails on high/critical advisories in production dependencies. Transitive `multer`, `lodash` and `js-yaml` are pinned to patched versions through `pnpm.overrides` in the root `package.json`. Revisit the overrides when NestJS is upgraded.
- **Dev port:** Postgres is published on 5433 because 5432 was already in use on the developer machine.
- **Seed password** must satisfy the same password policy as users, and must be quoted in `.env` (an unquoted `#` starts a comment).

## Customers and KYC

- **Wizard:** 6 steps as in the existing app. Each step saves as a draft (partial data allowed, anything present must be valid). Consent (DPDP) is captured in step 6 and is mandatory to submit. The customer photo is the PHOTO document (uploaded on step 1); the wizard's "Selfie" slot in step 3 is the same document.
- **Status:** DRAFT, ACTIVE, INACTIVE. Submitting activates directly. The brief's SUBMITTED / UNDER_REVIEW / REJECTED / NEEDS_CHANGES states are deferred until the generic approvals (maker-checker) engine exists, and will be a setting ("customer approval required").
- **KYC policy (default):** Aadhaar, PAN and photo are required. KYC status: NOT_STARTED, PARTIAL (a required item missing), COMPLETE (all supplied, not all verified), VERIFIED, EXPIRED. Becomes per-product configuration in Settings.
- **Risk and category:** category by CIBIL (750+ Excellent, 700+ Good, 650+ Medium, else Poor). Risk is HIGH if income is zero, CIBIL < 650 or debt-to-income > 50%; MEDIUM if CIBIL < 750 or DTI > 30%; else LOW. Comparisons use exact integer arithmetic.
- **Sensitive data:** ID numbers and account numbers are AES-256-GCM encrypted with an HMAC blind index. The API returns masked values only; `POST /customers/:id/reveal` is permissioned and audited. Audit logs never contain numbers. Exports contain no ID or account numbers at all.
- **Files:** 5 MB, JPG/PNG/WebP/PDF decided by file bytes. Local disk behind a `StorageDriver` interface; a `VirusScanner` hook is a no-op until a scanner is chosen. Access is via 60-second HMAC-signed links, each issue audited. Client-side compression (max 1600 px) runs before upload; crop and rotate are not built yet.
- **Export:** CSV (opens in Excel). Cells that start with `= + - @` are neutralised against spreadsheet formula injection. Excel export can be added later. Bulk import has its own section below.
- **Blacklist:** needs its own permission (`customer:blacklist`) and a reason, and is audited. The second-person approval from the brief plugs in with the approvals engine. Blocking loans and chits is enforced by those modules when built.
- **API prefix:** everything is served under `/api` so web routes (`/customers`) never collide with API routes. The refresh cookie is scoped to `/api/auth`.
- **Not built yet in this area** (see README "What is not built yet"): merge-duplicates tool, customer statement and no-dues certificate (need loans and chits), relationship links, guarantors, e-sign, periodic re-KYC reminders, per-role data scope (branch / assigned customers), verification-provider integrations.

## Ledger

- **Built before chits**, because every money movement must post to it. Only `LedgerService.post` writes; entries must balance, are immutable (triggers), are idempotent by key, and are corrected by reversal. Trial balance is exposed; day close, financial years and bank reconciliation come later.
- Cheque receipts post to the Bank account for now; a cheque register with clearing status arrives with the accounting phase.

## Chit funds

- **Standard auction model.** The winner receives chit value minus their discount. The foreman keeps a commission (default 5% of chit value, capped at 10% by the system; the business sets its legal cap). The rest of the discount, the dividend, is shared equally among all tickets including the winner's. Each ticket pays subscription minus dividend that month. Collections always equal prize plus foreman income to the paisa (tested).
- **Paise that cannot be split evenly** (pool divided by members) go to the foreman as income.
- **Rules enforced:** members x subscription = chit value; duration = members (one auction per month, one prize per ticket; variable-installment chits are a later extension); minimum bid >= commission (so the dividend is never negative); maximum bid at most 50%; one prize per ticket; auctions in month order; members with unpaid earlier installments cannot bid (or win a lottery draw).
- **Tie-break:** the earliest recorded bid wins. Lottery draws use the server's cryptographic random and record how many were eligible. Fixed-order chits award tickets by `payoutOrder` (default ticket number). In lottery and fixed chits the winner receives value minus commission and there is no dividend.
- **Schedule:** month 1 is the month of the start date; the auction falls on the auction day (day 29-31 clamps to the month end); installments are due N days after the auction (default 5). An installment becomes payable only when its auction closes, because the dividend is not known before then.
- **Enrolment:** ACTIVE customers with KYC COMPLETE or VERIFIED, not blacklisted; a customer may hold several tickets; seats are filled from a waiting list manually. Members cannot be added or removed once the chit starts; tickets can be transferred (audited, with a reason). The approval workflow for transfers plugs in with the approvals engine.
- **Late penalty:** simple interest per month on the overdue installment, counted daily after the grace days, minus penalty already paid on that installment. Default 0% (off). Allocation order: penalty, oldest dues, then advance. Advance is applied automatically when the next auction closes.
- **Payments:** need an `Idempotency-Key` (safe retries and double taps), are serialised per ticket, may be back-dated only with `payment:backdate`, and are corrected only by reversal (blocked when their advance was already used).
- **Ledger flow.** Collection: Dr Cash or Bank, Cr Chit payable (and Cr Penalty income for penalty). Auction close: Dr Chit payable, Cr Commission income. Prize paid: Dr Chit payable, Cr Cash or Bank. Set-off of the winner's own dues against the prize creates allocations but no cash entry. The group's payable balance returns to zero when the chit is settled; a negative balance means prizes were paid before all installments were collected.
- **Payout:** approval needs the security / guarantor confirmation. Prize payout does not wait for the other members' installments (the organiser may pay early); the statement shows the resulting gap. Second-person approval (maker-checker) for payouts, transfers and reversals is deferred to the approvals engine.
- **Registers and reports:** the auction sheet, receipt, passbook and group statement are print-friendly pages. Mandatory registers (minutes of auction, subscriber register) as PDF/Excel exports, the WhatsApp auction reminders and the customer statement are not built yet. The business must confirm state-specific Chit Funds Act requirements with a legal advisor.

## Dashboard

- **Sections follow permissions:** the API returns a section only if the caller holds the permission that shows the same data elsewhere, so the dashboard never reveals more than the rest of the app. Staff without `report:view` see no cash or staff figures.
- **Definitions:** _Collected_ counts posted receipts by payment date and excludes reversed payments and prize set-offs (no money moved). _Overdue_ is any installment past its due date with a balance; days past due are counted from the due date and bucketed 0-30, 31-60, 61-90, 90+ (1 to 30 days late is the first bucket). _KYC pending_ is active customers not fully verified. _Upcoming auctions_ is each running group's next unheld month within 30 days, flagged "not held yet" if its date has passed. _Held for chit members_ is the ledger's chit-payable balance.
- **Cash and bank** come from the ledger. There is no opening balance yet, so paying prizes in cash can show a negative cash figure; the tile says so. An opening-balance entry arrives with the accounting phase.
- **Charts:** one series per chart in the accent colour, one-hue ordered bars for ageing, every chart with direct labels, hover/keyboard tooltips and a "View as table" toggle. The dashboard refreshes every minute.
- **Not on the dashboard yet** (need modules that are not built): loans outstanding, interest earned, disbursements, day-end cash variance, scheduled owner emails.

## Authentication and sessions

- **[built]** Access token (15 min JWT) is held in memory only; the refresh token is an httpOnly, SameSite=Strict cookie scoped to `/api/auth`, stored server-side as a SHA-256 hash. Refresh tokens rotate on every use; presenting an already-rotated token revokes the whole session family (theft detection).
- **[built]** Lockout: 5 failed sign-ins lock the account for 15 minutes. Unknown email and wrong password return the same message, and an unknown email still does a password hash so timing does not reveal which accounts exist.
- **[built]** Users and roles are loaded from the database on every request, so suspending a user, changing a role or revoking a session takes effect on the very next request.
- **[built]** A user must change a temporary password on first login; the Super Admin must also set up 2FA. Until both are done every other endpoint returns `SETUP_REQUIRED`. 2FA setup is idempotent until enabled (a repeated request returns the same secret), which fixed a bug where overlapping requests could desynchronise the QR code.
- **[built]** Nobody can grant or assign permissions they do not hold (`ESCALATION`). The Super Admin role is locked: not assignable, editable, deletable or suspendable.
- **[built]** Break-glass: `pnpm --filter @jana/api superadmin:reset` (run from a shell on the server) resets the Super Admin password to the seed value, clears lockout and 2FA, signs out all sessions and writes an audit entry.
- **[decided]** Rate limiting is on (10 sign-ins a minute per IP, 300 requests a minute otherwise; off only in tests). IP allow-listing for admin access and a session timeout setting are still to do.

## Working agreements with the owner

- Chit model and loan conventions: the owner will supply real rules later; build with the standard defaults recorded above meanwhile.
- Hosting: cheapest workable option (one small VPS in India), not a managed platform.
- WhatsApp: needed for auction-day reminders to every member of a group (and dues and results).
- UI: follow the existing app's look and its wizard and user-management screens (screenshots supplied); design system rules as briefed.
- The owner delegated remaining choices ("others all your choices"), so defaults here were chosen by the developer and can be changed.
- Commits are made only when the owner asks. The first commit is `06a0df3`.

## Testing approach

- **[built]** Shared maths (money, chit auction, penalty, allocation, risk) has worked-example unit tests, including rounding edges and the invariant that collections equal prize plus foreman income to the paisa.
- **[built]** API integration tests run against a real Postgres. Every protected endpoint has a "401 without a token, 403 without the permission" test. Security-critical tests were checked by deliberately breaking the code (mutation checks) to confirm they fail.
- **[built]** Browser end-to-end tests drive the real UI against a throwaway database, including the full chit journey and dashboard.
- Tests that share a database measure **changes** (before and after), not absolute totals.

## Open decisions (need the owner's input)

1. **[open]** Real loan rules: interest types offered, day-count basis, penalty convention, processing fees, grace, collateral requirements.
2. **[open]** Real chit rules: commission cap and maximum chit value for the owner's state, whether prizes may be paid before all installments are collected, whether payouts need a second approver.
3. **[open]** Regulatory status (registered chit foreman, NBFC or money-lender registration) and any registers the state requires. Needs a legal advisor.
4. **[open]** WhatsApp Business (Meta Cloud API) account and approved message templates; the SMS provider and DLT registration if SMS is wanted.
5. **[open]** Whether to store full Aadhaar numbers at all. Today they are encrypted and masked; storing only the last four digits plus a hash is the lower-risk option under the Aadhaar Act and DPDP.
6. **[open]** Opening balances for cash and bank, and how capital is introduced, so the cash figure is meaningful.
7. **[open]** Whether customers need a self-service view (planned as a later phase) and which language after English (Tamil assumed).
8. **[open]** TDS and GST: whether they apply now (built as off by default when added).
9. **[open]** Hosting choice and domain, and where nightly backups go (R2 or B2 assumed).

## Bulk customer import (Excel)

- **[built]** One template (`.xlsx`) generated by the server from a single column list shared with the validator, so the template, instructions sheet, checks and error file cannot drift apart. The checks reuse the registration wizard's own schemas, so bulk and manual entry follow identical rules.
- **[built]** Mandatory columns are exactly what the wizard requires to submit: name, gender, date of birth, mobile, marital status, both addresses, state, district, pincode, residence type, Aadhaar, PAN, occupation, monthly income, bank name, account number, IFSC, both parents, nominee and relation, one reference and CIBIL. Additional income, existing loans and EMI default to 0 when blank.
- **[built]** The whole file is checked first and nothing is saved. Rows are sorted into ready, needs fixing and possible duplicates. A row with several mistakes reports all of them, each against its own column.
- **[built]** Ready rows can be imported while failing rows are downloaded as an Excel file in the same layout (offending cells highlighted, an Errors column, original row numbers). The corrected file goes through the same checks; the extra columns are ignored.
- **[built]** Duplicates (existing customers by mobile, Aadhaar, PAN, or similar name with the same date of birth, and repeats within the file) are skipped unless the user ticks "import anyway", and have their own downloadable file.
- **[built]** Imported customers are complete DRAFTS. Consent is never recorded on the customer's behalf: the list shows "Awaiting consent", and consent is ticked in the wizard's last step before activation. Documents and photos are added afterwards on each customer.
- **[built]** New customers only; updating existing customers through Excel is out of scope. Limits: 1,000 rows and 5 MB per file. `.xlsx` and `.csv` only; `.xls`, macro-enabled files and zip bombs are rejected.
- **Data protection:** uploaded rows are kept encrypted for 24 hours only and are deleted when imported, discarded or expired. Reports and audit entries carry counts and names, never ID or bank numbers. There is no background job runner yet, so expired data is cleared the next time anyone opens the import page or uploads a file.
- **[open]** A zip of photos and documents matched to customers (by Aadhaar or mobile) is a possible later addition.
