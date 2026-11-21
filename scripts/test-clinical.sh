#!/bin/bash
# End-to-end checks of medical-record-service visits through the gateway.
# Vitals (8.2): the visit's doctor or a nurse, not another doctor, open
# visits only, at least one value, ranges, systolic > diastolic, BMI by
# the database, newest first, vitals.recorded (no values in the history).
# Diagnoses: ICD-10 search (code prefix, title, typos), own doctor only,
# unknown code, duplicate, first = PRIMARY, choosing another PRIMARY moves
# the old one, refine wording/notes, remove, close after a real PRIMARY,
# closed visit read-only, diagnosis.added/removed events.
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-clinical.sh
# Creates a test patient + appointments and deletes them (history rows stay).
cd "$(dirname "${BASH_SOURCE[0]}")/.."
API=http://localhost:3000/api/v1
E=$API/encounters
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
aq() { q appointment_db "$1"; }
rq() { q record_db "$1"; }
hq() { q notification_db "$1"; }
redis_flush_rl() { $DC exec -T redis sh -c "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli del" >/dev/null; }
uuid() { cat /proc/sys/kernel/random/uuid; }
TAG=$(tr -dc 'a-z' </dev/urandom | head -c 6)
SUR="Zt${TAG}en" # patient-service test cleanups match 'Zt%'
at() { date -u -d "TZ=\"Asia/Baku\" $1 $2" +%Y-%m-%dT%H:%M:%SZ; } # at <YYYY-MM-DD> <HH:MM>
TODAY=$(TZ=Asia/Baku date +%F)
wait_for() { # wait_for <expected> <db> <sql> → prints the last value
  local v
  for _ in $(seq 1 40); do
    v=$(q "$2" "$3"); [ "$v" = "$1" ] && break; sleep 0.5
  done
  echo "$v"
}
start() { as $1 -X POST $E -H 'content-type: application/json' -d "{\"appointmentId\":\"$2\"}"; }
patch() { as $1 -X PATCH $E/$2 -H 'content-type: application/json' -d "$3"; }
close_v() { as $1 -X PATCH $E/$2/close; }
vit() { as $1 -X POST $E/$2/vitals -H 'content-type: application/json' -d "$3"; }
dx() { as $1 -X POST $E/$2/diagnoses -H 'content-type: application/json' -d "$3"; }
dxp() { as $1 -X PATCH $E/$2/diagnoses/$3 -H 'content-type: application/json' -d "$4"; }
dxd() { as $1 -X DELETE $E/$2/diagnoses/$3; }
icd() { as $1 "$API/icd10?search=$2"; }
cleanup() {
  rq "delete from outbox_events where aggregate_id in (select id from encounters where patient_name like '% Zt%')" >/dev/null
  rq "delete from encounters where patient_name like '% Zt%'" >/dev/null
  aq "delete from appointments where patient_name like '% Zt%'" >/dev/null
  q patient_db "delete from outbox_events where aggregate_id in (select id from patients where last_name like 'Zt%')" >/dev/null
  q patient_db "delete from patients where last_name like 'Zt%'" >/dev/null
}

echo "Setup"
redis_flush_rl
cleanup
check "admin login" 200 "$(code -c $D/admin -X POST $API/auth/login \
  -H 'content-type: application/json' -d '{"email":"admin@medflow.az","password":"Admin12345"}')"
SECRET=$(grep '^JWT_ACCESS_SECRET=' .env | cut -d= -f2)
tok() { node scripts/lib/sign-token.mjs "$SECRET" "${2:-$(uuid)}" $1 600; } # tok <ROLE> [userId]
DOC_ID=$(uuid); DOC=$(tok DOCTOR $DOC_ID); DOC2=$(tok DOCTOR)
NUR=$(tok NURSE); REC=$(tok RECEPTIONIST); ACC=$(tok ACCOUNTANT); ADM=$(tok ADMIN)
CARD=$(q staff_db "select id from departments where code='CARD'")
as_admin -X POST $API/patients -H 'content-type: application/json' \
  -d "{\"firstName\":\"Aysel\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"1985-03-04\",\"gender\":\"FEMALE\",\"phone\":\"+994 50 000 00 01\",\"email\":\"aysel.$TAG@mail.test\"}" >/dev/null
