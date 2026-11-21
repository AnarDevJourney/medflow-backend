#!/bin/bash
# End-to-end checks of medical-record-service visits through the gateway.
# Start (8.1): permissions, only the appointment's own doctor, only a
# CHECKED_IN appointment, pressing it twice / in parallel returns the one
# visit, snapshots from the appointment, outbox → Kafka → appointment
# IN_PROGRESS + encounter_id, action history (patient timeline), 503 when
# appointment-service is down. Notes: own doctor, open visit, trimming,
# null clears, follow-up range, no events. Close: chief complaint and one
# PRIMARY diagnosis required, encounter.closed payload for billing (lab
# test codes without cancelled orders, email, follow-up), appointment
# COMPLETED, closed visit read-only.
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-encounters.sh
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

echo "Start visit"
redis_flush_rl
check "no cookie → 401" 401 "$(code -X POST $E -H 'content-type: application/json' -d "{\"appointmentId\":\"$A1\"}")"
check "nurse → 403" 403 "$(start $NUR $A1)"
check "receptionist → 403" 403 "$(start $REC $A1)"
check "admin → 403" 403 "$(start $ADM $A1)"
check "bad appointmentId → 400" '400|"VALIDATION_ERROR"' "$(start $DOC nope)|$(j .error.code)"
check "unknown appointment → 404 field appointmentId" '404|"appointmentId"' "$(start $DOC $(uuid))|$(j .error.details.field)"
check "another doctor → 403" 403 "$(start $DOC2 $A1)"
check "SCHEDULED (not checked in) → 409" '409|"INVALID_STATUS"|"SCHEDULED"' "$(start $DOC $A2)|$(j .error.code)|$(j .error.details.status)"
check "CANCELLED → 409" '409|"CANCELLED"' "$(start $DOC $A5)|$(j .error.details.status)"
check "own doctor, checked in → 201 OPEN" '201|"OPEN"' "$(start $DOC $A1)|$(j .status)"
V1=$(j .id | tr -d '"')
check "  snapshots from the appointment" "\"Aysel $SUR\"|\"$MRN\"|\"Zaur Testov\"|\"CARD\"|\"FOLLOW_UP\"|\"$A1\"|\"$P1\"" \
  "$(j .patientName)|$(j .patientMrn)|$(j .doctorName)|$(j .departmentCode)|$(j .appointmentType)|$(j .appointmentId)|$(j .patientId)"
check "  notes empty, not closed" "null|null|null" "$(j .chiefComplaint)|$(j .closedAt)|$(j .followUpInDays)"
check "  email snapshot stored (not in the response)" "aysel.$TAG@mail.test|false" "$(rq "select patient_email from encounters where id='$V1'")|$(j 'has("patientEmail")')"
check "again → 200, the same visit" "200|\"$V1\"" "$(start $DOC $A1)|$(j .id)"
check "another doctor on the open visit → 403" 403 "$(start $DOC2 $A1)"
check "  one row, one encounter.started in the outbox" "1|1" "$(rq "select count(*) from encounters where appointment_id='$A1'")|$(rq "select count(*) from outbox_events where aggregate_id='$V1' and event_type='encounter.started'")"
check "appointment → IN_PROGRESS + encounter id (Kafka)" "IN_PROGRESS|$V1|t" \
  "$(wait_for IN_PROGRESS appointment_db "select status from appointments where id='$A1'")|$(aq "select encounter_id from appointments where id='$A1'")|$(aq "select started_at is not null from appointments where id='$A1'")"
check "  history encounter.started on the patient timeline" "1|$P1|ENCOUNTER" \
  "$(wait_for 1 notification_db "select count(*) from action_history where entity_id='$V1' and summary_key='encounter.started'")|$(hq "select patient_id from action_history where entity_id='$V1'")|$(hq "select entity_type from action_history where entity_id='$V1'")"
