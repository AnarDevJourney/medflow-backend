#!/bin/bash
# End-to-end checks of staff-service through the gateway.
# Departments: seed, active list + Redis cache, management list (search,
# filter, sort, pages), create / edit / deactivate, permissions, validation,
# conflicts, outbox → Kafka → action history.
# Profiles: created / synced from auth.events, invite department check,
# directory, doctors picker, admin edit, own edit, staff.updated history.
# Schedules: read rules (read / read_own), replace the week, validation,
# doctor-only, deactivated → 409, schedule.updated history.
# Time off: add / list / remove, overlap → 409 (exclusion constraint),
# date rules, ended periods kept, time_off.* history.
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-staff.sh
# Deletes the departments and users it creates (their history rows stay: append-only).
cd "$(dirname "${BASH_SOURCE[0]}")/.."
API=http://localhost:3000/api/v1
DEP=$API/departments
D=$(mktemp -d)
DC="docker compose"
CACHE=staff:departments:active
PASS=0; FAIL=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1 (expected $2, got $3)"; FAIL=$((FAIL+1)); fi
}
code() { curl -s -o $D/body -w '%{http_code}' "$@"; }
as_admin() { code -b $D/admin "$@"; }
as() { local t=$1; shift; code -b "access_token=$t" "$@"; } # as <token> <curl args>
post() { as_admin -X POST $DEP -H 'content-type: application/json' -d "$1"; }
patch() { as_admin -X PATCH $DEP/$1 -H 'content-type: application/json' -d "$2"; }
j() { jq -c "(.data // .) | $1" $D/body; }
q() { $DC exec -T postgres psql -U medflow -d "$1" -tAc "$2"; }
sq() { q staff_db "$1"; }
hq() { q notification_db "$1"; }
rc() { $DC exec -T redis redis-cli "$@"; }
redis_flush_rl() { $DC exec -T redis sh -c "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli del" >/dev/null; }
cleanup() { sq "delete from departments where code like 'ZT%' or code = '9Z7'" >/dev/null; rc del $CACHE >/dev/null; }
# Waits (≤ 20 s) until the entity has a history row with this key
wait_history() { # summary_key entity_id
  for _ in $(seq 1 40); do
    [ "$(hq "select count(*) from action_history where summary_key='$1' and entity_id='$2'")" -gt 0 ] && { echo "$1"; return; }
    sleep 0.5
  done
  echo "timeout"
}

echo "Setup"
redis_flush_rl
cleanup
check "admin login" 200 "$(code -c $D/admin -X POST $API/auth/login \
  -H 'content-type: application/json' -d '{"email":"admin@medflow.az","password":"Admin12345"}')"
SECRET=$(grep '^JWT_ACCESS_SECRET=' .env | cut -d= -f2)
DOC=$(node scripts/lib/sign-token.mjs "$SECRET" "$(cat /proc/sys/kernel/random/uuid)" DOCTOR 300)
ACC=$(node scripts/lib/sign-token.mjs "$SECRET" "$(cat /proc/sys/kernel/random/uuid)" ACCOUNTANT 300)

echo "Seed + active list"
check "5 seeded departments" 5 "$(sq "select count(*) from departments where code in ('GEN','CARD','PED','NEURO','ORTH')")"
check "no cookie → 401" 401 "$(code $DEP)"
check "doctor GET /departments → 200" 200 "$(as $DOC $DEP)"
check "  sorted by name" true "$(j '[.[].name] == ([.[].name]|sort)')"
check "  only active" true "$(j 'all(.isActive)')"
check "  fields" '["code","createdAt","description","id","isActive","location","name","phone","updatedAt"]' "$(j '.[0]|keys')"
check "accountant GET /departments → 200" 200 "$(as $ACC $DEP)"

echo "Redis cache"
check "list cached" true "$(rc get $CACHE | jq -c 'length > 0')"
TTL=$(rc ttl $CACHE)
check "  TTL ≤ 10 min" true "$([ "$TTL" -gt 0 ] && [ "$TTL" -le 600 ] && echo true)"
rc set $CACHE '[{"name":"From cache"}]' EX 60 >/dev/null
as $DOC $DEP >/dev/null
check "served from the cache" '"From cache"' "$(j '.[0].name')"
rc del $CACHE >/dev/null

