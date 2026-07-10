#!/usr/bin/env bash
# Safe SQLite backup (works while the app is running, WAL-aware) + prune old copies.
# Requires the sqlite3 CLI on the host:  sudo apt-get install -y sqlite3
#
# Usage:   ./scripts/backup.sh
# Cron (daily 03:30, keep 14):
#   30 3 * * * cd /opt/when2yi && ./scripts/backup.sh >> /var/log/when2yi-backup.log 2>&1
#
# Then copy $BACKUP_DIR offsite (rclone to a bucket, scp, etc.) — a backup that lives
# only on the same disk is not a backup.
set -euo pipefail

DB="${DATABASE_PATH:-./data/when2yi.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/when2yi-$STAMP.db"

sqlite3 "$DB" ".backup '$OUT'"
gzip -f "$OUT"
echo "backed up -> ${OUT}.gz"

# Keep only the newest $KEEP archives.
ls -1t "$BACKUP_DIR"/when2yi-*.db.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm --
