#!/usr/bin/env bash
set -euo pipefail
: "${ADMIN_TOKEN:?Export ADMIN_TOKEN before backup}"
COMPOSE_ENGINE=${COMPOSE_ENGINE:-docker}
BACKUP_URL=${BACKUP_URL:-http://localhost:3000}
BACKUP_DEST=${1:?Usage: scripts/backup.sh NEW_BACKUP_DIRECTORY}
if [[ -e "$BACKUP_DEST" ]]; then echo 'Backup destination must not exist' >&2; exit 1; fi
umask 077
mkdir -p "$BACKUP_DEST"
BACKUP_ID=$(date -u +%Y%m%dT%H%M%SZ)
unfreeze() { curl --fail --silent --show-error -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"frozen":false}' "$BACKUP_URL/api/admin/freeze" >/dev/null; }
curl --fail --silent --show-error -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"frozen\":true,\"backupId\":\"$BACKUP_ID\"}" "$BACKUP_URL/api/admin/freeze" > "$BACKUP_DEST/freeze.json"
trap unfreeze EXIT
"$COMPOSE_ENGINE" compose exec -T database pg_dump -U qollab -Fc qollab > "$BACKUP_DEST/database.dump"
"$COMPOSE_ENGINE" compose exec -T app tar -C /data -czf - . > "$BACKUP_DEST/projects.tar.gz"
"$COMPOSE_ENGINE" compose images --format json > "$BACKUP_DEST/images.json"
printf '%s\n' "$BACKUP_ID" > "$BACKUP_DEST/backup-id"
(cd "$BACKUP_DEST" && shasum -a 256 database.dump projects.tar.gz images.json > SHA256SUMS)
echo "Backup complete: $BACKUP_DEST"
