#!/usr/bin/env bash
# Set one KEY in /opt/gatherspace/backend.env without the value appearing on
# screen or in shell history. Run on the server as ubuntu:
#
#   /opt/gatherspace/set-secret.sh MONGO_URL
#
# Then restart the backend:
#   cd /opt/gatherspace && docker compose -f docker-compose.prod.yml up -d backend
set -euo pipefail

KEY="${1:?usage: set-secret.sh KEY}"
FILE=/opt/gatherspace/backend.env

read -rsp "Paste value for $KEY (hidden): " VAL
echo
if [ -z "$VAL" ]; then
  echo "Empty value - nothing changed."
  exit 1
fi

touch "$FILE"
KEY="$KEY" VAL="$VAL" python3 - "$FILE" <<'PY'
import os, sys
path, key, val = sys.argv[1], os.environ["KEY"], os.environ["VAL"].strip()
lines = open(path).read().splitlines()
out, found = [], False
for line in lines:
    if line.split("=", 1)[0] == key:
        out.append(f"{key}={val}")
        found = True
    else:
        out.append(line)
if not found:
    out.append(f"{key}={val}")
open(path, "w").write("\n".join(out) + "\n")
PY
chmod 600 "$FILE"
echo "$KEY updated."
