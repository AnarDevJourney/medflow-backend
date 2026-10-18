#!/bin/bash
# Phase 4.1 end-to-end checks of the action history (DOC 6.7, 8.9):
# auth-service → Kafka → notification-history batch consumer → action_history,
# plus the /history endpoints.
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-history.sh
# Publishes ~900 synthetic events (source 'test-history') to file.events to
# exercise batching; action_history is append-only, so those rows stay.
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
waitfor() { # <seconds> <expected> <command…>: polls until the command prints expected
  local t=$1 want=$2; shift 2; local got
  for _ in $(seq 1 $((t * 4))); do got=$("$@"); [ "$got" = "$want" ] && { echo "$got"; return; }; sleep 0.25; done
  echo "$got"
}
lastlink() { # waits until auth-service logged the invite link of $1
  local t; for _ in $(seq 1 20); do
    t=$($DC logs auth-service 2>&1 | grep "$1" | tail -1 | grep -o 'token=[A-Za-z0-9_-]*' | cut -d= -f2)
    [ -n "$t" ] && { echo $t; return; }; sleep 0.2; done; echo "$t"; }
invite() { # email role → prints the user id
  code -b $D/a.jar -X POST $G/users -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"firstName\":\"History\",\"lastName\":\"Test\",\"role\":\"$2\"}" >/dev/null
  grep -o '"id":"[^"]*"' $D/body | head -1 | cut -d'"' -f4
}
event_id() { q auth_db "select id from outbox_events where aggregate_id='$1' and event_type='$2' order by occurred_at desc limit 1"; }
hrows() { q notification_db "select count(*) from action_history where event_id='$1'"; }
hist_log() { $DC logs --since "$1" notification-history-service 2>&1 | grep "$2"; }
for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 $G/health)" = 200 ] && break; sleep 1; done
SUF=$RANDOM
redis_flush_rl
check "login admin" 200 $(login $D/a.jar admin@medflow.az Admin12345)
ADMIN_ID=$(q auth_db "select id from users where email='admin@medflow.az'")
ADMIN_NAME=$(q auth_db "select first_name||' '||last_name from users where id='$ADMIN_ID'")

