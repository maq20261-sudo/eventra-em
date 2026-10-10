#!/usr/bin/env bash
# Nightly MongoDB Atlas backup → S3 (Atlas M0 has no automatic backups).
# Installed as a cron job by setup-server.sh. Keeps 30 days via an S3
# lifecycle rule on the backups/ prefix (see docs/DEPLOYMENT.md).
#
#   /opt/gatherspace/backup.sh            # run manually
#   restore: see docs/DEPLOYMENT.md "Restore a backup"
set -euo pipefail

cd /opt/gatherspace

# Read KEY=value from backend.env without sourcing it (the Atlas URI
# contains "&", which a shell would treat as a command separator).
val() { grep -E "^$1=" backend.env | tail -n 1 | cut -d= -f2-; }
MONGO_URL="$(val MONGO_URL)"
DB_NAME="$(val DB_NAME)"
S3_BUCKET="$(val S3_BUCKET)"
S3_REGION="$(val S3_REGION)"
export AWS_ACCESS_KEY_ID="$(val AWS_ACCESS_KEY_ID)"
export AWS_SECRET_ACCESS_KEY="$(val AWS_SECRET_ACCESS_KEY)"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="gatherspace-${STAMP}.archive.gz"
TMP="/tmp/${FILE}"
trap 'rm -f "$TMP"' EXIT

docker run --rm mongo:7.0 \
  mongodump --uri="${MONGO_URL}" --db="${DB_NAME}" --archive --gzip > "$TMP"

docker run --rm -v /tmp:/backup \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION="${S3_REGION:-ap-south-1}" \
  amazon/aws-cli:2.17.0 s3 cp "/backup/${FILE}" "s3://${S3_BUCKET}/backups/mongo/${FILE}" --only-show-errors

echo "$(date -u +%FT%TZ) backup ok: s3://${S3_BUCKET}/backups/mongo/${FILE} ($(du -h "$TMP" | cut -f1))"
