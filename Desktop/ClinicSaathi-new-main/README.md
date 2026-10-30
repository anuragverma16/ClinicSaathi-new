# ClinicSaathi

**Smarter Clinics. Happier Patients.** A multi-tenant clinic management SaaS: booking, queue,
consultations, prescriptions, lab, billing, WhatsApp automation, an AI booking assistant and
analytics, with a separate dashboard for each role.

Stack: React 18 + Vite + Tailwind + TanStack Query (client) · Express 4 + MySQL 8 via mysql2
(server) · BullMQ + Redis (background jobs) · Socket.IO (live queue).

---

## Running it

You need Node 18+ and **MySQL 8**. Redis is optional (without it the API runs, but scheduled
reminders, recall and campaigns are recorded as *not queued* instead of being sent).

```bash
cd server
cp .env.example .env            # set MYSQL_PASSWORD to your MySQL root password, and the JWT secrets
npm install
npm run dev                     # API on :5003 — creates the database and all tables on first start
npm run worker                  # background jobs (needs Redis)

cd ../client && npm install && npm run dev      # app on :5173
```

### Database (MySQL)

- Connection settings live in `server/.env`: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`,
  `MYSQL_PASSWORD`, `MYSQL_DATABASE` (default `clinicsaathi`).
- On start the API creates the database, every table and any newly added columns. You can
  also create them yourself: open **`database/schema.sql`** in MySQL Workbench and run it.
- One table per entity (`users`, `clinics`, `doctors`, `patients`, `appointments`,
  `invoices`, `payments`, ...). Ids are 24-character hex strings in an `id` column; nested data
  (doctor timetables, invoice line items, settings) is stored in JSON columns.
- After changing a model, `npm run db:schema` regenerates `database/schema.sql` and
  `npm run migrate` adds any new columns to an existing database.
- `docker compose up -d` starts MySQL (root/root, pre-loaded with the schema) and Redis.

### Super admin (no sign-up)

There is no public sign-up. The super admin is created on first start from `SUPER_ADMIN_EMAIL` /
`SUPER_ADMIN_PASSWORD` in `.env` (default `admin@clinicsaathi.com` / `Admin@12345` — change it).
The super admin creates each clinic together with its owner login, and can create any other
panel login (branch manager, doctor, receptionist, accountant, lab technician); owners can also
add their own staff from **Staff Management**.

### Sign-in

| Who | Where | How |
|---|---|---|
| All staff and super admin | `/login` | email or phone + password; the server decides the role and dashboard |
| Patients | `/patient/login?clinic=<slug>` | one-time code to their mobile, per clinic |
| Public booking | `/book/<clinic-slug>` | no account needed |

| Role | Lands on |
|---|---|
| Super Admin | `/super-admin/dashboard` |
| Clinic Owner | `/clinic/dashboard` |
| Branch Manager | `/clinic/branch/dashboard` |
| Doctor | `/clinic/doctor/dashboard` |
| Receptionist | `/clinic/reception/dashboard` |
| Accountant | `/clinic/accounts/dashboard` |
| Lab Technician | `/clinic/lab/dashboard` |
| Patient | `/patient/dashboard` |

---

## Security model

- **Tenant isolation in the schema.** `models/plugins/tenantScope.js` throws on any query without a
  clinic filter. The tenant comes from the signed-in user's database record — never a header,
  query string or body field.
- **Role permissions on the server.** `middleware/rbac.js` holds the permission matrix; every route
  checks it. Branch-assigned staff are filtered to their branch. Patients can only reach `/portal`
  routes, which pin every query to their own record and registered dependents — changing an id in
  a URL returns 404.
- **Clinical records** (notes, prescriptions, lab results, documents) are readable only by the clinic
  owner and doctors with a care relationship (an appointment with that patient). Only the treating
  doctor writes them; completed notes accept addenda only; prescriptions are drafted then signed
  with the doctor's registration number and locked. Lab technicians see name/age/gender only and
  cannot verify results. Super admins see counts, not patient records.
- **Sessions.** 15-minute access tokens; refresh tokens rotate on every use and a replayed one
  revokes the session. Logout, password reset, deactivation and role changes end sessions. Accounts
  lock after repeated failed logins. Clinic suspension takes effect within seconds.
- **Files** live in private storage (`STORAGE_DIR`, never served statically). Downloads go through a
  5-minute signed link issued after an access check; every download is audited.
- **Money only moves on verification.** A payment becomes `SUCCESS` from a signed Razorpay webhook,
  or a checkout callback whose HMAC signature verifies *and* whose payment the server re-fetches as
  captured. Webhook event ids are de-duplicated and settlement is conditional, so retries never
  double-credit. Desk payments can't exceed the balance, even with concurrent clicks.
- **Double booking** is prevented by a unique slot index plus an insert-then-verify overlap check for
  services of different lengths. Bookings are validated against the doctor's real schedule, breaks,
  leave and clinic holidays.
- Webhook signatures (Razorpay, WhatsApp `X-Hub-Signature-256`), input validation with zod, flat
  query parsing (no `?id[$ne]=` operator injection), rate limits on auth/OTP/public booking, and
  generic 500 messages.

---

## Features by role

**Super Admin** — clinics (onboard, suspend, plan), branches, users and roles, editable plans
(price, doctor/branch limits, features — enforced by the API), platform revenue, integration
status, system health (DB, Redis, job failures, message failures, webhooks), support tickets,
audit log, platform settings.

**Clinic Owner** — overview, appointments, patients CRM, doctors (weekly hours, breaks, leave),
staff management, services and fees (GST, recall interval), calendar and availability, queue,
prescriptions and reports, billing, WhatsApp automation (event switches, approved template names,
reminder timing, delivery log), follow-ups and recall, reviews and campaigns, analytics,
branches, subscription and usage, settings (profile, booking policy, holidays, WhatsApp number).

**Branch Manager** — branch overview, appointments, queue, doctor schedules, branch staff,
patients, branch reports and collections, branch contact/hours.

**Doctor** — dashboard with live queue, schedule and leave, consultation workspace (vitals,
allergies, notes, diagnosis, plan, follow-up, prescription draft → sign, lab orders, history),
prescriptions, lab results verification, follow-ups, medical certificates, consultation history.

**Receptionist** — today's list, new appointment, patient registration with duplicate check,
calendar, walk-ins (token issued immediately), waiting queue, check-in, reschedule/cancel,
patient messages, payment status.

**Accountant** — financial overview, invoices (from visits or itemised), GST invoices, desk and
online payments, receipts, outstanding dues, refunds, reconciliation, reports, CSV export.

**Lab Technician** — worklist (urgent first), collect → process → submit values and report file.

**Patient** — dashboard with live queue position, booking (with prepayment if the clinic
requires it), appointments (reschedule/cancel within policy), released prescriptions, lab reports,
certificates and documents, invoices and payment, profile and messaging preferences, family
members, booking assistant.

---

## Integrations

All integrations are optional and configured only through server environment variables.

| Integration | Without credentials | With credentials |
|---|---|---|
| WhatsApp Cloud API | messages logged as stub and recorded | sends approved templates; delivery receipts and STOP opt-outs via signed webhook |
| Razorpay | online payment refused with a clear message; desk payments work | orders, Checkout, signed webhooks, refunds |
| Email (Resend) | logged | password reset and email messages |
| SMS | logged only — no provider is wired | — |
| OpenAI | rule-based booking assistant (specialty + day + time) using real availability | LLM tool-calling assistant over the same tools |
| Redis | jobs recorded as not queued | reminders, follow-ups, recall, review requests, campaigns |

WhatsApp messages initiated by the clinic must use templates Meta has approved; set your template
names in **WhatsApp Automation**. Messages never carry diagnoses or results — documents are
announced with a link to the patient portal.

---

## Tests

```bash
cd server
npm run test:logic      # 30 assertions, no database
npm test                # 59 integration tests over HTTP against MySQL (throwaway clinicsaathi_test_* databases;
                        # MYSQL_TEST_HOST/_PORT/_USER/_PASSWORD override the connection)