P1=$(j .id | tr -d '"'); MRN=$(j .mrn | tr -d '"')
check "test patient registered" true "$([ -n "$P1" ] && echo true)"
ins() { # ins <HH:MM> <status> [doctorId] [type] → appointment id (today, CARD)
  aq "insert into appointments (patient_id, doctor_id, department_id, patient_name, patient_mrn, patient_phone, patient_email, doctor_name, department_name, department_code, starts_at, ends_at, type, status, checked_in_at, cancelled_at, created_by)
      values ('$P1', '${3:-$DOC_ID}', '$CARD', 'Aysel $SUR', '$MRN', '+994 50 000 00 01', 'aysel.$TAG@mail.test', 'Zaur Testov', 'Cardiology', 'CARD',
              '$(at $TODAY $1)', '$(at $TODAY $1)'::timestamptz + interval '1 minute', '${4:-CONSULTATION}', '$2',
              case when '$2' <> 'SCHEDULED' then now() end, case when '$2' = 'CANCELLED' then now() end, '$DOC_ID') returning id" | head -1
}
# One-minute slots so several appointments of one patient never overlap
A1=$(ins 00:01 CHECKED_IN "" FOLLOW_UP); A2=$(ins 00:02 SCHEDULED); A3=$(ins 00:03 CHECKED_IN)
A4=$(ins 00:04 CHECKED_IN); A5=$(ins 00:05 CANCELLED)
check "test appointments inserted" true "$([ -n "$A1" ] && [ -n "$A5" ] && echo true)"
check "visits started" '201|201' "$(start $DOC $A1)|$(start $DOC $A3)"
start $DOC $A1 >/dev/null; V1=$(j .id | tr -d '"')
start $DOC $A3 >/dev/null; V3=$(j .id | tr -d '"')
check "  a new visit has no vitals or diagnoses" '[]|[]' "$(j .vitals)|$(j .diagnoses)"

echo "ICD-10 search"
redis_flush_rl
icdpatch() { as $1 -X PATCH "$API/icd10/$2" -H 'content-type: application/json' -d "$3"; }
cat_() { as $1 "$API/icd10/catalog?$2"; }
check "nurse → 403" 403 "$(icd $NUR hyper)"
check "admin → 403 (not a doctor)" 403 "$(icd $ADM hyper)"
check "empty → nothing (the UI shows frequent codes)" '200|0' "$(icd $DOC '')|$(j length)"
check "the whole list is loaded (~12 000 codes)" true "$([ "$(rq "select count(*) from icd10_codes")" -gt 11000 ] && echo true)"
check "code prefix first" '"I10"' "$(icd $DOC i10 >/dev/null; j '.[0].code')"
check "title contains" true "$(icd $DOC hypert >/dev/null; j '[.[].code] | index("I10") != null')"
check "a typo still finds it (pnevmoniya)" true "$(icd $DOC pnevmoniya >/dev/null; j '[.[].code] | index("J18.9") != null')"
check "Azerbaijani name" '"I10"' "$(icd $DOC 'hipertenziya' >/dev/null; j '[.[] | select(.code == "I10")][0].code')"
check "Azerbaijani letters folded (sekerli → şəkərli)" true "$(icd $DOC 'sekerli%20diabet' >/dev/null; j '[.[].code] | index("E11.9") != null')"
check "synonym (soyuqdəymə → J00)" '"J00"' "$(icd $DOC 'soyuqd%C9%99ym%C9%99' >/dev/null; j '.[0].code')"
check "Russian name (гипертония)" true "$(icd $DOC '%D0%B3%D0%B8%D0%BF%D0%B5%D1%80%D1%82%D0%BE%D0%BD%D0%B8%D1%8F' >/dev/null; j '[.[].code] | index("I10") != null')"
check "categories with subcodes are not offered (J45 → J45.x)" 'false|true' "$(icd $DOC J45 >/dev/null; j '[.[].code] | index("J45") != null')|$(j '[.[].code] | index("J45.9") != null')"
check "  names in all languages + chapter" '"Essential (primary) hypertension"|"Essensial (birincili) hipertenziya"|9|true' \
  "$(icd $DOC I10 >/dev/null; j '.[0].titleEn')|$(j '.[0].titleAz')|$(j '.[0].chapterNo')|$(j '.[0].isLeaf')"
check "% is not a wildcard" '200|0' "$(icd $DOC '%25%25')|$(j length)"
check "nothing similar → empty" '200|0' "$(icd $DOC qqqqzzzz)|$(j length)"

echo "Catalogue (admin)"
redis_flush_rl
check "doctor → 403" 403 "$(cat_ $DOC '')"
check "nurse → 403" 403 "$(cat_ $NUR '')"
check "admin → 200, by code, paginated" '200|"A00"|20|true' "$(cat_ $ADM '')|$(j '.items[0].code')|$(j '.items | length')|$(j '.meta.total > 11000')"
check "  categories listed too" true "$(cat_ $ADM 'search=J45' >/dev/null; j '[.items[].code] | index("J45") != null')"
check "chapter filter" '200|true' "$(cat_ $ADM 'chapterNo=10&limit=100')|$(j '[.items[].chapterNo] | unique == [10]')"
check "named filter → only named" true "$(cat_ $ADM 'named=true&limit=100' >/dev/null; j '[.items[] | .titleAz != null or .titleRu != null] | all')"
check "named=false is not a filter" true "$(cat_ $ADM 'named=false' >/dev/null; j '.meta.total > 11000')"
check "bad chapter → 400" 400 "$(cat_ $ADM 'chapterNo=23')"
check "bad status → 400" 400 "$(cat_ $ADM 'status=gone')"
check "PATCH: doctor → 403" 403 "$(icdpatch $DOC J45.9 '{"titleAz":"x"}')"
check "PATCH: unknown code → 404" 404 "$(icdpatch $ADM Z99.99 '{"titleAz":"x"}')"
check "PATCH: bad code → 400" 400 "$(icdpatch $ADM 'abc' '{"titleAz":"x"}')"
check "PATCH: unknown field → 400 (no new titles/codes)" 400 "$(icdpatch $ADM J45.9 '{"title":"x"}')"
check "PATCH: 21 synonyms → 400" 400 "$(icdpatch $ADM J45.9 "{\"synonyms\":[$(printf '"s%s",' $(seq 1 21) | sed 's/,$//')]}")"
EV0=$(rq "select count(*) from outbox_events where event_type='icd10.updated' and payload->'payload'->>'code'='K59.0'")
HI0=$(hq "select count(*) from action_history where summary_key='icd10.updated' and summary_params->>'code'='K59.0'")
OLD=$(rq "select row_to_json(c)::text from (select title_az, title_ru, synonyms from icd10_codes where code='K59.0') c")
check "PATCH: name + synonyms (trimmed, deduplicated)" '200|"Qəbizlik (xroniki)"|["qəbz","QƏBZ2"]|"Expiry Test"' \
  "$(icdpatch $ADM k59.0 '{"titleAz":"  Qəbizlik (xroniki) ","synonyms":[" qəbz ","Qəbz","","QƏBZ2"]}')|$(j .titleAz)|$(j .synonyms)|$(j .updatedByName)"
check "  an admin-written name counts as checked" true "$(j .titleAzVerified)"
check "PATCH: mark the Russian name unchecked → in the review filter" 'false|true' \
  "$(icdpatch $ADM K59.0 '{"titleRuVerified":false}' >/dev/null; j .titleRuVerified)|$(cat_ $ADM 'unverified=true&search=K59.0' >/dev/null; j '[.items[].code] | index("K59.0") != null')"
check "PATCH: confirm it → out of the review filter" 'true|false' \
  "$(icdpatch $ADM K59.0 '{"titleRuVerified":true}' >/dev/null; j .titleRuVerified)|$(cat_ $ADM 'unverified=true&search=K59.0' >/dev/null; j '[.items[].code] | index("K59.0") != null')"
check "  the new synonym is searchable" '"K59.0"' "$(icd $DOC 'qebz2' >/dev/null; j '.[0].code')"
check "  icd10.updated in the outbox (3 changes)" "3" "$(( $(rq "select count(*) from outbox_events where event_type='icd10.updated' and payload->'payload'->>'code'='K59.0'") - EV0 ))"
check "PATCH: same values again → no new event" "3" "$(icdpatch $ADM K59.0 '{"titleAz":"Qəbizlik (xroniki)"}' >/dev/null; echo $(( $(rq "select count(*) from outbox_events where event_type='icd10.updated' and payload->'payload'->>'code'='K59.0'") - EV0 )))"
check "  history icd10.updated (no patient)" "$((HI0 + 3))|" \
  "$(wait_for $((HI0 + 3)) notification_db "select count(*) from action_history where summary_key='icd10.updated' and summary_params->>'code'='K59.0'")|$(hq "select patient_id from action_history where summary_key='icd10.updated' and summary_params->>'code'='K59.0' order by occurred_at desc limit 1")"
check "PATCH: deactivate → hidden from doctors" '200|false|null' "$(icdpatch $ADM R42 '{"isActive":false}')|$(j .isActive)|$(icd $DOC R42 >/dev/null; j '[.[] | select(.code == "R42")][0].code')"
check "  history icd10.deactivated" 1 "$(wait_for 1 notification_db "select count(*) from action_history where summary_key='icd10.deactivated' and summary_params->>'code'='R42' and occurred_at > now() - interval '1 minute'")"
check "  status filter inactive" true "$(cat_ $ADM 'status=inactive&search=R42' >/dev/null; j '[.items[].code] | index("R42") != null')"

echo "Vitals"
redis_flush_rl
check "receptionist → 403" 403 "$(vit $REC $V1 '{"heartRate":70}')"
check "admin → 403" 403 "$(vit $ADM $V1 '{"heartRate":70}')"
check "another doctor → 403" 403 "$(vit $DOC2 $V1 '{"heartRate":70}')"
check "unknown visit → 404" 404 "$(vit $DOC $(uuid) '{"heartRate":70}')"
check "nothing entered → 400 field vitals" '400|"vitals"' "$(vit $DOC $V1 '{}')|$(j .error.details.field)"
check "only nulls → 400" 400 "$(vit $DOC $V1 '{"heartRate":null}')"
check "temperature 370 → 400" 400 "$(vit $DOC $V1 '{"temperatureC":370}')"
check "temperature with 2 decimals → 400" 400 "$(vit $DOC $V1 '{"temperatureC":36.65}')"
check "SpO2 101 → 400" 400 "$(vit $DOC $V1 '{"oxygenSaturation":101}')"
check "heart rate 12.5 → 400" 400 "$(vit $DOC $V1 '{"heartRate":12.5}')"
check "systolic ≤ diastolic → 400 field diastolicBp" '400|"diastolicBp"' "$(vit $DOC $V1 '{"systolicBp":80,"diastolicBp":90}')|$(j .error.details.field)"
check "text → 400" 400 "$(vit $DOC $V1 '{"heartRate":"fast"}')"
check "  nothing saved" 0 "$(rq "select count(*) from vital_signs where encounter_id='$V1'")"
check "own doctor → 201, the whole visit back" '201|1|36.6|120|80|72' \
  "$(vit $DOC $V1 '{"temperatureC":36.6,"systolicBp":120,"diastolicBp":80,"heartRate":72}')|$(j '.vitals | length')|$(j '.vitals[0].temperatureC')|$(j '.vitals[0].systolicBp')|$(j '.vitals[0].diastolicBp')|$(j '.vitals[0].heartRate')"
