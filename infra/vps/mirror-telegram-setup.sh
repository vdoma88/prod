#!/usr/bin/env bash
# Отправка резервных копий зеркала в Telegram — настройка без редактора.
#
#   bash /var/www/prod/infra/vps/mirror-telegram-setup.sh
#
# Спрашивает токен бота (вставить, на экране не виден) и Telegram ID
# получателя, проверяет бота и шлёт пробное сообщение, пишет
# /etc/sr-mirror-backup.env (только для root). Затем по желанию сразу делает
# копии (backup-mirror.py --scope all) и включает ночной запуск.
set -euo pipefail
cd "$(dirname "$0")"
[ "$(id -u)" = 0 ] || { echo "Запустите от root"; exit 1; }
ENV_FILE=/etc/sr-mirror-backup.env

old_chat="$(grep -sE '^TELEGRAM_CHAT_ID=' "$ENV_FILE" | cut -d= -f2- || true)"

echo "Токен бота: @BotFather → ваш бот → API Token. Вставьте и нажмите Enter (на экране не виден)."
read -r -s -p "Токен: " TOKEN; echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
[[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]] || { echo "Это не похоже на токен бота."; exit 1; }

read -r -p "Telegram ID получателя${old_chat:+ [$old_chat]}: " CHAT
CHAT="${CHAT:-$old_chat}"
[[ "$CHAT" =~ ^-?[0-9]+$ ]] || { echo "ID — это число (его присылает @userinfobot)."; exit 1; }

# Токен — в файл настроек curl, а не в командную строку: её видно в списке процессов
CFG="$(mktemp)"; trap 'rm -f "$CFG"' EXIT
chmod 600 "$CFG"

api() { # метод [поле=значение…]
  local method="$1"; shift
  printf 'url = "https://api.telegram.org/bot%s/%s"\n' "$TOKEN" "$method" > "$CFG"
  local args=()
  for kv in "$@"; do args+=(--data-urlencode "$kv"); done
  curl -sS --max-time 20 -K "$CFG" "${args[@]}"
}

me="$(api getMe)"
echo "$me" | grep -q '"ok":true' || { echo "Telegram не принял токен."; exit 1; }
bot="$(echo "$me" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"
echo "Бот: @$bot"

sent="$(api sendMessage "chat_id=$CHAT" "text=Проверка: сюда будут приходить резервные копии зеркала «Сила Рода».")"
if ! echo "$sent" | grep -q '"ok":true'; then
  echo "Бот не смог написать вам. Откройте @$bot в Telegram, нажмите «Старт» и запустите скрипт снова."
  exit 1
fi
echo "Пробное сообщение отправлено — проверьте Telegram."

umask 077
{
  echo "# Отправка резервных копий зеркала (infra/vps/backup-mirror.py)"
  echo "TELEGRAM_BOT_TOKEN=$TOKEN"
  echo "TELEGRAM_CHAT_ID=$CHAT"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
unset TOKEN
echo "Сохранено: $ENV_FILE"

read -r -p "Сделать копии и отправить их сейчас? [Д/н] " ans
case "${ans:-д}" in
  [нНnN]*) ;;
  *) python3 ./backup-mirror.py --scope all || true ;;
esac

read -r -p "Включить ночные копии (каждый день)? [Д/н] " ans
case "${ans:-д}" in
  [нНnN]*) ;;
  *) bash ./install-mirror-backup-cron.sh ;;
esac
echo "Готово."