```

The integration suite boots the real app and covers: each role's sign-in and dashboard routing;
role permission denials; refresh-token rotation and replay; lockout; OTP; password reset; clinic
suspension; clinic A/B isolation; patient isolation and dependents; care-relationship access;
branch scoping; query-injection; schedule validation; concurrent double booking (same slot and
overlapping lengths); cancel/reschedule; patient cutoff policy; holidays; queue tokens and
transitions; consultation, prescription, lab and certificate permissions; signed downloads;
invoice maths; concurrent payments; webhook signatures and duplicates; checkout verification;
prepaid holds and their expiry; refunds; reports; plan limits and lapsed subscriptions; analytics
accuracy; notification recording and opt-out; the AI assistant's slot fidelity and emergency
handling; WhatsApp webhook signatures, routing and STOP.

---

## Known limitations

- **Patient portal sign-in is per clinic.** A patient of two clinics has two separate accounts.
- **Branch managers manage one branch** (`branchId`), not several.
- **Subscription fees** are tracked by status; charging clinics through a gateway is not wired.
- **SMS** has no provider. OTPs go by WhatsApp when it is configured, otherwise they are only
  logged — configure WhatsApp (with an `otp_code` authentication template) or add an SMS provider
  before patients can sign in in production.
- **File storage** is local private disk. For multiple servers, swap `integrations/storage.js` for
  S3 (the signed-link flow above it stays the same).
- Consent wording, retention periods and prescription-signature requirements should be reviewed
  against the DPDP Act 2023 and the Telemedicine Practice Guidelines by counsel.
