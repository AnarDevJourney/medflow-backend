#!/bin/bash
# Phase 4.3 end-to-end checks of emails (DOC 6.7, 6.8, 8.9):
# auth-service event → Kafka → notification-history EmailConsumer →
# email_logs (QUEUED) → BullMQ → EmailWorker → SMTP (Mailpit) → SENT/FAILED,
# plus GET /history/emails.
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-emails.sh
# Pauses Mailpit and Redis for a few seconds (outage tests) — about 2 minutes.
# Publishes a few synthetic events (source 'test-emails') to file.events.
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
invite() { # email role [firstName] → prints the user id
  code -b $D/a.jar -X POST $G/users -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"firstName\":\"${3:-Email}\",\"lastName\":\"Test\",\"role\":\"$2\"}" >/dev/null
  grep -o '"id":"[^"]*"' $D/body | head -1 | cut -d'"' -f4
}
event_id() { q auth_db "select id from outbox_events where aggregate_id='$1' and event_type='$2' order by occurred_at desc limit 1"; }
email_row() { q notification_db "select status||'|'||attempts from email_logs where event_id='$1'"; } # → STATUS|attempts
email_status() { q notification_db "select status from email_logs where event_id='$1'"; }
produce() { kafka kafka-console-producer.sh --topic file.events --property parse.key=true --property 'key.separator=|' >/dev/null; }
uuid() { cat /proc/sys/kernel/random/uuid; }
for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 $G/health)" = 200 ] && break; sleep 1; done
SUF=$RANDOM
redis_flush_rl
check "login admin" 200 $(login $D/a.jar admin@medflow.az Admin12345)
ADMIN_NAME=$(q auth_db "select first_name||' '||last_name from users where email='admin@medflow.az'")

echo "== Invite → email + history row (phase 4 done-when)"
E_MAIL="email$SUF@medflow.az"
U1=$(invite $E_MAIL NURSE Aysel)
E1=$(event_id $U1 user.invited)
check "email_logs row SENT after 1 attempt (≤ 10 s)" "SENT|1" "$(waitfor 10 'SENT|1' email_row $E1)"
check "history row too" 1 $(q notification_db "select count(*) from action_history where event_id='$E1'")
ID=$(mail_id $E_MAIL invited)
yes_no "email arrived in Mailpit" "$ID"
curl -s "$MAILPIT/message/$ID" >$D/mail
LOG_ID=$(q notification_db "select id from email_logs where event_id='$E1'")
yes_no "  … subject + from" "$(grep '"Subject":"You'"'"'re invited to MedFlow"' $D/mail | grep 'no-reply@medflow.az')" "$(head -c 300 $D/mail)"
yes_no "  … Message-ID = email_logs id" "$(grep "\"MessageID\":\"$LOG_ID@medflow.az\"" $D/mail)"
yes_no "  … greets by name, names the inviter + role" "$(grep "Hello Aysel" $D/mail | grep "$ADMIN_NAME invited you to MedFlow as NURSE")"
yes_no "  … HTML has the button" "$(grep 'Accept the invitation' $D/mail)"
INV=$(mailtoken $E_MAIL invited)
check "  … the link's token opens the invitation" 200 $(code $G/auth/invitations/$INV)
SENT_AT=$(q notification_db "select sent_at is not null and error is null from email_logs where event_id='$E1'")
check "  … sent_at set, no error" t "$SENT_AT"
JOB=$(printf '%s' "$E1|staff-invite|$E_MAIL" | sha256sum | cut -d' ' -f1)
check "finished job removed from Redis (link not kept)" 0 $($DC exec -T redis redis-cli exists "bull:email:$JOB")
check "no auth-service log line with the link any more" 0 $($DC logs auth-service 2>&1 | grep -c "$INV")

echo "== Redelivered event: no second email"
q auth_db "update outbox_events set published_at = null where id='$E1'" >/dev/null
sleep 5
check "still one email in Mailpit" 1 "$(mailcount $E_MAIL invited)"
check "still one email_logs row" 1 $(q notification_db "select count(*) from email_logs where event_id='$E1'")

echo "== Resend invite = new event → new email"
check "resend invite" 200 $(code -b $D/a.jar -X POST $G/users/$U1/resend-invite)
INV2=$(mailtoken $E_MAIL invited "$INV")
check "second email with a new link" 2 "$(waitfor 10 2 mailcount $E_MAIL invited)"
check "  … new link works, old one not" "200 404" "$(code $G/auth/invitations/$INV2) $(code $G/auth/invitations/$INV)"

