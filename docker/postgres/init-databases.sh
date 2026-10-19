#!/bin/bash
# docker-entrypoint-initdb.d script: creates one database per service on the same PostgreSQL instance.
# Runs only when the data volume is empty (first start).
set -e
for db in auth_db staff_db patient_db appointment_db record_db billing_db file_db notification_db configurations_db; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -c "CREATE DATABASE $db;"
done
