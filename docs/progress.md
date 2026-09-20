# Jana Finance: Progress

Last updated with the Loans module (Step 1). Design choices are in `docs/decisions.md`; how to run everything is in `README.md`.

## At a glance

| Area                                                                                               | Status                                                            |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Foundation (auth, users, roles, audit, design system, CI, docs)                                    | Done                                                              |
| Customers and KYC                                                                                  | Done, with a short list of gaps below                             |
| Ledger core                                                                                        | Done (minimal): posting, reversal, trial balance                  |
| Chit funds                                                                                         | Done, with a short list of gaps below                             |
| Owner dashboard                                                                                    | Done for what exists (customers, chits, loans, collections, cash) |
| Loans                                                                                              | **Step 1 done** (fixed monthly interest); later steps below       |
| Accounting beyond the ledger core (day close, expenses, bank reconciliation, financial statements) | Not started                                                       |
| Collections and field operations (agent daily list, routes)                                        | Not started (chit collection screens exist)                       |
| Notifications (WhatsApp reminders and results)                                                     | Not started                                                       |
| Reports and exports (registers, statements, scheduled emails)                                      | Not started                                                       |
| Customer self-service, payment gateway, verification providers                                     | Later phases                                                      |
| Deployment and hardening                                                                           | Not started                                                       |

Size today: 30 database tables in 6 migrations, 114 API operations, 42 permissions, 19 web pages.

## Verification (last run)

- Lint, formatting and type-check: clean for the whole repo.
- Tests: 94 shared, 317 API integration, 14 browser end-to-end. All passing. The loan interest maths is checked against hand-worked figures, and deliberately breaking it in three places, and the payment and approval rules in four more, made the tests fail.
- The app was run and used through the browser (owner journey and staff journey), and the phone layouts were checked visually for the wizard, customer profile, collections and dashboard.
- Not verified: the GitHub Actions workflow has never run (nothing is pushed); the setup script has only been run on a machine that already had a database and `.env`; colour contrast has not been measured with a tool; no load or performance test yet.

## What is built

### Foundation

- Monorepo (`apps/api`, `apps/web`, `packages/shared`, `e2e`), Docker Compose for Postgres and a dev mail catcher, one-command setup script, ESLint, Prettier, pre-commit hook, CI workflow, Swagger docs at `/api/docs`.
- Sign-in with rotating refresh tokens, lockout, invite and reset links, sessions that can be revoked, mandatory 2FA for the Super Admin, a break-glass reset command.
- Users and roles as data: create, edit, suspend, delete, force logout; roles with grouped permission checkboxes; nobody can grant permissions they do not hold; the Super Admin is locked.
- Append-only audit log (the database rejects edits and deletes) with a viewer; secrets never reach it.
- Design system page (`/design-system`) and a component library (buttons, tables, badges, money text, stepper, uploader, dialogs, permission gate, toasts).

### Customers and KYC

- Customer list with stats, drafts tab, search (including exact Aadhaar or PAN), filters, sorting and paging.
- Six-step registration wizard matching the existing app, with draft saving at every step, live risk evaluation, consent capture, and duplicate warnings by mobile, Aadhaar, PAN and similar name plus date of birth.
- ID and bank account numbers encrypted, masked everywhere, revealed only through a permissioned, audited action.
- Document upload with file type decided from the file's bytes, client-side photo shrinking, viewing through short-lived signed links, verify and reject with a reason, KYC status derived automatically.
- Customer profile with overview, KYC, notes and follow-ups, activity trail, tags, watchlist and blacklist, and chit memberships.
- **Bulk upload from Excel:** downloadable template with instructions and dropdowns; every row checked (mandatory fields, types, formats, checksums, duplicates); ready rows imported as complete drafts awaiting consent; failed rows downloadable as an Excel file to correct and re-upload; recent-uploads history; data held encrypted for 24 hours only. CSV is also accepted.
- CSV export of the customer list (no ID numbers, protected against spreadsheet formula injection).

### Ledger

- Balanced, immutable, idempotent double-entry postings; reversals; trial balance and journal API. The database itself rejects an unbalanced entry and any edit or delete.

### Chit funds

- Groups of three types (auction, lottery, fixed order) with rule checks, clone, draft, open, start, cancel and complete.
- Members: eligibility checks (active, KYC complete, not blacklisted), several tickets per customer, waiting list, transfers with a reason.
- Monthly auction: ordered bids that cannot be edited, arrears block, highest-bid winner with earliest-bid tie-break, lottery and fixed-order winners, transparent breakdown and a printable auction sheet.
- Collections: worklist, payment dialog, receipts (printable, WhatsApp share link), penalty first then oldest dues then advance, idempotent payments, back-dating permission, reversal, phone-friendly layout.
- Prize payouts with security confirmation, set-off of the winner's own dues, and ledger posting; member passbook; group statement reconciled to the ledger.
- Demo data: two running groups with several months of history, a member in arrears, and payouts at each stage.

### Hosting (dev/test)

Docker image serving API + web app, Render blueprint (`render.yaml`), Neon Postgres, Cloudflare R2 file storage via an S3 driver, migrate-and-seed on start. Image verified locally on an empty database (migrations, seed, demo data, login, SPA routes). Not yet deployed to a real host. See `docs/deploy.md`.