echo "Create"
check "doctor POST → 403" '403|"Missing permission: departments.manage"' "$(as $DOC -X POST $DEP -H 'content-type: application/json' -d '{"code":"ZTX","name":"Nope"}')|$(j .error.message)"
as $DOC $DEP >/dev/null # fills the cache
check "admin POST → 201" 201 "$(post '{"code":" zt1 ","name":"  ZT Oncology ","description":"  ","location":"Building C","phone":"+994 12 555 10 20"}')"
ID=$(j .id | tr -d '"')
check "  code uppercased, name trimmed, empty → null" '"ZT1"|"ZT Oncology"|null' "$(j .code)|$(j .name)|$(j .description)"
check "  active by default" true "$(j .isActive)"
check "  cache cleared" 0 "$(rc exists $CACHE)"
as $DOC $DEP >/dev/null
check "  in the active list" 1 "$(j '[.[]|select(.code=="ZT1")]|length')"
check "  outbox event" 'department.created|DEPARTMENT|staff.events' "$(sq "select event_type||'|'||aggregate_type||'|'||topic from outbox_events where aggregate_id='$ID'")"
check "  envelope actor" '"ADMIN"' "$(sq "select payload->'actor'->'role' from outbox_events where aggregate_id='$ID'")"
check "  Kafka → action history" department.created "$(wait_history department.created $ID)"
check "  history entity + source" 'DEPARTMENT|staff-service' "$(hq "select entity_type||'|'||source from action_history where entity_id='$ID'")"
check "minimal body → 201" '201|null|null' "$(post '{"code":"ZT2","name":"ZT Minimal"}')|$(j .location)|$(j .phone)"
ID2=$(j .id | tr -d '"')

echo "Free-form codes"
check "starts with a digit → 201" '201|"9Z7"' "$(post '{"code":"9z7","name":"ZT Digit"}')|$(j .code)"
check "symbols and a space → 201" '201|"ZT-1 /A"' "$(post '{"code":"zt-1 /a","name":"ZT Symbols"}')|$(j .code)"
check "Azerbaijani letters → 201" '201|"ZTŞƏ"' "$(post '{"code":"ztşə","name":"ZT Azerbaijani"}')|$(j .code)"
check "one character is enough" 201 "$(as_admin -X POST $DEP -H 'content-type: application/json' -d '{"code":"Z","name":"ZT One"}'; sq "delete from departments where code = 'Z'" >/dev/null)"

echo "Conflicts"
check "same code → 409 field code" '409|"CONFLICT"|"code"' "$(post '{"code":"ZT1","name":"ZT Other"}')|$(j .error.code)|$(j .error.details.field)"
check "same code in lower case → 409" 409 "$(post '{"code":"zt1","name":"ZT Other"}')"
check "same name → 409 field name" '409|"name"' "$(post '{"code":"ZT3","name":"ZT Oncology"}')|$(j .error.details.field)"
check "rename to a taken name → 409" '409|"name"' "$(patch $ID2 '{"name":"ZT Oncology"}')|$(j .error.details.field)"
check "  no event from the failed writes" 1 "$(sq "select count(*) from outbox_events where aggregate_id='$ID2'")"

echo "Validation"
check "code missing → 400" '400|"code"' "$(post '{"name":"ZT No code"}')|$(j '.error.details[0].field')"
check "blank code → 400" '400|"code"' "$(post '{"code":"   ","name":"ZT Bad"}')|$(j '.error.details[0].field')"
check "code 11 chars → 400" 400 "$(post '{"code":"ZTABCDEFGHI","name":"ZT Bad"}')"
check "blank name → 400" '400|"name"' "$(post '{"code":"ZT4","name":"   "}')|$(j '.error.details[0].field')"
check "name 101 chars → 400" 400 "$(post "{\"code\":\"ZT4\",\"name\":\"$(printf 'a%.0s' $(seq 1 101))\"}")"
check "bad phone → 400" '400|"phone"' "$(post '{"code":"ZT4","name":"ZT Bad","phone":"call me"}')|$(j '.error.details[0].field')"
check "unknown field → 400" 400 "$(post '{"code":"ZT4","name":"ZT Bad","isActive":false}')"
check "PATCH code → 400 (never changes)" 400 "$(patch $ID '{"code":"ZT9"}')"
check "PATCH name null → 400" 400 "$(patch $ID '{"name":null}')"
check "PATCH isActive null → 400" 400 "$(patch $ID '{"isActive":null}')"
check 'PATCH isActive "false" → 400' 400 "$(patch $ID '{"isActive":"false"}')"
check "bad uuid → 400" 400 "$(patch not-a-uuid '{"name":"x"}')"
check "unknown id → 404" '404|"NOT_FOUND"' "$(patch "$(cat /proc/sys/kernel/random/uuid)" '{"name":"x"}')|$(j .error.code)"
check "nothing stored" 0 "$(sq "select count(*) from departments where code='ZT4'")"

