# MediLink Billing and Payment Management

Independent Subsystem 6 starter application using Node.js, Express, MongoDB Atlas, Mongoose, Argon2id, server-side sessions, and a plain dark-theme browser UI.

## Requirements

- Node.js 20+
- MongoDB Atlas or MongoDB running as a replica set (financial transactions require transaction support)

## Local setup

1. Run `npm run setup` to create `.env` with a generated session secret, or copy `.env.example` manually.
2. Set `MONGODB_URI` in `.env` to your rotated MongoDB Atlas URI. Set `DB_NAME=medilink_billing_dev` (or another billing-only database name). The app explicitly selects `DB_NAME` for both Mongoose and session storage, even if the URI path names a different database.
3. Install packages with `npm install`.
4. On Windows, create the initial administrator using the hidden-password PowerShell prompt:

   ```powershell
   .\scripts\create-admin.ps1
   ```

   The password is entered and confirmed without echoing to the terminal. The script clears its temporary environment variables when it exits. On other platforms, set `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in the process environment and run `npm run create-admin`; never put real credentials in source files or commit them.

5. Start with `npm start`, then open `http://localhost:3000`.

The app never creates or assumes an unrelated shared MediLink database. Point `MONGODB_URI` only to a billing database approved for this subsystem. Keep `.env` out of source control.
Create a MongoDB database user with only the permissions needed for the Billing database. Never reuse a Laboratory-only database user or copy its password into `.env.example`.

## Implemented functionality

- Argon2id login, secure HTTP-only sessions stored in MongoDB, login throttling, role enforcement, and audit records for login/logout.
- Patient billing account registration/search, service catalog, draft/issue/cancel invoice workflows, historical line-item prices, integer-centavo amounts, and due-date aging.
- Partial/full payment recording, idempotency-key duplicate prevention, transactionally updated invoice balances, unique payment/receipt sequences, and non-sensitive receipt metadata.
- Insurance providers and claims, pending/approved refunds, outstanding balances, dashboard aggregates, payment/invoice summaries, CSV export, settings, and audit-log viewing.
- Responsive dark browser UI connected to the API.
- Automated unit tests for monetary arithmetic, input limits, invoice status, and aging buckets.

## API

All APIs are under `/api/v1`; the frontend is served by Express. Important routes include `/auth/login`, `/auth/session`, `/dashboard`, `/accounts`, `/services`, `/invoices`, `/payments`, `/receipts`, `/outstanding`, `/insurance/providers`, `/insurance/claims`, `/refunds`, `/reports/summary`, `/reports/payments.csv`, `/settings`, and `/audit-logs`.

Amounts sent to payment APIs are integer centavos. Tax is calculated in integer centavos from the configured basis-point setting; leave it at zero until an authorized, verified policy is configured. The payment endpoint requires a unique `Idempotency-Key` request header. Card credentials are never accepted; `card_terminal` records an external terminal reference only.

## Verification

Run `npm test` and `npm run check`.

## Deployment and integration notes

- Set `NODE_ENV=production`, a strong `SESSION_SECRET`, `MONGODB_URI`, and hospital display values. Set `TRUST_PROXY=1` only when deployed behind a trusted single reverse proxy.
- Configure MongoDB Atlas network access and a replica-set-capable deployment before testing payment/refund transactions.
- Configure a browser-appropriate same-origin URL and TLS before handling real financial records. No gateway, external patient identity service, legal discount/tax rule, or Main Portal API is integrated.
- The Main Portal can link to the eventual Billing deployment URL. No public deployment or cross-system integration has been performed or claimed.

## Scope and limitations

This is a functional independent foundation, not a certified production financial system. Advanced financial controls (multi-person refund approval, adjustment/discount authorization, credit notes, configurable numbering, full user administration, comprehensive charting/report suite, downloadable PDF generation, and detailed patient history) remain to be implemented and independently audited before handling live patient or financial data. Tax/discount amounts remain zero until their validated policy workflows are built; do not treat this application as tax/legal advice or use unverified configurations.
