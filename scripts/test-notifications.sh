#!/bin/bash
# Phase 4.2 end-to-end checks of in-app notifications (DOC 6.7, 8.9):
# auth-service event → Kafka → notification-history batch consumer →
# notifications table → Socket.io push through the gateway, plus the
# /notifications endpoints.
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-notifications.sh
# Stops and starts notification-history once (backlog test) and publishes
# synthetic user.session_revoked events (source 'test-notifications') to
# file.events — those rows stay in action_history (append-only).
cd "$(dirname "${BASH_SOURCE[0]}")/.."
G=http://localhost:3000/api/v1
D=$(mktemp -d)
DC="docker compose"
PASS=0; FAIL=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1 (expected $2, got $3)"; FAIL=$((FAIL+1)); fi
}
yes_no() { [ -n "$2" ] && check "$1" ok ok || check "$1" ok "${3:-missing}"; } # name, non-empty = pass
code() { curl -s -o $D/body -w '%{http_code}' "$@"; }
tok() { awk -v n=$2 '$6==n{print $7}' $1; }
login() { code -c $1 -X POST $G/auth/login -H 'content-type: application/json' -d "{\"email\":\"$2\",\"password\":\"$3\"}"; }
q() { $DC exec -T postgres psql -U medflow -d $1 -tAc "$2"; }
redis_flush_rl() { $DC exec -T redis sh -c "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli del" >/dev/null; }
kafka() { $DC exec -T kafka /opt/kafka/bin/$1 --bootstrap-server kafka:9092 "${@:2}"; }
waitfor() { # <seconds> <expected> <command…>: polls until the command prints expected
  local t=$1 want=$2; shift 2; local got
  for _ in $(seq 1 $((t * 4))); do got=$("$@"); [ "$got" = "$want" ] && { echo "$got"; return; }; sleep 0.25; done
  echo "$got"
}
source scripts/lib/mailpit.sh
# listen <token|-> <seconds> <file>: Socket.io client in the background, one JSON line per event
listen() { node scripts/lib/socket-listen.mjs http://localhost:3000 "$1" "$2" >"$3" 2>&1 & }
ev() { grep -c "\"name\":\"$2\"" $1; } # how many <event> a listener received
last() { grep "\"name\":\"$2\"" $1 | tail -1; } # last <event> line
nrows() { q notification_db "select count(*) from notifications where event_id='$1'"; }
notif_log() { $DC logs --since "$1" notification-history-service 2>&1 | grep NotificationsConsumer | grep "$2"; }
produce() { kafka kafka-console-producer.sh --topic file.events --property parse.key=true --property 'key.separator=|' >/dev/null; }
envelope() { # userId occurredAt padding → a user.session_revoked line for produce
  echo "$1|{\"eventId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"eventType\":\"user.session_revoked\",\"version\":1,\"occurredAt\":\"$2\",\"source\":\"test-notifications\",\"actor\":null,\"payload\":{\"userId\":\"$1\",\"familyId\":\"$(cat /proc/sys/kernel/random/uuid)\",\"reason\":\"REFRESH_TOKEN_REUSE\"$3}}"
}
for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 $G/health)" = 200 ] && break; sleep 1; done
SUF=$RANDOM
SECRET=$(grep '^JWT_ACCESS_SECRET=' .env | cut -d= -f2)
redis_flush_rl
check "login admin" 200 $(login $D/a.jar admin@medflow.az Admin12345)

echo "== Setup: a doctor with a live session"
EMAIL="notif$SUF@medflow.az"
check "invite doctor" 201 $(code -b $D/a.jar -X POST $G/users -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"firstName\":\"Notif\",\"lastName\":\"Test\",\"role\":\"DOCTOR\"}")
U=$(grep -o '"id":"[^"]*"' $D/body | head -1 | cut -d'"' -f4)
INV=$(mailtoken $EMAIL invited)
check "doctor accepts the invite" 200 $(code -c $D/d.jar -X POST $G/auth/accept-invite -H 'content-type: application/json' -d "{\"token\":\"$INV\",\"password\":\"Secret123\"}")
A1=$(tok $D/d.jar access_token); R1=$(tok $D/d.jar refresh_token)