echo "Edit"
check "doctor PATCH → 403" 403 "$(as $DOC -X PATCH $DEP/$ID -H 'content-type: application/json' -d '{"name":"x"}')"
as $DOC $DEP >/dev/null
check "PATCH → 200, other fields kept" '200|"ZT Oncology 2"|"Building C"|"ZT1"' "$(patch $ID '{"name":"ZT Oncology 2"}')|$(j .name)|$(j .location)|$(j .code)"
check "  cache cleared" 0 "$(rc exists $CACHE)"
check "  event lists the field" '["name"]' "$(sq "select payload->'payload'->'changedFields' from outbox_events where aggregate_id='$ID' and event_type='department.updated'" | jq -c .)"
check "  history key" department.updated "$(wait_history department.updated $ID)"
check "  history params" 'ZT Oncology 2|["name"]' "$(hq "select summary_params->>'name'||'|'||(summary_params->'fields')::text from action_history where summary_key='department.updated' and entity_id='$ID'")"
check "null clears an optional field" '200|null' "$(patch $ID '{"location":null}')|$(j .location)"
check "empty string clears too" '200|null' "$(patch $ID '{"phone":""}')|$(j .phone)"
BEFORE=$(sq "select count(*) from outbox_events")
as $DOC $DEP >/dev/null
check "same values → 200" 200 "$(patch $ID '{"name":"ZT Oncology 2","location":null}')"
check "  no event" 0 "$(( $(sq "select count(*) from outbox_events") - BEFORE ))"
check "  cache kept" 1 "$(rc exists $CACHE)"
check "empty body → 200, no event" '200|0' "$(patch $ID '{}')|$(( $(sq "select count(*) from outbox_events") - BEFORE ))"

echo "Parallel edits"
for name in A B; do
  as_admin -X PATCH $DEP/$ID2 -H 'content-type: application/json' -d "{\"description\":\"ZT parallel $name\"}" >/dev/null &
done
wait
check "two different values → two events" 2 "$(sq "select count(*) from outbox_events where aggregate_id='$ID2' and event_type='department.updated'")"

echo "Deactivate / reactivate"
check "deactivate → 200" '200|false' "$(patch $ID '{"isActive":false}')|$(j .isActive)"
check "  history says deactivated" department.deactivated "$(wait_history department.deactivated $ID)"
as $DOC $DEP >/dev/null
check "  gone from the active list" 0 "$(j '[.[]|select(.code=="ZT1")]|length')"
check "reactivate → 200" '200|true' "$(patch $ID '{"isActive":true}')|$(j .isActive)"
check "  history says reactivated" department.reactivated "$(wait_history department.reactivated $ID)"
as $DOC $DEP >/dev/null
check "  back in the active list" 1 "$(j '[.[]|select(.code=="ZT1")]|length')"
patch $ID '{"isActive":false}' >/dev/null

echo "Management list"
check "doctor GET /all → 403" 403 "$(as $DOC $DEP/all)"
check "admin GET /all → 200 with meta" '200|1|20' "$(as_admin $DEP/all)|$(j .meta.page)|$(j .meta.limit)"
check "  inactive included" 1 "$(j '[.items[]|select(.code=="ZT1")]|length')"
check "  newest first by default" true "$(j '[.items[].createdAt] == ([.items[].createdAt]|sort|reverse)')"
check "isActive=false" true "$(as_admin "$DEP/all?isActive=false" >/dev/null; j 'all(.items[]; .isActive == false) and (.items|length) >= 1')"
check "isActive=true" true "$(as_admin "$DEP/all?isActive=true" >/dev/null; j 'all(.items[]; .isActive) and (.items|length) >= 5')"
check "bad isActive → 400" 400 "$(as_admin "$DEP/all?isActive=maybe")"
check "search by name" '"Cardiology"' "$(as_admin "$DEP/all?search=cardio" >/dev/null; j '.items[0].name')"
check "search by code" '1|"ZT Minimal"' "$(as_admin "$DEP/all?search=zt2" >/dev/null; j '.meta.total')|$(j '.items[0].name')"
check "search by location" true "$(as_admin "$DEP/all?search=Building%20B" >/dev/null; j '(.items|length) >= 2')"
check "% is literal" 0 "$(as_admin "$DEP/all?search=%25" >/dev/null; j '.meta.total')"
check "sort code:desc" true "$(as_admin "$DEP/all?sort=code:desc" >/dev/null; j '[.items[].code] == ([.items[].code]|sort|reverse)')"
check "page size" '2|true' "$(as_admin "$DEP/all?limit=2&page=2" >/dev/null; j '.items|length')|$(j '.meta.total >= 7')"

