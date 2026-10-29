#!/bin/bash
# End-to-end checks of permission-based access control through the gateway:
# catalog seed, Redis cache → x-user-permissions, PermissionGuard (403),
# header spoofing, admin changes → outbox → Kafka → Redis + Socket.io push
# + action history, validation, ADMIN lock-out rule, cache miss fallback,
# versioned cache writes, catalog sync on restart.
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-permissions.sh
# Restores the DOCTOR permissions it changes; restarts configurations-service once.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
API=http://localhost:3000/api/v1
P=$API/configurations/permissions
D=$(mktemp -d)
DC="docker compose"
PASS=0; FAIL=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1 (expected $2, got $3)"; FAIL=$((FAIL+1)); fi
}
code() { curl -s -o $D/body -w '%{http_code}' "$@"; }
as_admin() { code -b $D/admin "$@"; }
as() { local t=$1; shift; code -b "access_token=$t" "$@"; } # as <token> <curl args>
put() { as_admin -X PUT $P -H 'content-type: application/json' -d "$1"; }
j() { jq -c "(.data // .) | $1" $D/body; }
q() { $DC exec -T postgres psql -U medflow -d "$1" -tAc "$2"; }
cq() { q configurations_db "$1"; }
rc() { $DC exec -T redis redis-cli "$@"; }
redis_flush_rl() { $DC exec -T redis sh -c "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli del" >/dev/null; }
# Waits (≤ 15 s) until the role's cache contains / lacks a code
wait_cache() { # role code present|absent
  for _ in $(seq 1 30); do
    local has=absent
    rc get "permissions:role:$1" | tr ',' '\n' | grep -qx "$2" && has=present
    [ "$has" = "$3" ] && { echo "$3"; return; }
    sleep 0.5
  done
  echo "timeout"
}
listen() { node scripts/lib/socket-listen.mjs http://localhost:3000 "$1" "$2" >"$3" 2>&1 & }
doctor_list() { cq "select coalesce(json_agg(permission order by permission), '[]') from role_permissions where role='DOCTOR'" | jq -c .; }

echo "Setup"
redis_flush_rl
check "admin login" 200 "$(code -c $D/admin -X POST $API/auth/login \
  -H 'content-type: application/json' -d '{"email":"admin@medflow.az","password":"Admin12345"}')"
SECRET=$(grep '^JWT_ACCESS_SECRET=' .env | cut -d= -f2)
DOC=$(node scripts/lib/sign-token.mjs "$SECRET" "$(cat /proc/sys/kernel/random/uuid)" DOCTOR 300)
RECEP=$(node scripts/lib/sign-token.mjs "$SECRET" "$(cat /proc/sys/kernel/random/uuid)" RECEPTIONIST 300)
NURSE=$(node scripts/lib/sign-token.mjs "$SECRET" "$(cat /proc/sys/kernel/random/uuid)" NURSE 300)
ORIGINAL_DOCTOR=$(doctor_list)

echo "Catalog seed"
check "52 permissions in the catalog table" 52 "$(cq "select count(*) from permissions")"
check "ADMIN defaults (DOC 4.2)" 'true|true|false' "$(cq "select bool_or(permission='users.invite')||'|'||bool_or(permission='permissions.manage')||'|'||bool_or(permission='encounters.manage') from role_permissions where role='ADMIN'")"
check "every role cached in Redis" 5 "$(rc --scan --pattern 'permissions:role:*' | grep -vc ':version')"

echo "Gateway → x-user-permissions"
check "admin /me → 200" 200 "$(as_admin $P/me)"
check "  admin has permissions.manage" true "$(j '.permissions|index("permissions.manage") != null')"
check "doctor /me → role + list from Redis" '"DOCTOR"|true|false' "$(as $DOC $P/me >/dev/null; j .role)|$(j '.permissions|index("records.read") != null')|$(j '.permissions|index("users.read") != null')"
check "  same list as the Redis key" "$(rc get permissions:role:DOCTOR)" "$(j '.permissions|join(",")' | tr -d '"')"
check "no cookie → 401" 401 "$(code $P/me)"

echo "PermissionGuard"
check "doctor GET /users → 403" '403|"FORBIDDEN"|"Missing permission: users.read"' "$(as $DOC $API/users)|$(j .error.code)|$(j .error.message)"
check "admin GET /users → 200" 200 "$(as_admin "$API/users?limit=1")"
check "doctor GET /history → 403" 403 "$(as $DOC $API/history)"
check "doctor GET /history/entity → 200" 200 "$(as $DOC "$API/history/entity/USER/$(cat /proc/sys/kernel/random/uuid)")"
check "receptionist GET /history/emails → 403" 403 "$(as $RECEP $API/history/emails)"
check "self endpoints need no permission (notifications)" 200 "$(as $RECEP $API/notifications/unread-count)"
check "spoofed x-user-permissions ignored" 403 "$(as $DOC $API/users -H 'x-user-permissions: users.read')"

echo "Matrix"
check "admin GET matrix → 200" 200 "$(as_admin $P)"
check "  52 permissions, 11 groups, 5 roles" '52|11|5' "$(j '.permissions|length')|$(j '.groups|length')|$(j '.roles|keys|length')"
check "  ADMIN locks" '["permissions.read","permissions.manage"]' "$(j .locked.ADMIN)"
check "  DOCTOR list = DB" "$(doctor_list)" "$(j '.roles.DOCTOR|sort')"
check "doctor GET matrix → 403" 403 "$(as $DOC $P)"
check "doctor PUT → 403" 403 "$(as $DOC -X PUT $P -H 'content-type: application/json' -d '{"roles":{"DOCTOR":[]}}')"

echo "Admin grants users.read to DOCTOR"
WITH_USERS=$(echo "$ORIGINAL_DOCTOR" | jq -c '. + ["users.read"]')
listen "$DOC" 12 $D/doc-socket
listen "$RECEP" 12 $D/recep-socket
sleep 1.5
OUTBOX_BEFORE=$(cq "select count(*) from outbox_events")
check "PUT → 200" 200 "$(put "{\"roles\":{\"DOCTOR\":$WITH_USERS}}")"
check "  response has the new list" true "$(j '.DOCTOR|index("users.read") != null')"
check "  row in role_permissions (granted_by = admin)" 1 "$(cq "select count(*) from role_permissions r where role='DOCTOR' and permission='users.read' and granted_by is not null")"
check "  one outbox event" 1 "$(( $(cq "select count(*) from outbox_events") - OUTBOX_BEFORE ))"
EVENT=$(cq "select payload from outbox_events where event_type='role_permissions.updated' order by occurred_at desc limit 1")
check "  event payload: role + added + full list" '"DOCTOR"|["users.read"]|[]|true' "$(echo "$EVENT" | jq -c .payload.role)|$(echo "$EVENT" | jq -c .payload.added)|$(echo "$EVENT" | jq -c .payload.removed)|$(echo "$EVENT" | jq -c '.payload.permissions|index("users.read") != null')"
check "Kafka → Redis updated" present "$(wait_cache DOCTOR users.read present)"
check "doctor GET /users → 200 now" 200 "$(as $DOC "$API/users?limit=1")"
sleep 2
check "doctor socket got permissions:updated" true "$(grep '"permissions:updated"' $D/doc-socket | tail -1 | jq -c '.data.role == "DOCTOR" and (.data.permissions|index("users.read") != null)')"
check "receptionist socket got nothing" 0 "$(grep -c '"permissions:updated"' $D/recep-socket)"
EVENT_ID=$(echo "$EVENT" | jq -r .eventId)
for _ in $(seq 1 20); do [ "$(q notification_db "select count(*) from action_history where event_id='$EVENT_ID'")" = 1 ] && break; sleep 0.5; done
check "action history row" "role_permissions.updated|ROLE|permissions.updated|[\"users.read\"]" \
  "$(q notification_db "select event_type||'|'||entity_type||'|'||summary_key||'|'||(summary_params->'added')::text from action_history where event_id='$EVENT_ID'" | tr -d ' ')"

echo "No change → no event"
OUTBOX_BEFORE=$(cq "select count(*) from outbox_events")
check "same list again → 200" 200 "$(put "{\"roles\":{\"DOCTOR\":$WITH_USERS}}")"
check "  no outbox event" 0 "$(( $(cq "select count(*) from outbox_events") - OUTBOX_BEFORE ))"

echo "Admin takes it back"
check "PUT original list → 200" 200 "$(put "{\"roles\":{\"DOCTOR\":$ORIGINAL_DOCTOR}}")"
check "  Kafka → Redis updated" absent "$(wait_cache DOCTOR users.read absent)"
check "  doctor GET /users → 403 again" 403 "$(as $DOC $API/users)"

echo "Validation"
check "unknown role → 400" '400|"VALIDATION_ERROR"|"roles.JANITOR"' "$(put '{"roles":{"JANITOR":[]}}')|$(j .error.code)|$(j '.error.details[0].field')"
check "unknown permission → 400" 400 "$(put '{"roles":{"DOCTOR":["users.fly"]}}')"
check "not an array → 400" 400 "$(put '{"roles":{"DOCTOR":"users.read"}}')"
check "empty roles → 400" 400 "$(put '{"roles":{}}')"
check "roles missing → 400" 400 "$(put '{}')"
check "ADMIN without permissions.manage → 422" '422|"BUSINESS_RULE"' "$(put '{"roles":{"ADMIN":["permissions.read","users.read"]}}')|$(j .error.code)"
check "  ADMIN unchanged" 1 "$(cq "select count(*) from role_permissions where role='ADMIN' and permission='permissions.manage'")"
check "duplicates collapse" '200|1' "$(put "{\"roles\":{\"DOCTOR\":$(echo "$ORIGINAL_DOCTOR" | jq -c '. + ["records.read"]')}}")|$(j '[.DOCTOR[]|select(.=="records.read")]|length')"

echo "Cache miss (Redis key gone)"
rc del permissions:role:NURSE permissions:role:NURSE:version >/dev/null
check "nurse request still works" '200|true' "$(as $NURSE $P/me)|$(j '.permissions|index("lab.process") != null')"
check "  key refilled from the DB" true "$(rc get permissions:role:NURSE | tr ',' '\n' | grep -qx lab.process && echo true)"

echo "Versioned cache write (old event never wins)"
rc set permissions:role:DOCTOR:version $(( $(date +%s%3N) + 3600000 )) >/dev/null
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
put "{\"roles\":{\"DOCTOR\":$WITH_USERS}}" >/dev/null
sleep 4
check "event older than the cache is skipped" absent "$(rc get permissions:role:DOCTOR | tr ',' '\n' | grep -qx users.read && echo present || echo absent)"
check "  consumer logged the skip" 1 "$($DC logs --since "$SINCE" configurations-service 2>&1 | grep -c 'is newer, event')"
put "{\"roles\":{\"DOCTOR\":$ORIGINAL_DOCTOR}}" >/dev/null
rc del permissions:role:DOCTOR permissions:role:DOCTOR:version >/dev/null
check "  key rebuilt from the DB on the next request" 200 "$(as $DOC $P/me)"
check "  DB, cache and original agree" "$ORIGINAL_DOCTOR" "$(doctor_list)"

echo "Catalog sync on restart"
cq "delete from permissions where code='lab.stats'" >/dev/null # as if lab.stats were new
cq "insert into permissions (code) values ('old.thing'); insert into role_permissions (role, permission) values ('NURSE', 'old.thing')" >/dev/null
$DC restart configurations-service >/dev/null 2>&1
for _ in $(seq 1 60); do [ "$(curl -s $API/health | jq -r '.data.checks["configurations-service"].status')" = up ] && break; sleep 1; done
check "new code seeded with its defaults (NURSE)" 'NURSE' "$(cq "select string_agg(role, ',') from role_permissions where permission='lab.stats'")"
check "obsolete code removed with its grants" '0|0' "$(cq "select count(*) from permissions where code='old.thing'")|$(cq "select count(*) from role_permissions where permission='old.thing'")"
check "admin's choices kept (DOCTOR list unchanged)" "$ORIGINAL_DOCTOR" "$(doctor_list)"
check "cache warmed again" true "$(rc get permissions:role:NURSE | tr ',' '\n' | grep -qx lab.stats && echo true)"

rm -rf $D
echo
echo "PASS $PASS  FAIL $FAIL"
[ $FAIL -eq 0 ]
