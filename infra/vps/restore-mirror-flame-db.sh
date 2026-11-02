#!/usr/bin/env bash
# Activate previously restored Flame database on the emergency mirror.
# Does NOT delete or overwrite the old flame_db or backup archives.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Run as root' >&2; exit 1; }
cd /var/www/flame-app
DB=flame_recovery_20261101
ARCHIVE=/root/mirror/flame-backup-2026-11-01_16-00.tar.gz
[ -f "$ARCHIVE" ] || { echo 'Backup archive missing' >&2; exit 1; }
[ -f .env.local ] || { echo '.env.local missing' >&2; exit 1; }
OLD_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local | tail -1)"
[ -n "$OLD_URL" ] || { echo 'DATABASE_URL missing' >&2; exit 1; }
case "$OLD_URL" in
  */flame_recovery_20261101)
    NEW_URL="$OLD_URL"
    ALREADY_USING=1
    ;;
  */flame_db)
    NEW_URL="${OLD_URL%/flame_db}/$DB"
    ALREADY_USING=0
    ;;
  *) echo 'Unexpected DATABASE_URL; manual inspection required.' >&2; exit 1 ;;
esac
echo 'Validating credentials and exact archived record counts…'
COUNTS="$(psql "$NEW_URL" -XAtqc 'SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM lessons), (SELECT count(*) FROM homework_submissions), (SELECT count(*) FROM diary_entries)' 2>/dev/null)" || { echo 'Flame database credentials do not work.' >&2; exit 1; }
[ "$COUNTS" = '5|33|25|44' ] || { echo "Unexpected database counts: $COUNTS" >&2; exit 1; }
mkdir -p public/uploads
# Existing files are never overwritten; no fallback to the empty database.
tar -xzf "$ARCHIVE" -C public --skip-old-files ./uploads
COUNT="$(find public/uploads -type f | wc -l)"
printf 'File count in public/uploads: %s\n' "$COUNT"
[ "$COUNT" -gt 0 ] || { echo 'No uploaded files restored. Check the archive before publishing the school.' >&2; exit 1; }
if [ "$ALREADY_USING" = 1 ]; then
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3000/ || true)"
  case "$STATUS" in
    2??|3??) echo "Verified existing $DB and restored missing uploads (HTTP $STATUS)."; exit 0 ;;
    *) echo "Flame is configured for $DB, but HTTP returned $STATUS. Check journalctl -u flame-school." >&2; exit 1 ;;
  esac
fi
BACKUP="/root/mirror/flame-env-before-switch-$(date +%Y%m%d-%H%M%S).bak"
cp -p .env.local "$BACKUP"
chmod 600 "$BACKUP"
sed -i '/^DATABASE_URL=/s#\/flame_db$#/flame_recovery_20261101#' .env.local
systemctl restart flame-school
sleep 3
STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3000/ || true)"
case "$STATUS" in
  2??|3??) echo "Flame mirror switched to verified $DB (HTTP $STATUS)." ;;
  *)
    echo "Flame returned HTTP $STATUS; reverting environment change."
    cp -p "$BACKUP" .env.local
    systemctl restart flame-school || true
    exit 1
    ;;
esac