# ─── Staff profiles (5.2) ────────────────────────────────────────────────────
redis_flush_rl
STAFF=$API/staff
USERS=$API/users
RUN=$(date +%s%N | tail -c 9)
CARD=$(sq "select id from departments where code='CARD'")
PED=$(sq "select id from departments where code='PED'")
INACTIVE=$ID # ZT1, deactivated above
invite() { as_admin -X POST $USERS -H 'content-type: application/json' -d "$1"; }
spatch() { as_admin -X PATCH $STAFF/$1 -H 'content-type: application/json' -d "$2"; }
# Waits (≤ 20 s) until the staff row matches the SQL condition
wait_staff() { # user_id condition
  for _ in $(seq 1 40); do
    [ "$(sq "select count(*) from staff_members where user_id='$1' and ($2)")" -gt 0 ] && { echo ok; return; }
    sleep 0.5
  done
  echo timeout
}

echo "Profile from user.invited"
check "invite with department + title → 201" 201 "$(invite "{\"email\":\"zt-doc-$RUN@medflow.test\",\"firstName\":\"Zaur\",\"lastName\":\"Testov\",\"role\":\"DOCTOR\",\"departmentId\":\"$CARD\",\"title\":\"Cardiologist\"}")"
U1=$(j .id | tr -d '"')
check "  profile created" ok "$(wait_staff $U1 "true")"
check "  copies + department + title" "Zaur|Testov|DOCTOR|INVITED|true|$CARD|Cardiologist" "$(sq "select first_name||'|'||last_name||'|'||role||'|'||status||'|'||is_active||'|'||department_id||'|'||title from staff_members where user_id='$U1'")"
check "invite with an inactive department → 422" '422|"BUSINESS_RULE"|"departmentId"' "$(invite "{\"email\":\"zt-x-$RUN@medflow.test\",\"firstName\":\"X\",\"lastName\":\"Y\",\"role\":\"NURSE\",\"departmentId\":\"$INACTIVE\"}")|$(j .error.code)|$(j .error.details.field)"
check "invite with an unknown department → 422" 422 "$(invite "{\"email\":\"zt-x-$RUN@medflow.test\",\"firstName\":\"X\",\"lastName\":\"Y\",\"role\":\"NURSE\",\"departmentId\":\"$(cat /proc/sys/kernel/random/uuid)\"}")"
check "  no user created" 0 "$(q auth_db "select count(*) from users where email='zt-x-$RUN@medflow.test'")"
check "invite without department → 201" 201 "$(invite "{\"email\":\"zt-nurse-$RUN@medflow.test\",\"firstName\":\"Nigar\",\"lastName\":\"Testova\",\"role\":\"NURSE\"}")"
U2=$(j .id | tr -d '"')
check "  profile without department" ok "$(wait_staff $U2 "department_id is null and title is null")"
check "resend invite → 200" 200 "$(as_admin -X POST $USERS/$U1/resend-invite)"
sleep 2
check "  still CARD + Cardiologist, one row" "$CARD|Cardiologist|1" "$(sq "select department_id||'|'||title||'|'||count(*) over () from staff_members where user_id='$U1'")"

echo "Read"
check "no cookie → 401" 401 "$(code $STAFF)"
check "doctor GET /staff/:userId → 200" '200|"Cardiology"|"CARD"' "$(as $DOC $STAFF/$U1)|$(j .department.name)|$(j .department.code)"
check "  fields" '["bio","createdAt","department","email","firstName","hireDate","isActive","lastName","licenseNumber","phone","role","specialization","status","title","updatedAt","userId"]' "$(j 'keys')"
check "unknown user → 404" 404 "$(as $DOC $STAFF/$(cat /proc/sys/kernel/random/uuid))"
check "bad uuid → 400" 400 "$(as $DOC $STAFF/nope)"
check "doctor directory: only ACTIVE" true "$(as $DOC "$STAFF?limit=100" >/dev/null; j 'all(.items[]; .status == "ACTIVE")')"
check "  status filter ignored without users.read" true "$(as $DOC "$STAFF?status=INVITED" >/dev/null; j 'all(.items[]; .status == "ACTIVE")')"
check "admin status=INVITED + search finds the invite" '1|"Zaur"' "$(as_admin "$STAFF?status=INVITED&search=zt-doc-$RUN" >/dev/null; j .meta.total)|$(j '.items[0].firstName')"
check "admin search by full name" true "$(as_admin "$STAFF?search=Zaur%20Testov" >/dev/null; j "[.items[].userId] | index(\"$U1\") != null")"
check "role + department filter" true "$(as_admin "$STAFF?role=DOCTOR&departmentId=$CARD&limit=100" >/dev/null; j "all(.items[]; .role == \"DOCTOR\" and .department.code == \"CARD\") and ([.items[].userId] | index(\"$U1\") != null)")"
check "newest first by default" true "$(as_admin "$STAFF?limit=100" >/dev/null; j '[.items[].createdAt] == ([.items[].createdAt]|sort|reverse)')"
check "sort department:asc → 200" 200 "$(as_admin "$STAFF?sort=department:asc")"
check "bad role → 400" 400 "$(as_admin "$STAFF?role=PILOT")"
check "accountant GET /staff/doctors → 200" 200 "$(as $ACC "$STAFF/doctors?departmentId=$CARD")"
check "  only active CARD doctors, includes the invite" true "$(j "all(.[]; .role == \"DOCTOR\" and .department.code == \"CARD\" and .isActive) and ([.[].userId] | index(\"$U1\") != null)")"