check "  history params: names only" '{"mrn": "'$MRN'", "name": "Aysel '$SUR'", "actor": "Expiry Test", "doctor": "Zaur Testov"}' "$(hq "select summary_params from action_history where entity_id='$V1'")"
start $DOC $A3 >$D/p1 & start $DOC $A3 >$D/p2 & wait
check "parallel start → 201 + 200" "200 201" "$(echo $(cat $D/p1) $(cat $D/p2) | tr ' ' '\n' | sort | xargs)"
check "  one visit, one event" "1|1" "$(rq "select count(*) from encounters where appointment_id='$A3'")|$(rq "select count(*) from outbox_events o join encounters e on e.id = o.aggregate_id where e.appointment_id='$A3'")"

echo "Read"
check "doctor → 200" 200 "$(as $DOC $E/$V1)"
check "another doctor → 200 (full medical history)" 200 "$(as $DOC2 $E/$V1)"
check "nurse → 200" 200 "$(as $NUR $E/$V1)"
check "receptionist → 403" 403 "$(as $REC $E/$V1)"
check "admin → 403 (no clinical notes)" 403 "$(as $ADM $E/$V1)"
check "accountant → 403" 403 "$(as $ACC $E/$V1)"
check "unknown → 404" 404 "$(as $DOC $E/$(uuid))"
check "bad id → 400" 400 "$(as $DOC $E/nope)"

echo "Notes"
redis_flush_rl
check "another doctor → 403" 403 "$(patch $DOC2 $V1 '{"chiefComplaint":"x"}')"
check "nurse → 403" 403 "$(patch $NUR $V1 '{"chiefComplaint":"x"}')"
check "follow-up 0 → 400" 400 "$(patch $DOC $V1 '{"followUpInDays":0}')"
check "follow-up 366 → 400" 400 "$(patch $DOC $V1 '{"followUpInDays":366}')"
check "follow-up text → 400" 400 "$(patch $DOC $V1 '{"followUpInDays":"soon"}')"
check "complaint over 5000 chars → 400" 400 "$(patch $DOC $V1 "{\"chiefComplaint\":\"$(head -c 5001 /dev/zero | tr '\0' a)\"}")"
check "own doctor → 200, trimmed" '200|"Chest pain for 3 days"|"Mild tachycardia"|14' \
  "$(patch $DOC $V1 '{"chiefComplaint":"  Chest pain for 3 days  ","examinationNotes":"Mild tachycardia","followUpInDays":14}')|$(j .chiefComplaint)|$(j .examinationNotes)|$(j .followUpInDays)"
check "  only sent fields change" '200|"Chest pain for 3 days"|"Rest"' "$(patch $DOC $V1 '{"treatmentPlan":"Rest"}')|$(j .chiefComplaint)|$(j .treatmentPlan)"
check "null / blank clears" '200|null|null' "$(patch $DOC $V1 '{"examinationNotes":null,"treatmentPlan":"   "}')|$(j .examinationNotes)|$(j .treatmentPlan)"
check "notes are not events" 1 "$(rq "select count(*) from outbox_events where aggregate_id='$V1'")"