check "  numbers, not strings; unset = null" '"number"|null|"Expiry Test"' "$(j '.vitals[0].temperatureC | type')|$(j '.vitals[0].weightKg')|$(j '.vitals[0].recordedByName')"
sleep 0.05
check "nurse → 201, BMI by the database" '201|2|24.5|72.5|172' \
  "$(vit $NUR $V1 '{"weightKg":72.5,"heightCm":172,"oxygenSaturation":97}')|$(j '.vitals | length')|$(j '.vitals[0].bmi')|$(j '.vitals[0].weightKg')|$(j '.vitals[0].heightCm')"
check "  newest first" '97|null' "$(j '.vitals[0].oxygenSaturation')|$(j '.vitals[1].oxygenSaturation')"
check "  BMI cannot be sent" 400 "$(vit $DOC $V1 '{"heartRate":70,"bmi":99}')"
check "GET returns them" '200|2' "$(as $NUR $E/$V1)|$(j '.vitals | length')"
check "vitals.recorded × 2 in the outbox" 2 "$(rq "select count(*) from outbox_events where aggregate_id='$V1' and event_type='vitals.recorded'")"
P=$(rq "select payload->'payload' from outbox_events where aggregate_id='$V1' and event_type='vitals.recorded' limit 1")
check "  payload names the visit, no values" "\"$V1\"|\"$P1\"|false" "$(echo "$P" | jq -c .encounterId)|$(echo "$P" | jq -c .patientId)|$(echo "$P" | jq 'has("heartRate") or has("temperatureC")')"
check "  history vitals.recorded on the patient timeline" "2|$P1" \
  "$(wait_for 2 notification_db "select count(*) from action_history where entity_id='$V1' and summary_key='vitals.recorded'")|$(hq "select distinct patient_id from action_history where entity_id='$V1' and summary_key='vitals.recorded'")"

echo "Diagnoses"
redis_flush_rl
check "nurse → 403" 403 "$(dx $NUR $V1 '{"icd10Code":"I10"}')"
check "another doctor → 403" 403 "$(dx $DOC2 $V1 '{"icd10Code":"I10"}')"
check "unknown code → 400 field icd10Code" '400|"icd10Code"' "$(dx $DOC $V1 '{"icd10Code":"Z99.99"}')|$(j .error.details.field)"
check "no code, no text → 400 field description" '400|"description"' "$(dx $DOC $V1 '{}')|$(j .error.details.field)"
check "switched-off code → 422 CODE_INACTIVE" '422|"CODE_INACTIVE"' "$(dx $DOC $V1 '{"icd10Code":"R42"}')|$(j .error.details.reason)"
check "category with subcodes → 422 CODE_NOT_SPECIFIC" '422|"CODE_NOT_SPECIFIC"' "$(dx $DOC $V1 '{"icd10Code":"J45"}')|$(j .error.details.reason)"
check "uncoded as PRIMARY → 422 UNCODED_PRIMARY" '422|"UNCODED_PRIMARY"' "$(dx $DOC $V1 '{"description":"Rare thing","type":"PRIMARY"}')|$(j .error.details.reason)"
check "bad type → 400" 400 "$(dx $DOC $V1 '{"icd10Code":"I10","type":"MAIN"}')"
check "first one → PRIMARY, title copied, code upper-cased" '201|"I10"|"PRIMARY"|"Essential (primary) hypertension"|"Essential (primary) hypertension"' \
  "$(dx $DOC $V1 '{"icd10Code":" i10 "}')|$(j '.diagnoses[0].icd10Code')|$(j '.diagnoses[0].type')|$(j '.diagnoses[0].description')|$(j '.diagnoses[0].icd10TitleEn')"
DX1=$(j '.diagnoses[0].id' | tr -d '"')
check "same code again → 409 field icd10Code" '409|"icd10Code"' "$(dx $DOC $V1 '{"icd10Code":"I10"}')|$(j .error.details.field)"
check "second one → SECONDARY, own wording + notes" '201|2|"SECONDARY"|"Chest pain on exertion"|"since Monday"' \
  "$(dx $DOC $V1 '{"icd10Code":"R07.4","description":"  Chest pain on exertion ","notes":"since Monday"}')|$(j '.diagnoses | length')|$(j '.diagnoses[1].type')|$(j '.diagnoses[1].description')|$(j '.diagnoses[1].notes')"
