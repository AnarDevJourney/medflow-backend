#!/bin/bash
# TypeORM CLI wrapper for one app.
# Usage: npm run db -- <app> <generate|create|run|revert|show> [MigrationName]
#   npm run db -- patient-service generate CreatePatients
#   npm run db -- patient-service run
set -e

APP=$1
CMD=$2
NAME=$3

if [ -z "$APP" ] || [ -z "$CMD" ]; then
  echo "Usage: npm run db -- <app> <generate|create|run|revert|show> [MigrationName]"
  exit 1
fi

DIR="apps/$APP/src/database"
if [ ! -f "$DIR/data-source.ts" ]; then
  echo "Unknown app '$APP' (no $DIR/data-source.ts)"
  exit 1
fi

TYPEORM="npm run --silent typeorm --"

case "$CMD" in
  generate|create)
    if [ -z "$NAME" ]; then echo "Migration name required"; exit 1; fi
    if [ "$CMD" = "generate" ]; then
      $TYPEORM migration:generate -d "$DIR/data-source.ts" "$DIR/migrations/$NAME"
    else
      $TYPEORM migration:create "$DIR/migrations/$NAME"
    fi
    ;;
  run)    $TYPEORM migration:run -d "$DIR/data-source.ts" ;;
  revert) $TYPEORM migration:revert -d "$DIR/data-source.ts" ;;
  show)   $TYPEORM migration:show -d "$DIR/data-source.ts" ;;
  *) echo "Unknown command '$CMD'"; exit 1 ;;
esac