echo "== Socket.io handshake is authenticated"
listen - 5 $D/s0; listen garbage.token.here 5 $D/s1
check "no cookie → refused" 1 $(waitfor 5 1 ev $D/s0 connect_error)
yes_no "  … code UNAUTHORIZED" "$(last $D/s0 connect_error | grep '"code":"UNAUTHORIZED"')" "$(cat $D/s0)"
check "garbage token → refused" 1 $(waitfor 5 1 ev $D/s1 connect_error)
listen $A1 60 $D/l1
check "valid token → connected" 1 $(waitfor 5 1 ev $D/l1 connect)
yes_no "  … initial unread count 0" "$(waitfor 3 1 ev $D/l1 notification:count >/dev/null; last $D/l1 notification:count | grep '"count":0')" "$(cat $D/l1)"

echo "== Real event: refresh-token reuse → live notification, old socket closed"
check "refresh (rotates)" 200 $(code -b $D/d.jar -c $D/d.jar -X POST $G/auth/refresh)
check "replay the old refresh token → reuse" 401 $(code -H "cookie: refresh_token=$R1" -X POST $G/auth/refresh)
check "notification pushed live (≤ 8 s)" 1 $(waitfor 8 1 ev $D/l1 notification)
yes_no "  … SESSION_REVOKED, urgent" "$(last $D/l1 notification | grep '"type":"SESSION_REVOKED"' | grep '"isUrgent":true')" "$(cat $D/l1)"
yes_no "  … badge count 1" "$(last $D/l1 notification:count | grep '"count":1')" "$(cat $D/l1)"
check "  … then session:revoked" 1 $(waitfor 3 1 ev $D/l1 session:revoked)
yes_no "  … and the server closed the socket" "$(last $D/l1 disconnect | grep 'io server disconnect')" "$(cat $D/l1)"
N_LINE=$(grep -n '"name":"notification"' $D/l1 | cut -d: -f1); R_LINE=$(grep -n '"name":"session:revoked"' $D/l1 | cut -d: -f1)
[ "$N_LINE" -lt "$R_LINE" ] 2>/dev/null && check "  … notification arrives before the disconnect" ok ok || check "  … notification arrives before the disconnect" ok "$N_LINE/$R_LINE"
E1=$(q auth_db "select id from outbox_events where event_type='user.session_revoked' and aggregate_id='$U' order by occurred_at desc limit 1")
check "one row in notifications" 1 $(nrows $E1)
listen $A1 5 $D/s2
check "revoked token can't reconnect" 1 $(waitfor 5 1 ev $D/s2 connect_error)
yes_no "  … 'Session has been revoked'" "$(last $D/s2 connect_error | grep 'revoked')" "$(cat $D/s2)"

