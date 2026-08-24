#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${R2_ENDPOINT_URL:?R2_ENDPOINT_URL is required}"
: "${R2_BACKUP_BUCKET:?R2_BACKUP_BUCKET is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"

backup_dir=$(mktemp -d)
trap 'rm -rf -- "$backup_dir"' EXIT
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$backup_dir/procurex-$stamp.dump"

pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" --file "$backup_file"
pg_restore --list "$backup_file" >/dev/null
sha256sum "$backup_file" > "$backup_file.sha256"
aws s3 cp "$backup_file" "s3://$R2_BACKUP_BUCKET/postgres/$(basename "$backup_file")" \
  --endpoint-url "$R2_ENDPOINT_URL"
aws s3 cp "$backup_file.sha256" \
  "s3://$R2_BACKUP_BUCKET/postgres/$(basename "$backup_file").sha256" \
  --endpoint-url "$R2_ENDPOINT_URL"