echo "Admin edit"
check "doctor PATCH → 403" 403 "$(as $DOC -X PATCH $STAFF/$U1 -H 'content-type: application/json' -d '{"title":"x"}')"
check "PATCH → 200" "200|\"Senior Cardiologist\"|\"Interventional\"|\"ZT-LIC-$RUN\"|\"2024-09-01\"" "$(spatch $U1 "{\"title\":\" Senior Cardiologist \",\"specialization\":\"Interventional\",\"licenseNumber\":\"ZT-LIC-$RUN\",\"hireDate\":\"2024-09-01\"}")|$(j .title)|$(j .specialization)|$(j .licenseNumber)|$(j .hireDate)"
check "  event" '["title","specialization","licenseNumber","hireDate"]|STAFF_MEMBER|Cardiology' "$(sq "select (payload->'payload'->'changedFields')::text||'|'||aggregate_type||'|'||(payload->'payload'->>'departmentName') from outbox_events where aggregate_id='$U1' and event_type='staff.updated' order by occurred_at desc limit 1" | sed 's/, /,/g')"
check "  history" staff.updated "$(wait_history staff.updated $U1)"
check "  history entity" "STAFF_MEMBER|Zaur Testov" "$(hq "select entity_type||'|'||(summary_params->>'name') from action_history where summary_key='staff.updated' and entity_id='$U1' limit 1")"
check "move to PED → 200" '200|"PED"' "$(spatch $U1 "{\"departmentId\":\"$PED\"}")|$(j .department.code)"
check "inactive department → 422" '422|"departmentId"' "$(spatch $U1 "{\"departmentId\":\"$INACTIVE\"}")|$(j .error.details.field)"
check "unknown department → 422" 422 "$(spatch $U1 "{\"departmentId\":\"$(cat /proc/sys/kernel/random/uuid)\"}")"
check "department null → 200" '200|null' "$(spatch $U1 '{"departmentId":null}')|$(j .department)"
check "same licence on another person → 409" '409|"licenseNumber"' "$(spatch $U2 "{\"licenseNumber\":\"ZT-LIC-$RUN\"}")|$(j .error.details.field)"
check "bad hireDate → 400" 400 "$(spatch $U1 '{"hireDate":"2024-13-01"}')"
check "bad phone → 400" 400 "$(spatch $U1 '{"phone":"call me"}')"
check "name is not editable here → 400" 400 "$(spatch $U1 '{"firstName":"X"}')"
BEFORE=$(sq "select count(*) from outbox_events")
check "same values → 200, no event" '200|0' "$(spatch $U1 '{"title":"Senior Cardiologist"}')|$(( $(sq "select count(*) from outbox_events") - BEFORE ))"
check "unknown user → 404" 404 "$(spatch $(cat /proc/sys/kernel/random/uuid) '{"title":"x"}')"

echo "Own profile"
SELF=$(node scripts/lib/sign-token.mjs "$SECRET" "$U1" DOCTOR 300)
check "GET /staff/me → 200" "200|\"$U1\"" "$(as $SELF $STAFF/me)|$(j .userId)"
check "PATCH /staff/me phone + bio → 200" '200|"+994 50 111 22 33"|"Heart doctor"' "$(as $SELF -X PATCH $STAFF/me -H 'content-type: application/json' -d '{"phone":"+994 50 111 22 33","bio":"Heart doctor"}')|$(j .phone)|$(j .bio)"
check "  history: own edit" staff.profileUpdated "$(wait_history staff.profileUpdated $U1)"
check "own title → 400" 400 "$(as $SELF -X PATCH $STAFF/me -H 'content-type: application/json' -d '{"title":"Chief"}')"
check "no profile → 404" 404 "$(as $DOC $STAFF/me)"

