# MedFlow — Backend

Hospital management system built as NestJS microservices: an API gateway plus
nine services, each with its own PostgreSQL database, talking through Kafka.
Full design: `../MedFlow_Documentation.docx` and `../DATABASE.md`.

## Layout

```
apps/
  api-gateway/                    :3000  proxy, JWT check, rate limit, health
  auth-service/                   :3001  auth_db
  staff-service/                  :3002  staff_db
  patient-service/                :3003  patient_db
  appointment-service/            :3004  appointment_db
  medical-record-service/         :3005  record_db
  billing-service/                :3006  billing_db
  file-service/                   :3007  file_db
  notification-history-service/   :3008  notification_db
  configurations-service/         :3009  configurations_db  per-user UI settings (sidebar, tables, theme)
libs/
  common/     guards, decorators, filters, interceptors, pagination, config, bootstrap
  database/   TypeORM base config, SnakeNamingStrategy, numeric transformer
  contracts/  event envelope, topic names, typed event payloads
  kafka/      KafkaJS module, transactional outbox + poller, BaseConsumer
docker/       postgres init script, kafka topic script
scripts/      db.sh (TypeORM CLI), run/stop the stack, e2e checks
```

Plain Nest CLI monorepo (`nest-cli.json` → `"monorepo": true`, `tsc` builder) — no extra tooling.

## Getting started

Requirements: Node ≥ 22.15, Docker.

```bash
npm install
npm run env:init     # copies .env.example → .env (root + every app)
npm run infra:up     # postgres, kafka (+ topics), kafka-ui, redis, minio, mailpit
npm run dev:all      # all 10 apps in watch mode
curl localhost:3000/api/v1/health
```

Run a single app: `npm run dev -- patient-service`.

### Everything in Docker (one command)

```bash
npm run stack:up     # builds the 10 app images + starts infra and apps
curl localhost:3000/api/v1/health
npm run stack:logs   # follow logs
npm run stack:down   # stop (volumes are kept)
```

`./scripts/run-all.sh` (or `npm run run-all`) does the same `up` and also opens one
GNOME Terminal window with a live log tab per app + an `infra` tab.
`./scripts/run-all.sh logs` only opens that window.
`./scripts/stop-all.sh` (or `npm run stop-all`) stops the stack and closes the log window (data is kept).

One shared multi-stage `Dockerfile` builds any app via `--build-arg APP=<app>`.
`docker-compose.yml` includes the infra from `docker-compose.dev.yml` and adds
the apps; only the gateway (3000) is published — services are reachable only
inside the compose network. Infra uses the same host ports as in dev, so stop
one stack (`infra:down` / `stack:down`) before starting the other.
Their data volumes are separate (`medflow_*` vs `medflow-dev_*`).

| Tool | URL |
|---|---|
| Gateway | http://localhost:3000/api/v1 |
| Swagger links (dev) | http://localhost:3000/docs |
| Kafka UI | http://localhost:8080 |
| MinIO console | http://localhost:9001 (minioadmin / minioadmin) |
| Mailpit | http://localhost:8025 |
| PostgreSQL | localhost:**5433** (medflow / secret) |

## Environment

- Root `.env` — shared values (internal key, Redis, Kafka, service URLs, Docker infra).
- `apps/<app>/.env` — app-specific values (`PORT`, `DATABASE_URL`).
- Real environment variables override both. Every app validates its env with Joi and refuses to start if something is missing.

## Authentication

- `auth-service` issues tokens; the gateway verifies the access JWT (cookie `access_token`, 15 min) on every non-public request and forwards `x-user-id/role/name` plus `x-user-permissions` (see Permissions).
- Refresh token (cookie `refresh_token`, 7 days, path `/api/v1/auth`) is opaque, stored as sha256, rotated on every use; replaying a rotated token revokes the whole family.
- Access tokens can be killed before they expire (Redis, checked by the gateway):
  - logout → `auth:blocked-jti:<jti>` for the token's remaining lifetime
  - deactivation, password reset, refresh-token reuse → `auth:revoked-before:<userId>` (all older tokens)
