#!/usr/bin/env bash
set -euo pipefail
COMPOSE_ENGINE=${COMPOSE_ENGINE:-docker}
BACKUP_SOURCE=${1:?Usage: scripts/restore.sh BACKUP_DIRECTORY}
# Run only against an empty/replacement installation. Stopping the application
# before restoring keeps old sockets and renderer leases out of the new state.
(cd "$BACKUP_SOURCE" && shasum -a 256 -c SHA256SUMS)
"$COMPOSE_ENGINE" compose stop app renderer
"$COMPOSE_ENGINE" compose up -d database
"$COMPOSE_ENGINE" compose exec -T database pg_restore -U qollab -d qollab --clean --if-exists < "$BACKUP_SOURCE/database.dump"
"$COMPOSE_ENGINE" compose run --rm --no-deps -T --entrypoint sh app -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar -C /data -xzf -' < "$BACKUP_SOURCE/projects.tar.gz"
"$COMPOSE_ENGINE" compose exec -T database psql -U qollab -d qollab -v ON_ERROR_STOP=1 -c "UPDATE maintenance SET frozen=false,backup_id=NULL; UPDATE builds SET status='failed',log='RESTORED_BACKUP' WHERE status='running';"
"$COMPOSE_ENGINE" compose up -d app renderer
