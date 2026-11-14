#!/bin/bash
# End-to-end checks of patient-service through the gateway.
# Registry (6.1): register (MRN from the sequence), validation, FIN duplicate
# → 409 naming the existing patient, search (fuzzy name, MRN, FIN, phone,
# best match first), filters / sort / pages, edit (changed fields, no-op),
# deactivate / reactivate, permissions, outbox → Kafka → action history
# (patient timeline).
# Clinical summary (6.3): allergies + chronic conditions, clinical-only
# access, hidden from GET /patients/:id for others, duplicates, inactive
# records, events / history without clinical values.
# Internal API + stats (6.4): summary / allergies (internal key, not via the
# gateway), GET /patients/stats totals, months, gender, age-group bounds.
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-patients.sh
# Deletes the patients it creates (their history rows stay: append-only).
cd "$(dirname "${BASH_SOURCE[0]}")/.."
API=http://localhost:3000/api/v1
P=$API/patients
D=$(mktemp -d)
DC="docker compose"
PASS=0; FAIL=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1 (expected $2, got $3)"; FAIL=$((FAIL+1)); fi
}
code() { curl -s -o $D/body -w '%{http_code}' "$@"; }
as_admin() { code -b $D/admin "$@"; }
as() { local t=$1; shift; code -b "access_token=$t" "$@"; } # as <token> <curl args>
j() { jq -c "(.data // .) | $1" $D/body; }
q() { $DC exec -T postgres psql -U medflow -d "$1" -tAc "$2"; }
pq() { q patient_db "$1"; }
hq() { q notification_db "$1"; }
redis_flush_rl() { $DC exec -T redis sh -c "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli del" >/dev/null; }
# Every test patient's surname starts with Zt (cleanup relies on it) + a random tag of this run
TAG=$(tr -dc 'a-z' </dev/urandom | head -c 6)
SUR="Zt${TAG}ova"
FIN1=$(tr -dc 'A-Z0-9' </dev/urandom | head -c 7)
FIN2=$(tr -dc 'A-Z0-9' </dev/urandom | head -c 7)
PH=$(tr -dc '0-9' </dev/urandom | head -c 7)
cleanup() {
  pq "delete from outbox_events where aggregate_id in (select id from patients where last_name like 'Zt%')" >/dev/null
  pq "delete from patients where last_name like 'Zt%'" >/dev/null
}
wait_history() { # summary_key entity_id
  for _ in $(seq 1 40); do
    [ "$(hq "select count(*) from action_history where summary_key='$1' and entity_id='$2'")" -gt 0 ] && { echo "$1"; return; }
    sleep 0.5
  done
  echo "timeout"
}
reg() { as $1 -X POST $P -H 'content-type: application/json' -d "$2"; } # reg <token> <json>
upd() { as $1 -X PATCH $P/$2 -H 'content-type: application/json' -d "$3"; }
today() { TZ=Asia/Baku date +%F; }

echo "Setup"
redis_flush_rl
cleanup
check "admin login" 200 "$(code -c $D/admin -X POST $API/auth/login \
  -H 'content-type: application/json' -d '{"email":"admin@medflow.az","password":"Admin12345"}')"
SECRET=$(grep '^JWT_ACCESS_SECRET=' .env | cut -d= -f2)
tok() { node scripts/lib/sign-token.mjs "$SECRET" "$(cat /proc/sys/kernel/random/uuid)" $1 300; }
REC=$(tok RECEPTIONIST); NUR=$(tok NURSE); DOC=$(tok DOCTOR); ACC=$(tok ACCOUNTANT)