DX2=$(j '.diagnoses[1].id' | tr -d '"')
check "  ICD titles kept apart from the wording" '"Chest pain, unspecified"|"Döş qəfəsində ağrı, dəqiqləşdirilməmiş"' "$(j '.diagnoses[1].icd10TitleEn')|$(j '.diagnoses[1].icd10TitleAz')"
check "uncoded → 201 SECONDARY, no code" '201|null|"SECONDARY"|"Post-viral fatigue"|null' \
  "$(dx $DOC $V1 '{"description":"  Post-viral fatigue ","type":"SECONDARY"}')|$(j '[.diagnoses[] | select(.icd10Code == null)][0].icd10Code')|$(j '[.diagnoses[] | select(.icd10Code == null)][0].type')|$(j '[.diagnoses[] | select(.icd10Code == null)][0].description')|$(j '[.diagnoses[] | select(.icd10Code == null)][0].icd10TitleEn')"
DXU=$(j '[.diagnoses[] | select(.icd10Code == null)][0].id' | tr -d '"')
check "  uncoded cannot be made PRIMARY → 422" '422|"UNCODED_PRIMARY"' "$(dxp $DOC $V1 $DXU '{"type":"PRIMARY"}')|$(j .error.details.reason)"
check "  a second uncoded one is fine" 201 "$(dx $DOC $V1 '{"description":"Another note"}')"
check "  remove the uncoded ones" '200|200' "$(dxd $DOC $V1 $DXU)|$(dxd $DOC $V1 "$(j '[.diagnoses[] | select(.icd10Code == null)][0].id' | tr -d '"')")"
check "third as PRIMARY → the old primary becomes SECONDARY" '201|"E11.9"|1' \
  "$(dx $DOC $V1 '{"icd10Code":"E11.9","type":"PRIMARY"}')|$(j '.diagnoses[0].icd10Code')|$(j '[.diagnoses[] | select(.type == "PRIMARY")] | length')"
DX3=$(j '.diagnoses[0].id' | tr -d '"')
check "  I10 now SECONDARY" '"SECONDARY"' "$(j ".diagnoses[] | select(.id == \"$DX1\") | .type")"
check "PATCH: make I10 primary again" '200|"I10"|1' "$(dxp $DOC $V1 $DX1 '{"type":"PRIMARY"}')|$(j '.diagnoses[0].icd10Code')|$(j '[.diagnoses[] | select(.type == "PRIMARY")] | length')"
check "PATCH: wording + notes, null clears notes" '200|"Hypertension, stage 2"|null' \
  "$(dxp $DOC $V1 $DX2 '{"notes":null}' >/dev/null; dxp $DOC $V1 $DX1 '{"description":"Hypertension, stage 2"}')|$(j ".diagnoses[] | select(.id == \"$DX1\") | .description")|$(j ".diagnoses[] | select(.id == \"$DX2\") | .notes")"
