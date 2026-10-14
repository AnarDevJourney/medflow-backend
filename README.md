# MedFlow — Backend

Hospital management system built as NestJS microservices: an API gateway plus
eight services, each with its own PostgreSQL database, talking through Kafka.
Full design: `../MedFlow_Documentation.docx` and `../DATABASE.md`.

## Layout

```
apps/
  api-gateway/                    :3000  proxy, health, (JWT in phase 2)
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
docker/       postgres init script, kafka topic script
scripts/db.sh TypeORM CLI wrapper
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
`./scripts/run-all.sh logs` only opens that window; `./scripts/run-all.sh down` stops.

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

## Migrations

```bash
npm run db -- <app> generate <Name>   # from entity changes
npm run db -- <app> create <Name>     # empty migration (raw SQL)
npm run db -- <app> run | revert | show
```

In development pending migrations also run automatically on app startup.