echo "== Invite → history row (phase 4 done-when)"
EMAIL="history$SUF@medflow.az"
U1=$(invite $EMAIL NURSE)
E1=$(event_id $U1 user.invited)
check "user.invited in the outbox" 36 ${#E1}
check "history row written (≤ 6 s)" 1 $(waitfor 6 1 hrows $E1)
ROW=$(q notification_db "select event_type||'|'||source||'|'||actor_id||'|'||actor_role||'|'||entity_type||'|'||entity_id||'|'||(patient_id is null)||'|'||(correlation_id is not null) from action_history where event_id='$E1'")
check "row: type, source, actor, entity, no patient, correlation id" "user.invited|auth-service|$ADMIN_ID|ADMIN|USER|$U1|true|true" "$ROW"
check "summary" "$ADMIN_NAME invited History Test as NURSE" "$(q notification_db "select summary from action_history where event_id='$E1'")"
check "occurred_at = event time, not insert time" t $(q notification_db "select h.occurred_at = '$(q auth_db "select payload->>'occurredAt' from outbox_events where id='$E1'")'::timestamptz from action_history h where event_id='$E1'")
check "invite link / token never stored" 0 $(q notification_db "select count(*) from action_history where event_id='$E1' and (metadata::text ilike '%token%' or metadata::text ilike '%link%' or summary ilike '%token%')")
check "metadata keeps email + role" "$EMAIL|NURSE" "$(q notification_db "select metadata->>'email'||'|'||(metadata->>'role') from action_history where event_id='$E1'")"

echo "== Redelivered event is not stored twice"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
q auth_db "update outbox_events set published_at = null where id='$E1'" >/dev/null
check "consumer reports the duplicate" 1 $(waitfor 6 1 sh -c "$DC logs --since $SINCE notification-history-service 2>&1 | grep -c '1 duplicate'")
check "still one row" 1 $(hrows $E1)

echo "== Password reset request stays out of the history"
redis_flush_rl
check "forgot-password" 200 $(code -X POST $G/auth/forgot-password -H 'content-type: application/json' -d '{"email":"admin@medflow.az"}')
E2=$(q auth_db "select id from outbox_events where event_type='user.password_reset_requested' order by occurred_at desc limit 1")
check "event published" 1 $(waitfor 4 1 q auth_db "select count(*) from outbox_events where id='$E2' and published_at is not null")
U_NEXT=$(invite "history-b$SUF@medflow.az" DOCTOR) # same pipeline right after it
check "a later event is recorded (≤ 6 s)" 1 $(waitfor 6 1 hrows $(event_id $U_NEXT user.invited))
check "reset request not recorded" 0 $(hrows $E2)

echo "== Append-only (trigger)"
q notification_db "update action_history set summary='x' where event_id='$E1'" >$D/upd 2>&1
grep -q "append-only" $D/upd && check "UPDATE blocked" ok ok || check "UPDATE blocked" ok "$(cat $D/upd)"
q notification_db "delete from action_history where event_id='$E1'" >$D/del 2>&1
grep -q "append-only" $D/del && check "DELETE blocked" ok ok || check "DELETE blocked" ok "$(cat $D/del)"

echo "== /history endpoints"
check "GET /history" 200 $(code -b $D/a.jar "$G/history?eventType=user.invited&limit=5")
grep -q "\"eventId\":\"$E1\"" $D/body && check "feed has the invite" ok ok || check "feed has the invite" ok missing
check "newest first" 200 $(code -b $D/a.jar "$G/history?limit=2")
FIRST=$(grep -o '"occurredAt":"[^"]*"' $D/body | sed -n 1p | cut -d'"' -f4)
SECOND=$(grep -o '"occurredAt":"[^"]*"' $D/body | sed -n 2p | cut -d'"' -f4)
[[ "$FIRST" > "$SECOND" || "$FIRST" = "$SECOND" ]] && check "  … sorted by occurredAt desc" ok ok || check "  … sorted by occurredAt desc" ok "$FIRST < $SECOND"
check "filter by actor" 200 $(code -b $D/a.jar "$G/history?actorId=$ADMIN_ID&entityType=USER&limit=1")
grep -q "\"actor\":{\"id\":\"$ADMIN_ID\"" $D/body && check "  … actor object in response" ok ok || check "  … actor object in response" ok missing
check "date range in the future → empty" 200 $(code -b $D/a.jar "$G/history?from=2099-01-01T00:00:00Z")
grep -q '"total":0' $D/body && check "  … total 0" ok ok || check "  … total 0" ok "$(cat $D/body)"
check "entity history" 200 $(code -b $D/a.jar "$G/history/entity/USER/$U1")
grep -q '"total":1' $D/body && check "  … one row for the new user" ok ok || check "  … one row for the new user" ok "$(cat $D/body)"
check "user history (what the admin did)" 200 $(code -b $D/a.jar "$G/history/users/$ADMIN_ID?limit=1")
check "patient timeline (no patients yet)" 200 $(code -b $D/a.jar "$G/history/patients/$U1")
check "bad entity type → 400" 400 $(code -b $D/a.jar "$G/history/entity/user-x/$U1")
check "bad uuid → 400" 400 $(code -b $D/a.jar "$G/history/entity/USER/nope")
check "bad date → 400" 400 $(code -b $D/a.jar "$G/history?from=yesterday")
check "bad eventType → 400" 400 $(code -b $D/a.jar "$G/history?eventType=DROP%20TABLE")
check "no cookie → 401" 401 $(code "$G/history")

echo "== Roles (nurse)"
INV=$(lastlink "Invite link for $EMAIL")
check "nurse accepts the invite" 200 $(code -c $D/n.jar -X POST $G/auth/accept-invite -H 'content-type: application/json' -d "{\"token\":\"$INV\",\"password\":\"Secret123\"}")
check "nurse: global feed → 403" 403 $(code -b $D/n.jar "$G/history")
check "nurse: user history → 403" 403 $(code -b $D/n.jar "$G/history/users/$ADMIN_ID")
check "nurse: entity history → 200" 200 $(code -b $D/n.jar "$G/history/entity/USER/$U1")
check "nurse: patient timeline → 200" 200 $(code -b $D/n.jar "$G/history/patients/$U1")
E3=$(event_id $U1 user.activated)
check "user.activated recorded, actor = the nurse" "$U1" "$(waitfor 6 "$U1" q notification_db "select actor_id from action_history where event_id='$E3'")"

echo "== Batching: a backlog of 900 events × ~5 KB"
# The service is stopped while the events are published, so on start every
# partition has ~1.5 MB waiting: fetches must be capped at 1 MB
TAG="batch-$SUF"
N=900
python3 - $N $TAG $ADMIN_ID >$D/msgs <<'EOF'
import json, sys, uuid, datetime
n, tag, admin = int(sys.argv[1]), sys.argv[2], sys.argv[3]
for i in range(n):
    user = str(uuid.uuid4())
    env = {"eventId": str(uuid.uuid4()), "eventType": "user.updated", "version": 1,
           "occurredAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "source": "test-history", "correlationId": tag,
           "actor": {"id": admin, "name": "Batch Test", "role": "ADMIN"},
           "payload": {"userId": user, "email": f"{tag}-{i}@medflow.az", "firstName": "Batch",
                       "lastName": str(i), "role": "NURSE", "avatarFileId": None,
                       "changedFields": ["firstName"], "padding": "x" * 5000}}
    print(f"{user}|{json.dumps(env)}")
EOF
$DC stop notification-history-service >/dev/null 2>&1
# file.events: only notification-history consumes it today
kafka kafka-console-producer.sh --topic file.events --property parse.key=true --property 'key.separator=|' <$D/msgs >/dev/null
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
$DC start notification-history-service >/dev/null 2>&1
batched() { q notification_db "select count(*) from action_history where correlation_id='$TAG'"; }
check "all $N stored after the restart (≤ 60 s)" $N $(waitfor 60 $N batched)
hist_log $SINCE "file.events\[" >$D/batches
LINES=$(wc -l <$D/batches)
MAX=$(grep -o '\] [0-9]* message' $D/batches | grep -o '[0-9]*' | sort -n | tail -1)
SUM=$(grep -o '→ [0-9]* row(s) inserted' $D/batches | grep -o '→ [0-9]*' | grep -o '[0-9]*' | awk '{s+=$1} END {print s}')
echo "    $N events → $LINES transaction(s), largest batch $MAX message(s)"
check "inserted counts add up" $N "$SUM"
[ "$LINES" -le 30 ] && check "a handful of transactions, not $N" ok ok || check "a handful of transactions, not $N" "≤30" "$LINES"
# one message ≈ 5.4 KB → 1 MB holds ≈ 190
[ "$MAX" -ge 30 ] && [ "$MAX" -le 200 ] && check "a batch holds many events but ≤ 1 MB" ok ok || check "a batch holds many events but ≤ 1 MB" "30..200" "$MAX"

echo "== Unknown event type → dead letters, partition keeps flowing"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
UNK="{\"eventId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"eventType\":\"unknown.thing_$SUF\",\"version\":1,\"occurredAt\":\"2026-10-18T10:00:00Z\",\"source\":\"test-history\",\"actor\":null,\"payload\":{}}"
echo "k$SUF|$UNK" | kafka kafka-console-producer.sh --topic file.events --property parse.key=true --property 'key.separator=|' >/dev/null
check "moved to dead-letter.events" 1 $(waitfor 8 1 sh -c "$DC logs --since $SINCE notification-history-service 2>&1 | grep -c 'No history template for unknown.thing_$SUF'")
U4=$(invite "history-c$SUF@medflow.az" ACCOUNTANT)
check "next event still recorded" 1 $(waitfor 6 1 hrows $(event_id $U4 user.invited))

echo "== Database down → batch retried, nothing lost"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
q notification_db "alter table action_history rename to action_history_off" >/dev/null
U5=$(invite "history-d$SUF@medflow.az" RECEPTIONIST)
E5=$(event_id $U5 user.invited)
check "insert fails and is retried" 1 $(waitfor 8 1 sh -c "$DC logs --since $SINCE notification-history-service 2>&1 | grep -c 'failed (attempt 1)'")
sleep 2
q notification_db "alter table action_history_off rename to action_history" >/dev/null
check "stored once the table is back (≤ 15 s)" 1 $(waitfor 15 1 hrows $E5)
check "nothing dead-lettered for the outage" 0 $(hist_log $SINCE "moved to dead-letter" | wc -l)

rm -rf $D
echo
echo "PASS $PASS  FAIL $FAIL"
[ $FAIL -eq 0 ]
