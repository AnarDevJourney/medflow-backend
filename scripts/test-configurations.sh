#!/bin/bash
# End-to-end checks of configurations-service (sidebar, table and theme settings)
# through the gateway: defaults, partial upserts, validation, atomic
# page-visit counters, per-user isolation, table reset.
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-configurations.sh
# Deletes the sidebar / table / theme settings rows of the dev admin and of
# a throw-away user.
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

echo "Table settings"
T_URL=http://localhost:3000/api/v1/configurations/tables
tpatch() { as_admin -X PATCH $T_URL/$1 -H 'content-type: application/json' -d "$2"; }
q "delete from table_settings where user_id='$ADMIN'" >/dev/null
check "GET unknown table → defaults" '200|{"tableKey":"patients","columns":null,"density":null,"view":null,"updatedAt":null}' "$(as_admin $T_URL/patients)|$(j .)"
check "  GET creates no row" 0 "$(q "select count(*) from table_settings where user_id='$ADMIN'")"
check "bad table key → 400" 400 "$(as_admin $T_URL/Bad_Key)"
COLS='[{"key":"mrn","visible":true,"width":120,"pinned":"left"},{"key":"lastName","visible":true,"width":null,"pinned":null},{"key":"createdAt","visible":false,"width":160,"pinned":"right"}]'
check "PATCH columns" '200|3|"left"|null' "$(tpatch patients "{\"columns\":$COLS}")|$(j '.columns|length')|$(j '.columns[0].pinned')|$(j '.columns[1].width')"
check "PATCH density keeps columns" '200|"compact"|3' "$(tpatch patients '{"density":"compact"}')|$(j .density)|$(j '.columns|length')"
check "PATCH view" '200|"striped"' "$(tpatch patients '{"view":"striped"}')|$(j .view)"
check "other table independent" '200|null|"comfortable"' "$(tpatch invoices '{"density":"comfortable"}')|$(j .columns)|$(j .density)"
check "  patients unchanged" '"compact"|"striped"' "$(as_admin $T_URL/patients >/dev/null; j .density)|$(j .view)"
check "density: null → default" '200|null|"striped"' "$(tpatch patients '{"density":null}')|$(j .density)|$(j .view)"
check "  SQL NULL" t "$(q "select density is null from table_settings where user_id='$ADMIN' and table_key='patients'")"
check "duplicate column key → 400" '400|"columns"' "$(tpatch patients '{"columns":[{"key":"a","visible":true,"width":null,"pinned":null},{"key":"a","visible":false,"width":null,"pinned":null}]}')|$(j '.error.details[0].field')"
check "width < 40 → 400" 400 "$(tpatch patients '{"columns":[{"key":"a","visible":true,"width":20,"pinned":null}]}')"
check "width not integer → 400" 400 "$(tpatch patients '{"columns":[{"key":"a","visible":true,"width":"120","pinned":null}]}')"
check "pinned: middle → 400" 400 "$(tpatch patients '{"columns":[{"key":"a","visible":true,"width":null,"pinned":"middle"}]}')"
check "visible: \"no\" → 400" 400 "$(tpatch patients '{"columns":[{"key":"a","visible":"no","width":null,"pinned":null}]}')"
check "density: dense → 400" 400 "$(tpatch patients '{"density":"dense"}')"
check "bad column key → 400" 400 "$(tpatch patients '{"columns":[{"key":"a b","visible":true,"width":null,"pinned":null}]}')"
check "unknown field → 400" 400 "$(tpatch patients '{"pageSize":50}')"
check "nothing changed by bad requests" '3|"striped"' "$(as_admin $T_URL/patients >/dev/null; j '.columns|length')|$(j .view)"
check "DELETE → 204 (reset)" 204 "$(as_admin -X DELETE $T_URL/patients)"
check "  back to defaults, row gone" 'null|null|0' "$(as_admin $T_URL/patients >/dev/null; j .columns)|$(j .updatedAt)|$(q "select count(*) from table_settings where user_id='$ADMIN' and table_key='patients'")"
check "  other table kept" '"comfortable"' "$(as_admin $T_URL/invoices >/dev/null; j .density)"
check "DELETE of unsaved table → 204" 204 "$(as_admin -X DELETE $T_URL/never-saved)"
q "insert into table_settings (user_id, table_key) select '$ADMIN', 't' || i from generate_series(1, 199) i" >/dev/null
check "201st table → 422 BUSINESS_RULE" '422|"BUSINESS_RULE"' "$(tpatch one-too-many '{"density":"compact"}')|$(j .error.code)"
check "  existing table still updatable" 200 "$(tpatch invoices '{"density":"compact"}')"
q "delete from table_settings where user_id='$ADMIN'" >/dev/null

