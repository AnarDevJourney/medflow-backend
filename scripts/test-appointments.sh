#!/bin/bash
# End-to-end checks of appointment-service through the gateway.
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
check "  fields" '["cancellationReason","cancelledAt","checkedInAt","completedAt","createdAt","departmentCode","departmentId","departmentName","doctorId","doctorName","encounterId","endsAt","id","notes","patientEmail","patientId","patientMrn","patientName","patientPhone","reason","startedAt","startsAt","status","type","updatedAt"]' "$(j keys)"
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

echo "Staff service down"
$DC stop staff-service >/dev/null 2>&1
check "availability → 503 naming the service" '503|"SERVICE_UNAVAILABLE"|"staff-service"' "$(as $REC "$AV?doctorId=$U1&date=$D3")|$(j .error.code)|$(j .error.details.service)"
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