- Rate limit (Redis, per IP): 10/min on login + forgot-password + change-password, 100/min elsewhere.
- First admin is seeded from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (dev: `admin@medflow.az` / `Admin12345`).
- Invite and reset links travel only by email (notification-history → Mailpit in dev, http://localhost:8025); they are never logged.
- End-to-end check against the Docker stack: `./scripts/test-auth.sh`.

Endpoints (prefix `/api/v1`, DOC 8.2):

| Route | Who | Notes |
|---|---|---|
| `POST /auth/login` · `/refresh` · `/logout` | public | cookies only |
| `GET /auth/me` · `PATCH /auth/me` | signed in | own first/last name, `avatarFileId` (null removes) |
| `PATCH /auth/change-password` | signed in | other sessions revoked, this one gets new cookies |
| `GET /auth/invitations/:token` · `POST /auth/accept-invite` | public | invite form + activation |
| `POST /auth/forgot-password` · `/reset-password` | public | always 200 · revokes every session |
| `GET /users` | `users.read` | `role`, `status`, `search`, `page`, `limit`, `sort` (`createdAt`, `lastName`, `email`, `lastLoginAt`) |
| `POST /users` · `POST /users/:id/resend-invite` | `users.invite` | invite (72 h link) |
| `GET /users/:id` · `PATCH /users/:id` | `users.read` · `users.update` | name / role; a role change kills live access tokens; own role not editable |
| `PATCH /users/:id/deactivate` · `/reactivate` | `users.deactivate` | reactivate → ACTIVE, or INVITED if no password was ever set |

## Events (Kafka)

- A service never publishes directly: it writes the event to its `outbox_events` table in the same transaction as the business change (`OutboxService.add`). `OutboxPoller` (BullMQ, every second) sends unpublished rows to the service's topic and sets `published_at`; rows published more than 7 days ago are deleted daily at 03:00.
- Message key = aggregate id (ordering per entity), value = `EventEnvelope` from `libs/contracts`.
- Delivery is at-least-once, so consumers extend `BaseConsumer`: handler + `processed_events` row in one transaction (duplicates skipped), offsets committed after it, retries after 1 s / 5 s / 15 s, then the message goes to `dead-letter.events` (see Kafka UI).
- Consumer group = service name. `./scripts/kafka-reset-group.sh <service> <topic>` replays a topic for one service.
- End-to-end check (stops Kafka once): `./scripts/test-kafka.sh`.

Published so far (`auth.events`, key = user id): `user.invited` (`resent: true` on resend-invite), `user.activated`, `user.updated` (`changedFields`), `user.deactivated`, `user.reactivated`, `user.session_revoked` (`email`, `firstName`), `user.password_reset_requested`, `user.password_changed` (`via: RESET | CHANGE`). Not in the DOC 5.6 catalog: `user.reactivated`, `changedFields`, `via`, `email`/`firstName` on `user.session_revoked`. Consumed by staff-service (log-only until phase 5) and notification-history (action history, notifications, emails).

## Action history

notification-history-service reads every domain topic and writes one row per event to `action_history` (append-only: a trigger rejects UPDATE/DELETE). A `HistoryMapper` template per event type builds the summary (never clinical values, never invite/reset links); actor, time and correlation id come from the envelope. `user.password_reset_requested` is not recorded.

- High volume, so `ActionHistoryConsumer` extends `BaseBatchConsumer` (`libs/kafka`) instead of `BaseConsumer`: one Kafka fetch holds at most `HISTORY_BATCH_MAX_BYTES` (1 MB). The broker answers as soon as anything is there (`minBytes: 1`) — it never waits for the megabyte to fill — and under load a fetch carries up to 1 MB. Each partition's part of the fetch is stored with one multi-row `INSERT … ON CONFLICT (event_id) DO NOTHING` in one transaction, then the offset is committed. Measured: a backlog of 900 × 5 KB events → 7 transactions.
- No `processed_events`: the unique `event_id` is the idempotency key.
- Failures: a message that is not an envelope or has no template → `dead-letter.events`; a row the database rejects (data error) → the batch is retried row by row and only that row is dead-lettered; database down → retried 1 s / 5 s / 15 s, then KafkaJS restarts the consumer from the last committed offset (nothing dead-lettered).
- Consumer group `notification-history-service.action-history`, so the in-app notifications (phase 4.2, same topics) keep their own offsets.
- End-to-end check: `./scripts/test-history.sh`.

| Route | Who | Notes |
|---|---|---|
| `GET /history` | `history.read` | global feed: `eventType`, `actorId`, `entityType`, `from`, `to`, `page`, `limit`, `sort=occurredAt:asc\|desc` |
| `GET /history/entity/:entityType/:entityId` | `history.entity_read` | one user / appointment / invoice / lab order |
| `GET /history/patients/:patientId` | `history.patient_read` | patient timeline across services |
| `GET /history/users/:userId` | `history.user_read` | what one staff member did |

## Notifications (in-app + Socket.io)

notification-history reads every domain topic a second time (group `notification-history-service.notifications`, independent of the history) and turns events into in-app notifications. A `NotificationMapper` template per event decides recipients and text (DOC 5.6 "in-app to …"); events without a template notify nobody. Today only `user.session_revoked` notifies (appointment, lab and invoice templates come with their phases).

- Same batching as the history (`BaseBatchConsumer`): fetch ≤ `NOTIFICATION_BATCH_MAX_BYTES` (1 MB), one transaction per partition batch, `INSERT … ON CONFLICT (event_id, recipient_id) DO NOTHING RETURNING *` in chunks of 1000. Measured: 900 × 5 KB backlog → 7 transactions.
- After the commit only the rows really inserted are pushed (`afterCommit`): a redelivered event is never pushed twice, a rolled-back row never. Events older than `NOTIFICATION_PUSH_MAX_AGE_SECONDS` (600; e.g. replayed after an outage) are stored and counted but not popped up.
- Socket.io: the browser connects to `/socket.io` on the gateway (proxied here). The handshake checks the `access_token` cookie, the JWT (`JWT_ACCESS_SECRET`) and the Redis block-list — a failure arrives as `connect_error` with `err.data.code`. Rooms `user:<id>`, `role:<ROLE>`.
- Server events: `notification` (new one), `notification:count` (`{ count }`, sent on connect and after every change — the server owns the badge), `session:expired` (token lifetime over → refresh the cookie and reconnect), `session:revoked` (deactivation / password change / refresh-token reuse → only sockets opened with older tokens are closed).
- End-to-end check: `./scripts/test-notifications.sh` (uses `scripts/lib/socket-listen.mjs` as a Socket.io client).

| Route | Who | Notes |
|---|---|---|
| `GET /notifications` | all | own only, `unread=true\|false`, `page`, `limit`, `sort=createdAt:asc\|desc` |
| `GET /notifications/unread-count` | all | `{ count }` |
| `PATCH /notifications/:id/read` | all | idempotent; someone else's → 404 |
| `PATCH /notifications/read-all` | all | `{ updated }` |

## Emails (BullMQ + Mailpit)

A third consumer group (`notification-history-service.emails`) turns events into emails in two steps:

1. **Kafka side** (same pattern as history / notifications): an `EmailMapper` template per event → `email_logs` rows (`QUEUED`) for the whole fetch (≤ `EMAIL_BATCH_MAX_BYTES`, 1 MB) in one transaction, `ON CONFLICT (event_id, template, recipient_email) DO NOTHING`.
2. **BullMQ side**: after the commit (before the offset commit) one job per email on the `email` queue; `EmailWorker` renders the Handlebars template (HTML + text, Asia/Baku times), sends it with Nodemailer and sets `SENT` / `FAILED`. 3 attempts with exponential backoff (5 s, 10 s), `EMAIL_CONCURRENCY` (5) and `EMAIL_RATE_LIMIT_PER_SECOND` (10).

Why the split: a DB insert can be rolled back and repeated harmlessly, a sent email cannot — emails need their own status and retry per message, and a slow or dead SMTP server must never hold Kafka back.

- Duplicates: jobId = hash of the unique key, the worker skips rows that are not `QUEUED`; every stored row is enqueued again on redelivery, so a crash between the commit and the enqueue loses nothing. Redis down → the batch is redelivered later. `Message-ID` = `email_logs.id`.
- Links with a raw token live only in the event and the job (finished jobs are removed at once, failed ones after 7 days); `email_logs` has no body.
- An email whose link expired (invite 72 h, reset 1 h) or a security notice more than 24 h late (e.g. replayed after an outage) is not sent: `FAILED`, "Expired before it could be sent".
- Templates today: `staff-invite`, `password-reset`, `password-changed`, `session-revoked`.
- End-to-end check (pauses Mailpit and Redis briefly): `./scripts/test-emails.sh`. All scripts read invite/reset links from Mailpit (`scripts/lib/mailpit.sh`).

| Route | Who | Notes |
|---|---|---|
| `GET /history/emails` | `emails.read` | `status`, `template`, `recipient` (part of the address), `from`, `to`, `page`, `limit`, `sort=createdAt\|sentAt:asc\|desc` |
Also published: `role_permissions.updated` on `configurations.events` (key = a name-based uuid of the role; payload `role`, full `permissions`, `added`, `removed`).

## Permissions (permission-based access control)

Endpoints don't name roles; they name the permission they need. Which role has which permission is the admin's choice on the frontend's permissions page.

- Catalog: `libs/common/src/permissions/permissions.ts` — 52 codes (`module.action`, never renamed), each with a group and the roles that get it by default (DOC 4.2 matrix). configurations-service syncs it into `permissions` on start: a new code gets its default roles once, a removed code is deleted with its grants.
- `role_permissions (role, permission)` in configurations_db is the source of truth. Redis caches every role as `permissions:role:<ROLE>` = comma-separated codes (no TTL) + a `:version` key.
- Per request: the gateway reads the role's key and forwards it as `x-user-permissions` (a client-sent value is dropped). Key missing → `GET /internal/permissions/roles/:role` on configurations-service (reads the DB, refills Redis). Redis / configurations-service down → 503 (fail closed).
- Services: `@RequirePermission('users.read')` (all listed), `@RequireAnyPermission(...)` (any), `@Authenticated()` (signed in, no permission) + the global `PermissionGuard` → `403 FORBIDDEN "Missing permission: users.read"`. `@CurrentUser().permissions` is there for "own vs all" rules in services. `@Roles`/`RolesGuard` are gone; the `Role` enum stays (one role per user).
- Admin change: `PUT /configurations/permissions` writes `role_permissions` and one outbox event per changed role in the same transaction → configurations-service consumes it and rewrites the role's Redis key (a versioned Lua write: an older event never overwrites a newer list) → notification-history records it in the action history and pushes `permissions:updated { role, permissions }` to the Socket.io room `role:<ROLE>`, so open browsers update menus without a reload.
- The database is read only on start (sync + cache warm-up), on a cache miss and on an admin save. ADMIN can never lose `permissions.read` / `permissions.manage` (422).
- End-to-end check: `./scripts/test-permissions.sh`.

| Route | Who | Notes |
|---|---|---|
| `GET /configurations/permissions/me` | signed in | own role + permissions (what the gateway sent) |
| `GET /configurations/permissions` | `permissions.read` | groups, catalog, locked cells, every role's list |
| `PUT /configurations/permissions` | `permissions.manage` | `{ roles: { DOCTOR: [...full list] } }`; roles not sent stay unchanged |

## Configurations (per-user UI settings)

configurations-service keeps each user's UI configuration (and the permission matrix above). Three tables: `sidebar_settings` and `theme_settings` (one row per user) and `table_settings` (one row per user and table). A row is created on the first change; until then `GET` returns the defaults.

- Columns: `collapsed`, `groups` (jsonb `[{ id, name, collapsed, items }]`, `NULL` = default grouping; `name: null` = built-in group with a translated title), `favorites` (jsonb array), `show_frequent`, `show_recent`, `page_visits` (jsonb `{ pageKey: { count, lastVisitedAt } }` → "frequently used" and "recently viewed").
- Page keys (`patients`, `lab-queue`, …) belong to the frontend; the backend only checks their shape (lowercase slug ≤ 40), that group ids are unique and that a page is in at most one group.
- `PATCH` upserts only the sent fields (two tabs changing different settings don't overwrite each other). A visit is one atomic `INSERT … ON CONFLICT` (parallel visits all count), at most 100 distinct pages per user, and does not touch `updated_at`.
- The frontend fetches the settings once per session (TanStack Query, `staleTime: Infinity`), applies every change to the cache first and then writes it; if the service is down the sidebar falls back to the defaults.
- End-to-end check: `./scripts/test-configurations.sh`.

| Route | Who | Notes |
|---|---|---|
| `GET /configurations/sidebar` | all | own settings (defaults if none saved) |
| `PATCH /configurations/sidebar` | all | any of `collapsed`, `groups` (or `null`), `favorites`, `showFrequent`, `showRecent` |
| `POST /configurations/sidebar/visits` | all | `{ pageKey }` → 204 |
| `DELETE /configurations/sidebar/visits` | all | clears frequent + recent, keeps the layout → 204 |

**Table settings** (`table_settings`, PK `(user_id, table_key)`): `columns` (jsonb `[{ key, visible, width, pinned: left|right|null }]` in display order), `density` (`compact | comfortable`), `view` (preset look, e.g. `striped`). `NULL` = the table's default — only the frontend knows a table's columns and defaults, so the backend checks shapes only (column keys unique, width 40–1200). At most 200 tables with saved settings per user.

| Route | Who | Notes |
|---|---|---|
| `GET /configurations/tables/:tableKey` | all | own settings of that table (all `null` if none saved) |
| `PATCH /configurations/tables/:tableKey` | all | any of `columns`, `density`, `view`; `null` = back to that default |
| `DELETE /configurations/tables/:tableKey` | all | reset the table to its defaults → 204 |

**Theme settings** (`theme_settings`): `mode` (`system | light | dark`), `palette` (surface color family id), `primary_color` (`#rrggbb`, stored lowercase), `sidebar_style` (id), `density` (`compact | comfortable | spacious`), `motion` (`system | reduced | full`). `NULL` = default; palette and sidebar ids belong to the frontend.

| Route | Who | Notes |
|---|---|---|
| `GET /configurations/theme` | all | own appearance (all `null` if none saved) |
| `PATCH /configurations/theme` | all | any of the fields above; `null` = back to that default |
| `DELETE /configurations/theme` | all | reset to the default appearance → 204 |

## Build progress

| Phase | Status |
|---|---|
| 1 Skeleton, libs/common, libs/database, infra, gateway proxy + health | ✅ |
| 2 auth-service + gateway JWT (incl. all DOC 8.2 endpoints) | ✅ |
| 3 libs/contracts + libs/kafka (outbox, poller, BaseConsumer, DLQ) | ✅ |
| 4.1 notification-history: action history (batch consumer + `/history`) | ✅ |
| 4.2 notification-history: in-app notifications + Socket.io | ✅ |
| 4.3 notification-history: emails (BullMQ + Mailpit, `/history/emails`) | ✅ |
| configurations-service: sidebar settings | ✅ |
| configurations-service: table settings | ✅ |
| configurations-service: theme settings | ✅ |
| Permission-based access control (catalog, Redis cache, PermissionGuard, admin page) | ✅ |
| 5 staff-service | next |
| 6–12 patient, appointment, medical-record, billing, file, frontend, demo seed | — |

Phase 5 starts by replaying `auth.events` for staff-service (`./scripts/kafka-reset-group.sh staff-service auth.events`), so users created before it get their profiles.

## Migrations

```bash
npm run db -- <app> generate <Name>   # from entity changes
npm run db -- <app> create <Name>     # empty migration (raw SQL)
npm run db -- <app> run | revert | show
```

In development pending migrations also run automatically on app startup.
