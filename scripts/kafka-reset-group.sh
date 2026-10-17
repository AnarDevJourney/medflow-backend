#!/bin/bash
# Replays a topic for one consumer group in the Docker stack: stops the
# service, forgets which events it processed, moves the group's offsets to
# the beginning and starts it again — every event is handled anew.
# Usage: ./scripts/kafka-reset-group.sh <service> <topic>
#   e.g. ./scripts/kafka-reset-group.sh staff-service auth.events
# Needed once in phase 5: staff-service consumed auth.events with log-only
# handlers before, so existing users would otherwise never get a profile.
set -e
cd "$(dirname "${BASH_SOURCE[0]}")/.."
SERVICE=$1
TOPIC=$2
[ -n "$SERVICE" ] && [ -n "$TOPIC" ] || { echo "Usage: $0 <service> <topic>"; exit 1; }
DB=$(docker compose exec -T "$SERVICE" printenv DATABASE_URL | sed 's#.*/##')

docker compose stop "$SERVICE"
docker compose exec -T postgres psql -U "${POSTGRES_USER:-medflow}" -d "$DB" -c 'TRUNCATE processed_events'
docker compose exec -T kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka:9092 --group "$SERVICE" --topic "$TOPIC" \
  --reset-offsets --to-earliest --execute
docker compose start "$SERVICE"