echo "Register"
LEYLA="{\"firstName\":\" Leyla \",\"lastName\":\"$SUR\",\"fatherName\":\"Rashid\",\"finCode\":\" ${FIN1,,} \",\"dateOfBirth\":\"1990-05-14\",\"gender\":\"FEMALE\",\"bloodType\":\"A_POS\",\"phone\":\"+994 50 $PH\",\"email\":\" Leyla.$TAG@Mail.AZ \",\"address\":\"Baku, Nizami 10\",\"emergencyContactName\":\"Rashid $SUR\",\"emergencyContactPhone\":\"+994 55 111 22 33\",\"emergencyContactRelation\":\"Father\",\"notes\":\"Prefers Russian\"}"
# The number nextval will hand out next, minus one
BEFORE=$(pq "select case when is_called then last_value else last_value - 1 end from patient_mrn_seq")
check "no cookie → 401" 401 "$(code -X POST $P -H 'content-type: application/json' -d "$LEYLA")"
check "doctor → 403" 403 "$(reg $DOC "$LEYLA")"
check "accountant → 403" 403 "$(reg $ACC "$LEYLA")"
check "receptionist → 201" 201 "$(reg $REC "$LEYLA")"
P1=$(j .id | tr -d '"'); MRN1=$(j .mrn | tr -d '"')
check "  MRN from the sequence" "$(printf 'P-%06d' $((BEFORE+1)))" "$MRN1"
check "  trimmed, FIN upper, email lower" "\"Leyla\"|\"$FIN1\"|\"leyla.$TAG@mail.az\"" "$(j .firstName)|$(j .finCode)|$(j .email)"
check "  fields" '["address","bloodType","createdAt","dateOfBirth","email","emergencyContactName","emergencyContactPhone","emergencyContactRelation","fatherName","finCode","firstName","gender","id","isActive","lastName","mrn","notes","phone","updatedAt"]' "$(j 'keys')"
check "  registered_by = the receptionist" true "$([ -n "$(pq "select registered_by from patients where id='$P1'")" ] && echo true)"
check "  event" "patient.registered|PATIENT|$MRN1|Leyla|null" "$(pq "select event_type||'|'||aggregate_type||'|'||(payload->'payload'->>'mrn')||'|'||(payload->'payload'->>'firstName')||'|'||coalesce(payload->'payload'->>'dateOfBirth','null') from outbox_events where aggregate_id='$P1' order by occurred_at limit 1")"
check "  history" patient.registered "$(wait_history patient.registered $P1)"
check "  on the patient timeline" "PATIENT|$P1|$MRN1" "$(hq "select entity_type||'|'||patient_id||'|'||(summary_params->>'mrn') from action_history where summary_key='patient.registered' and entity_id='$P1'")"
check "nurse, minimal fields → 201" '201|null|null' "$(reg $NUR "{\"firstName\":\"Elvin\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"2015-01-02\",\"gender\":\"MALE\",\"phone\":\"050 777 66 55\",\"finCode\":\"\",\"email\":\"\"}")|$(j .finCode)|$(j .email)"
P2=$(j .id | tr -d '"'); MRN2=$(j .mrn | tr -d '"')
check "  next MRN" "$(printf 'P-%06d' $((BEFORE+2)))" "$MRN2"
check "admin → 201" 201 "$(reg $(tok ADMIN) "{\"firstName\":\"Leila\",\"lastName\":\"$SUR\",\"finCode\":\"$FIN2\",\"dateOfBirth\":\"1985-11-30\",\"gender\":\"FEMALE\",\"phone\":\"+994 70 000 00 01\"}")"
P3=$(j .id | tr -d '"')

echo "Validation"
base() { echo "{\"firstName\":\"X\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"1990-01-01\",\"gender\":\"MALE\",\"phone\":\"+994 50 000 00 00\"$1}"; }
check "same FIN → 409 naming the patient" "409|\"CONFLICT\"|\"finCode\"|\"$MRN1\"|\"$P1\"" "$(reg $REC "$(base ",\"finCode\":\"$FIN1\"")")|$(j .error.code)|$(j .error.details.field)|$(j .error.details.existingPatient.mrn)|$(j .error.details.existingPatient.id)"
check "  duplicate not added" 3 "$(pq "select count(*) from patients where last_name='$SUR'")"
check "bad FIN → 400" 400 "$(reg $REC "$(base ',"finCode":"AB12"')")"
check "FIN with a symbol → 400" 400 "$(reg $REC "$(base ',"finCode":"AB-1234"')")"
check "future birth date → 422" '422|"dateOfBirth"' "$(reg $REC "{\"firstName\":\"X\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"$(date -d '+1 day' +%F)\",\"gender\":\"MALE\",\"phone\":\"+994 50 000 00 00\"}")|$(j .error.details.field)"
check "born today → 201" 201 "$(reg $REC "{\"firstName\":\"Newborn\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"$(today)\",\"gender\":\"MALE\",\"phone\":\"+994 50 000 00 02\"}")"
check "born 1899 → 422" 422 "$(reg $REC "{\"firstName\":\"X\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"1899-12-31\",\"gender\":\"MALE\",\"phone\":\"+994 50 000 00 00\"}")"
check "bad date → 400" 400 "$(reg $REC "{\"firstName\":\"X\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"1990-02-30\",\"gender\":\"MALE\",\"phone\":\"+994 50 000 00 00\"}")"
check "bad gender → 400" 400 "$(reg $REC "{\"firstName\":\"X\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"1990-01-01\",\"gender\":\"OTHER\",\"phone\":\"+994 50 000 00 00\"}")"
check "bad phone → 400" 400 "$(reg $REC "{\"firstName\":\"X\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"1990-01-01\",\"gender\":\"MALE\",\"phone\":\"call me\"}")"
check "bad email → 400" 400 "$(reg $REC "$(base ',"email":"nope"')")"
check "bad blood type → 400" 400 "$(reg $REC "$(base ',"bloodType":"Z_POS"')")"
check "missing name → 400 with details" '400|"VALIDATION_ERROR"|true' "$(reg $REC '{"lastName":"Zt","dateOfBirth":"1990-01-01","gender":"MALE","phone":"+994 50 000 00 00"}')|$(j .error.code)|$(j '[.error.details[].field] | index("firstName") != null')"
check "MRN cannot be sent → 400" 400 "$(reg $REC "$(base ',"mrn":"P-999999"')")"