echo "Close"
redis_flush_rl
patch $DOC $V1 '{"chiefComplaint":null}' >/dev/null
check "no chief complaint → 422" '422|"CHIEF_COMPLAINT_REQUIRED"|"chiefComplaint"' "$(close_v $DOC $V1)|$(j .error.details.reason)|$(j .error.details.field)"
patch $DOC $V1 '{"chiefComplaint":"Chest pain for 3 days"}' >/dev/null
check "no diagnosis → 422" '422|"PRIMARY_DIAGNOSIS_REQUIRED"' "$(close_v $DOC $V1)|$(j .error.details.reason)"
rq "insert into diagnoses (encounter_id, patient_id, icd10_code, description, type) values ('$V1', '$P1', 'R07.4', 'Chest pain, unspecified', 'SECONDARY')" >/dev/null
check "only a SECONDARY diagnosis → 422" '422|"PRIMARY_DIAGNOSIS_REQUIRED"' "$(close_v $DOC $V1)|$(j .error.details.reason)"
check "a second PRIMARY is impossible (partial unique index)" "1" "$(rq "insert into diagnoses (encounter_id, patient_id, icd10_code, description, type) values ('$V1', '$P1', 'I10', 'Essential (primary) hypertension', 'PRIMARY')" >/dev/null; rq "insert into diagnoses (encounter_id, patient_id, icd10_code, description, type) values ('$V1', '$P1', 'I20.9', 'Angina', 'PRIMARY')" >/dev/null 2>&1; rq "select count(*) from diagnoses where encounter_id='$V1' and type='PRIMARY'")"
lab() { rq "insert into lab_orders (encounter_id, patient_id, patient_name, patient_mrn, department_id, ordered_by, ordered_by_name, test_code, test_name, status, cancelled_at)
            values ('$V1', '$P1', 'Aysel $SUR', '$MRN', '$CARD', '$DOC_ID', 'Zaur Testov', '$1', '$1', '$2', case when '$2' = 'CANCELLED' then now() end)" >/dev/null; }
lab CBC ORDERED; lab LIPID CANCELLED; lab CRP SAMPLE_COLLECTED
check "another doctor → 403" 403 "$(close_v $DOC2 $V1)"
check "nurse → 403" 403 "$(close_v $NUR $V1)"
check "own doctor → 200 CLOSED" '200|"CLOSED"|true' "$(close_v $DOC $V1)|$(j .status)|$(j '.closedAt != null')"
P=$(rq "select payload->'payload' from outbox_events where aggregate_id='$V1' and event_type='encounter.closed'")
check "  encounter.closed payload for billing" "[\"CBC\",\"CRP\"]|\"aysel.$TAG@mail.test\"|14|\"FOLLOW_UP\"|\"CARD\"" \
  "$(echo "$P" | jq -c .labTestCodes)|$(echo "$P" | jq -c .patientEmail)|$(echo "$P" | jq -c .followUpInDays)|$(echo "$P" | jq -c .appointmentType)|$(echo "$P" | jq -c .departmentCode)"
check "  no clinical text in the payload" false "$(echo "$P" | jq 'tostring | test("Chest pain")')"
check "appointment → COMPLETED (Kafka)" "COMPLETED|t" \
  "$(wait_for COMPLETED appointment_db "select status from appointments where id='$A1'")|$(aq "select completed_at is not null from appointments where id='$A1'")"
check "  history encounter.closed" 1 "$(wait_for 1 notification_db "select count(*) from action_history where entity_id='$V1' and summary_key='encounter.closed'")"
check "closed: notes → 409" '409|"INVALID_STATUS"|"CLOSED"' "$(patch $DOC $V1 '{"treatmentPlan":"x"}')|$(j .error.code)|$(j .error.details.status)"
check "closed: close again → 409" 409 "$(close_v $DOC $V1)"
check "closed: start again → 200, the closed visit" '200|"CLOSED"' "$(start $DOC $A1)|$(j .status)"
check "  still one encounter.closed" 1 "$(rq "select count(*) from outbox_events where aggregate_id='$V1' and event_type='encounter.closed'")"

echo "Appointment service down"
$DC stop appointment-service >/dev/null 2>&1
check "start → 503 naming the service, nothing saved" '503|"SERVICE_UNAVAILABLE"|"appointment-service"|0' \
  "$(start $DOC $A4)|$(j .error.code)|$(j .error.details.service)|$(rq "select count(*) from encounters where appointment_id='$A4'")"
check "an already open visit still opens (no call needed)" 200 "$(start $DOC $A3)"
$DC start appointment-service >/dev/null 2>&1
for _ in $(seq 1 60); do [ "$($DC ps appointment-service --format '{{.Health}}')" = healthy ] && break; sleep 1; done
check "appointment-service back → 201" 201 "$(start $DOC $A4)"

cleanup
rm -rf $D
echo
echo "PASS $PASS  FAIL $FAIL"
[ $FAIL -eq 0 ]