echo "Theme settings"
TH=http://localhost:3000/api/v1/configurations/theme
thpatch() { as_admin -X PATCH $TH -H 'content-type: application/json' -d "$1"; }
q "delete from theme_settings where user_id='$ADMIN'" >/dev/null
check "GET → defaults" '200|{"mode":null,"palette":null,"primaryColor":null,"sidebarStyle":null,"density":null,"motion":null,"updatedAt":null}' "$(as_admin $TH)|$(j .)"
check "  GET creates no row" 0 "$(q "select count(*) from theme_settings where user_id='$ADMIN'")"
check "PATCH mode + palette" '200|"dark"|"slate"|null' "$(thpatch '{"mode":"dark","palette":"slate"}')|$(j .mode)|$(j .palette)|$(j .density)"
check "primaryColor stored lowercase" '200|"#2563eb"' "$(thpatch '{"primaryColor":"#2563EB"}')|$(j .primaryColor)"
check "PATCH the rest keeps earlier fields" '200|"tinted"|"spacious"|"reduced"|"dark"|"#2563eb"' "$(thpatch '{"sidebarStyle":"tinted","density":"spacious","motion":"reduced"}')|$(j .sidebarStyle)|$(j .density)|$(j .motion)|$(j .mode)|$(j .primaryColor)"
check "null → default" '200|null|"slate"' "$(thpatch '{"mode":null}')|$(j .mode)|$(j .palette)"
check "  SQL NULL" t "$(q "select mode is null from theme_settings where user_id='$ADMIN'")"
check "mode: sepia → 400" 400 "$(thpatch '{"mode":"sepia"}')"
check "primaryColor: red → 400" 400 "$(thpatch '{"primaryColor":"red"}')"
check "primaryColor: #fff → 400" 400 "$(thpatch '{"primaryColor":"#fff"}')"
check "density: huge → 400" 400 "$(thpatch '{"density":"huge"}')"
check "motion: off → 400" 400 "$(thpatch '{"motion":"off"}')"
check "palette: Bad Name → 400" 400 "$(thpatch '{"palette":"Bad Name"}')"
check "unknown field → 400" 400 "$(thpatch '{"fontSize":16}')"
check "nothing changed by bad requests" '"slate"|"#2563eb"|"spacious"' "$(as_admin $TH >/dev/null; j .palette)|$(j .primaryColor)|$(j .density)"
check "DELETE → 204 (reset)" 204 "$(as_admin -X DELETE $TH)"
check "  back to defaults, row gone" 'null|null|0' "$(as_admin $TH >/dev/null; j .palette)|$(j .updatedAt)|$(q "select count(*) from theme_settings where user_id='$ADMIN'")"
check "other user's theme separate" '200|null' "$(thpatch '{"palette":"warm"}' >/dev/null; code -b "access_token=$(node scripts/lib/sign-token.mjs "$SECRET" $(cat /proc/sys/kernel/random/uuid) DOCTOR 60)" $TH)|$(j .palette)"
q "delete from theme_settings where user_id='$ADMIN'" >/dev/null

rm -rf $D
echo
echo "Passed: $PASS, failed: $FAIL"
[ $FAIL -eq 0 ]