echo "Read"
check "no cookie → 401" 401 "$(code $P/$P1)"
check "accountant GET /patients/:id → 200" "200|\"$MRN1\"" "$(as $ACC $P/$P1)|$(j .mrn)"
check "unknown → 404" 404 "$(as $REC $P/$(cat /proc/sys/kernel/random/uuid))"
check "bad uuid → 400" 400 "$(as $REC $P/nope)"

echo "Search"
redis_flush_rl # the gateway allows 100 requests a minute per IP
ids() { j "[.items[].id]"; }
has() { j "[.items[].id] | index(\"$1\") != null"; }
check "doctor list → 200, newest first" "200|true" "$(as $DOC "$P?limit=100")|$(j '[.items[].createdAt] == ([.items[].createdAt]|sort|reverse)')"
check "  meta" '["limit","page","total"]' "$(j '.meta|keys')"
check "by surname" 4 "$(as $REC "$P?search=$SUR" >/dev/null; j .meta.total)"
check "full name" true "$(as $REC "$P?search=Leyla%20$SUR" >/dev/null; j "[.items[].id][0] == \"$P1\"")"
check "typo (Leila → also finds Leyla), best first" "true|true" "$(as $REC "$P?search=Leila%20$SUR" >/dev/null; j "[.items[].id][0] == \"$P3\"")|$(has $P1)"
check "typo in surname (a letter missing)" true "$(as $REC "$P?search=Leyla%20${SUR:0:4}${SUR:5}" >/dev/null; has $P1)"
AZ=$(reg $REC "{\"firstName\":\"Şəbnəm\",\"lastName\":\"Zt${TAG}İsmayılova\",\"dateOfBirth\":\"1993-04-04\",\"gender\":\"FEMALE\",\"phone\":\"+994 50 000 00 03\"}"); P5=$(j .id | tr -d '"')
check "Azerbaijani letters typed plain (Sebnem …Ismayilova)" "201|\"$P5\"" "$AZ|$(as $REC "$P?search=Sebnem%20Zt${TAG}Ismayilova" >/dev/null; j '.items[0].id')"
check "  and with Russian-style spelling (…Ismailova)" "\"$P5\"" "$(as $REC "$P?search=Sebnem%20Zt${TAG}Ismailova" >/dev/null; j '.items[0].id')"
check "  and exactly as written" "\"$P5\"" "$(as $REC "$P?search=%C5%9E%C9%99bn%C9%99m%20Zt${TAG}%C4%B0smay%C4%B1lova" >/dev/null; j '.items[0].id')"
check "  passport spelling (Shabnam → Şəbnəm via a = ə)" "\"$P5\"" "$(as $REC "$P?search=Sabnam%20Zt${TAG}Ismayilova" >/dev/null; j '.items[0].id')"
check "MRN exact" "1|\"$P1\"" "$(as $REC "$P?search=$MRN1" >/dev/null; j .meta.total)|$(j '.items[0].id')"
check "MRN number only" "\"$P1\"" "$(as $REC "$P?search=$((10#${MRN1#P-}))" >/dev/null; j '.items[0].id')"
check "MRN lower case" "\"$P1\"" "$(as $REC "$P?search=${MRN1,,}" >/dev/null; j '.items[0].id')"
check "FIN exact, lower case" "1|\"$P1\"" "$(as $REC "$P?search=${FIN1,,}" >/dev/null; j .meta.total)|$(j '.items[0].id')"
check "phone with trunk 0 → +994 number" "\"$P1\"" "$(as $REC "$P?search=050${PH}" >/dev/null; j '.items[0].id')"
check "phone with spaces and +" "\"$P2\"" "$(as $REC "$P?search=%2B994%2050%20777%2066%2055" >/dev/null; j '.items[0].id')"
check "LIKE wildcards are literal" 0 "$(as $REC "$P?search=%25%25_" >/dev/null; j .meta.total)"
check "nothing found" 0 "$(as $REC "$P?search=Qwxzzv$TAG" >/dev/null; j .meta.total)"
check "gender filter" true "$(as $REC "$P?search=$SUR&gender=MALE" >/dev/null; j 'all(.items[]; .gender == "MALE") and (.meta.total == 2)')"
check "sort name:asc with search" true "$(as $REC "$P?search=$SUR&sort=name:asc" >/dev/null; j '[.items[].firstName] == ([.items[].firstName]|sort)')"
check "sort dateOfBirth:asc" true "$(as $REC "$P?search=$SUR&sort=dateOfBirth:asc" >/dev/null; j '[.items[].dateOfBirth] == ([.items[].dateOfBirth]|sort)')"
check "pages" "2|2|false" "$(as $REC "$P?search=$SUR&limit=2&page=1&sort=mrn:asc" >/dev/null; ids >$D/p1; j '.items|length')|$(as $REC "$P?search=$SUR&limit=2&page=2&sort=mrn:asc" >/dev/null; j '.items|length')|$(j "([.items[].id] - $(cat $D/p1)) | length == 0")"
check "bad sort → 400" 400 "$(as $REC "$P?sort=name")"
check "bad isActive → 400" 400 "$(as $REC "$P?isActive=maybe")"
check "bad gender → 400" 400 "$(as $REC "$P?gender=X")"
check "limit 101 → 400" 400 "$(as $REC "$P?limit=101")"

echo "Edit"
redis_flush_rl # the gateway allows 100 requests a minute per IP
check "doctor PATCH → 403" 403 "$(upd $DOC $P1 '{"phone":"+994 50 000 00 09"}')"
check "accountant PATCH → 403" 403 "$(upd $ACC $P1 '{"phone":"+994 50 000 00 09"}')"
check "receptionist PATCH → 200" '200|"+994 51 222 33 44"|"O_NEG"|null' "$(upd $REC $P1 '{"phone":"+994 51 222 33 44","bloodType":"O_NEG","address":"  "}')|$(j .phone)|$(j .bloodType)|$(j .address)"
check "  event: changed fields + snapshot" '["bloodType","phone","address"]|+994 51 222 33 44' "$(pq "select (payload->'payload'->'changedFields')::text||'|'||(payload->'payload'->>'phone') from outbox_events where aggregate_id='$P1' and event_type='patient.updated' order by occurred_at desc limit 1" | sed 's/, /,/g')"
check "  history" patient.updated "$(wait_history patient.updated $P1)"
check "  history params: field names only" '["bloodType","phone","address"]' "$(hq "select (summary_params->'fields')::text from action_history where summary_key='patient.updated' and entity_id='$P1' limit 1" | sed 's/, /,/g')"
BEFORE=$(pq "select count(*) from outbox_events")
check "same values → 200, no event" "200|0" "$(upd $NUR $P1 '{"phone":"+994 51 222 33 44","firstName":"Leyla"}')|$(( $(pq "select count(*) from outbox_events") - BEFORE ))"
check "clear a required field → 400" '400|"firstName"' "$(upd $REC $P1 '{"firstName":null}')|$(j '.error.details[0].field')"
check "empty name → 400" 400 "$(upd $REC $P1 '{"lastName":"   "}')"
check "another's FIN → 409" "409|\"$P3\"" "$(upd $REC $P1 "{\"finCode\":\"$FIN2\"}")|$(j .error.details.existingPatient.id)"
check "own FIN again → 200" 200 "$(upd $REC $P1 "{\"finCode\":\"$FIN1\"}")"
check "FIN cleared → 200" '200|null' "$(upd $REC $P2 '{"finCode":null}')|$(j .finCode)"
check "future birth date → 422" 422 "$(upd $REC $P1 "{\"dateOfBirth\":\"$(date -d '+3 days' +%F)\"}")"
check "unknown field → 400" 400 "$(upd $REC $P1 '{"isActive":false}')"
check "unknown patient → 404" 404 "$(upd $REC $(cat /proc/sys/kernel/random/uuid) '{"notes":"x"}')"

echo "Deactivate / reactivate"
check "receptionist → 403" 403 "$(as $REC -X PATCH $P/$P3/deactivate)"
check "nurse → 403" 403 "$(as $NUR -X PATCH $P/$P3/deactivate)"
check "admin deactivate → 200" '200|false' "$(as_admin -X PATCH $P/$P3/deactivate)|$(j .isActive)"
check "  history" patient.deactivated "$(wait_history patient.deactivated $P3)"
check "  again → 409" '409|"INVALID_STATUS"' "$(as_admin -X PATCH $P/$P3/deactivate)|$(j .error.code)"
check "  edit blocked → 409" '409|"INVALID_STATUS"' "$(upd $REC $P3 '{"notes":"x"}')|$(j .error.code)"
check "  still readable" '200|false' "$(as $REC $P/$P3)|$(j .isActive)"
check "  isActive=true hides it" false "$(as $REC "$P?search=$SUR&isActive=true" >/dev/null; has $P3)"
check "  isActive=false shows only inactive" "true|true" "$(as $REC "$P?search=$SUR&isActive=false" >/dev/null; has $P3)|$(j 'all(.items[]; .isActive == false)')"
check "  FIN still taken → 409 says inactive" '409|false' "$(reg $REC "$(base ",\"finCode\":\"$FIN2\"")")|$(j .error.details.existingPatient.isActive)"
check "reactivate → 200" '200|true' "$(as_admin -X PATCH $P/$P3/reactivate)|$(j .isActive)"
check "  history" patient.reactivated "$(wait_history patient.reactivated $P3)"
check "  again → 409" 409 "$(as_admin -X PATCH $P/$P3/reactivate)"
check "unknown → 404" 404 "$(as_admin -X PATCH $P/$(cat /proc/sys/kernel/random/uuid)/deactivate)"

echo "Allergies"
redis_flush_rl # the gateway allows 100 requests a minute per IP
A=$P/$P1/allergies
addA() { as $1 -X POST $A -H 'content-type: application/json' -d "$2"; }
check "receptionist list → 403" 403 "$(as $REC $A)"
check "admin list → 403 (no clinical data)" 403 "$(as_admin $A)"
check "receptionist add → 403" 403 "$(addA $REC '{"allergen":"Penicillin","category":"DRUG","severity":"SEVERE"}')"
check "empty list" '200|[]' "$(as $DOC $A)|$(j .)"
check "nurse adds penicillin → 201" '201|"Penicillin"|"SEVERE"|"Anaphylaxis"' "$(addA $NUR '{"allergen":" Penicillin ","category":"DRUG","severity":"SEVERE","reaction":"Anaphylaxis"}')|$(j .allergen)|$(j .severity)|$(j .reaction)"
AL1=$(j .id | tr -d '"')
check "  fields" '["allergen","category","createdAt","id","reaction","recordedByName","severity"]' "$(j 'keys')"
check "  recorded by (name snapshot)" '"Expiry Test"' "$(j .recordedByName)"
check "  event without the allergen" "patient.allergy_added|PATIENT|$AL1|null|null" "$(pq "select event_type||'|'||aggregate_type||'|'||(payload->'payload'->>'allergyId')||'|'||coalesce(payload->'payload'->>'allergen','null')||'|'||coalesce(payload->'payload'->>'severity','null') from outbox_events where aggregate_id='$P1' and event_type='patient.allergy_added' order by occurred_at desc limit 1")"
check "  history" patient.allergyAdded "$(wait_history patient.allergyAdded $P1)"
check "  history has no clinical value" 0 "$(hq "select count(*) from action_history where entity_id='$P1' and (summary ilike '%penicillin%' or summary_params::text ilike '%penicillin%' or metadata::text ilike '%penicillin%')")"
check "same allergen, other case → 409 on the field" '409|"allergen"' "$(addA $DOC '{"allergen":"PENICILLIN","category":"DRUG","severity":"MILD"}')|$(j .error.details.field)"
check "doctor adds peanuts (mild) → 201" 201 "$(addA $DOC '{"allergen":"Peanuts","category":"FOOD","severity":"MILD"}')"
check "doctor adds latex (moderate) → 201" 201 "$(addA $DOC '{"allergen":"Latex","category":"ENVIRONMENTAL","severity":"MODERATE"}')"
AL3=$(j .id | tr -d '"')
check "list: most severe first" '["Penicillin","Latex","Peanuts"]' "$(as $NUR $A >/dev/null; j '[.[].allergen]')"
check "bad category → 400" 400 "$(addA $DOC '{"allergen":"X","category":"DUST","severity":"MILD"}')"
check "bad severity → 400" 400 "$(addA $DOC '{"allergen":"X","category":"OTHER","severity":"FATAL"}')"
check "empty allergen → 400" 400 "$(addA $DOC '{"allergen":"  ","category":"OTHER","severity":"MILD"}')"
check "unknown patient → 404" 404 "$(as $DOC -X POST $P/$(cat /proc/sys/kernel/random/uuid)/allergies -H 'content-type: application/json' -d '{"allergen":"X","category":"OTHER","severity":"MILD"}')"
updA() { as $1 -X PATCH $A/$2 -H 'content-type: application/json' -d "$3"; }
check "receptionist edit → 403" 403 "$(updA $REC $AL3 '{"severity":"SEVERE"}')"
check "edit every field → 200" '200|"Natural rubber latex"|"OTHER"|"SEVERE"|"Hives"' "$(updA $NUR $AL3 '{"allergen":" Natural rubber latex ","category":"OTHER","severity":"SEVERE","reaction":"Hives"}')|$(j .allergen)|$(j .category)|$(j .severity)|$(j .reaction)"
check "  event: field names only" '["allergen","category","severity","reaction"]|null' "$(pq "select (payload->'payload'->'changedFields')::text||'|'||coalesce(payload->'payload'->>'allergen','null') from outbox_events where aggregate_id='$P1' and event_type='patient.allergy_updated' order by occurred_at desc limit 1" | sed 's/, /,/g')"
check "  history" patient.allergyUpdated "$(wait_history patient.allergyUpdated $P1)"
check "  history has no allergen" 0 "$(hq "select count(*) from action_history where entity_id='$P1' and (summary ilike '%rubber%' or summary_params::text ilike '%rubber%' or metadata::text ilike '%hives%')")"
check "clear the reaction → 200" '200|null' "$(updA $NUR $AL3 '{"reaction":""}')|$(j .reaction)"
BEFORE=$(pq "select count(*) from outbox_events")
check "same values → 200, no event" "200|0" "$(updA $NUR $AL3 '{"severity":"SEVERE"}')|$(( $(pq "select count(*) from outbox_events") - BEFORE ))"
check "rename to an existing allergen → 409" '409|"allergen"' "$(updA $NUR $AL3 '{"allergen":"peanuts"}')|$(j .error.details.field)"
check "clear the allergen → 400" 400 "$(updA $NUR $AL3 '{"allergen":null}')"
check "bad severity → 400" 400 "$(updA $NUR $AL3 '{"severity":"FATAL"}')"
check "unknown allergy → 404" 404 "$(updA $NUR $(cat /proc/sys/kernel/random/uuid) '{"severity":"MILD"}')"
check "remove → 204" 204 "$(as $NUR -X DELETE $A/$AL3)"
check "  history" patient.allergyRemoved "$(wait_history patient.allergyRemoved $P1)"
check "remove again → 404" 404 "$(as $NUR -X DELETE $A/$AL3)"
check "another patient's allergy id → 404" 404 "$(as $NUR -X DELETE $P/$P2/allergies/$AL1)"
check "receptionist remove → 403" 403 "$(as $REC -X DELETE $A/$AL1)"

echo "Conditions"
redis_flush_rl # the gateway allows 100 requests a minute per IP
C=$P/$P1/conditions
addC() { as $1 -X POST $C -H 'content-type: application/json' -d "$2"; }
check "receptionist list → 403" 403 "$(as $REC $C)"
check "doctor adds diabetes → 201" '201|"E11"|"ACTIVE"|"2019-03-01"' "$(addC $DOC '{"name":"Type 2 diabetes mellitus","icd10Code":" e11 ","diagnosedOn":"2019-03-01","notes":"On metformin"}')|$(j .icd10Code)|$(j .status)|$(j .diagnosedOn)"
CO1=$(j .id | tr -d '"')
check "  fields" '["createdAt","diagnosedOn","icd10Code","id","name","notes","recordedByName","status","updatedAt"]' "$(j 'keys')"
check "  event without the diagnosis" "patient.condition_added|$CO1|null" "$(pq "select event_type||'|'||(payload->'payload'->>'conditionId')||'|'||coalesce(payload->'payload'->>'name','null') from outbox_events where aggregate_id='$P1' and event_type='patient.condition_added' order by occurred_at desc limit 1")"
check "  history" patient.conditionAdded "$(wait_history patient.conditionAdded $P1)"
check "nurse adds asthma (resolved, no code) → 201" 201 "$(addC $NUR '{"name":"Childhood asthma","status":"RESOLVED"}')"
check "nurse adds hypertension → 201" 201 "$(addC $NUR '{"name":"Essential hypertension","icd10Code":"I10","diagnosedOn":"2021-06-10"}')"
CO3=$(j .id | tr -d '"')
check "list: active first, latest diagnosis first" '["Essential hypertension","Type 2 diabetes mellitus","Childhood asthma"]' "$(as $DOC $C >/dev/null; j '[.[].name]')"
check "bad ICD-10 → 400" 400 "$(addC $DOC '{"name":"X","icd10Code":"diabetes"}')"
check "ICD-10 with a subcode → 201" '201|"J45.909"' "$(addC $DOC '{"name":"Asthma, unspecified","icd10Code":"J45.909"}')|$(j .icd10Code)"
CO4=$(j .id | tr -d '"')
check "future diagnosis date → 422" '422|"diagnosedOn"' "$(addC $DOC "{\"name\":\"X\",\"diagnosedOn\":\"$(date -d '+2 days' +%F)\"}")|$(j .error.details.field)"
check "resolve hypertension → 200" '200|"RESOLVED"' "$(as $NUR -X PATCH $C/$CO3 -H 'content-type: application/json' -d '{"status":"RESOLVED","notes":"Controlled with diet"}')|$(j .status)"
check "  event: field names only" '["status","notes"]|null' "$(pq "select (payload->'payload'->'changedFields')::text||'|'||coalesce(payload->'payload'->>'notes','null') from outbox_events where aggregate_id='$P1' and event_type='patient.condition_updated' order by occurred_at desc limit 1" | sed 's/, /,/g')"
check "  history" patient.conditionUpdated "$(wait_history patient.conditionUpdated $P1)"
BEFORE=$(pq "select count(*) from outbox_events")
check "same values → 200, no event" "200|0" "$(as $NUR -X PATCH $C/$CO3 -H 'content-type: application/json' -d '{"status":"RESOLVED"}')|$(( $(pq "select count(*) from outbox_events") - BEFORE ))"
check "clear the name → 400" 400 "$(as $NUR -X PATCH $C/$CO3 -H 'content-type: application/json' -d '{"name":null}')"
check "remove a mistaken condition → 204" 204 "$(as $DOC -X DELETE $C/$CO4)"
check "  history" patient.conditionRemoved "$(wait_history patient.conditionRemoved $P1)"
check "unknown condition → 404" 404 "$(as $DOC -X PATCH $C/$(cat /proc/sys/kernel/random/uuid) -H 'content-type: application/json' -d '{"notes":"x"}')"
check "history never names a diagnosis" 0 "$(hq "select count(*) from action_history where entity_id='$P1' and (summary ilike '%diabetes%' or summary ilike '%hypertension%' or summary_params::text ilike '%diet%' or metadata::text ilike '%metformin%')")"

echo "Clinical in the patient record"
redis_flush_rl # the gateway allows 100 requests a minute per IP
check "doctor GET /patients/:id → 2 allergies + 3 conditions" '200|2|3' "$(as $DOC $P/$P1)|$(j '.allergies|length')|$(j '.conditions|length')"
check "  most severe allergy first" '"Penicillin"' "$(j '.allergies[0].allergen')"
check "receptionist GET → no clinical fields" 'false|false' "$(as $REC $P/$P1 >/dev/null; j 'has("allergies")')|$(j 'has("conditions")')"
check "admin GET → no clinical fields" false "$(as_admin $P/$P1 >/dev/null; j 'has("allergies")')"
check "list never carries clinical fields" false "$(as $DOC "$P?search=$MRN1" >/dev/null; j '.items[0] | has("allergies")')"
as_admin -X PATCH $P/$P2/deactivate >/dev/null
check "inactive patient: add allergy → 409" '409|"INVALID_STATUS"' "$(as $DOC -X POST $P/$P2/allergies -H 'content-type: application/json' -d '{"allergen":"X","category":"OTHER","severity":"MILD"}')|$(j .error.code)"
check "inactive patient: add condition → 409" 409 "$(as $DOC -X POST $P/$P2/conditions -H 'content-type: application/json' -d '{"name":"X"}')"
check "inactive patient: still readable" 200 "$(as $DOC $P/$P2/allergies)"
as_admin -X PATCH $P/$P2/reactivate >/dev/null

echo "Internal API"
redis_flush_rl # the gateway allows 100 requests a minute per IP
# Service ports are not published: call from inside the patient container.
# svc <nokey|key> <url> → prints the status, body goes to $D/body
SVC=http://localhost:3003
svc() {
  local out
  out=$($DC exec -T patient-service node -e '
    const [mode, url] = process.argv.slice(1);
    const headers = mode === "key" ? { "x-internal-key": process.env.INTERNAL_API_KEY } : {};
    fetch(url, { headers }).then(async (r) => process.stdout.write(r.status + "\n" + (await r.text())));
  ' "$1" "$2")
  echo "$out" | tail -n +2 > $D/body
  echo "$out" | head -1
}
check "summary without the key → 401" 401 "$(svc nokey "$SVC/internal/patients/$P1/summary")"
check "not routed by the gateway → 404" 404 "$(as_admin "$API/internal/patients/$P1/summary")"
check "summary → 200" "200|\"$MRN1\"|\"Leyla\"|\"+994 51 222 33 44\"|true" "$(svc key "$SVC/internal/patients/$P1/summary")|$(j .mrn)|$(j .firstName)|$(j .phone)|$(j .isActive)"
check "  fields" '["email","firstName","id","isActive","lastName","mrn","phone"]' "$(j 'keys')"
as_admin -X PATCH $P/$P2/deactivate >/dev/null
check "inactive patient → 200, isActive false" '200|false' "$(svc key "$SVC/internal/patients/$P2/summary")|$(j .isActive)"
as_admin -X PATCH $P/$P2/reactivate >/dev/null
check "unknown patient → 404" 404 "$(svc key "$SVC/internal/patients/$(cat /proc/sys/kernel/random/uuid)/summary")"
check "bad uuid → 400" 400 "$(svc key "$SVC/internal/patients/nope/summary")"
check "allergies → most severe first" '200|["Penicillin","Peanuts"]|["SEVERE","MILD"]' "$(svc key "$SVC/internal/patients/$P1/allergies")|$(j '[.[].allergen]')|$(j '[.[].severity]')"
check "  fields" '["allergen","category","reaction","severity"]' "$(j '.[0]|keys')"
check "  none → []" '200|[]' "$(svc key "$SVC/internal/patients/$P3/allergies")|$(j .)"
check "  unknown patient → 404" 404 "$(svc key "$SVC/internal/patients/$(cat /proc/sys/kernel/random/uuid)/allergies")"
check "  without the key → 401" 401 "$(svc nokey "$SVC/internal/patients/$P1/allergies")"

echo "Stats"
redis_flush_rl # the gateway allows 100 requests a minute per IP
ST=$P/stats
check "receptionist → 403" 403 "$(as $REC $ST)"
check "doctor → 403" 403 "$(as $DOC $ST)"
check "admin → 200" 200 "$(as_admin $ST)"
check "  shape" '["ageGroups","gender","monthly","totals"]|["active","inactive","newLastMonth","newThisMonth"]|12|["0-17","18-39","40-64","65+"]' "$(j 'keys')|$(j '.totals|keys')|$(j '.monthly|length')|$(j '[.ageGroups[].group]')"
check "  months oldest first, the last is this month" "true|\"$(TZ=Asia/Baku date +%Y-%m)\"" "$(j '[.monthly[].month] == ([.monthly[].month]|sort)')|$(j '.monthly[-1].month')"
cp $D/body $D/s1
# Born exactly 18 years ago today (18 → 18-39), one day later (17 → 0-17), and a 76-year-old
EIGHTEEN=$(TZ=Asia/Baku date -d '-18 years' +%F)
SEVENTEEN=$(TZ=Asia/Baku date -d "$EIGHTEEN +1 day" +%F)
reg $REC "{\"firstName\":\"Adult\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"$EIGHTEEN\",\"gender\":\"MALE\",\"phone\":\"+994 50 000 00 04\"}" >/dev/null
reg $REC "{\"firstName\":\"Teen\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"$SEVENTEEN\",\"gender\":\"FEMALE\",\"phone\":\"+994 50 000 00 05\"}" >/dev/null
check "register a 76-year-old → 201" 201 "$(reg $REC "{\"firstName\":\"Elder\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"1950-01-15\",\"gender\":\"FEMALE\",\"phone\":\"+994 50 000 00 06\"}")"
OLD=$(j .id | tr -d '"')
as_admin $ST >/dev/null; cp $D/body $D/s2
delta() { jq -n --slurpfile a $D/s1 --slurpfile b $D/s2 "(\$b[0].data | $1) - (\$a[0].data | $1)"; }
check "  +3 active, +3 this month, +3 in the last month bar" "3|3|3" "$(delta .totals.active)|$(delta .totals.newThisMonth)|$(delta '.monthly[-1].count')"
check "  gender +1 male, +2 female" "1|2" "$(delta .gender.MALE)|$(delta .gender.FEMALE)"
check "  age groups: 17 → 0-17, 18 → 18-39, 76 → 65+" "1|1|0|1" "$(delta '.ageGroups[0].count')|$(delta '.ageGroups[1].count')|$(delta '.ageGroups[2].count')|$(delta '.ageGroups[3].count')"
as_admin -X PATCH $P/$OLD/deactivate >/dev/null
as_admin $ST >/dev/null; cp $D/body $D/s2
check "  deactivated: +2 active, +1 inactive, not in the age groups" "2|1|0" "$(delta .totals.active)|$(delta .totals.inactive)|$(delta '.ageGroups[3].count')"
check "  still counted as registered this month" 3 "$(delta .totals.newThisMonth)"

echo "Timeline"
redis_flush_rl # the gateway allows 100 requests a minute per IP
check "admin /history/patients/:id → registered, deactivated, reactivated" "200|3" "$(as_admin "$API/history/patients/$P3")|$(j '.meta.total // (.items|length)')"
check "receptionist → 403" 403 "$(as $REC "$API/history/patients/$P3")"

cleanup
rm -rf $D
echo
echo "PASS $PASS  FAIL $FAIL"
[ $FAIL -eq 0 ]