echo "== Security emails"
check "nurse accepts the invite" 200 $(code -c $D/n.jar -X POST $G/auth/accept-invite -H 'content-type: application/json' -d "{\"token\":\"$INV2\",\"password\":\"Secret123\"}")
check "change password" 200 $(code -b $D/n.jar -c $D/n.jar -X PATCH $G/auth/change-password -H 'content-type: application/json' -d '{"currentPassword":"Secret123","newPassword":"Secret456"}')
check "password-changed email (≤ 10 s)" 1 "$(waitfor 10 1 mailcount $E_MAIL changed)"
curl -s "$MAILPIT/message/$(mail_id $E_MAIL changed)" >$D/mail
yes_no "  … says 'changed' (not reset)" "$(grep 'account was changed on' $D/mail)" "$(grep -o '"Text":"[^"]*' $D/mail)"
R1=$(tok $D/n.jar refresh_token)
check "refresh (rotates)" 200 $(code -b $D/n.jar -c $D/n.jar -X POST $G/auth/refresh)
check "old refresh replayed → reuse" 401 $(code -H "cookie: refresh_token=$R1" -X POST $G/auth/refresh)
check "session-revoked email (≤ 10 s)" 1 "$(waitfor 10 1 mailcount $E_MAIL signed)"
check "  … payload now carries the email" "$E_MAIL" "$(q auth_db "select payload->'payload'->>'email' from outbox_events where aggregate_id='$U1' and event_type='user.session_revoked' order by occurred_at desc limit 1")"
redis_flush_rl
check "forgot-password" 200 $(code -X POST $G/auth/forgot-password -H 'content-type: application/json' -d "{\"email\":\"$E_MAIL\"}")
check "password-reset email (≤ 10 s)" 1 "$(waitfor 10 1 mailcount $E_MAIL Reset)"
check "  … its link resets the password" 200 $(code -X POST $G/auth/reset-password -H 'content-type: application/json' -d "{\"token\":\"$(mailtoken $E_MAIL Reset)\",\"password\":\"Secret789\"}")

echo "== Links that already expired are not sent"
EX=$(uuid); EXU=$(uuid)
echo "$EXU|{\"eventId\":\"$EX\",\"eventType\":\"user.invited\",\"version\":1,\"occurredAt\":\"$(date -u -d '-4 days' +%Y-%m-%dT%H:%M:%SZ)\",\"source\":\"test-emails\",\"actor\":null,\"payload\":{\"userId\":\"$EXU\",\"email\":\"expired$SUF@medflow.az\",\"firstName\":\"Old\",\"lastName\":\"Invite\",\"role\":\"NURSE\",\"departmentId\":null,\"title\":null,\"inviteLink\":\"http://localhost:5173/accept-invite?token=expired$SUF\",\"expiresAt\":\"$(date -u -d '-1 day' +%Y-%m-%dT%H:%M:%SZ)\",\"resent\":false}}" | produce
check "invite with a dead link → FAILED, not sent (≤ 10 s)" FAILED "$(waitfor 10 FAILED email_status $EX)"
check "  … reason saved" "Expired before it could be sent|0" "$(q notification_db "select error||'|'||attempts from email_logs where event_id='$EX'")"
check "  … nothing in Mailpit" 0 "$(mailcount expired$SUF@medflow.az)"
OLD=$(uuid); OLDU=$(uuid)
echo "$OLDU|{\"eventId\":\"$OLD\",\"eventType\":\"user.password_changed\",\"version\":1,\"occurredAt\":\"$(date -u -d '-2 days' +%Y-%m-%dT%H:%M:%SZ)\",\"source\":\"test-emails\",\"actor\":null,\"payload\":{\"userId\":\"$OLDU\",\"email\":\"late$SUF@medflow.az\",\"firstName\":\"Late\",\"via\":\"CHANGE\"}}" | produce
check "security notice 2 days late → dropped (≤ 10 s)" FAILED "$(waitfor 10 FAILED email_status $OLD)"

echo "== SMTP down for a while → retried, then sent"
$DC pause mailpit >/dev/null 2>&1
U2=$(invite "smtp-a$SUF@medflow.az" DOCTOR)
E2=$(event_id $U2 user.invited)
failed_once() { q notification_db "select status||'|'||attempts||'|'||(error is not null) from email_logs where event_id='$1'"; }
check "first attempt fails: QUEUED, error saved (≤ 25 s)" "QUEUED|1|true" "$(waitfor 25 'QUEUED|1|true' failed_once $E2)"
check "  … history written meanwhile (Kafka side not blocked)" 1 $(q notification_db "select count(*) from action_history where event_id='$E2'")
$DC unpause mailpit >/dev/null 2>&1
check "sent by a retry once SMTP is back (≤ 30 s)" SENT "$(waitfor 30 SENT email_status $E2)"
check "  … on attempt 2" 2 $(q notification_db "select attempts from email_logs where event_id='$E2'")
check "  … error cleared" t $(q notification_db "select error is null from email_logs where event_id='$E2'")

echo "== SMTP down too long → FAILED after 3 attempts"
$DC pause mailpit >/dev/null 2>&1
U3=$(invite "smtp-b$SUF@medflow.az" DOCTOR)
E3=$(event_id $U3 user.invited)
check "given up after 3 attempts (≤ 75 s)" "FAILED|3" "$(waitfor 75 'FAILED|3' email_row $E3)"
$DC unpause mailpit >/dev/null 2>&1
JOB3=$(printf '%s' "$E3|staff-invite|smtp-b$SUF@medflow.az" | sha256sum | cut -d' ' -f1)
check "  … failed job kept in BullMQ for inspection" 1 $($DC exec -T redis redis-cli zscore bull:email:failed $JOB3 | grep -c .)
check "  … not sent later by itself" 0 "$(sleep 3; mailcount smtp-b$SUF@medflow.az)"

echo "== Redis briefly down → the email waits, nothing lost"
RE=$(uuid); REU=$(uuid)
$DC pause redis >/dev/null 2>&1
echo "$REU|{\"eventId\":\"$RE\",\"eventType\":\"user.invited\",\"version\":1,\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"source\":\"test-emails\",\"actor\":null,\"payload\":{\"userId\":\"$REU\",\"email\":\"redis$SUF@medflow.az\",\"firstName\":\"Redis\",\"lastName\":\"Down\",\"role\":\"NURSE\",\"departmentId\":null,\"title\":null,\"inviteLink\":\"http://localhost:5173/accept-invite?token=redis$SUF\",\"expiresAt\":\"$(date -u -d '+3 days' +%Y-%m-%dT%H:%M:%SZ)\",\"resent\":false}}" | produce
check "row stored while Redis is down (≤ 8 s)" "QUEUED|0" "$(waitfor 8 'QUEUED|0' email_row $RE)"
sleep 2
check "  … nothing sent yet" 0 "$(mailcount redis$SUF@medflow.az)"
$DC unpause redis >/dev/null 2>&1
check "sent once Redis is back (≤ 20 s)" "SENT|1" "$(waitfor 20 'SENT|1' email_row $RE)"
check "  … exactly one email" 1 "$(mailcount redis$SUF@medflow.az)"

echo "== GET /history/emails"
redis_flush_rl
check "admin" 200 $(code -b $D/a.jar "$G/history/emails?recipient=email$SUF&limit=50")
yes_no "  … rows of this run" "$(grep "\"recipientEmail\":\"$E_MAIL\"" $D/body)"
check "status=FAILED" 200 $(code -b $D/a.jar "$G/history/emails?status=FAILED&recipient=expired$SUF")
yes_no "  … the expired invite with its reason" "$(grep '"status":"FAILED"' $D/body | grep 'Expired before it could be sent')" "$(cat $D/body)"
check "template filter" 200 $(code -b $D/a.jar "$G/history/emails?template=password-reset&recipient=email$SUF")
yes_no "  … total 1" "$(grep '"total":1' $D/body)" "$(cat $D/body)"
check "bad status → 400" 400 $(code -b $D/a.jar "$G/history/emails?status=LOST")
check "bad template → 400" 400 $(code -b $D/a.jar "$G/history/emails?template=Not%20One")
check "nurse logs in" 200 $(login $D/n.jar $E_MAIL Secret789)
check "nurse → 403" 403 $(code -b $D/n.jar "$G/history/emails")
check "no cookie → 401" 401 $(code "$G/history/emails")

rm -rf $D
echo
echo "PASS $PASS  FAIL $FAIL"
[ $FAIL -eq 0 ]