### Loans (Step 1)

Fixed monthly interest on the outstanding principal, principal repaid any time. Loan products; application with a live preview and eligibility checks; maker-checker approval with a written override for warnings; payout to cash or bank with the fee deducted; monthly interest worked out from the payment history (never stored as a balance); one receipt for interest and/or principal with duplicate protection; payoff quote and automatic closure; reversal of the latest receipt; collateral with photos; the collector's "interest to collect" worklist by how late; a Loans tab on the customer profile; a Loans section on the dashboard; six demo loans. Every rupee posts to the ledger and the loan's receivable is exactly zero at closure. See `docs/decisions.md` (Loans) for the rules and what was assumed.

### Dashboard

- Money, business, collections chart, overdue ageing, upcoming auctions, top defaulters, KYC and risk mix, staff collections, follow-ups, and the balance held for chit members. Sections appear only if the user has the matching permission.

## Known gaps in what is built

**Customers**

- Merge-duplicates tool, customer statement and no-dues certificate, guarantors, relationship links, e-sign, periodic re-KYC reminders, photo crop and rotate.
- Per-role data scope (own branch, assigned customers) is stored but not enforced.
- Status workflow beyond DRAFT, ACTIVE, INACTIVE (submitted, under review, needs changes) waits for the approvals engine.
- Excel (.xlsx) export of the customer list (import is Excel already); a zip of photos and documents for bulk import.

**Chit funds**

- Mandatory registers (auction minutes, subscriber register) as PDF or Excel; PDF generation in general (receipts and sheets print from the browser).
- Variable-installment chits; a group registration fee is recorded but not collected.
- Second-person approval for payouts, transfers and reversals.
- Prize payouts do not wait for other members' installments (deliberate; the statement shows the gap).

**Platform**

- Approvals (maker-checker) engine, settings screens (company profile, numbering, holidays, master data, KYC policy and risk bands as configuration), background jobs (pg-boss), notification providers, dark mode, Tamil language files, IP allow-listing, session timeout setting, data retention and anonymisation tool, backups.
- Cash and bank show no opening balance, so cash can appear negative after cash payouts.
- No global search from the top bar yet (the box is present but disabled).

## Pending, by the original build plan

| Phase                        | What remains                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3. Loans (Steps 2 and 3)     | Step 2: penalty on late interest and its waiver, write-off, statement and no-dues certificate, renewal or top-up. Step 3: reports and exports, WhatsApp interest-due reminders, weekly or daily collection loans, importing existing loans in bulk, restructure, investor deposits                   |
| 5. Accounting                | Day book, cash book and day close with variance, agent settlement, expenses and petty cash, bank reconciliation, manual journals with approval, staff commission, TDS and GST, financial year handling, trial balance to P&L and balance sheet                                                       |
| 6. Field operations          | Agent daily list by route and area, follow-up scheduler, geo check-in, offline-tolerant entry (PWA), escalation rules, legal and recovery module                                                                                                                                                     |
| 7. Notifications and reports | WhatsApp templates, auction reminders to all members (T-3, T-1, day of), due and overdue reminders, result and payout notices, message log and opt-out; the report set (collection, ageing, disbursement, group statements, registers, staff performance, audit); scheduled daily email to the owner |
| 8. Hardening                 | Load test at several thousand customers, security review, backup and restore drill, deployment (VPS, HTTPS, nightly backup), user acceptance with real data                                                                                                                                          |
| 9. Later                     | Customer portal and UPI payments, verification-provider integrations, native mobile app                                                                                                                                                                                                              |

## Next steps (recommended order)

1. **Decide the open questions** in `docs/decisions.md` that block work: penalty on late interest, the legal rate cap, the WhatsApp account, whether to keep full Aadhaar numbers.
2. **WhatsApp reminders** for chit auctions (asked for explicitly): notification provider seam, message templates, background job runner, opt-out and message log. Start with the mock provider, then connect the real account once templates are approved.
3. **Loans, Step 2**: overdue handling (penalty once the owner sets a number, waivers, write-off), statement and no-dues certificate, renewal or top-up. Then **WhatsApp interest-due reminders**, which fit this model well.
4. **Settings and approvals engine**: configurable KYC policy, risk bands and numbering; second-person approval for payouts, transfers, reversals, blacklisting and back-dated entries.
5. **Accounting essentials**: opening balances, day close, expenses, and bank reconciliation, then the financial statements.
6. **Agent daily collection screen and reports/registers** (PDF and Excel).
7. **Hardening and deployment**: performance test, security review, backups, put it on the VPS, real-data acceptance run.

## Housekeeping

- Push the repository to a remote so CI runs, and confirm the workflow passes (Chromium install and the dependency audit gate are the parts most likely to need adjusting).
- Run `sudo corepack enable` (or install pnpm globally) so plain `pnpm` commands work on the developer machine.
- Before real use: change the seed Super Admin password, set strong values in `.env`, keep `FIELD_ENCRYPTION_KEY` safe (losing it makes encrypted numbers unreadable), and get legal advice on the chit and lending rules for your state.
