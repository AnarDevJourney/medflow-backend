# Sourced by the e2e scripts: read emails from Mailpit (dev SMTP catcher)
# through its REST API. Invite / reset links only travel by email.
MAILPIT=http://localhost:8025/api/v1

# mail_id <to> <subject word>: id of the newest matching email (or nothing)
mail_id() {
  curl -s -G "$MAILPIT/search" --data-urlencode "query=to:$1 subject:$2" --data-urlencode limit=1 \
    | grep -o '"ID":"[^"]*"' | head -1 | cut -d'"' -f4
}

# mailtoken <to> <subject word> [previous token]: waits up to 20 s for the
# newest email to <to> whose subject has <word> and prints the token= of its
# link — a different one than [previous token] when given
mailtoken() {
  local id t
  for _ in $(seq 1 80); do
    id=$(mail_id "$1" "$2")
    if [ -n "$id" ]; then
      t=$(curl -s "$MAILPIT/message/$id" | grep -o 'token=[A-Za-z0-9_-]*' | head -1 | cut -d= -f2)
      [ -n "$t" ] && [ "$t" != "$3" ] && { echo "$t"; return; }
    fi
    sleep 0.25
  done
  echo "$t"
}

# mailcount <to> [subject word]: how many emails <to> got
mailcount() {
  local query="to:$1"; [ -n "$2" ] && query="$query subject:$2"
  curl -s -G "$MAILPIT/search" --data-urlencode "query=$query" | grep -o '"messages_count":[0-9]*' | cut -d: -f2
}

# lasttoken <to> <subject word>: token of the newest matching email right
# now (no waiting) — pass it to mailtoken to wait for a newer email
lasttoken() {
  local id; id=$(mail_id "$1" "$2")
  [ -n "$id" ] && curl -s "$MAILPIT/message/$id" | grep -o 'token=[A-Za-z0-9_-]*' | head -1 | cut -d= -f2
}
