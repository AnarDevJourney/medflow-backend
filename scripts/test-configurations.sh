#!/bin/bash
# End-to-end checks of configurations-service (sidebar settings) through the
# gateway: defaults, partial upserts, validation, atomic page-visit counters,
# per-user isolation.
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-configurations.sh
# Deletes the sidebar_settings rows of the dev admin and of a throw-away user.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
G=http://localhost:3000/api/v1/configurations/sidebar
D=$(mktemp -d)
DC="docker compose"
PASS=0; FAIL=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1 (expected $2, got $3)"; FAIL=$((FAIL+1)); fi
}
code() { curl -s -o $D/body -w '%{http_code}' "$@"; }
as_admin() { code -b $D/admin "$@"; }
patch() { as_admin -X PATCH $G -H 'content-type: application/json' -d "$1"; }
visit() { as_admin -X POST $G/visits -H 'content-type: application/json' -d "{\"pageKey\":\"$1\"}"; }
j() { jq -c "(.data // .) | $1" $D/body; } # jq filter on data (or the error body) of the last response
q() { $DC exec -T postgres psql -U medflow -d configurations_db -tAc "$1"; }
redis_flush_rl() { $DC exec -T redis sh -c "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli del" >/dev/null; }

echo "Setup"
redis_flush_rl
check "configurations-service in gateway health" '"up"' \
  "$(curl -s localhost:3000/api/v1/health | jq -c '.data.checks["configurations-service"].status')"
check "admin login" 200 "$(code -c $D/admin -X POST localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' -d '{"email":"admin@medflow.az","password":"Admin12345"}')"
ADMIN=$(curl -s -b $D/admin localhost:3000/api/v1/auth/me | jq -r .data.id)
q "delete from sidebar_settings where user_id='$ADMIN'" >/dev/null

echo "Auth"
check "no cookie → 401" 401 "$(code $G)"

echo "Defaults (no row yet)"
check "GET → 200" 200 "$(as_admin $G)"
check "  defaults" '{"collapsed":false,"groups":null,"favorites":[],"showFrequent":true,"showRecent":true,"pageVisits":{},"updatedAt":null}' "$(j .)"
check "  GET creates no row" 0 "$(q "select count(*) from sidebar_settings where user_id='$ADMIN'")"

echo "Partial upserts"
check "PATCH collapsed → 200" 200 "$(patch '{"collapsed":true}')"
check "  collapsed true, rest default" 'true|null|[]|true' "$(j '[.collapsed,.groups,.favorites,.showRecent]|map(tostring)|join("|")' | tr -d '"')"
check "  updatedAt set" true "$(j '.updatedAt != null')"
check "PATCH favorites" 200 "$(patch '{"favorites":["patients","invoices"]}')"
check "  favorites saved, collapsed kept" '["patients","invoices"]|true' "$(j .favorites)|$(j .collapsed)"
LAYOUT='[{"id":"clinical","name":null,"collapsed":false,"items":["patients","appointments"]},{"id":"g-mine","name":"  Mənim işim  ","collapsed":true,"items":["invoices"]}]'
check "PATCH groups" 200 "$(patch "{\"groups\":$LAYOUT,\"showFrequent\":false}")"
check "  groups saved, name trimmed" '"Mənim işim"|2|false' "$(j '.groups[1].name')|$(j '.groups|length')|$(j .showFrequent)"
check "  jsonb array in DB" array "$(q "select jsonb_typeof(groups) from sidebar_settings where user_id='$ADMIN'")"
check "empty PATCH → current settings" '200|["patients","invoices"]' "$(patch '{}')|$(j .favorites)"
check "groups: null → back to default" '200|null' "$(patch '{"groups":null}')|$(j .groups)"
check "  SQL NULL, not JSON null" t "$(q "select groups is null from sidebar_settings where user_id='$ADMIN'")"
check "  one row per user" 1 "$(q "select count(*) from sidebar_settings where user_id='$ADMIN'")"

