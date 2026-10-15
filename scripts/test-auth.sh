#!/bin/bash
# Phase 2 end-to-end checks of auth through the gateway (55 checks).
# Needs the Docker stack: ./scripts/run-all.sh, then ./scripts/test-auth.sh
# Reads invite/reset links from the auth-service logs (LOG_AUTH_LINKS=true).
cd "$(dirname "${BASH_SOURCE[0]}")/.."
G=http://localhost:3000/api/v1
D=$(mktemp -d)
DC="docker compose"
PASS=0; FAIL=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1 (expected $2, got $3)"; FAIL=$((FAIL+1)); fi
}
code() { curl -s -o $D/body -w '%{http_code}' "$@"; }
tok() { awk -v n=$2 '$6==n{print $7}' $1; }
json() { curl -s "$@"; }
login() { code -c $1 -X POST $G/auth/login -H 'content-type: application/json' -d "{\"email\":\"$2\",\"password\":\"$3\"}"; }
psql() { $DC exec -T postgres psql -U medflow -d auth_db -tAc "$1"; }
redis_flush_rl() { $DC exec -T redis sh -c "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli del" >/dev/null; }
lastlink() { # waits until a link different from $2 shows up (docker logs lag a bit)
  local t; for _ in $(seq 1 20); do
    t=$($DC logs auth-service 2>&1 | grep "$1" | tail -1 | grep -o 'token=[A-Za-z0-9_-]*' | cut -d= -f2)
    [ -n "$t" ] && [ "$t" != "$2" ] && { echo $t; return; }; sleep 0.2; done; echo "$t"; }
SUF=$RANDOM
START=$(psql "select now()")
redis_flush_rl

echo "== Login / me"
check "login admin" 200 $(login $D/a.jar admin@medflow.az Admin12345)
check "me" 200 $(code -b $D/a.jar $G/auth/me)
check "me without cookie" 401 $(code $G/auth/me)
check "garbage token" 401 $(code -H 'cookie: access_token=abc.def.ghi' $G/auth/me)

echo "== Refresh rotation + reuse detection"
OLD_R=$(tok $D/a.jar refresh_token)
check "refresh" 200 $(code -b $D/a.jar -c $D/a.jar -X POST $G/auth/refresh)
check "old refresh replayed → reuse" 401 $(code -H "cookie: refresh_token=$OLD_R" -X POST $G/auth/refresh)
check "new refresh of the family dead" 401 $(code -b $D/a.jar -X POST $G/auth/refresh)
check "access from before reuse dead" 401 $(code -b $D/a.jar $G/auth/me)
check "only one session_revoked event" 1 $(psql "select count(*) from outbox_events where event_type='user.session_revoked' and occurred_at > '$START'")
check "fresh login after reuse works" 200 $(login $D/a.jar admin@medflow.az Admin12345)
check "me with fresh token" 200 $(code -b $D/a.jar $G/auth/me)

echo "== Logout blocks the stolen access token (user's change)"
STOLEN=$(tok $D/a.jar access_token)
check "logout" 200 $(code -b $D/a.jar -c $D/a.jar -X POST $G/auth/logout)
check "stolen access token after logout" 401 $(code -H "cookie: access_token=$STOLEN" $G/auth/me)
TTL=$($DC exec -T redis redis-cli --scan --pattern 'auth:blocked-jti:*' | head -1 | xargs -I{} $DC exec -T redis redis-cli ttl {})
[ "$TTL" -gt 0 ] && [ "$TTL" -le 900 ] && check "blocked-jti TTL ≤ 15 min ($TTL s)" ok ok || check "blocked-jti TTL" "1..900" "$TTL"
check "refresh after logout" 401 $(code -b $D/a.jar -X POST $G/auth/refresh)

echo "== Invite → accept"
check "login admin" 200 $(login $D/a.jar admin@medflow.az Admin12345)
EMAIL="doctor$SUF@medflow.az"
check "invite doctor" 201 $(code -b $D/a.jar -X POST $G/users -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"firstName\":\"Aysel\",\"lastName\":\"Məmmədova\",\"role\":\"DOCTOR\",\"title\":\"Cardiologist\"}")
DOC_ID=$(grep -o '"id":"[^"]*"' $D/body | head -1 | cut -d'"' -f4)
check "duplicate email" 409 $(code -b $D/a.jar -X POST $G/users -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"firstName\":\"A\",\"lastName\":\"B\",\"role\":\"DOCTOR\"}")
check "invalid role → 400" 400 $(code -b $D/a.jar -X POST $G/users -H 'content-type: application/json' -d '{"email":"x@y.az","firstName":"A","lastName":"B","role":"GOD"}')
check "invited user cannot log in" 401 $(login $D/x.jar $EMAIL Secret123)
INV=$(lastlink "Invite link for $EMAIL")
check "invitation preview" 200 $(code $G/auth/invitations/$INV)
check "weak password rejected" 400 $(code -X POST $G/auth/accept-invite -H 'content-type: application/json' -d "{\"token\":\"$INV\",\"password\":\"onlyletters\"}")
check "accept invite (logged in)" 200 $(code -c $D/d.jar -X POST $G/auth/accept-invite -H 'content-type: application/json' -d "{\"token\":\"$INV\",\"password\":\"Secret123\"}")
check "doctor me" 200 $(code -b $D/d.jar $G/auth/me)
grep -q 'Məmmədova' $D/body && check "non-ASCII name intact" ok ok || check "non-ASCII name" ok bad
check "accept again → 409" 409 $(code -X POST $G/auth/accept-invite -H 'content-type: application/json' -d "{\"token\":\"$INV\",\"password\":\"Secret123\"}")
check "doctor cannot invite (403)" 403 $(code -b $D/d.jar -X POST $G/users -H 'content-type: application/json' -d '{"email":"z@y.az","firstName":"A","lastName":"B","role":"NURSE"}')
check "resend invite to ACTIVE → 409" 409 $(code -b $D/a.jar -X POST $G/users/$DOC_ID/resend-invite)