echo "== Fresh login → badge restored from the database"
redis_flush_rl
check "doctor logs in again" 200 $(login $D/d.jar $EMAIL Secret123)
A3=$(tok $D/d.jar access_token)
listen $A3 120 $D/l2
check "connected" 1 $(waitfor 5 1 ev $D/l2 connect)
yes_no "  … initial unread count 1" "$(waitfor 3 1 ev $D/l2 notification:count >/dev/null; last $D/l2 notification:count | grep '"count":1')" "$(cat $D/l2)"
check "GET /notifications" 200 $(code -b $D/d.jar "$G/notifications")
NID=$(grep -o '"id":"[^"]*"' $D/body | head -1 | cut -d'"' -f4)
yes_no "  … the SESSION_REVOKED notification, unread" "$(grep '"type":"SESSION_REVOKED"' $D/body | grep '"isRead":false')" "$(cat $D/body)"
check "?unread=true" 200 $(code -b $D/d.jar "$G/notifications?unread=true")
yes_no "  … total 1" "$(grep '"total":1' $D/body)" "$(cat $D/body)"
check "?unread=false" 200 $(code -b $D/d.jar "$G/notifications?unread=false")
yes_no "  … total 0" "$(grep '"total":0' $D/body)" "$(cat $D/body)"
check "?urgent=true (SESSION_REVOKED is urgent)" 200 $(code -b $D/d.jar "$G/notifications?urgent=true")
yes_no "  … total 1" "$(grep '"total":1' $D/body)" "$(cat $D/body)"
check "?urgent=false" 200 $(code -b $D/d.jar "$G/notifications?urgent=false")
yes_no "  … total 0" "$(grep '"total":0' $D/body)" "$(cat $D/body)"
check "?type=SESSION_REVOKED" 200 $(code -b $D/d.jar "$G/notifications?type=SESSION_REVOKED")
yes_no "  … total 1" "$(grep '"total":1' $D/body)" "$(cat $D/body)"
check "?type=LAB_RESULT_READY" 200 $(code -b $D/d.jar "$G/notifications?type=LAB_RESULT_READY")
yes_no "  … total 0" "$(grep '"total":0' $D/body)" "$(cat $D/body)"
check "?type=bad-type → 400" 400 $(code -b $D/d.jar "$G/notifications?type=bad-type")
check "?from=2000-01-01 (includes it)" 200 $(code -b $D/d.jar "$G/notifications?from=2000-01-01T00:00:00Z")
yes_no "  … total 1" "$(grep '"total":1' $D/body)" "$(cat $D/body)"
check "?to=2000-01-01 (before it)" 200 $(code -b $D/d.jar "$G/notifications?to=2000-01-01T00:00:00Z")
yes_no "  … total 0" "$(grep '"total":0' $D/body)" "$(cat $D/body)"
check "?from=not-a-date → 400" 400 $(code -b $D/d.jar "$G/notifications?from=not-a-date")
check "unread-count" 200 $(code -b $D/d.jar "$G/notifications/unread-count")
yes_no "  … 1" "$(grep '"count":1' $D/body)" "$(cat $D/body)"

echo "== Redelivered event: stored once, never pushed twice, newer socket stays"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
q auth_db "update outbox_events set published_at = null where id='$E1'" >/dev/null
check "consumer reports the duplicate" 1 $(waitfor 8 1 sh -c "$DC logs --since $SINCE notification-history-service 2>&1 | grep NotificationsConsumer | grep -c '1 duplicate'")
check "still one row" 1 $(nrows $E1)
sleep 1
check "no second push" 0 $(ev $D/l2 notification)
check "socket opened after the revocation stays connected" 0 $(ev $D/l2 disconnect)