echo "Validation"
dup_page='{"groups":[{"id":"a","name":null,"collapsed":false,"items":["patients"]},{"id":"b","name":null,"collapsed":false,"items":["patients"]}]}'
check "page in two groups → 400" '400|"VALIDATION_ERROR"|"groups"' "$(patch "$dup_page")|$(j .error.code)|$(j '.error.details[0].field')"
dup_id='{"groups":[{"id":"a","name":null,"collapsed":false,"items":[]},{"id":"a","name":null,"collapsed":false,"items":[]}]}'
check "duplicate group id → 400" 400 "$(patch "$dup_id")"
check "bad page key → 400" 400 "$(patch '{"favorites":["Patients!"]}')"
check "duplicate favorite → 400" 400 "$(patch '{"favorites":["patients","patients"]}')"
check "unknown field → 400" 400 "$(patch '{"theme":"dark"}')"
check "group without collapsed → 400" 400 "$(patch '{"groups":[{"id":"a","name":null,"items":[]}]}')"
check "group name > 40 chars → 400" 400 "$(patch "{\"groups\":[{\"id\":\"a\",\"name\":\"$(printf 'x%.0s' {1..41})\",\"collapsed\":false,\"items\":[]}]}")"
check "empty group name → 400" 400 "$(patch '{"groups":[{"id":"a","name":"   ","collapsed":false,"items":[]}]}')"
check "collapsed: \"yes\" → 400" 400 "$(patch '{"collapsed":"yes"}')"
check "nothing changed by bad requests" '["patients","invoices"]|null' "$(as_admin $G >/dev/null; j .favorites)|$(j .groups)"

echo "Page visits"
UPDATED=$(q "select updated_at from sidebar_settings where user_id='$ADMIN'")
for _ in $(seq 1 20); do visit patients >/dev/null & done; wait
check "20 parallel visits → all counted" 20 "$(as_admin $G >/dev/null; j '.pageVisits.patients.count')"
check "visit → 204" 204 "$(visit invoices)"
check "  two pages tracked" '["invoices","patients"]' "$(as_admin $G >/dev/null; j '.pageVisits|keys')"
check "  lastVisitedAt is a timestamp" true "$(j '.pageVisits.invoices.lastVisitedAt|test("^20[0-9]{2}-")')"
check "  visits don't touch updated_at" "$UPDATED" "$(q "select updated_at from sidebar_settings where user_id='$ADMIN'")"
check "bad page key → 400" 400 "$(visit 'x y')"
check "first visit creates the row" 204 "$(q "delete from sidebar_settings where user_id='$ADMIN'" >/dev/null; visit staff)"
check "  row with defaults + 1 visit" 'false|1' "$(as_admin $G >/dev/null; j .collapsed)|$(j .pageVisits.staff.count)"
# Cap: at most 100 distinct pages per user
q "update sidebar_settings set page_visits = (select jsonb_object_agg('p' || i, jsonb_build_object('count', 1, 'lastVisitedAt', now())) from generate_series(1, 100) i) where user_id='$ADMIN'" >/dev/null
visit p-new >/dev/null; visit p1 >/dev/null
check "101st page ignored, known page still counted" '100|null|2' "$(as_admin $G >/dev/null; j '.pageVisits|length')|$(j '.pageVisits["p-new"]')|$(j .pageVisits.p1.count)"
patch '{"favorites":["patients"]}' >/dev/null
check "DELETE visits → 204" 204 "$(as_admin -X DELETE $G/visits)"
check "  visits empty, layout kept" '{}|["patients"]' "$(as_admin $G >/dev/null; j .pageVisits)|$(j .favorites)"

echo "Isolation"
SECRET=$(grep '^JWT_ACCESS_SECRET=' .env | cut -d= -f2)
OTHER=$(cat /proc/sys/kernel/random/uuid)
T=$(node scripts/lib/sign-token.mjs "$SECRET" $OTHER NURSE 60)
check "other user sees defaults" '200|[]' "$(code -b "access_token=$T" $G)|$(j .favorites)"
code -b "access_token=$T" -X PATCH $G -H 'content-type: application/json' -d '{"favorites":["lab-queue"],"collapsed":true}' >/dev/null
check "  their change saved for them" '["lab-queue"]' "$(code -b "access_token=$T" $G >/dev/null; j .favorites)"
check "  admin's settings untouched" '["patients"]|false' "$(as_admin $G >/dev/null; j .favorites)|$(j .collapsed)"
q "delete from sidebar_settings where user_id='$OTHER'" >/dev/null

rm -rf $D
echo
echo "Passed: $PASS, failed: $FAIL"
[ $FAIL -eq 0 ]
