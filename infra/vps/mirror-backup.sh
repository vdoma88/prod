#!/usr/bin/env bash
# Срочная резервная копия каждого курса отдельным файлом (ноябрь 2026).
#
#   bash /var/www/prod/infra/vps/mirror-backup.sh
#
# Кладёт в /root/backups/ДАТА/ по архиву на курс:
#   plamya-…  база flame_db + фото учениц и уроков
#   rod-…     база rodology + вложения отчётов
#   runes-…   база рун (runes.sqlite)
#   taro-…    база Таро (cabinet.db)
#   sila-roda-… общий вход и бот лендинга (sqlite)
# Курс, которого на сервере нет, пропускается. Секретов (.env) в архивах нет.
# Забрать на компьютер (в PowerShell, не на сервере) — команду печатает в конце.
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "Запустите от root"; exit 1; }

STAMP="$(date +%Y-%m-%d_%H-%M)"
OUT="/root/backups/$STAMP"
umask 077
mkdir -p "$OUT"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
FAIL=0

pack() { # курс — упаковать $WORK/курс в архив
  tar -czf "$OUT/$1-$STAMP.tar.gz" -C "$WORK" "$1" && echo "  ✓ $1: $(du -h "$OUT/$1-$STAMP.tar.gz" | cut -f1)"
}
skip() { echo "  – $1: $2"; }
bad()  { echo "  ✗ $1: $2"; FAIL=1; }

# sqlite_copy источник цель — целостная копия базы sqlite при работающей службе
sqlite_copy() {
  node --disable-warning=ExperimentalWarning -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    db.exec("VACUUM INTO \x27" + process.argv[2].replace(/\x27/g, "\x27\x27") + "\x27");
    db.close();' "$1" "$2"
}

echo "Копии в $OUT"

# --- Язык Пламени ---
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='flame_db'" 2>/dev/null | grep -q 1; then
  mkdir -p "$WORK/plamya"
  if sudo -u postgres pg_dump flame_db > "$WORK/plamya/flame_db.sql"; then
    [ -d /var/www/flame-app/public/uploads ] && cp -r /var/www/flame-app/public/uploads "$WORK/plamya/uploads"
    pack plamya
  else bad plamya "pg_dump не прошёл"; fi
else skip plamya "базы flame_db нет"; fi

# --- Связь с Родом ---
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='rodology'" 2>/dev/null | grep -q 1; then
  mkdir -p "$WORK/rod"
  if sudo -u postgres pg_dump --no-owner --no-privileges rodology > "$WORK/rod/rodology.sql"; then
    [ -d /var/www/rodology/server/storage/uploads ] && cp -r /var/www/rodology/server/storage/uploads "$WORK/rod/uploads"
    pack rod
  else bad rod "pg_dump не прошёл"; fi
else skip rod "базы rodology нет"; fi

# --- Руны ---
if [ -f /var/lib/runes/runes.sqlite ]; then
  mkdir -p "$WORK/runes"
  if sqlite_copy /var/lib/runes/runes.sqlite "$WORK/runes/runes.sqlite"; then pack runes
  else bad runes "копия базы не прошла"; fi
else skip runes "нет /var/lib/runes/runes.sqlite"; fi

# --- Таро ---
if [ -f /var/lib/polkas/cabinet.db ]; then
  mkdir -p "$WORK/taro"
  if sqlite_copy /var/lib/polkas/cabinet.db "$WORK/taro/cabinet.db"; then pack taro
  else bad taro "копия базы не прошла"; fi
else skip taro "нет /var/lib/polkas/cabinet.db"; fi

# --- Общий вход и бот ---
if [ -f /var/lib/sr-accounts/accounts.sqlite ] || [ -f /var/lib/rodbot/bot.sqlite ]; then
  mkdir -p "$WORK/sila-roda"
  ok=1
  [ ! -f /var/lib/sr-accounts/accounts.sqlite ] || sqlite_copy /var/lib/sr-accounts/accounts.sqlite "$WORK/sila-roda/accounts.sqlite" || ok=0
  [ ! -f /var/lib/rodbot/bot.sqlite ] || sqlite_copy /var/lib/rodbot/bot.sqlite "$WORK/sila-roda/bot.sqlite" || ok=0
  if [ "$ok" = 1 ]; then pack sila-roda; else bad sila-roda "копия базы не прошла"; fi
else skip sila-roda "баз общего входа и бота нет"; fi

IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
echo
echo "Готово$([ "$FAIL" = 1 ] && echo ', но с ошибками — см. ✗ выше')."
echo "Забрать на компьютер (PowerShell, папка «Загрузки»):"
echo "  cd Downloads"
echo "  scp -r root@$IP:$OUT ."
exit "$FAIL"