echo "== Mark as read"
check "someone else's notification → 404" 404 $(code -b $D/a.jar -X PATCH "$G/notifications/$NID/read")
check "mark read" 200 $(code -b $D/d.jar -X PATCH "$G/notifications/$NID/read")
READ_AT=$(grep -o '"readAt":"[^"]*"' $D/body)
yes_no "  … isRead true, readAt set" "$(grep '"isRead":true' $D/body)" "$(cat $D/body)"
yes_no "  … badge 0 pushed to the open socket" "$(waitfor 3 1 sh -c "grep '\"name\":\"notification:count\"' $D/l2 | grep -c '\"count\":0'")" "$(cat $D/l2)"
check "mark read again (idempotent)" 200 $(code -b $D/d.jar -X PATCH "$G/notifications/$NID/read")
check "  … readAt unchanged" "$READ_AT" "$(grep -o '"readAt":"[^"]*"' $D/body)"
check "unknown id → 404" 404 $(code -b $D/d.jar -X PATCH "$G/notifications/$(cat /proc/sys/kernel/random/uuid)/read")
check "bad id → 400" 400 $(code -b $D/d.jar -X PATCH "$G/notifications/nope/read")
check "?unread=maybe → 400" 400 $(code -b $D/d.jar "$G/notifications?unread=maybe")
check "read-all" 200 $(code -b $D/d.jar -X PATCH "$G/notifications/read-all")
yes_no "  … nothing left to update" "$(grep '"updated":0' $D/body)" "$(cat $D/body)"
check "no cookie → 401" 401 $(code "$G/notifications")

echo "== Old event (replayed after an outage): stored, counted, not popped up"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
COUNTS_BEFORE=$(ev $D/l2 notification:count)
envelope $U "$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)" | produce
check "stored (≤ 8 s)" 2 $(waitfor 8 2 q notification_db "select count(*) from notifications where recipient_id='$U'")
yes_no "  … logged as stored without a live push" "$(notif_log $SINCE 'without a live push')"
check "  … badge updated" $((COUNTS_BEFORE + 1)) $(waitfor 3 $((COUNTS_BEFORE + 1)) ev $D/l2 notification:count)
check "  … no popup" 0 $(ev $D/l2 notification)
check "  … socket newer than the old revocation stays" 0 $(ev $D/l2 disconnect)

echo "== Token expiry closes the socket"
listen "$(node scripts/lib/sign-token.mjs "$SECRET" $U DOCTOR 3)" 10 $D/l3
check "connected with a 3 s token" 1 $(waitfor 3 1 ev $D/l3 connect)
check "session:expired when the token dies (≤ 6 s)" 1 $(waitfor 6 1 ev $D/l3 session:expired)
check "  … then disconnected" 1 $(waitfor 2 1 ev $D/l3 disconnect)

echo "== Deactivation closes the live socket"
check "admin deactivates the doctor" 200 $(code -b $D/a.jar -X PATCH $G/users/$U/deactivate)
check "session:revoked pushed (≤ 8 s)" 1 $(waitfor 8 1 ev $D/l2 session:revoked)
check "  … disconnected" 1 $(waitfor 2 1 ev $D/l2 disconnect)

echo "== Batching: a backlog of 900 notifications × ~5 KB"
N=900
PAD=",\"padding\":\"$(head -c 5000 /dev/zero | tr '\0' x)\""
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
for _ in $(seq 1 $N); do envelope $(cat /proc/sys/kernel/random/uuid) $NOW "$PAD"; done >$D/msgs
BEFORE=$(q notification_db "select count(*) from notifications")
$DC stop notification-history-service >/dev/null 2>&1
produce <$D/msgs
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
$DC start notification-history-service >/dev/null 2>&1
check "all $N stored after the restart (≤ 60 s)" $((BEFORE + N)) $(waitfor 60 $((BEFORE + N)) q notification_db "select count(*) from notifications")
notif_log $SINCE "file.events\[" | grep "row(s) inserted" >$D/batches
LINES=$(wc -l <$D/batches)
MAX=$(grep -o '\] [0-9]* message' $D/batches | grep -o '[0-9]*' | sort -n | tail -1)
SUM=$(grep -o '→ [0-9]* row(s) inserted' $D/batches | grep -o '→ [0-9]*' | grep -o '[0-9]*' | awk '{s+=$1} END {print s}')
echo "    $N notifications → $LINES transaction(s), largest batch $MAX message(s)"
check "inserted counts add up" $N "$SUM"
[ "$LINES" -le 30 ] && check "a handful of transactions, not $N" ok ok || check "a handful of transactions, not $N" "≤30" "$LINES"
[ "$MAX" -ge 30 ] && [ "$MAX" -le 200 ] && check "a batch holds many events but ≤ 1 MB" ok ok || check "a batch holds many events but ≤ 1 MB" "30..200" "$MAX"

wait 2>/dev/null
rm -rf $D
echo
echo "PASS $PASS  FAIL $FAIL"
[ $FAIL -eq 0 ]