check "PATCH: blank wording → 400" 400 "$(dxp $DOC $V1 $DX1 '{"description":"   "}')"
check "PATCH: another doctor → 403" 403 "$(dxp $DOC2 $V1 $DX1 '{"type":"SECONDARY"}')"
check "PATCH: diagnosis of another visit → 404" 404 "$(dxp $DOC $V3 $DX1 '{"type":"SECONDARY"}')"
check "updates are not events" 0 "$(rq "select count(*) from outbox_events where aggregate_id='$V1' and event_type like 'diagnosis.%' and event_type not in ('diagnosis.added','diagnosis.removed')")"
check "DELETE: another doctor → 403" 403 "$(dxd $DOC2 $V1 $DX3)"
check "DELETE → 200, gone" '200|2|false' "$(dxd $DOC $V1 $DX3)|$(j '.diagnoses | length')|$(j "[.diagnoses[].id] | index(\"$DX3\") != null")"
check "DELETE again → 404" 404 "$(dxd $DOC $V1 $DX3)"
check "outbox: 5 added, 3 removed" "5|3" "$(rq "select count(*) from outbox_events where aggregate_id='$V1' and event_type='diagnosis.added'")|$(rq "select count(*) from outbox_events where aggregate_id='$V1' and event_type='diagnosis.removed'")"
P=$(rq "select payload->'payload' from outbox_events where aggregate_id='$V1' and event_type='diagnosis.added' order by occurred_at limit 1")
check "  payload: no code or title" "true|false" "$(echo "$P" | jq .primary)|$(echo "$P" | jq 'tostring | test("I10|hypertension"; "i")')"
check "  history diagnosis.added / removed" "5|3" \
  "$(wait_for 5 notification_db "select count(*) from action_history where entity_id='$V1' and summary_key='diagnosis.added'")|$(wait_for 3 notification_db "select count(*) from action_history where entity_id='$V1' and summary_key='diagnosis.removed'")"
check "  history text has no diagnosis" 0 "$(hq "select count(*) from action_history where entity_id='$V1' and (summary ilike '%hypertension%' or summary ilike '%I10%')")"
dx $DOC $V3 '{"icd10Code":"J18.9"}' >/dev/null
check "PRIMARY demoted to none → close says PRIMARY_DIAGNOSIS_REQUIRED" '422|"PRIMARY_DIAGNOSIS_REQUIRED"' \
  "$(patch $DOC $V3 '{"chiefComplaint":"Cough"}' >/dev/null; dxp $DOC $V3 "$(j '.diagnoses[0].id' | tr -d '"')" '{"type":"SECONDARY"}' >/dev/null; close_v $DOC $V3)|$(j .error.details.reason)"

echo "Frequent codes"
check "nurse → 403" 403 "$(as $NUR $API/icd10/frequent)"
check "this doctor's codes, most used first" '200|true|true' "$(as $DOC $API/icd10/frequent)|$(j '[.[].code] | index("I10") != null')|$(j '.[0].uses >= 1')"
check "another doctor has none" '200|0' "$(as $DOC2 $API/icd10/frequent)|$(j length)"

echo "Close and read-only"
redis_flush_rl
patch $DOC $V1 '{"chiefComplaint":"Headache, high blood pressure"}' >/dev/null
check "close with the real PRIMARY → 200, detail kept" '200|"CLOSED"|2|2' "$(close_v $DOC $V1)|$(j .status)|$(j '.vitals | length')|$(j '.diagnoses | length')"
check "closed: vitals (doctor) → 409" '409|"INVALID_STATUS"' "$(vit $DOC $V1 '{"heartRate":70}')|$(j .error.code)"
check "closed: vitals (nurse) → 409" 409 "$(vit $NUR $V1 '{"heartRate":70}')"
check "closed: add diagnosis → 409" 409 "$(dx $DOC $V1 '{"icd10Code":"J45.9"}')"
check "closed: change diagnosis → 409" 409 "$(dxp $DOC $V1 $DX2 '{"type":"PRIMARY"}')"
check "closed: remove diagnosis → 409" 409 "$(dxd $DOC $V1 $DX2)"
check "  nothing changed" "2|2" "$(rq "select count(*) from vital_signs where encounter_id='$V1'")|$(rq "select count(*) from diagnoses where encounter_id='$V1'")"

icdpatch $ADM R42 '{"isActive":true}' >/dev/null
rq "update icd10_codes set title_az = '$(echo "$OLD" | jq -r .title_az)', synonyms = '{}' where code='K59.0'" >/dev/null
rq "update icd10_codes set search_text = icd10_fold(code || ' ' || title_en || ' ' || coalesce(title_az, '') || ' ' || coalesce(title_ru, '') || ' ' || array_to_string(synonyms, ' ')) where code='K59.0'" >/dev/null
cleanup
rm -rf $D
echo
echo "PASS $PASS  FAIL $FAIL"
[ $FAIL -eq 0 ]
