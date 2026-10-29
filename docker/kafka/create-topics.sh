#!/bin/bash
# One-shot (kafka-init container): creates every topic MedFlow uses.
# One domain topic per producing service; key = aggregate id keeps ordering per entity.
set -e
BOOTSTRAP=kafka:9092
KAFKA_BIN=/opt/kafka/bin

for topic in auth.events staff.events patient.events appointment.events record.events billing.events file.events configurations.events; do
  $KAFKA_BIN/kafka-topics.sh --bootstrap-server $BOOTSTRAP --create --if-not-exists \
    --topic "$topic" --partitions 3 --replication-factor 1
done

$KAFKA_BIN/kafka-topics.sh --bootstrap-server $BOOTSTRAP --create --if-not-exists \
  --topic dead-letter.events --partitions 1 --replication-factor 1

$KAFKA_BIN/kafka-topics.sh --bootstrap-server $BOOTSTRAP --list
