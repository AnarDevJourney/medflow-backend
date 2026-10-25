# One image recipe for all 9 apps of the monorepo; the app is picked with a
# build arg:  docker build --build-arg APP=auth-service -t medflow/auth-service .
# docker-compose.yml builds every app this way.

# ─── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

# Install deps first so this layer is cached until package*.json changes
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG APP
RUN test -n "$APP" || (echo "Build arg APP is required (e.g. --build-arg APP=auth-service)" && exit 1)
RUN npx nest build "$APP"

# ─── Stage 2: production deps (shared by every app image) ────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ─── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

ARG APP
ENV APP=${APP}
# DNS lookups run on libuv's thread pool (default 4). While Kafka is gone
# from Docker DNS, failing lookups of "kafka" can hold every thread and
# delay new Postgres connections — more threads keep the DB path free.
ENV UV_THREADPOOL_SIZE=16

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/package.json ./package.json
# dist/apps/<app>/ contains apps/<app>/src/** and the libs it imports
COPY --from=build --chown=node:node /app/dist/apps/${APP} ./dist

# TODO(phase 10): file-service may need a writable temp dir for uploads
#   (multer) — create it here and chown it to node.
# TODO: when native deps appear (e.g. bcrypt in phase 2 — prefer bcryptjs or
#   argon2 prebuilds), alpine may need `apk add --no-cache python3 make g++`
#   in the build/deps stages.

USER node

# PORT comes from the environment (docker-compose.yml); EXPOSE is documentation only
EXPOSE 3000

# exec → node becomes the main process and receives SIGTERM (graceful shutdown)
CMD ["sh", "-c", "exec node dist/apps/${APP}/src/main.js"]