echo "== Expired invite / resend"
E2="nurse$SUF@medflow.az"
code -b $D/a.jar -X POST $G/users -H 'content-type: application/json' -d "{\"email\":\"$E2\",\"firstName\":\"Leyla\",\"lastName\":\"Əliyeva\",\"role\":\"NURSE\"}" >/dev/null
NURSE_ID=$(grep -o '"id":"[^"]*"' $D/body | head -1 | cut -d'"' -f4)
INV2=$(lastlink "Invite link for $E2")
psql "update invitations set expires_at = now() - interval '1 minute' where user_id='$NURSE_ID'" >/dev/null
check "expired invite → 410" 410 $(code $G/auth/invitations/$INV2)
check "resend invite" 200 $(code -b $D/a.jar -X POST $G/users/$NURSE_ID/resend-invite)
check "old link invalid after resend" 404 $(code $G/auth/invitations/$INV2)
INV3=$(lastlink "Invite link for $E2" "$INV2")
check "new link works" 200 $(code $G/auth/invitations/$INV3)

echo "== Deactivation locks the user out instantly"
ADMIN_ID=$(psql "select id from users where email='admin@medflow.az'")
check "cannot deactivate yourself" 422 $(code -b $D/a.jar -X PATCH $G/users/$ADMIN_ID/deactivate)
check "deactivate doctor" 200 $(code -b $D/a.jar -X PATCH $G/users/$DOC_ID/deactivate)
check "doctor's live access token → 401" 401 $(code -b $D/d.jar $G/auth/me)
check "doctor refresh → 401" 401 $(code -b $D/d.jar -X POST $G/auth/refresh)
check "doctor login → 401" 401 $(login $D/x.jar $EMAIL Secret123)
check "deactivate again → 409" 409 $(code -b $D/a.jar -X PATCH $G/users/$DOC_ID/deactivate)

echo "== Forgot / reset password"
check "forgot (existing)" 200 $(code -X POST $G/auth/forgot-password -H 'content-type: application/json' -d '{"email":"admin@medflow.az"}')
B1=$(cat $D/body)
check "forgot (unknown) same answer" 200 $(code -X POST $G/auth/forgot-password -H 'content-type: application/json' -d '{"email":"nobody@medflow.az"}')
[ "$B1" = "$(cat $D/body)" ] && check "identical bodies" ok ok || check "identical bodies" ok diff
RST=$(lastlink "Password reset link for admin@medflow.az")
check "second admin session" 200 $(login $D/c.jar admin@medflow.az Admin12345)
check "reset password" 200 $(code -X POST $G/auth/reset-password -H 'content-type: application/json' -d "{\"token\":\"$RST\",\"password\":\"NewAdmin123\"}")
check "old session access → 401" 401 $(code -b $D/c.jar $G/auth/me)
check "old session refresh → 401" 401 $(code -b $D/c.jar -X POST $G/auth/refresh)
check "reset link reused → 400" 400 $(code -X POST $G/auth/reset-password -H 'content-type: application/json' -d "{\"token\":\"$RST\",\"password\":\"Other12345\"}")
check "old password → 401" 401 $(login $D/x.jar admin@medflow.az Admin12345)
check "new password → 200" 200 $(login $D/a.jar admin@medflow.az NewAdmin123)
# put the demo password back (strict limit is shared by login + forgot)
redis_flush_rl
code -X POST $G/auth/forgot-password -H 'content-type: application/json' -d '{"email":"admin@medflow.az"}' >/dev/null
RST2=$(lastlink "Password reset link for admin@medflow.az" "$RST")
check "restore demo password" 200 $(code -X POST $G/auth/reset-password -H 'content-type: application/json' -d "{\"token\":\"$RST2\",\"password\":\"Admin12345\"}")

echo "== Security checklist"
check "services not reachable from host" 000 $(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://localhost:3001/health)
check "/internal not routed" 404 $(code -b $D/a.jar $G/internal/anything)
H=$(curl -s -D - -o /dev/null $G/health)
echo "$H" | grep -qi 'x-content-type-options' && check "helmet headers" ok ok || check "helmet headers" ok missing
echo "$H" | grep -qi '^ratelimit' && check "rate limit headers absent on /health" ok bad || check "rate limit headers absent on /health" ok ok
redis_flush_rl
LAST=; for i in $(seq 1 11); do LAST=$(login $D/x.jar admin@medflow.az wrongpass1); done
check "11th login in a minute → 429" 429 $LAST
check "other routes still allowed" 401 $(code $G/auth/me)
redis_flush_rl

echo; echo "PASS $PASS  FAIL $FAIL"
rm -rf $D
