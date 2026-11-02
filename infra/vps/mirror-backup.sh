#!/usr/bin/env bash
# Срочная копия рун и Таро на запасном сервере (ноябрь 2026).
#
#   bash /var/www/prod/infra/vps/mirror-backup.sh
#
# Род, школу и общий кабинет копирует infra/vps/backup-mirror.py (--scope all).
# Этот скрипт дополняет его двумя курсами, каждый — отдельным архивом, в том
# же формате и той же папке /root/sr-backups:
#   runes-ДАТА.tar.gz.enc  база рун (runes.sqlite, целостная копия)
#   taro-ДАТА.tar.gz.enc   база Таро (cabinet.db, целостная копия)
# Шифрование и ключ — те же, что у backup-mirror.py (/etc/sr-backup.key,
# AES-256-CBC, PBKDF2 250 000), рядом .sha256. Курс, которого нет, пропускается.
# Если настроен /etc/sr-mirror-backup.env (mirror-telegram-setup.sh) — архивы
# уходят в Telegram тем же ботом. Ночной запуск: строка в /etc/cron.d/sr-mirror-courses.
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "Запустите от root"; exit 1; }

KEY=/etc/sr-backup.key
OUT=/root/sr-backups
[ -s "$KEY" ] || { echo "Нет ключа $KEY — сначала: python3 /var/www/prod/infra/vps/backup-mirror.py --scope all"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
umask 077
mkdir -p "$OUT"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
FAIL=0

# Отправка в Telegram: токен — в файле настроек curl, не в командной строке
TG_ENV=/etc/sr-mirror-backup.env
tg_send() { # файл подпись
  [ -f "$TG_ENV" ] || return 0
  local token chat cfg
  token="$(grep -E '^TELEGRAM_BOT_TOKEN=' "$TG_ENV" | cut -d= -f2-)"
  chat="$(grep -E '^TELEGRAM_CHAT_ID=' "$TG_ENV" | cut -d= -f2-)"
  [ -n "$token" ] && [ -n "$chat" ] || return 0
  cfg="$(mktemp)"; chmod 600 "$cfg"
  printf 'url = "https://api.telegram.org/bot%s/sendDocument"\n' "$token" > "$cfg"
  if curl -sS --max-time 300 -K "$cfg" -F "chat_id=$chat" -F "caption=$2" -F "document=@$1" | grep -q '"ok":true'; then
    echo "    Telegram: отправлено"
  else
    echo "    Telegram: не отправлено (копия осталась на сервере)"; FAIL=1
  fi
  rm -f "$cfg"
}

# sqlite_copy источник цель — целостная копия базы sqlite при работающей службе
sqlite_copy() {
  node --disable-warning=ExperimentalWarning -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    db.exec("VACUUM INTO \x27" + process.argv[2].replace(/\x27/g, "\x27\x27") + "\x27");
    db.close();' "$1" "$2"
}

# course имя файл_базы — архив, шифрование, контрольная сумма
course() {
  local name="$1" db="$2" file="$OUT/$1-$STAMP.tar.gz.enc"
  if [ ! -f "$db" ]; then echo "  – $name: нет $db"; return; fi
  mkdir -p "$WORK/$name"
  if ! sqlite_copy "$db" "$WORK/$name/$(basename "$db")"; then echo "  ✗ $name: копия базы не прошла"; FAIL=1; return; fi
  if tar -czf - -C "$WORK" "$name" | openssl enc -aes-256-cbc -pbkdf2 -iter 250000 -salt -pass "file:$KEY" -out "$file"; then
    sha256sum "$file" | awk '{print $1}' > "$file.sha256"
    echo "  ✓ $name: $file ($(du -h "$file" | cut -f1))"
    tg_send "$file" "$name $STAMP, sha256 $(cat "$file.sha256")"
  else
    rm -f "$file"; echo "  ✗ $name: архив не создан"; FAIL=1
  fi
}

echo "Копии в $OUT"
# Ночной запуск — один раз ставится сам (03:50, после backup-mirror.py в 03:35)
if [ ! -f /etc/cron.d/sr-mirror-courses ]; then
  printf '50 3 * * * root /bin/bash %s >> /var/log/sr-mirror-courses.log 2>&1\n' "$(readlink -f "$0")" > /etc/cron.d/sr-mirror-courses
  echo "Ночной запуск включён: 03:50, журнал /var/log/sr-mirror-courses.log"
fi
course runes /var/lib/runes/runes.sqlite
course taro /var/lib/polkas/cabinet.db

IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
echo
echo "Готово$([ "$FAIL" = 1 ] && echo ', но с ошибками — см. ✗ выше')."
echo "Забрать все копии на компьютер (PowerShell, не на сервере):"
echo "  scp -r root@$IP:$OUT ."
exit "$FAIL"
