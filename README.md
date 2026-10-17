# MedFlow — Backend

Hospital management system built as NestJS microservices: an API gateway plus
eight services, each with its own PostgreSQL database, talking through Kafka.
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
npm run dev:all      # all 9 apps in watch mode
curl localhost:3000/api/v1/health
```

Run a single app: `npm run dev -- patient-service`.

### Everything in Docker (one command)

```bash
npm run stack:up     # builds the 9 app images + starts infra and apps
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

- `auth-service` issues tokens; the gateway verifies the access JWT (cookie `access_token`, 15 min) on every non-public request and forwards `x-user-id/role/name`.
- Refresh token (cookie `refresh_token`, 7 days, path `/api/v1/auth`) is opaque, stored as sha256, rotated on every use; replaying a rotated token revokes the whole family.
- Access tokens can be killed before they expire (Redis, checked by the gateway):
  - logout → `auth:blocked-jti:<jti>` for the token's remaining lifetime
  - deactivation, password reset, refresh-token reuse → `auth:revoked-before:<userId>` (all older tokens)
- Rate limit (Redis, per IP): 10/min on login + forgot-password + change-password, 100/min elsewhere.
- First admin is seeded from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (dev: `admin@medflow.az` / `Admin12345`).
- No emails yet (phase 4): invite and reset links are printed in the auth-service log (`LOG_AUTH_LINKS`).
- End-to-end check against the Docker stack: `./scripts/test-auth.sh`.

Endpoints (prefix `/api/v1`, DOC 8.2):

| Route | Who | Notes |
|---|---|---|
| `POST /auth/login` · `/refresh` · `/logout` | public | cookies only |
| `GET /auth/me` · `PATCH /auth/me` | all | own first/last name, `avatarFileId` (null removes) |
| `PATCH /auth/change-password` | all | other sessions revoked, this one gets new cookies |
| `GET /auth/invitations/:token` · `POST /auth/accept-invite` | public | invite form + activation |
| `POST /auth/forgot-password` · `/reset-password` | public | always 200 · revokes every session |
| `GET /users` | ADMIN | `role`, `status`, `search`, `page`, `limit`, `sort` (`createdAt`, `lastName`, `email`, `lastLoginAt`) |
| `POST /users` · `POST /users/:id/resend-invite` | ADMIN | invite (72 h link) |
| `GET /users/:id` · `PATCH /users/:id` | ADMIN | name / role; a role change kills live access tokens; own role not editable |
| `PATCH /users/:id/deactivate` · `/reactivate` | ADMIN | reactivate → ACTIVE, or INVITED if no password was ever set |

## Events (Kafka)

- A service never publishes directly: it writes the event to its `outbox_events` table in the same transaction as the business change (`OutboxService.add`). `OutboxPoller` (BullMQ, every second) sends unpublished rows to the service's topic and sets `published_at`; rows published more than 7 days ago are deleted daily at 03:00.
- Message key = aggregate id (ordering per entity), value = `EventEnvelope` from `libs/contracts`.
- Delivery is at-least-once, so consumers extend `BaseConsumer`: handler + `processed_events` row in one transaction (duplicates skipped), offsets committed after it, retries after 1 s / 5 s / 15 s, then the message goes to `dead-letter.events` (see Kafka UI).
- Consumer group = service name. `./scripts/kafka-reset-group.sh <service> <topic>` replays a topic for one service.
- End-to-end check (stops Kafka once): `./scripts/test-kafka.sh`.

Published so far (`auth.events`, key = user id): `user.invited` (`resent: true` on resend-invite), `user.activated`, `user.updated` (`changedFields`), `user.deactivated`, `user.reactivated`, `user.session_revoked`, `user.password_reset_requested`, `user.password_changed` (`via: RESET | CHANGE`). Not in the DOC 5.6 catalog: `user.reactivated`, `changedFields`, `via`. Consumed by staff-service (log-only until phase 5).

## Build progress

| Phase | Status |
|---|---|
| 1 Skeleton, libs/common, libs/database, infra, gateway proxy + health | ✅ |
| 2 auth-service + gateway JWT (incl. all DOC 8.2 endpoints) | ✅ |
| 3 libs/contracts + libs/kafka (outbox, poller, BaseConsumer, DLQ) | ✅ |
| 4 notification-history-service | next |
| 5–12 staff, patient, appointment, medical-record, billing, file, frontend, demo seed | — |

Phase 5 starts by replaying `auth.events` for staff-service (`./scripts/kafka-reset-group.sh staff-service auth.events`), so users created before it get their profiles.

## Migrations

```bash
npm run db -- <app> generate <Name>   # from entity changes
npm run db -- <app> create <Name>     # empty migration (raw SQL)
npm run db -- <app> run | revert | show
```

In development pending migrations also run automatically on app startup.
