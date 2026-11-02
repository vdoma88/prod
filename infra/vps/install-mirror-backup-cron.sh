#!/usr/bin/env bash
# Install nightly full backups on the recovered VPS. Safe to repeat.
# Does not delete old cron jobs or change application services.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Run as root.' >&2; exit 1; }
SCRIPT=/var/www/prod/infra/vps/backup-mirror.py
[ -f "$SCRIPT" ] || { echo "Missing $SCRIPT" >&2; exit 1; }
command -v python3 >/dev/null || { echo 'python3 missing' >&2; exit 1; }
command -v openssl >/dev/null || { echo 'openssl missing' >&2; exit 1; }
command -v pg_dump >/dev/null || { echo 'pg_dump missing' >&2; exit 1; }
command -v pg_restore >/dev/null || { echo 'pg_restore missing' >&2; exit 1; }
command -v runuser >/dev/null || { echo 'runuser missing' >&2; exit 1; }

install -d -m 700 /root/sr-backups
cat > /etc/cron.d/sr-mirror-backups <<'CRON'
# Encrypted full backups of Rod, Flame and common hub, 03:35 server local time.
SHELL=/bin/bash
PATH=/usr/sbin:/usr/bin:/sbin:/bin
35 3 * * * root /usr/bin/python3 /var/www/prod/infra/vps/backup-mirror.py --scope all >> /var/log/sr-mirror-backups.log 2>&1
CRON
chmod 644 /etc/cron.d/sr-mirror-backups

echo 'Nightly full backups: 03:35 SERVER local time.'
echo 'Log: /var/log/sr-mirror-backups.log'
echo 'Encrypted archives: /root/sr-backups/'
echo 'CRITICAL: copy /etc/sr-backup.key OFF the VPS after first backup.'
echo 'Telegram settings are taken from /etc/sr-mirror-backup.env, or a configured Rod/Flame bot.'
echo 'Older cron jobs are not removed automatically; check warnings below.'
if [ -e /etc/cron.d/rodology-backup ]; then
  echo 'WARNING: old /etc/cron.d/rodology-backup is DB-only, without media.'
fi
if crontab -l 2>/dev/null | grep -q '/flame-app/deploy/backup.sh'; then
  echo 'WARNING: old Flame cron might back up empty flame_db rather than the active recovery database.'
fi