echo "Schedules"
SCH=$API/schedules
REC=$(node scripts/lib/sign-token.mjs "$SECRET" "$(cat /proc/sys/kernel/random/uuid)" RECEPTIONIST 300)
put() { as_admin -X PUT $SCH/$1 -H 'content-type: application/json' -d "$2"; }
WEEK='{"days":[{"dayOfWeek":3,"startTime":"10:00","endTime":"14:00","slotMinutes":20},{"dayOfWeek":1,"startTime":"09:00","endTime":"17:00","slotMinutes":30}]}'
check "empty week at first" '200|[]' "$(as_admin $SCH/$U1)|$(j .days)"
check "no cookie → 401" 401 "$(code $SCH/$U1)"
check "accountant → 403" 403 "$(as $ACC $SCH/$U1)"
check "doctor reads another's week → 403" 403 "$(as $DOC $SCH/$U1)"
check "doctor reads own week → 200" 200 "$(as $SELF $SCH/$U1)"
check "receptionist reads → 200" 200 "$(as $REC $SCH/$U1)"
check "unknown user → 404" 404 "$(as_admin $SCH/$(cat /proc/sys/kernel/random/uuid))"
check "bad uuid → 400" 400 "$(as_admin $SCH/nope)"
check "doctor PUT → 403" 403 "$(as $SELF -X PUT $SCH/$U1 -H 'content-type: application/json' -d "$WEEK")"
check "receptionist PUT → 403" 403 "$(as $REC -X PUT $SCH/$U1 -H 'content-type: application/json' -d "$WEEK")"
check "PUT week → 200, Monday first" '200|[1,3]|"09:00"|20' "$(put $U1 "$WEEK")|$(j '[.days[].dayOfWeek]')|$(j '.days[0].startTime')|$(j '.days[1].slotMinutes')"
check "  rows" '1|09:00:00|17:00:00|30;3|10:00:00|14:00:00|20' "$(sq "select string_agg(day_of_week||'|'||start_time||'|'||end_time||'|'||slot_minutes, ';' order by day_of_week) from doctor_schedules d join staff_members s on s.id = d.staff_member_id where s.user_id='$U1'")"
check "  GET returns it" '[1,3]|"17:00"' "$(as $REC $SCH/$U1 >/dev/null; j '[.days[].dayOfWeek]')|$(j '.days[0].endTime')"
check "  event" 'schedule.updated|STAFF_MEMBER|[1,3]|[]' "$(sq "select event_type||'|'||aggregate_type||'|'||(payload->'payload'->'changedDays')::text||'|'||(payload->'payload'->'previousDays')::text from outbox_events where aggregate_id='$U1' and event_type='schedule.updated' order by occurred_at desc limit 1" | sed 's/, /,/g')"
check "  history" schedule.updated "$(wait_history schedule.updated $U1)"
check "  history params" 'Zaur Testov|["1","3"]' "$(hq "select (summary_params->>'name')||'|'||(summary_params->'days')::text from action_history where summary_key='schedule.updated' and entity_id='$U1' limit 1" | sed 's/, /,/g')"
BEFORE=$(sq "select count(*) from outbox_events")
check "same week again → 200, no event" '200|0' "$(put $U1 "$WEEK")|$(( $(sq "select count(*) from outbox_events") - BEFORE ))"
check "change Wed, drop Mon, add Fri → 200" '200|[3,5]' "$(put $U1 '{"days":[{"dayOfWeek":3,"startTime":"10:00","endTime":"15:00","slotMinutes":20},{"dayOfWeek":5,"startTime":"08:00","endTime":"12:00","slotMinutes":60}]}')|$(j '[.days[].dayOfWeek]')"
check "  changedDays" '[1,3,5]' "$(sq "select (payload->'payload'->'changedDays')::text from outbox_events where aggregate_id='$U1' and event_type='schedule.updated' order by occurred_at desc limit 1" | sed 's/, /,/g')"
check "  Wednesday row kept (updated in place)" 2 "$(sq "select count(*) from doctor_schedules d join staff_members s on s.id = d.staff_member_id where s.user_id='$U1'")"
check "duplicate day → 422" '422|"days.1.dayOfWeek"' "$(put $U1 '{"days":[{"dayOfWeek":2,"startTime":"09:00","endTime":"10:00","slotMinutes":30},{"dayOfWeek":2,"startTime":"11:00","endTime":"12:00","slotMinutes":30}]}')|$(j .error.details.field)"
check "end before start → 422" '422|"days.0.endTime"' "$(put $U1 '{"days":[{"dayOfWeek":2,"startTime":"12:00","endTime":"09:00","slotMinutes":30}]}')|$(j .error.details.field)"
check "half slot at the end → 422" 422 "$(put $U1 '{"days":[{"dayOfWeek":2,"startTime":"09:00","endTime":"16:50","slotMinutes":30}]}')"
check "slot 25 → 400" 400 "$(put $U1 '{"days":[{"dayOfWeek":2,"startTime":"09:00","endTime":"10:00","slotMinutes":25}]}')"
check "day 8 → 400" 400 "$(put $U1 '{"days":[{"dayOfWeek":8,"startTime":"09:00","endTime":"10:00","slotMinutes":30}]}')"
check "time 24:00 → 400" 400 "$(put $U1 '{"days":[{"dayOfWeek":2,"startTime":"09:00","endTime":"24:00","slotMinutes":30}]}')"
check "no days field → 400" 400 "$(put $U1 '{}')"
check "  week unchanged after errors" '[3,5]' "$(as_admin $SCH/$U1 >/dev/null; j '[.days[].dayOfWeek]')"
check "nurse → 422 (doctors only)" '422|"role"' "$(put $U2 "$WEEK")|$(j .error.details.field)"
check "nurse GET → empty week" '200|[]' "$(as_admin $SCH/$U2)|$(j .days)"
check "unknown user PUT → 404" 404 "$(put $(cat /proc/sys/kernel/random/uuid) "$WEEK")"
check "clear the week → 200" '200|[]' "$(put $U1 '{"days":[]}')|$(j .days)"
check "  history: cleared" schedule.cleared "$(wait_history schedule.cleared $U1)"
put $U1 "$WEEK" >/dev/null

