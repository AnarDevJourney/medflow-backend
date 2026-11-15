#!/bin/bash
# End-to-end checks of appointment-service through the gateway.
# Notifications + emails (7.4): doctor in-app notifications (params, link,
# not for own actions, moved away / to), patient emails in Azerbaijani
# (booked, rescheduled, cancelled, reminder; none for system cancels),
# appointments:changed socket push only to roles with appointments.read.
# Jobs + sync (7.4): patient.updated → future snapshots, patient.deactivated
# → system cancellations (no patient email), reminder job planned / moved /
# removed / sent once, no-show sweep.
# Changes (7.2): edit (type / reason / notes, only changed fields, no-op →
# no event), reschedule (time and / or doctor, same rules, freed slot),
# check-in (appointment day only), cancel (reason, slot freed, past
# appointments too), invalid status transitions, today's list, the
# internal API for record-service, name snapshots of who did what.
# Booking (7.1): availability (slots in clinic time → UTC, booked / past /
# patient-busy slots, time off, no department, 90-day limit), booking
# (future, slot boundary, working hours, inactive / unknown patient,
# snapshots, outbox → Kafka → action history), the exclusion constraints
# (parallel booking of one slot → 201 + 409, patient double-booked with
# another doctor, back-to-back slots), list filters and the doctor's own
# scope, permissions, 503 when staff-service is down.
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-appointments.sh
# Creates two test doctors + patients and deletes them (history rows stay).
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/lib/mailpit.sh
API=http://localhost:3000/api/v1
A=$API/appointments
AV=$A/availability
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
sq() { q staff_db "$1"; }
hq() { q notification_db "$1"; }
redis_flush_rl() { $DC exec -T redis sh -c "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli del" >/dev/null; }
RUN=$(tr -dc 'a-z0-9' </dev/urandom | head -c 6)
TAG=$(tr -dc 'a-z' </dev/urandom | head -c 6)
SUR="Zt${TAG}ap" # patient-service test cleanups match 'Zt%'
# Clinic calendar day <offset> days from today, and a clinic wall-clock time as UTC ISO
day() { TZ=Asia/Baku date -d "$1 days" +%F; }
at() { date -u -d "TZ=\"Asia/Baku\" $1 $2" +%Y-%m-%dT%H:%M:%SZ; } # at <YYYY-MM-DD> <HH:MM>
wait_history() { # summary_key entity_id
  for _ in $(seq 1 40); do
    [ "$(hq "select count(*) from action_history where summary_key='$1' and entity_id='$2'")" -gt 0 ] && { echo "$1"; return; }
    sleep 0.5
  done
  echo "timeout"
}
wait_staff() { # user_id → waits until the profile exists (user.invited consumed)
  for _ in $(seq 1 40); do
    [ "$(sq "select count(*) from staff_members where user_id='$1'")" -gt 0 ] && { echo ok; return; }
    sleep 0.5
  done
  echo timeout
}
book() { as $1 -X POST $A -H 'content-type: application/json' -d "$2"; } # book <token> <json>
body() { # body <patientId> <doctorId> <startsAt> [extra json]
  echo "{\"patientId\":\"$1\",\"doctorId\":\"$2\",\"startsAt\":\"$3\"$4}"
}
U1=; U2=; U3=
cleanup() {
  [ -n "$U1$U2$U3" ] && {
    aq "delete from outbox_events where aggregate_id in (select id from appointments where doctor_id in ('${U1:-x}'::text::uuid, '${U2:-x}'::text::uuid, '${U3:-x}'::text::uuid))" >/dev/null 2>&1
  }
  aq "delete from outbox_events where aggregate_id in (select id from appointments where patient_name like '% Zt%')" >/dev/null
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
tok() { node scripts/lib/sign-token.mjs "$SECRET" "${2:-$(cat /proc/sys/kernel/random/uuid)}" $1 600; } # tok <ROLE> [userId]
REC=$(tok RECEPTIONIST); NUR=$(tok NURSE); ACC=$(tok ACCOUNTANT); ADM=$(tok ADMIN)
CARD=$(sq "select id from departments where code='CARD'")
invite() { # invite <first> <last> [departmentId] → prints the new user id
  local dep=""; [ -n "$3" ] && dep=",\"departmentId\":\"$3\""
  as_admin -X POST $API/users -H 'content-type: application/json' \
    -d "{\"email\":\"zt-$1-$RUN@medflow.test\",\"firstName\":\"$1\",\"lastName\":\"$2\",\"role\":\"DOCTOR\"$dep}" >/dev/null
  j .id | tr -d '"'
}
U1=$(invite Zaur Testov $CARD); U3=$(invite Kamran Testov $CARD); U2=$(invite Nodept Testov)
check "three test doctors invited" true "$([ -n "$U1" ] && [ -n "$U2" ] && [ -n "$U3" ] && echo true)"
check "  staff profiles created" "ok|ok|ok" "$(wait_staff $U1)|$(wait_staff $U2)|$(wait_staff $U3)"
# Every day 09:00–12:00 by 30 min → 6 slots a day
WEEK='{"days":['$(for d in 1 2 3 4 5 6 7; do printf '{"dayOfWeek":%d,"startTime":"09:00","endTime":"12:00","slotMinutes":30}' $d; [ $d -lt 7 ] && printf ','; done)']}'
for u in $U1 $U2 $U3; do as_admin -X PUT $API/schedules/$u -H 'content-type: application/json' -d "$WEEK" >/dev/null; done
check "  schedules set" 21 "$(sq "select count(*) from doctor_schedules d join staff_members s on s.id = d.staff_member_id where s.user_id in ('$U1','$U2','$U3')")"
check "  vacation on day +5" 201 "$(as_admin -X POST $API/time-off -H 'content-type: application/json' -d "{\"userId\":\"$U1\",\"type\":\"VACATION\",\"startDate\":\"$(day 5)\",\"endDate\":\"$(day 5)\"}")"
reg() { # reg <first> → prints the new patient id
  as_admin -X POST $API/patients -H 'content-type: application/json' \
    -d "{\"firstName\":\"$1\",\"lastName\":\"$SUR\",\"dateOfBirth\":\"1990-01-01\",\"gender\":\"FEMALE\",\"phone\":\"+994 50 000 00 0$2\",\"email\":\"$1.$TAG@mail.test\"}" >/dev/null
  j .id | tr -d '"'
}
P1=$(reg Leyla 1); P2=$(reg Sevinc 2); P3=$(reg Inactive 3)
MRN1=$(q patient_db "select mrn from patients where id='$P1'")
as_admin -X PATCH $API/patients/$P3/deactivate >/dev/null
check "three test patients (one inactive)" "true|f" "$([ -n "$P1" ] && [ -n "$P2" ] && echo true)|$(q patient_db "select is_active from patients where id='$P3'")"
D2=$(day 2); D3=$(day 3)

echo "Availability"
redis_flush_rl
check "no cookie → 401" 401 "$(code "$AV?doctorId=$U1&date=$D2")"
check "accountant → 403" 403 "$(as $ACC "$AV?doctorId=$U1&date=$D2")"
check "doctor → 403" 403 "$(as $(tok DOCTOR $U1) "$AV?doctorId=$U1&date=$D2")"
check "missing date → 400" 400 "$(as $REC "$AV?doctorId=$U1")"
check "bad date → 400" 400 "$(as $REC "$AV?doctorId=$U1&date=2026-02-30")"
check "bad doctorId → 400" 400 "$(as $REC "$AV?doctorId=nope&date=$D2")"
check "unknown doctor → 404" 404 "$(as $REC "$AV?doctorId=$(cat /proc/sys/kernel/random/uuid)&date=$D2")"
check "receptionist → 200, working" '200|true|6|30' "$(as $REC "$AV?doctorId=$U1&date=$D2")|$(j .working)|$(j '.slots|length')|$(j .slotMinutes)"
check "  doctor + department snapshot" '"Zaur Testov"|"CARD"|"09:00"|"12:00"' "$(j .doctorName)|$(j .departmentCode)|$(j .start)|$(j .end)"
check "  09:00 Baku = $(at $D2 09:00) (UTC)" "\"$(at $D2 09:00)\"|\"$(at $D2 09:30)\"|\"$(at $D2 11:30)\"" "$(j '.slots[0].startsAt' | sed 's/\.000Z/Z/')|$(j '.slots[0].endsAt' | sed 's/\.000Z/Z/')|$(j '.slots[5].startsAt' | sed 's/\.000Z/Z/')"
check "  all free" true "$(j 'all(.slots[]; .available and (has("reason")|not))')"
check "nurse → 200" 200 "$(as $NUR "$AV?doctorId=$U1&date=$D2")"
check "vacation → not working" '200|false|"VACATION"' "$(as $REC "$AV?doctorId=$U1&date=$(day 5)")|$(j .working)|$(j .reason)"
check "doctor without department → NO_DEPARTMENT" '200|false|"NO_DEPARTMENT"' "$(as $REC "$AV?doctorId=$U2&date=$D2")|$(j .working)|$(j .reason)"
check "not a doctor (receptionist id) → NOT_A_DOCTOR" '"NOT_A_DOCTOR"' "$(as $REC "$AV?doctorId=$(sq "select user_id from staff_members where role='NURSE' limit 1")&date=$D2" >/dev/null; j .reason)"
check "day 90 → 200" 200 "$(as $REC "$AV?doctorId=$U1&date=$(day 90)")"
check "day 91 → 422 TOO_FAR_AHEAD" '422|"TOO_FAR_AHEAD"|"date"' "$(as $REC "$AV?doctorId=$U1&date=$(day 91)")|$(j .error.details.reason)|$(j .error.details.field)"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
check "today: started slots PAST, the rest free" true "$(as $REC "$AV?doctorId=$U1&date=$(day 0)" >/dev/null; j "all(.slots[]; if .startsAt <= \"$NOW\" then .reason == \"PAST\" and (.available|not) else .available end)")"
check "yesterday: every slot PAST" true "$(as $REC "$AV?doctorId=$U1&date=$(day -1)" >/dev/null; j 'all(.slots[]; .reason == "PAST")')"

echo "Book"
redis_flush_rl
S0900=$(at $D2 09:00); S0930=$(at $D2 09:30); S1000=$(at $D2 10:00)
check "no cookie → 401" 401 "$(code -X POST $A -H 'content-type: application/json' -d "$(body $P1 $U1 $S0900)")"
check "doctor → 403" 403 "$(book $(tok DOCTOR $U1) "$(body $P1 $U1 $S0900)")"
check "nurse → 403" 403 "$(book $NUR "$(body $P1 $U1 $S0900)")"
check "accountant → 403" 403 "$(book $ACC "$(body $P1 $U1 $S0900)")"
check "receptionist → 201" 201 "$(book $REC "$(body $P1 $U1 $S0900 ',"type":"FOLLOW_UP","reason":"  Chest pain ","notes":""')")"
A1=$(j .id | tr -d '"')
check "  times (end = start + slot)" "\"$S0900\"|\"$(at $D2 09:30)\"" "$(j .startsAt | sed 's/\.000Z/Z/')|$(j .endsAt | sed 's/\.000Z/Z/')"
check "  snapshots" "\"Leyla $SUR\"|\"$MRN1\"|\"+994 50 000 00 01\"|\"zaur testov\"|\"CARD\"" "$(j .patientName)|$(j .patientMrn)|$(j .patientPhone)|$(j '.doctorName|ascii_downcase')|$(j .departmentCode)"
check "  SCHEDULED, FOLLOW_UP, reason trimmed, empty notes null" '"SCHEDULED"|"FOLLOW_UP"|"Chest pain"|null' "$(j .status)|$(j .type)|$(j .reason)|$(j .notes)"
check "  fields" '["cancellationReason","cancelledAt","cancelledByName","checkedInAt","checkedInByName","completedAt","createdAt","createdByName","departmentCode","departmentId","departmentName","doctorId","doctorName","encounterId","endsAt","id","notes","patientEmail","patientId","patientMrn","patientName","patientPhone","reason","startedAt","startsAt","status","type","updatedAt","updatedByName"]' "$(j keys)"
check "  booked by (name snapshot)" '"Expiry Test"' "$(j .createdByName)"
check "  created_by = the receptionist" true "$([ -n "$(aq "select created_by from appointments where id='$A1'")" ] && echo true)"
check "  event" "appointment.created|APPOINTMENT|$MRN1|$S0900" "$(aq "select event_type||'|'||aggregate_type||'|'||(payload->'payload'->>'patientMrn')||'|'||(payload->'payload'->>'startsAt') from outbox_events where aggregate_id='$A1'" | sed 's/\.000Z/Z/')"
check "  history" appointment.created "$(wait_history appointment.created $A1)"
check "  on the patient timeline, no contacts" "APPOINTMENT|$P1|$MRN1|false" "$(hq "select entity_type||'|'||patient_id||'|'||(summary_params->>'mrn')||'|'||(summary like '%@%' or metadata::text like '%@%') from action_history where summary_key='appointment.created' and entity_id='$A1'")"
check "  published to Kafka" true "$(for _ in $(seq 1 20); do [ -n "$(aq "select published_at from outbox_events where aggregate_id='$A1'")" ] && { echo true; break; }; sleep 0.5; done)"
check "type defaults to CONSULTATION (admin)" '201|"CONSULTATION"' "$(book $ADM "$(body $P2 $U1 $S1000)")|$(j .type)"
A2=$(j .id | tr -d '"')
check "slot now TAKEN in availability" '"TAKEN"|true|"TAKEN"' "$(as $REC "$AV?doctorId=$U1&date=$D2" >/dev/null; j '.slots[0].reason')|$(j '.slots[1].available')|$(j '.slots[2].reason')"
check "  with patientId: P1 busy with U1 → TAKEN for U1, PATIENT_BUSY for U3" '"PATIENT_BUSY"|true' "$(as $REC "$AV?doctorId=$U3&date=$D2&patientId=$P1" >/dev/null; j '.slots[0].reason')|$(j '.slots[1].available')"

echo "Rules"
redis_flush_rl
check "past time → 422 startsAt" '422|"startsAt"' "$(book $REC "$(body $P1 $U1 $(at $(day -1) 09:00))")|$(j .error.details.field)"
check "off the slot grid (09:10) → 422 NOT_A_SLOT" '422|"NOT_A_SLOT"' "$(book $REC "$(body $P1 $U1 $(at $D3 09:10))")|$(j .error.details.reason)"
check "before hours (08:30) → 422" '422|"NOT_A_SLOT"' "$(book $REC "$(body $P1 $U1 $(at $D3 08:30))")|$(j .error.details.reason)"
check "last piece past the end (12:00) → 422" 422 "$(book $REC "$(body $P1 $U1 $(at $D3 12:00))")"
check "seconds in the time → 422" 422 "$(book $REC "$(body $P1 $U1 $(at $D3 09:00 | sed 's/:00Z/:30Z/'))")"
check "vacation day → 422 VACATION" '422|"VACATION"' "$(book $REC "$(body $P1 $U1 $(at $(day 5) 09:00))")|$(j .error.details.reason)"
check "doctor without department → 422 NO_DEPARTMENT" '422|"NO_DEPARTMENT"' "$(book $REC "$(body $P1 $U2 $(at $D3 09:00))")|$(j .error.details.reason)"
check "91 days ahead → 422 TOO_FAR_AHEAD" '422|"TOO_FAR_AHEAD"' "$(book $REC "$(body $P1 $U1 $(at $(day 91) 09:00))")|$(j .error.details.reason)"
check "unknown doctor → 404 doctorId" '404|"doctorId"' "$(book $REC "$(body $P1 $(cat /proc/sys/kernel/random/uuid) $(at $D3 09:00))")|$(j .error.details.field)"
check "unknown patient → 404 patientId" '404|"patientId"' "$(book $REC "$(body $(cat /proc/sys/kernel/random/uuid) $U1 $(at $D3 09:00))")|$(j .error.details.field)"
check "inactive patient → 409 INVALID_STATUS" '409|"INVALID_STATUS"|"patientId"' "$(book $REC "$(body $P3 $U1 $(at $D3 09:00))")|$(j .error.code)|$(j .error.details.field)"
check "bad startsAt → 400" 400 "$(book $REC "$(body $P1 $U1 tomorrow)")"
check "bad type → 400" 400 "$(book $REC "$(body $P1 $U1 $(at $D3 09:00) ',"type":"SURGERY"')")"
check "endsAt cannot be sent → 400" 400 "$(book $REC "$(body $P1 $U1 $(at $D3 09:00) ",\"endsAt\":\"$(at $D3 11:00)\"")")"
check "reason over 500 chars → 400" 400 "$(book $REC "$(body $P1 $U1 $(at $D3 09:00) ",\"reason\":\"$(printf 'x%.0s' $(seq 1 501))\"")")"
check "nothing was saved by the failures" 2 "$(aq "select count(*) from appointments where doctor_id in ('$U1','$U2','$U3')")"

echo "Double booking"
redis_flush_rl
check "same slot, same doctor → 409 SLOT_TAKEN (DOCTOR)" '409|"SLOT_TAKEN"|"DOCTOR"' "$(book $REC "$(body $P2 $U1 $S0900)")|$(j .error.code)|$(j .error.details.conflict)"
check "same patient, other doctor, same time → 409 (PATIENT)" '409|"PATIENT"' "$(book $REC "$(body $P1 $U3 $S0900)")|$(j .error.details.conflict)"
check "back-to-back slot (09:30) → 201" 201 "$(book $REC "$(body $P1 $U1 $S0930)")"
# Two desks book the same free slot at the same moment (same patient, so
# either constraint may fire — exactly one insert wins)
S1100=$(at $D3 11:00)
( book $REC "$(body $P2 $U3 $S1100)" > $D/c1 ) &
( D2B=$(mktemp -d); curl -s -o $D2B/body -w '%{http_code}' -b "access_token=$REC" -X POST $A -H 'content-type: application/json' -d "$(body $P2 $U3 $S1100)" > $D/c2 ) &
wait
check "parallel booking of one slot → one 201, one 409" "201 409" "$(cat $D/c1 $D/c2 | tr -d '\n' | fold -w3 | sort | tr '\n' ' ' | sed 's/ $//')"
check "  exactly one row holds the slot" 1 "$(aq "select count(*) from appointments where doctor_id='$U3' and starts_at='$S1100'")"

echo "List + read"
redis_flush_rl
check "no cookie → 401" 401 "$(code $A)"
check "accountant → 403" 403 "$(as $ACC $A)"
check "receptionist, newest booking first" "200|true" "$(as $REC "$A?search=$SUR&limit=100")|$(j '[.items[].createdAt] == ([.items[].createdAt]|sort|reverse)')"
check "  search by surname → 4" 4 "$(j .meta.total)"
check "  meta" '["limit","page","total"]' "$(j '.meta|keys')"
check "search by MRN" true "$(as $REC "$A?search=$MRN1" >/dev/null; j 'all(.items[]; .patientMrn == "'$MRN1'") and .meta.total == 2')"
check "patientId filter (incl. the parallel winner)" 2 "$(as $REC "$A?patientId=$P2" >/dev/null; j .meta.total)"
check "doctorId + from/to (day +2 only)" 3 "$(as $REC "$A?doctorId=$U1&from=$D2&to=$D2" >/dev/null; j .meta.total)"
check "  day +3 → U1 has none" 0 "$(as $REC "$A?doctorId=$U1&from=$D3&to=$D3" >/dev/null; j .meta.total)"
check "sort startsAt:asc" true "$(as $REC "$A?search=$SUR&sort=startsAt:asc" >/dev/null; j '[.items[].startsAt] == ([.items[].startsAt]|sort)')"
check "status filter" '4|0' "$(as $REC "$A?search=$SUR&status=SCHEDULED" >/dev/null; j .meta.total)|$(as $REC "$A?search=$SUR&status=CANCELLED" >/dev/null; j .meta.total)"
check "departmentId filter" true "$(as $REC "$A?departmentId=$CARD&search=$SUR" >/dev/null; j 'all(.items[]; .departmentCode == "CARD") and .meta.total == 4')"
check "doctor sees only own by default" "200|3|true" "$(as $(tok DOCTOR $U1) "$A?search=$SUR")|$(j .meta.total)|$(j "all(.items[]; .doctorId == \"$U1\")")"
check "  allDoctors=true → everyone's" 4 "$(as $(tok DOCTOR $U1) "$A?search=$SUR&allDoctors=true" >/dev/null; j .meta.total)"
check "  a colleague's by doctorId" 1 "$(as $(tok DOCTOR $U1) "$A?doctorId=$U3" >/dev/null; j .meta.total)"
check "  patient's appointments (patientId) → all doctors" 2 "$(as $(tok DOCTOR $U3) "$A?patientId=$P2" >/dev/null; j .meta.total)"
check "bad status → 400" 400 "$(as $REC "$A?status=DONE")"
check "bad from → 400" 400 "$(as $REC "$A?from=16-11-2026")"
check "bad sort → 400" 400 "$(as $REC "$A?sort=startsAt")"
check "GET /:id → 200" "200|\"$A1\"" "$(as $NUR $A/$A1)|$(j .id)"
check "  unknown → 404" 404 "$(as $REC $A/$(cat /proc/sys/kernel/random/uuid))"
check "  bad uuid → 400" 400 "$(as $REC $A/nope)"

echo "Edit"
redis_flush_rl
pat() { as $1 -X PATCH $A/$2${3:+/$3} -H 'content-type: application/json' -d "${4:-{\}}"; } # pat <token> <id> [action] [json]
events() { aq "select count(*) from outbox_events where aggregate_id='$1' and event_type='$2'"; }
check "doctor → 403" 403 "$(pat $(tok DOCTOR $U1) $A1 '' '{"notes":"x"}')"
check "nurse → 403" 403 "$(pat $NUR $A1 '' '{"notes":"x"}')"
check "notes + unchanged reason → 200" '200|"Bring the ECG"|"Chest pain"|"Expiry Test"' "$(pat $REC $A1 '' '{"notes":"  Bring the ECG ","reason":"Chest pain"}')|$(j .notes)|$(j .reason)|$(j .updatedByName)"
check "  event names only the changed field" '["notes"]' "$(aq "select payload->'payload'->'changedFields' from outbox_events where aggregate_id='$A1' and event_type='appointment.updated'" | tr -d ' ')"
check "  history" appointment.updated "$(wait_history appointment.updated $A1)"
check "same values again → 200, no new event" "200|1" "$(pat $REC $A1 '' '{"notes":"Bring the ECG"}')|$(events $A1 appointment.updated)"
check "type + clear notes → 200" '200|"CHECK_UP"|null' "$(pat $REC $A1 '' '{"type":"CHECK_UP","notes":""}')|$(j .type)|$(j .notes)"
check "type null → 400" 400 "$(pat $REC $A1 '' '{"type":null}')"
check "bad type → 400" 400 "$(pat $REC $A1 '' '{"type":"SURGERY"}')"
check "patient cannot be changed → 400" 400 "$(pat $REC $A1 '' "{\"patientId\":\"$P2\"}")"
check "unknown → 404" 404 "$(pat $REC $(cat /proc/sys/kernel/random/uuid) '' '{"notes":"x"}')"

echo "Reschedule"
redis_flush_rl
S0900D3=$(at $D3 09:00)
check "nurse → 403" 403 "$(pat $NUR $A2 reschedule "{\"startsAt\":\"$S0900D3\"}")"
check "to day +3 09:00 → 200, end moved too" "200|\"$S0900D3\"|\"$(at $D3 09:30)\"|\"$U1\"|\"Expiry Test\"" "$(pat $REC $A2 reschedule "{\"startsAt\":\"$S0900D3\"}")|$(j .startsAt | sed 's/\.000Z/Z/')|$(j .endsAt | sed 's/\.000Z/Z/')|$(j .doctorId)|$(j .updatedByName)"
check "  event keeps the old time" "$S1000" "$(aq "select payload->'payload'->'previous'->>'startsAt' from outbox_events where aggregate_id='$A2' and event_type='appointment.rescheduled'" | sed 's/\.000Z/Z/')"
check "  history" appointment.rescheduled "$(wait_history appointment.rescheduled $A2)"
check "  old slot (day +2 10:00) free again" true "$(as $REC "$AV?doctorId=$U1&date=$D2" >/dev/null; j '.slots[2].available')"
check "same time + doctor → 400" 400 "$(pat $REC $A2 reschedule "{\"startsAt\":\"$S0900D3\"}")"
check "onto a booked slot → 409 SLOT_TAKEN" '409|"SLOT_TAKEN"|"DOCTOR"' "$(pat $REC $A2 reschedule "{\"startsAt\":\"$S0900\"}")|$(j .error.code)|$(j .error.details.conflict)"
check "onto a vacation day → 422 VACATION" '422|"VACATION"' "$(pat $REC $A2 reschedule "{\"startsAt\":\"$(at $(day 5) 09:00)\"}")|$(j .error.details.reason)"
check "into the past → 422" 422 "$(pat $REC $A2 reschedule "{\"startsAt\":\"$(at $(day -1) 09:00)\"}")"
check "off the grid → 422 NOT_A_SLOT" '"NOT_A_SLOT"' "$(pat $REC $A2 reschedule "{\"startsAt\":\"$(at $D3 09:15)\"}" >/dev/null; j .error.details.reason)"
check "to a doctor without department → 422" '"NO_DEPARTMENT"' "$(pat $REC $A2 reschedule "{\"startsAt\":\"$(at $D3 10:00)\",\"doctorId\":\"$U2\"}" >/dev/null; j .error.details.reason)"
check "to another doctor (U3) → 200" "200|\"$U3\"|\"Kamran Testov\"" "$(pat $REC $A2 reschedule "{\"startsAt\":\"$(at $D3 10:00)\",\"doctorId\":\"$U3\"}")|$(j .doctorId)|$(j .doctorName)"
check "  history names both doctors" "appointment.rescheduledDoctor|Zaur Testov" "$(wait_history appointment.rescheduledDoctor $A2)|$(hq "select summary_params->>'previousDoctor' from action_history where summary_key='appointment.rescheduledDoctor' and entity_id='$A2'")"
check "unknown → 404" 404 "$(pat $REC $(cat /proc/sys/kernel/random/uuid) reschedule "{\"startsAt\":\"$S0900D3\"}")"

echo "Check-in"
redis_flush_rl
# Today's appointments are inserted directly: the schedule's slots for
# today may already be over when the script runs
ins() { # ins <patientId> <patientName> <doctorId> <day> <HH:MM> [status] → id
  aq "insert into appointments (patient_id, doctor_id, department_id, patient_name, patient_mrn, patient_phone, doctor_name, department_name, department_code, starts_at, ends_at, status, cancelled_at, created_by)
      values ('$1', '$3', '$CARD', '$2', 'P-T', '+994 50 000 00 00', 'Zaur Testov', 'Cardiology', 'CARD', '$(at $4 $5)', '$(at $4 $5)'::timestamptz + interval '30 minutes', '${6:-SCHEDULED}', case when '${6:-SCHEDULED}' = 'CANCELLED' then now() end, '$U1') returning id" | head -1
}
T1=$(ins $P2 "Sevinc $SUR" $U1 $(day 0) 22:00)
check "not the appointment's day → 422" '422|"NOT_APPOINTMENT_DAY"' "$(pat $REC $A1 check-in)|$(j .error.details.reason)"
check "doctor → 403" 403 "$(pat $(tok DOCTOR $U1) $T1 check-in)"
check "admin → 403 (no check_in permission)" 403 "$(pat $ADM $T1 check-in)"
check "nurse, today → 200 CHECKED_IN" '200|"CHECKED_IN"|"Expiry Test"|true' "$(pat $NUR $T1 check-in)|$(j .status)|$(j .checkedInByName)|$(j '.checkedInAt != null')"
check "  history" appointment.checkedIn "$(wait_history appointment.checkedIn $T1)"
check "again → 409 INVALID_STATUS" '409|"INVALID_STATUS"' "$(pat $REC $T1 check-in)|$(j .error.code)"
check "reschedule a checked-in one → 409" 409 "$(pat $REC $T1 reschedule "{\"startsAt\":\"$S0900D3\"}")"
check "edit notes while checked in → 200" '200|"Waiting room 2"' "$(pat $REC $T1 '' '{"notes":"Waiting room 2"}')|$(j .notes)"

echo "Cancel"
redis_flush_rl
check "doctor → 403" 403 "$(pat $(tok DOCTOR $U1) $A1 cancel '{"reason":"x"}')"
check "nurse → 403" 403 "$(pat $NUR $A1 cancel '{"reason":"x"}')"
check "no reason → 400" 400 "$(pat $REC $A1 cancel)"
check "blank reason → 400" 400 "$(pat $REC $A1 cancel '{"reason":"   "}')"
check "checked-in patient left → 200 CANCELLED" '200|"CANCELLED"|"Left before the visit"|"Expiry Test"' "$(pat $REC $T1 cancel '{"reason":" Left before the visit "}')|$(j .status)|$(j .cancellationReason)|$(j .cancelledByName)"
check "  event: reason + previous status" "Left before the visit|CHECKED_IN" "$(aq "select (payload->'payload'->>'reason')||'|'||(payload->'payload'->>'previousStatus') from outbox_events where aggregate_id='$T1' and event_type='appointment.cancelled'")"
check "  history keeps the reason, no contacts" "appointment.cancelled|Left before the visit|false" "$(wait_history appointment.cancelled $T1)|$(hq "select (metadata->>'cancellationReason')||'|'||(metadata::text like '%@%') from action_history where summary_key='appointment.cancelled' and entity_id='$T1'")"
check "cancel again → 409" 409 "$(pat $REC $T1 cancel '{"reason":"x"}')"
check "edit a cancelled one → 409" 409 "$(pat $REC $T1 '' '{"notes":"x"}')"
check "check in a cancelled one → 409" 409 "$(pat $NUR $T1 check-in)"
check "scheduled → 200" 200 "$(pat $ADM $A1 cancel '{"reason":"The patient called"}')"
check "  slot day +2 09:00 free again" 'true' "$(as $REC "$AV?doctorId=$U1&date=$D2" >/dev/null; j '.slots[0].available')"
check "  and can be booked again" 201 "$(book $REC "$(body $P2 $U1 $S0900)")"
T2=$(ins $P2 "Sevinc $SUR" $U1 $(day -1) 09:00)
check "past, still scheduled → can be cancelled" 200 "$(pat $REC $T2 cancel '{"reason":"Did not come"}')"

echo "Today"
redis_flush_rl
T3=$(ins $P1 "Leyla $SUR" $U3 $(day 0) 21:00)
T4=$(ins $P2 "Sevinc $SUR" $U1 $(day 0) 22:30)
aq "update appointments set doctor_name='Kamran Testov' where id='$T3'" >/dev/null
check "accountant → 403" 403 "$(as $ACC $A/today)"
check "receptionist → today's, in time order" "200|true|true" "$(as $REC $A/today)|$(j "[.[].id] | (index(\"$T3\") < index(\"$T1\")) and (index(\"$T1\") < index(\"$T4\"))")|$(j "[.[].startsAt] == ([.[].startsAt]|sort)")"
check "  nothing from other days" true "$(j "[.[].id] | (index(\"$A2\") == null) and (index(\"$T2\") == null)")"
check "  cancelled ones included (status shown)" '"CANCELLED"' "$(j ".[] | select(.id == \"$T1\") | .status")"
check "doctor U1 → only own" true "$(as $(tok DOCTOR $U1) $A/today >/dev/null; j "all(.[]; .doctorId == \"$U1\") and ([.[].id] | index(\"$T4\") != null)")"
check "doctorId filter" true "$(as $REC "$A/today?doctorId=$U3" >/dev/null; j "all(.[]; .doctorId == \"$U3\") and length >= 1")"
check "departmentId filter" true "$(as $REC "$A/today?departmentId=$CARD" >/dev/null; j 'all(.[]; .departmentCode == "CARD")')"
check "bad departmentId → 400" 400 "$(as $REC "$A/today?departmentId=nope")"

echo "Internal API"
redis_flush_rl
SVC=http://localhost:3004
svc() { # svc <nokey|key> <url> [method] → status, body in $D/body
  local out
  out=$($DC exec -T appointment-service node -e '
    const [mode, url, method] = process.argv.slice(1);
    const headers = mode === "key" ? { "x-internal-key": process.env.INTERNAL_API_KEY } : {};
    fetch(url, { headers, method: method || "GET" }).then(async (r) => process.stdout.write(r.status + "\n" + (await r.text())));
  ' "$1" "$2" "$3")
  echo "$out" | tail -n +2 > $D/body
  echo "$out" | head -1
}
check "without the key → 401" 401 "$(svc nokey "$SVC/internal/appointments/$T4")"
check "not routed by the gateway → 404" 404 "$(as_admin "$API/internal/appointments/$T4")"
check "with the key → 200" "200|\"SCHEDULED\"|\"$U1\"|\"$P2\"" "$(svc key "$SVC/internal/appointments/$T4")|$(j .status)|$(j .doctorId)|$(j .patientId)"
check "unknown → 404" 404 "$(svc key "$SVC/internal/appointments/$(cat /proc/sys/kernel/random/uuid)")"

echo "Calendar"
redis_flush_rl
CAL=$A/calendar
check "accountant → 403" 403 "$(as $ACC "$CAL?from=$D2&to=$D3")"
check "doctor (read) → 200" 200 "$(as $(tok DOCTOR $U1) "$CAL?from=$D2&to=$D3&doctorId=$U1")"
check "U1, day +2..+3 → one doctor, two days" '200|1|2|"09:00"|30' "$(as $REC "$CAL?from=$D2&to=$D3&doctorId=$U1")|$(j '.doctors|length')|$(j '.doctors[0].days|length')|$(j '.doctors[0].days[0].start')|$(j '.doctors[0].days[0].slotMinutes')"
check "  appointments of U1 only, in the range, time order" true "$(j "all(.appointments[]; .doctorId == \"$U1\") and ([.appointments[].startsAt] == ([.appointments[].startsAt]|sort)) and (.appointments|length) >= 2")"
check "  cancelled ones hidden by default" true "$(j "all(.appointments[]; .status != \"CANCELLED\") and ([.appointments[].id] | index(\"$A1\") == null)")"
check "  includeCancelled=true shows them" '"CANCELLED"' "$(as $REC "$CAL?from=$D2&to=$D3&doctorId=$U1&includeCancelled=true" >/dev/null; j ".appointments[] | select(.id == \"$A1\") | .status")"
check "vacation day → reason" '"VACATION"' "$(as $REC "$CAL?from=$(day 5)&to=$(day 5)&doctorId=$U1" >/dev/null; j '.doctors[0].days[0].reason')"
check "department CARD → U1 + U3, not U2 (no department)" "true|false" "$(as $REC "$CAL?from=$D2&to=$D2&departmentId=$CARD" >/dev/null; j "([.doctors[].userId] | index(\"$U1\") != null) and ([.doctors[].userId] | index(\"$U3\") != null)")|$(j "[.doctors[].userId] | index(\"$U2\") != null")"
check "  appointments of the department only" true "$(j 'all(.appointments[]; .departmentCode == "CARD")')"
check "a week (7 days) → 200" 200 "$(as $REC "$CAL?from=$D2&to=$(day 8)&doctorId=$U1")"
check "15 days → 400" 400 "$(as $REC "$CAL?from=$D2&to=$(day 16)")"
check "to before from → 400" 400 "$(as $REC "$CAL?from=$D3&to=$D2")"
check "missing to → 400" 400 "$(as $REC "$CAL?from=$D2")"
check "bad includeCancelled → 400" 400 "$(as $REC "$CAL?from=$D2&to=$D2&includeCancelled=maybe")"

echo "Patient sync"
redis_flush_rl
wait_sql() { # wait_sql <sql returning one value> <expected> → the value (≤ 20 s)
  local v
  for _ in $(seq 1 40); do v=$(aq "$1"); [ "$v" = "$2" ] && break; sleep 0.5; done
  echo "$v"
}
PAST=$(ins $P1 "Leyla $SUR" $U1 $(day -3) 09:00 COMPLETED)
A3=$(aq "select id from appointments where patient_id='$P1' and status='SCHEDULED' and starts_at > now() order by starts_at limit 1")
check "rename the patient → 200" 200 "$(as_admin -X PATCH $API/patients/$P1 -H 'content-type: application/json' -d '{"firstName":"Leylan","phone":"+994 55 999 88 77"}')"
check "  future SCHEDULED snapshot refreshed" "Leylan $SUR|+994 55 999 88 77" "$(wait_sql "select patient_name||'|'||patient_phone from appointments where id='$A3'" "Leylan $SUR|+994 55 999 88 77")"
check "  past appointment keeps the old name" "Leyla $SUR" "$(aq "select patient_name from appointments where id='$PAST'")"
check "  no appointment event for it" 0 "$(aq "select count(*) from outbox_events where aggregate_id='$A3' and event_type='appointment.updated' and occurred_at > now() - interval '1 minute'")"
check "a non-snapshot field (notes) → nothing changes" 200 "$(as_admin -X PATCH $API/patients/$P1 -H 'content-type: application/json' -d '{"notes":"x"}')"
P2FUT=$(aq "select count(*) from appointments where patient_id='$P2' and status='SCHEDULED' and starts_at > now()")
check "deactivate a patient with future visits → 200" "200|true" "$(as_admin -X PATCH $API/patients/$P2/deactivate)|$([ "$P2FUT" -gt 0 ] && echo true)"
check "  future visits cancelled by the system" "0" "$(wait_sql "select count(*) from appointments where patient_id='$P2' and status='SCHEDULED' and starts_at > now()" 0)"
check "  reason code, no person" "PATIENT_DEACTIVATED||" "$(aq "select cancellation_reason||'|'||coalesce(cancelled_by::text,'')||'|'||coalesce(cancelled_by_name,'') from appointments where patient_id='$P2' and status='CANCELLED' and cancellation_reason='PATIENT_DEACTIVATED' limit 1")"
check "  events: no patient email, system actor" "$P2FUT|false|null" "$(aq "select count(*) from outbox_events o join appointments a on a.id=o.aggregate_id where a.patient_id='$P2' and o.payload->'payload'->>'reason'='PATIENT_DEACTIVATED'")|$(aq "select o.payload->'payload'->>'notifyPatient' from outbox_events o join appointments a on a.id=o.aggregate_id where a.patient_id='$P2' and o.payload->'payload'->>'reason'='PATIENT_DEACTIVATED' limit 1")|$(aq "select coalesce(o.payload->>'actor','null') from outbox_events o join appointments a on a.id=o.aggregate_id where a.patient_id='$P2' and o.payload->'payload'->>'reason'='PATIENT_DEACTIVATED' limit 1")"
as_admin -X PATCH $API/patients/$P2/reactivate >/dev/null
check "  reactivating does not bring them back" "0" "$(aq "select count(*) from appointments where patient_id='$P2' and status='SCHEDULED' and starts_at > now()")"

echo "Reminder job"
redis_flush_rl
R9=$(at $D3 09:30)
check "book day +3 09:30 → 201" 201 "$(book $REC "$(body $P1 $U1 $R9)")"
R1=$(j .id | tr -d '"')
expect_delay() { echo $(( ($(date -d "$1" +%s) - 86400 - $(date +%s)) * 1000 )); } # startsAt − 24 h − now, ms
near() { [ $(( $1 > $2 ? $1 - $2 : $2 - $1 )) -lt 90000 ] && echo near || echo "off($1 vs $2)"; }
check "  reminder planned at start − 24 h" "200|true|near" "$(svc key "$SVC/internal/jobs/reminders/$R1")|$(j .planned)|$(near $(j .delayMs) $(expect_delay $R9))"
R10=$(at $D3 10:30)
pat $REC $R1 reschedule "{\"startsAt\":\"$R10\"}" >/dev/null
check "  moved with the reschedule" "true|near" "$(svc key "$SVC/internal/jobs/reminders/$R1" >/dev/null; j .planned)|$(near $(j .delayMs) $(expect_delay $R10))"
check "run it now → sent" '200|true' "$(svc key "$SVC/internal/jobs/reminders/$R1/run" POST)|$(j .sent)"
check "  event appointment.reminder_due, system actor" "1|null" "$(events $R1 appointment.reminder_due)|$(aq "select coalesce(payload->>'actor','null') from outbox_events where aggregate_id='$R1' and event_type='appointment.reminder_due'")"
check "  again → not sent twice" '200|false|1' "$(svc key "$SVC/internal/jobs/reminders/$R1/run" POST)|$(j .sent)|$(events $R1 appointment.reminder_due)"
sleep 3
check "  not in the action history" 0 "$(hq "select count(*) from action_history where entity_id='$R1' and event_type='appointment.reminder_due'")"
pat $REC $R1 reschedule "{\"startsAt\":\"$R9\"}" >/dev/null
check "rescheduled → reminder due again" "true|true" "$(svc key "$SVC/internal/jobs/reminders/$R1" >/dev/null; j .planned)|$(svc key "$SVC/internal/jobs/reminders/$R1/run" POST >/dev/null; j .sent)"
pat $REC $R1 cancel '{"reason":"test"}' >/dev/null
check "cancelled → reminder removed, not sent" "false|false" "$(svc key "$SVC/internal/jobs/reminders/$R1" >/dev/null; j .planned)|$(svc key "$SVC/internal/jobs/reminders/$R1/run" POST >/dev/null; j .sent)"
check "jobs without the key → 401" 401 "$(svc nokey "$SVC/internal/jobs/no-show-sweep" POST)"

echo "No-show sweep"
redis_flush_rl
NS=$(ins $P1 "Leylan $SUR" $U1 $(day -1) 10:00)
check "sweep → marks the old scheduled visit" "200|true" "$(svc key "$SVC/internal/jobs/no-show-sweep" POST)|$(j '.marked >= 1')"
check "  NO_SHOW + event with system actor" "NO_SHOW|1|null" "$(aq "select status from appointments where id='$NS'")|$(events $NS appointment.no_show)|$(aq "select coalesce(payload->>'actor','null') from outbox_events where aggregate_id='$NS' and event_type='appointment.no_show'")"
check "  history (System)" "appointment.noShow|" "$(wait_history appointment.noShow $NS)|$(hq "select coalesce(actor_name,'') from action_history where summary_key='appointment.noShow' and entity_id='$NS'")"
check "  future visits untouched" SCHEDULED "$(aq "select status from appointments where id='$A3'")"
check "  second sweep → not marked again" "1" "$(svc key "$SVC/internal/jobs/no-show-sweep" POST >/dev/null; events $NS appointment.no_show)"
check "  the no-show slot can be booked again (SQL)" 1 "$(aq "select count(*) from (select 1) x where '$(ins $P2 "Sevinc $SUR" $U1 $(day -1) 10:00 COMPLETED)' <> ''")"

echo "Notifications + emails"
redis_flush_rl
nq() { hq "$1"; }
wait_notif() { # wait_notif <recipient> <type> <entity> → count (≤ 20 s)
  local c
  for _ in $(seq 1 40); do c=$(nq "select count(*) from notifications where recipient_id='$1' and type='$2' and entity_id='$3'"); [ "$c" -gt 0 ] && break; sleep 0.5; done
  echo "$c"
}
wait_mail() { # wait_mail <template> <entity startsAt-free key: event aggregate> → status of the email_logs row (≤ 30 s)
  local v
  for _ in $(seq 1 60); do v=$(nq "select status from email_logs where template='$1' and recipient_email='$2' order by created_at desc limit 1"); [ "$v" = SENT ] && break; sleep 0.5; done
  echo "$v"
}
MAIL1="leyla.$TAG@mail.test"
node scripts/lib/socket-listen.mjs http://localhost:3000 "$REC" 14 > $D/sock 2>&1 &
SOCK=$!
sleep 1.5
N9=$(at $(day 4) 09:00)
check "book → 201" 201 "$(book $REC "$(body $P1 $U3 $N9 ',"type":"FOLLOW_UP"')")"
N1=$(j .id | tr -d '"')
check "  doctor U3 notified (APPOINTMENT_BOOKED)" 1 "$(wait_notif $U3 APPOINTMENT_BOOKED $N1)"
check "  params for the translated text, no contacts" "Leylan $SUR|$(echo $N9 | sed 's/Z$//')|false" "$(nq "select (params->>'name')||'|'||replace(params->>'startsAt','.000Z','')||'|'||(params::text like '%@%') from notifications where entity_id='$N1' and type='APPOINTMENT_BOOKED'")"
check "  link opens the day with the drawer" "/appointments?view=day&date=$(day 4)&open=$N1" "$(nq "select link from notifications where entity_id='$N1' and type='APPOINTMENT_BOOKED'")"
check "  confirmation email to the patient (az)" "SENT" "$(wait_mail appointment-booked $MAIL1)"
MID=$(curl -s -G "$MAILPIT/search" --data-urlencode "query=to:$MAIL1" --data-urlencode limit=1 | grep -o '"ID":"[^"]*"' | head -1 | cut -d'"' -f4)
check "  email text: greeting, doctor, clinic time" "true|true|true" "$(curl -s "$MAILPIT/message/$MID" > $D/mail; jq -r '.HTML | contains("Hörmətli")' $D/mail)|$(jq -r '.HTML | contains("Kamran Testov")' $D/mail)|$(jq -r ".HTML | contains(\"saat 09:00\")" $D/mail)"
check "  az footer" true "$(jq -r '.HTML | contains("avtomatik məktubudur")' $D/mail)"
SELF=$(tok ADMIN $U3)
check "booking by the doctor themself (admin token) → no notification for them" "201|0" "$(book $SELF "$(body $P1 $U3 $(at $(day 4) 10:00))")|$(sleep 3; nq "select count(*) from notifications where recipient_id='$U3' and entity_id='$(j .id | tr -d '"')'")"
pat $REC $N1 reschedule "{\"startsAt\":\"$(at $(day 4) 11:00)\",\"doctorId\":\"$U1\"}" >/dev/null
check "moved to another doctor → old one APPOINTMENT_MOVED_AWAY, new one BOOKED" "1|1" "$(wait_notif $U3 APPOINTMENT_MOVED_AWAY $N1)|$(wait_notif $U1 APPOINTMENT_BOOKED $N1)"
check "  reschedule email" SENT "$(wait_mail appointment-rescheduled $MAIL1)"
pat $REC $N1 reschedule "{\"startsAt\":\"$(at $(day 4) 11:30)\"}" >/dev/null
check "moved in time → APPOINTMENT_RESCHEDULED with the previous time" "1|t" "$(wait_notif $U1 APPOINTMENT_RESCHEDULED $N1)|$(nq "select (params->>'previousStartsAt') is not null from notifications where entity_id='$N1' and type='APPOINTMENT_RESCHEDULED'")"
pat $REC $N1 cancel '{"reason":"Called to cancel"}' >/dev/null
check "cancelled → APPOINTMENT_CANCELLED + email" "1|SENT" "$(wait_notif $U1 APPOINTMENT_CANCELLED $N1)|$(wait_mail appointment-cancelled $MAIL1)"
check "  the cancel reason is not in the email" false "$(sleep 1; MID=$(curl -s -G "$MAILPIT/search" --data-urlencode "query=to:$MAIL1" --data-urlencode limit=1 | grep -o '"ID":"[^"]*"' | head -1 | cut -d'"' -f4); curl -s "$MAILPIT/message/$MID" | jq -r '.HTML | contains("Called to cancel")')"
check "system cancellation (patient deactivated) → no email" 0 "$(nq "select count(*) from email_logs where template='appointment-cancelled' and recipient_email='sevinc.$TAG@mail.test'")"
SYSC=$(aq "select id from appointments where cancellation_reason='PATIENT_DEACTIVATED' and patient_id='$P2' limit 1")
check "  but the doctor was told" 1 "$(nq "select count(*) from notifications where type='APPOINTMENT_CANCELLED' and entity_id='$SYSC'")"
check "reminder email (job run earlier)" SENT "$(wait_mail appointment-reminder $MAIL1)"
CI=$(ins $P1 "Leylan $SUR" $U3 $(day 0) 23:00)
pat $NUR $CI check-in >/dev/null
check "check-in → urgent APPOINTMENT_CHECKED_IN for the doctor" "1|t" "$(wait_notif $U3 APPOINTMENT_CHECKED_IN $CI)|$(nq "select is_urgent from notifications where entity_id='$CI' and type='APPOINTMENT_CHECKED_IN'")"
check "no-show → APPOINTMENT_NO_SHOW for the doctor" 1 "$(wait_notif $U1 APPOINTMENT_NO_SHOW $NS)"
wait $SOCK 2>/dev/null
check "socket: front desk got appointments:changed for that day" true "$(grep '"appointments:changed"' $D/sock | grep -q "$(day 4)" && echo true)"
ACCT=$(tok ACCOUNTANT)
node scripts/lib/socket-listen.mjs http://localhost:3000 "$ACCT" 6 > $D/sock2 2>&1 &
SOCK2=$!
sleep 1.5
book $REC "$(body $P1 $U3 $(at $(day 4) 12:00))" >/dev/null
wait $SOCK2 2>/dev/null
check "  an accountant (no appointments.read) gets nothing" "true|0" "$(grep -q '"connect"' $D/sock2 && echo true)|$(grep -c 'appointments:changed' $D/sock2)"

echo "Stats"
redis_flush_rl
ST=$A/stats
check "overview: doctor → 403" 403 "$(as $(tok DOCTOR $U1) $ST/overview)"
check "overview: receptionist → 403" 403 "$(as $REC $ST/overview)"
check "doctor stats: admin → 403" 403 "$(as $ADM $ST/doctor)"
check "overview: admin, default last 30 days" "200|30|\"$(day 0)\"" "$(as $ADM $ST/overview)|$(j '.daily|length')|$(j .to)"
check "  shape" '["byStatus","daily","departments","doctors","from","noShowRate","to","total"]' "$(j keys)"
# A quiet past range: snapshot, add known rows, compare the difference
SF=$(day -45); STO=$(day -44)
as $ADM "$ST/overview?from=$SF&to=$STO" >/dev/null; cp $D/body $D/s1
for x in "COMPLETED 09:00 $SF" "COMPLETED 09:30 $SF" "NO_SHOW 10:00 $SF" "CANCELLED 10:30 $STO" "COMPLETED 11:00 $STO"; do set -- $x; ins $P1 "Leylan $SUR" $U1 $3 $2 $1 >/dev/null; done
as $ADM "$ST/overview?from=$SF&to=$STO" >/dev/null; cp $D/body $D/s2
sd() { echo $(( $(jq "(.data // .) | $1" $D/s2) - $(jq "(.data // .) | $1" $D/s1) )); }
check "  +5 total, by status 3 / 1 / 1" "5|3|1|1" "$(sd .total)|$(sd .byStatus.COMPLETED)|$(sd .byStatus.NO_SHOW)|$(sd .byStatus.CANCELLED)"
check "  per day (cancelled kept in its status)" "3|1|1|1" "$(sd '.daily[0].COMPLETED + .daily[0].NO_SHOW')|$(sd '.daily[1].COMPLETED')|$(sd '.daily[1].CANCELLED')|$(sd '.daily[0].NO_SHOW')"
check "  departments / doctors count without cancelled" "4|4" "$(sd "([.departments[] | select(.code == \"CARD\") | .count] | add // 0)")|$(sd "([.doctors[] | select(.doctorId == \"$U1\") | .count] | add // 0)")"
check "  no-show rate = no-show / (completed + no-show)" true "$(jq -r '(.data // .) | .noShowRate == ((.byStatus.NO_SHOW / (.byStatus.COMPLETED + .byStatus.NO_SHOW) * 1000 | round) / 10)' $D/s2)"
check "  to before from → 400" 400 "$(as $ADM "$ST/overview?from=$STO&to=$SF")"
check "  more than 366 days → 400" 400 "$(as $ADM "$ST/overview?from=$(day -400)&to=$(day 0)")"
check "  bad date → 400" 400 "$(as $ADM "$ST/overview?from=2026-13-01")"
DT=$(tok DOCTOR $U1)
as $DT $ST/doctor >/dev/null; cp $D/body $D/d1
check "doctor stats: shape, 14 days ending today" "[\"daily\",\"next7Days\",\"noShowRate\",\"thisWeek\",\"today\",\"weeklyAverage\"]|14|\"$(day 0)\"" "$(jq -c '(.data // .) | keys' $D/d1)|$(jq '(.data // .) | .daily|length' $D/d1)|$(jq -c '(.data // .) | .daily[-1].date' $D/d1)"
ins $P1 "Leylan $SUR" $U1 $(day 0) 23:30 >/dev/null
as $DT $ST/doctor >/dev/null; cp $D/body $D/d2
dd2() { echo $(( $(jq "(.data // .) | $1" $D/d2) - $(jq "(.data // .) | $1" $D/d1) )); }
check "  a visit today → today +1, this week +1, last day +1" "1|1|1" "$(dd2 .today)|$(dd2 .thisWeek)|$(dd2 '.daily[-1].count')"
EXP=$(aq "select case when sum(case when status in ('COMPLETED','NO_SHOW') then 1 else 0 end) = 0 then 'null' else trim(to_char(round(100.0 * sum(case when status='NO_SHOW' then 1 else 0 end) / sum(case when status in ('COMPLETED','NO_SHOW') then 1 else 0 end), 1), 'FM990.0')) end from appointments where doctor_id='$U1' and starts_at >= '$(at $(day -89) 00:00)' and starts_at < '$(at $(day 1) 00:00)'")
check "  own no-show rate (last 90 days)" "$EXP" "$(jq -r '(.data // .) | .noShowRate | if . == null then "null" else (. * 10 | round / 10 | tostring | if test("\\.") then . else . + ".0" end) end' $D/d2)"
check "  only their own appointments" "0" "$(as $(tok DOCTOR $(cat /proc/sys/kernel/random/uuid)) $ST/doctor >/dev/null; j '.today + .thisWeek + ([.daily[].count] | add)')"

echo "Staff service down"
$DC stop staff-service >/dev/null 2>&1
check "availability → 503 naming the service" '503|"SERVICE_UNAVAILABLE"|"staff-service"' "$(as $REC "$AV?doctorId=$U1&date=$D3")|$(j .error.code)|$(j .error.details.service)"
check "calendar → 503" 503 "$(as $REC "$A/calendar?from=$D3&to=$D3")"
check "booking → 503, nothing saved" "503|0" "$(book $REC "$(body $P2 $U1 $(at $D3 09:00))")|$(aq "select count(*) from appointments where doctor_id='$U1' and starts_at='$(at $D3 09:00)'")"
$DC start staff-service >/dev/null 2>&1
for _ in $(seq 1 60); do [ "$($DC ps staff-service --format '{{.Health}}')" = healthy ] && break; sleep 1; done
check "staff-service back → 200" 200 "$(as $REC "$AV?doctorId=$U1&date=$D3")"

cleanup
aq "delete from outbox_events where aggregate_id in (select id from appointments where doctor_id in ('$U1','$U2','$U3'))" >/dev/null
aq "delete from appointments where doctor_id in ('$U1','$U2','$U3')" >/dev/null
sq "delete from staff_members where user_id in ('$U1','$U2','$U3')" >/dev/null
q auth_db "delete from users where id in ('$U1','$U2','$U3')" >/dev/null
rm -rf $D
echo
echo "PASS $PASS  FAIL $FAIL"
[ $FAIL -eq 0 ]
