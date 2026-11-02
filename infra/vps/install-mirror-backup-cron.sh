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

python3 -m py_compile "$SCRIPT"
if ! command -v cron >/dev/null 2>&1; then
  echo 'cron is not installed. Installing the system scheduler.'
  apt-get update -qq
  apt-get install -y -qq cron
fi
systemctl enable --now cron
systemctl is-active --quiet cron || { echo 'cron is not running' >&2; exit 1; }
install -d -m 700 /root/sr-backups
# 8:00 и 23:00 по Москве; cron считает по часовому поясу сервера
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
HOURS="$(server_hours 8 23)"
cat > /etc/cron.d/sr-mirror-backups <<CRON
# Encrypted full backups of Rod, Flame and common hub — 08:00 and 23:00 Moscow time
# (hours below are server local time).
SHELL=/bin/bash
PATH=/usr/sbin:/usr/bin:/sbin:/bin
0 $HOURS * * * root /usr/bin/python3 /var/www/prod/infra/vps/backup-mirror.py --scope all >> /var/log/sr-mirror-backups.log 2>&1
CRON
chmod 644 /etc/cron.d/sr-mirror-backups
# Руны и Таро — через 15 минут, тем же ключом и ботом
if [ -f /var/www/prod/infra/vps/mirror-backup.sh ]; then
  cat > /etc/cron.d/sr-mirror-courses <<CRON
# Encrypted backups of Runes and Taro — 08:15 and 23:15 Moscow time (server hours below).
SHELL=/bin/bash
PATH=/usr/sbin:/usr/bin:/sbin:/bin
15 $HOURS * * * root /bin/bash /var/www/prod/infra/vps/mirror-backup.sh >> /var/log/sr-mirror-courses.log 2>&1
CRON
  chmod 644 /etc/cron.d/sr-mirror-courses
  echo "Runes and Taro: :15 past the same hours, log /var/log/sr-mirror-courses.log"
fi

echo "Full backups: 08:00 and 23:00 Moscow time (server hours: $HOURS)."
echo 'Log: /var/log/sr-mirror-backups.log'
echo 'Encrypted archives: /root/sr-backups/'
echo 'CRITICAL: copy /etc/sr-backup.key OFF the VPS after first backup.'
echo 'Telegram settings are taken from /etc/sr-mirror-backup.env, or a configured Rod/Flame bot.'
echo 'Older cron jobs are not removed automatically; check warnings below.'
if [ -e /etc/cron.d/rodology-backup ]; then
  echo 'WARNING: /etc/cron.d/rodology-backup also runs Rod backup.js — on the mirror backup-mirror.py already covers Rod.'
fi
if crontab -l 2>/dev/null | grep -q '/flame-app/deploy/backup.sh'; then
  echo 'WARNING: old Flame cron might back up empty flame_db rather than the active recovery database.'
fi
