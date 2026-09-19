# Jana Finance

Internal system for a small finance business: customers and KYC, loans, chit funds, collections and accounting.
**Status:** foundation (login with 2FA, users, roles and permissions, audit log, design system) **Customers & KYC**, a minimal double-entry **ledger** and **Chit funds** (groups, members, monthly auctions, collections with receipts, prize payouts, passbooks) and the **owner dashboard** are built. Loans, the rest of accounting, notifications (WhatsApp) and reports come next (see `docs/decisions.md`).

## Stack

React + Vite + Tailwind (web) · NestJS + Prisma (API) · PostgreSQL · shared TypeScript package (money helpers, permissions, Zod schemas).
pnpm workspaces: `apps/web`, `apps/api`, `packages/shared`, `e2e`.

## Quick start

Prerequisites: Node 22+, Docker, and pnpm (`corepack enable`, or `npm i -g pnpm`).

```bash
./scripts/setup.sh   # creates .env with fresh secrets, installs, starts Postgres, migrates, seeds
pnpm dev             # web on :5173, API on :3000
```

- Web: http://localhost:5173
- API docs (Swagger): http://localhost:3000/api/docs (all API routes live under `/api`)
- Mail catcher (dev): http://localhost:8025 (invite/reset links are also printed in the API log)

Sign in as `superadmin@janafinance.local` with the `SEED_SUPERADMIN_PASSWORD` from your `.env`
(default `ChangeMe#12345`). You must change the password and set up an authenticator app on first login.

> **Port note:** Postgres is published on **5433** (not 5432) so it does not clash with a local Postgres.

## Everyday commands

| Command                           | What it does                                        |
| --------------------------------- | --------------------------------------------------- |
| `pnpm dev`                        | Web and API with hot reload                         |
| `pnpm lint` / `pnpm format:check` | ESLint / Prettier                                   |
| `pnpm typecheck`                  | TypeScript, all packages                            |
| `pnpm test`                       | Unit and API integration tests (needs Postgres up)  |
| `pnpm e2e`                        | Playwright end-to-end tests (uses installed Chrome) |
| `pnpm db:migrate`                 | Create/apply a migration while developing           |
| `pnpm db:seed`                    | Seed roles and the Super Admin (idempotent)         |
| `pnpm docs:permissions`           | Regenerate `docs/permissions-matrix.md`             |

If `pnpm` is not on your PATH, prefix commands with `corepack ` (for example `corepack pnpm dev`).

## Demo data

`pnpm db:seed:demo` (after the base seed) adds 30 customers with a realistic mix of KYC states (verified, complete, partial, rejected, expired),
risk grades, inactive customers and 6 partially saved drafts, plus two staff logins: `meera@demo.jana` (Manager) and `sathish@demo.jana` (Staff),
password `Demo!Passw0rd#1` (they must change it on first login). It is safe to re-run.

## What is not built yet

Loans, day close and bank reconciliation, notifications (WhatsApp auction reminders), reports and the owner dashboard. Within Chits: mandatory registers as PDF/Excel, per-member statements, variable-installment chits and second-person approvals. Within Customers: merge-duplicates,
statements and no-dues certificate, guarantors, relationship links, e-sign, re-KYC reminders and per-role data scope. See `docs/decisions.md`.

## Security notes

- Every API endpoint requires authentication and a server-side permission check unless marked public. UI hiding is cosmetic.
- The Super Admin role is locked: it cannot be assigned, edited or deleted, and its account cannot be suspended by anyone.
- Passwords use argon2id; refresh tokens rotate and are stored hashed; the audit log is append-only at the database level.
- Secrets live in `.env` (never committed). Rotate `FIELD_ENCRYPTION_KEY` only with a re-encryption migration.
- Before going live, read `docs/decisions.md` (legal/compliance notes) and confirm chit and lending rules for your state with a legal advisor.

## Docs

`docs/decisions.md` · `docs/data-model.md` · `docs/permissions-matrix.md` · `docs/api.md`

## Pre-commit and CI

Husky runs `lint-staged` (Prettier + ESLint on changed files) before each commit. GitHub Actions
(`.github/workflows/ci.yml`) runs lint, format check, type-check, tests, a dependency audit and the e2e suite.
