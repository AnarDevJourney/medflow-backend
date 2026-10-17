#!/bin/bash
# Phase 3 end-to-end checks of the event pipeline (DOC 5.3–5.5):
# auth-service outbox → poller → Kafka auth.events → staff-service consumer.
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-kafka.sh
# Stops and restarts Kafka once (outage test) — takes about a minute.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
G=http://localhost:3000/api/v1
D=$(mktemp -d)
DC="docker compose"
PASS=0; FAIL=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1 (expected $2, got $3)"; FAIL=$((FAIL+1)); fi
}
code() { curl -s -o $D/body -w '%{http_code}' "$@"; }
login() { code -c $1 -X POST $G/auth/login -H 'content-type: application/json' -d "{\"email\":\"$2\",\"password\":\"$3\"}"; }
q() { $DC exec -T postgres psql -U medflow -d $1 -tAc "$2"; }
redis_flush_rl() { $DC exec -T redis sh -c "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli del" >/dev/null; }
kafka() { $DC exec -T kafka /opt/kafka/bin/$1 --bootstrap-server kafka:9092 "${@:2}"; }
# waitfor <seconds> <expected> <command…>: polls until the command prints expected
waitfor() {
  local t=$1 want=$2; shift 2; local got
  for _ in $(seq 1 $((t * 4))); do got=$("$@"); [ "$got" = "$want" ] && { echo "$got"; return; }; sleep 0.25; done
  echo "$got"
}
invite() { # email → prints the user id
  code -b $D/a.jar -X POST $G/users -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"firstName\":\"Kafka\",\"lastName\":\"Test\",\"role\":\"NURSE\"}" >/dev/null
  grep -o '"id":"[^"]*"' $D/body | head -1 | cut -d'"' -f4
}
event_id() { q auth_db "select id from outbox_events where aggregate_id='$1' and event_type='$2' order by occurred_at desc limit 1"; }
published() { q auth_db "select count(*) from outbox_events where id='$1' and published_at is not null"; }
processed() { q staff_db "select count(*) from processed_events where event_id='$1'"; }
staff_log() { $DC logs --since "$1" staff-service 2>&1 | grep -c "$2"; }
# The stack may still be starting: wait until the gateway reports all green
for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 $G/health)" = 200 ] && break; sleep 1; done
SUF=$RANDOM
redis_flush_rl
check "login admin" 200 $(login $D/a.jar admin@medflow.az Admin12345)

echo "== Outbox → Kafka → consumer, exactly once"
U1=$(invite "kafka1-$SUF@medflow.az")
E1=$(event_id $U1 user.invited)
check "user.invited written to the outbox" 36 ${#E1}
check "published by the poller (≤ 3 s)" 1 $(waitfor 3 1 published $E1)
check "processed by staff-service (≤ 5 s)" 1 $(waitfor 5 1 processed $E1)
ENV=$(q auth_db "select payload->>'source' || ' ' || (payload->>'version') || ' ' || (payload->'actor'->>'role') || ' ' || (payload->>'eventId' = id::text) from outbox_events where id='$E1'")
check "envelope: source, version, actor, eventId = row id" "auth-service 1 ADMIN true" "$ENV"
K=$(kafka kafka-console-consumer.sh --topic auth.events --from-beginning --timeout-ms 4000 --property print.key=true 2>/dev/null | grep "$E1" | cut -f1)
check "Kafka message key = aggregate (user) id" "$U1" "$K"

echo "== Duplicate delivery is skipped (at-least-once → idempotent)"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
q auth_db "update outbox_events set published_at = null where id='$E1'" >/dev/null
check "row republished" 1 $(waitfor 3 1 published $E1)
check "consumer logs the duplicate" 1 $(waitfor 5 1 staff_log $SINCE "Duplicate user.invited $E1 skipped")
check "still processed exactly once" 1 $(processed $E1)

echo "== Handler failure → retries (1 s, 5 s) → success"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
q staff_db "alter table processed_events rename to processed_events_off" >/dev/null
U2=$(invite "kafka2-$SUF@medflow.az")
E2=$(event_id $U2 user.invited)
check "first attempts fail and are retried" 1 $(waitfor 4 1 staff_log $SINCE "$E2 failed (attempt 1)")
sleep 2
q staff_db "alter table processed_events_off rename to processed_events" >/dev/null
check "processed after the table is back (≤ 8 s)" 1 $(waitfor 8 1 processed $E2)

echo "== Poison messages → dead-letter.events, partition keeps flowing"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '%s\n' "not-json-poison-$SUF" "{\"marker\":\"envelope-poison-$SUF\"}" | kafka kafka-console-producer.sh --topic auth.events >/dev/null
check "both reported by the consumer" 2 $(waitfor 5 2 staff_log $SINCE "moved to dead-letter.events")
DLQ=$(kafka kafka-console-consumer.sh --topic dead-letter.events --from-beginning --timeout-ms 4000 2>/dev/null)
echo "$DLQ" | grep "not-json-poison-$SUF" | grep -q '"failedBy":"staff-service"' && check "DLQ keeps the original + failedBy" ok ok || check "DLQ keeps the original + failedBy" ok missing
echo "$DLQ" | grep "envelope-poison-$SUF" | grep -q 'not an event envelope' && check "DLQ has the error message" ok ok || check "DLQ has the error message" ok missing
U3=$(invite "kafka3-$SUF@medflow.az")
check "next event still processed" 1 $(waitfor 5 1 processed $(event_id $U3 user.invited))

echo "== Kafka outage: nothing is lost"
$DC stop kafka >/dev/null 2>&1
U4=$(invite "kafka4-$SUF@medflow.az")
check "invite still works while Kafka is down" 36 ${#U4}
E4=$(event_id $U4 user.invited)
failed() { q auth_db "select attempts > 0 and last_error is not null from outbox_events where id='$1'"; }
# A stopped container vanishes from Docker DNS: the first send only fails
# once the lookup of "kafka" gives up (EAI_AGAIN, ~20–30 s). A crashed
# broker that still resolves fails within a few seconds.
check "send fails → attempts++, last_error saved (≤ 45 s)" t $(waitfor 45 t failed $E4)
check "event waits in the outbox" 0 $(published $E4)
HC=$(curl -s -o $D/health -w '%{http_code}' --max-time 10 $G/health)
check "gateway health → 503" 503 $HC
$DC start kafka >/dev/null 2>&1
check "published after Kafka is back (≤ 60 s)" 1 $(waitfor 60 1 published $E4)
check "and processed exactly once (≤ 30 s)" 1 $(waitfor 30 1 processed $E4)
check "health green again (≤ 30 s)" 200 $(waitfor 30 200 curl -s -o /dev/null -w '%{http_code}' --max-time 5 $G/health)

echo "== Ordering: seed admin's invited before activated"
ADMIN=$(q auth_db "select id from users where email='admin@medflow.az'")
ORDER=$(q auth_db "select string_agg(event_type, ',' order by occurred_at) from outbox_events where aggregate_id='$ADMIN' and event_type in ('user.invited','user.activated')")
check "occurred_at order" "user.invited,user.activated" "$ORDER"

redis_flush_rl
echo; echo "PASS $PASS  FAIL $FAIL"
rm -rf $D