echo "Time off"
TO=$API/time-off
day() { date -d "$1 days" +%F; } # day <offset from today>
addoff() { as_admin -X POST $TO -H 'content-type: application/json' -d "$1"; }
off() { echo "{\"userId\":\"$1\",\"type\":\"$2\",\"startDate\":\"$(day $3)\",\"endDate\":\"$(day $4)\"$5}"; }
check "doctor POST → 403" 403 "$(as $SELF -X POST $TO -H 'content-type: application/json' -d "$(off $U1 VACATION 10 14)")"
check "receptionist POST → 403" 403 "$(as $REC -X POST $TO -H 'content-type: application/json' -d "$(off $U1 VACATION 10 14)")"
check "add vacation → 201" "201|\"VACATION\"|5|\"Annual leave\"|\"$(day 10)\"" "$(addoff "$(off $U1 VACATION 10 14 ',"reason":"  Annual leave "')")|$(j .type)|$(j .days)|$(j .reason)|$(j .startDate)"
T1=$(j .id | tr -d '"')
check "  person + creator" '"Zaur"|"System Administrator"' "$(j .firstName)|$(j .createdByName)"
check "  event" "time_off.created|STAFF_MEMBER|VACATION|5|null" "$(sq "select event_type||'|'||aggregate_type||'|'||(payload->'payload'->>'type')||'|'||(payload->'payload'->>'days')||'|'||coalesce(payload->'payload'->>'reason','null') from outbox_events where aggregate_id='$U1' and event_type='time_off.created' order by occurred_at desc limit 1")"
check "  history" timeOff.created "$(wait_history timeOff.created $U1)"
check "  history params" "VACATION|$(day 10)|$(day 14)" "$(hq "select (summary_params->>'type')||'|'||(summary_params->>'start')||'|'||(summary_params->>'end') from action_history where summary_key='timeOff.created' and entity_id='$U1' limit 1")"
check "overlap → 409" '409|"CONFLICT"|"startDate"' "$(addoff "$(off $U1 SICK_LEAVE 12 20)")|$(j .error.code)|$(j .error.details.field)"
check "inside another → 409" 409 "$(addoff "$(off $U1 DAY_OFF 11 11)")"
check "adjacent day → 201" '201|1' "$(addoff "$(off $U1 DAY_OFF 15 15)")|$(j .days)"
T2=$(j .id | tr -d '"')
check "end before start → 422" '422|"endDate"' "$(addoff "$(off $U1 TRAINING 30 29)")|$(j .error.details.field)"
check "longer than 365 days → 422" 422 "$(addoff "$(off $U1 VACATION 400 765)")"
check "365 days → 201" 201 "$(addoff "$(off $U1 TRAINING 1000 1364)")"
T3=$(j .id | tr -d '"')
check "bad type → 400" 400 "$(addoff "$(off $U1 HOLIDAY 40 41)")"
check "bad date → 400" 400 "$(addoff "{\"userId\":\"$U1\",\"type\":\"DAY_OFF\",\"startDate\":\"2026-02-30\",\"endDate\":\"2026-03-01\"}")"
check "nurse → 422" '422|"userId"' "$(addoff "$(off $U2 VACATION 10 12)")|$(j .error.details.field)"
check "unknown user → 404" 404 "$(addoff "$(off $(cat /proc/sys/kernel/random/uuid) VACATION 10 12)")"
check "past sick leave → 201 (recorded later)" 201 "$(addoff "$(off $U1 SICK_LEAVE -5 -3)")"
T4=$(j .id | tr -d '"')
check "list for the doctor → 200, newest first" "200|4|\"$T4\"" "$(as $REC "$TO?userId=$U1")|$(j .meta.total)|$(j '.items[0].id')"
check "  sort startDate:asc" "\"$T4\"|\"$T3\"" "$(as $REC "$TO?userId=$U1&sort=startDate:asc" >/dev/null; j '.items[0].id')|$(j '.items[-1].id')"
check "  scope=upcoming" 3 "$(as $REC "$TO?userId=$U1&scope=upcoming" >/dev/null; j .meta.total)"
check "  scope=past" "1|\"$T4\"" "$(as $REC "$TO?userId=$U1&scope=past" >/dev/null; j .meta.total)|$(j '.items[0].id')"
check "  from/to touching the range" 2 "$(as $REC "$TO?userId=$U1&from=$(day 14)&to=$(day 20)" >/dev/null; j .meta.total)"
check "doctor own list (no userId) → only own" "200|4" "$(as $SELF $TO)|$(j "[.items[] | select(.userId == \"$U1\")] | length")"
check "doctor another's list → 403" 403 "$(as $DOC "$TO?userId=$U1")"
check "accountant → 403" 403 "$(as $ACC $TO)"
check "bad scope → 400" 400 "$(as $REC "$TO?scope=soon")"
check "doctor DELETE → 403" 403 "$(as $SELF -X DELETE $TO/$T2)"
check "remove future → 204" 204 "$(as_admin -X DELETE $TO/$T2)"
check "  gone" 0 "$(sq "select count(*) from time_off where id='$T2'")"
check "  history" timeOff.deleted "$(wait_history timeOff.deleted $U1)"
check "remove ended → 409" '409|"INVALID_STATUS"' "$(as_admin -X DELETE $TO/$T4)|$(j .error.code)"
check "remove unknown → 404" 404 "$(as_admin -X DELETE $TO/$(cat /proc/sys/kernel/random/uuid))"
check "re-add the removed day → 201" 201 "$(addoff "$(off $U1 DAY_OFF 15 15)")"

echo "Sync from auth"
check "rename in auth → 200" 200 "$(as_admin -X PATCH $USERS/$U1 -H 'content-type: application/json' -d '{"firstName":"Zaurbek"}')"
check "  name copied" ok "$(wait_staff $U1 "first_name = 'Zaurbek'")"
check "deactivate in auth → 200" 200 "$(as_admin -X PATCH $USERS/$U1/deactivate)"
check "  DEACTIVATED, not active" ok "$(wait_staff $U1 "status = 'DEACTIVATED' and not is_active")"
check "  schedule locked → 409" '409|"INVALID_STATUS"' "$(put $U1 "$WEEK")|$(j .error.code)"
check "  schedule still readable" '200|[1,3]' "$(as_admin $SCH/$U1)|$(j '[.days[].dayOfWeek]')"
check "  time off locked → 409" 409 "$(addoff "$(off $U1 VACATION 50 52)")"
check "  time off removal locked → 409" 409 "$(as_admin -X DELETE $TO/$T1)"
check "  gone from /staff/doctors" false "$(as $ACC "$STAFF/doctors" >/dev/null; j "[.[].userId] | index(\"$U1\") != null")"
check "  profile still readable" '200|false' "$(as $DOC $STAFF/$U1)|$(j .isActive)"
check "reactivate in auth → 200" 200 "$(as_admin -X PATCH $USERS/$U1/reactivate)"
check "  INVITED again, active" ok "$(wait_staff $U1 "status = 'INVITED' and is_active")"

sq "delete from staff_members where user_id in ('$U1','$U2')" >/dev/null
q auth_db "delete from users where id in ('$U1','$U2')" >/dev/null

cleanup
rm -rf $D
echo
echo "PASS $PASS  FAIL $FAIL"
[ $FAIL -eq 0 ]
