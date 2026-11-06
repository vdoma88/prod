#!/usr/bin/env bash
# Пульт «Силы Рода» в Telegram (ops/README.md): установка и обновление.
#
#   bash /var/www/prod/infra/vps/install-ops-widget.sh
#
# Спрашивает, какого бота взять:
#   1 — бот резервных копий из /etc/sr-mirror-backup.env (обычный Telegram).
#       Сразу работают /status и тревоги текстом; пульт-виджет — когда
#       Telegram откроет виджеты всем (Bot API 10.4), без переустановки.
#   2 — отдельный бот в тестовой среде Telegram (бета Bot API с виджетами):
#       чтобы увидеть виджет уже сейчас. Токен вставляется, на экране не виден.
#   3 — другой бот в обычном Telegram: отдельный бот для пульта (у бота копий
#       бывает вебхук — тогда команды ему не доходят, ops-bot-webhook.sh).
# Пишет /etc/sr-ops.env (только root), ставит и запускает службу sr-ops.
# Повторный запуск — обновление: настройки не спрашивает, если они есть
# (заново: RECONFIGURE=1).
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
. ./lib.sh
need_root

REPO=/var/www/prod
ENV_FILE=/etc/sr-ops.env
BACKUP_ENV=/etc/sr-mirror-backup.env
[ -f "$REPO/ops/bot.mjs" ] || die "нет $REPO/ops/bot.mjs — сначала cd $REPO и git pull"
require_node

get() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1; }

# check_bot токен адрес тест — имя бота или пусто (токен — в файле настроек curl, не в командной строке)
check_bot() {
  local cfg path_test="" name
  [ "$3" = 1 ] && path_test="/test"
  cfg="$(mktemp)"; chmod 600 "$cfg"
  printf 'url = "%s/bot%s%s/getMe"\n' "${2%/}" "$1" "$path_test" > "$cfg"
  name="$(curl -sS --max-time 20 -K "$cfg" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')" || true
  rm -f "$cfg"
  printf '%s' "$name"
}

if [ ! -f "$ENV_FILE" ] || [ "${RECONFIGURE:-0}" = 1 ]; then
  log "Настройка пульта"
  ADMINS="$(get "$BACKUP_ENV" TELEGRAM_CHAT_ID)"
  echo "Какого бота взять для пульта?"
  echo "  1 — бот резервных копий (обычный Telegram; виджет появится, когда его запустят)"
  echo "  2 — тестовый бот в тестовой среде Telegram (виджет виден уже сейчас)"
  echo "  3 — другой бот в обычном Telegram (например, отдельный бот для пульта)"
  read -r -p "Ваш выбор [1]: " MODE
  MODE="${MODE:-1}"
  if [ "$MODE" = 2 ] || [ "$MODE" = 3 ]; then
    if [ "$MODE" = 2 ]; then BASE=https://api.telegram.org/beta; TEST=1; else BASE=https://api.telegram.org; TEST=0; fi
    echo "Токен бота (@BotFather$( [ "$MODE" = 2 ] && printf ' в тестовой среде')). Вставьте и нажмите Enter, на экране не виден."
    read -r -s -p "Токен: " TOKEN; echo
  else
    BASE=https://api.telegram.org; TEST=0
    TOKEN="$(get "$BACKUP_ENV" TELEGRAM_BOT_TOKEN)"
    [ -n "$TOKEN" ] || die "нет бота в $BACKUP_ENV — сначала mirror-telegram-setup.sh или выберите 2"
  fi
  TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
  [[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]] || die "это не похоже на токен бота"
  BOT="$(check_bot "$TOKEN" "$BASE" "$TEST")"
  [ -n "$BOT" ] || die "Telegram не принял токен"
  ok "бот @$BOT"

  read -r -p "Telegram ID администраторов через запятую${ADMINS:+ [$ADMINS]}: " IDS
  IDS="${IDS:-$ADMINS}"
  [[ "$IDS" =~ ^[0-9]+(,[0-9]+)*$ ]] || die "ID — числа через запятую (их присылает @userinfobot)"

  IP="$(server_ip)"
  if getent ahostsv4 "$DOMAIN" | awk '{print $1}' | grep -qx "$IP"; then OPS_DOMAIN="$DOMAIN"; else OPS_DOMAIN="${IP//./-}.sslip.io"; fi

  umask 077
  cat > "$ENV_FILE" <<EOF
# Пульт «Силы Рода» (ops/bot.mjs) — ставит infra/vps/install-ops-widget.sh
OPS_BOT_TOKEN=$TOKEN
OPS_BOT_API=$BASE
OPS_BOT_TEST_ENV=$TEST
OPS_ADMIN_IDS=$IDS
OPS_DOMAIN=$OPS_DOMAIN
OPS_INTERVAL_MIN=5
OPS_STATE=/var/lib/sr-ops/state.json
EOF
  chmod 600 "$ENV_FILE"
  unset TOKEN
  ok "настройки: $ENV_FILE (домен для проверки сайтов: $OPS_DOMAIN)"
  # Один процесс на бота: бот копий только отправляет, getUpdates больше никто не читает
fi

log "Кто онлайн: секрет служебных адресов"
# Школа отдаёт список учениц онлайн по секрету общего входа; на вход в школу
# он не влияет. Род — только когда он подключён к общему входу (ROD_LOCAL_LOGIN=1
# оставляет вход по своим паролям): это отдельное решение, здесь не делается.
SECRET="$(get /etc/sr-accounts.env SR_INTERNAL_SECRET)"
FLAME_ENV=/var/www/flame-app/.env.local
if [ -n "$SECRET" ] && [ -f "$FLAME_ENV" ] && ! grep -q '^SR_INTERNAL_SECRET=.' "$FLAME_ENV"; then
  cp -p "$FLAME_ENV" "$FLAME_ENV.bak-$(date +%Y%m%d-%H%M%S)"
  sed -i '/^SR_INTERNAL_SECRET=/d' "$FLAME_ENV"
  echo "SR_INTERNAL_SECRET=$SECRET" >> "$FLAME_ENV"
  systemctl restart flame-school && ok "школа: список онлайн включён (перезапущена)"
else
  ok "школа: $( [ -n "$SECRET" ] && grep -q '^SR_INTERNAL_SECRET=.' "$FLAME_ENV" 2>/dev/null && echo уже подключена || echo 'нет секрета общего входа — онлайн не показывается')"
fi
grep -q '^SR_INTERNAL_SECRET=.' /var/www/rodology/server/.env 2>/dev/null \
  && ok "Род: подключён к общему входу — онлайн показывается" \
  || ok "Род: не подключён к общему входу — на пульте онлайн Рода «—»"
unset SECRET

log "Служба sr-ops"
install -d -m 700 /var/lib/sr-ops
install -m 644 "$REPO/ops/deploy/sr-ops.service" /etc/systemd/system/sr-ops.service
systemctl daemon-reload
systemctl enable sr-ops >/dev/null 2>&1
systemctl restart sr-ops
sleep 4
if systemctl is-active --quiet sr-ops; then
  ok "работает"
  journalctl -u sr-ops -n 5 --no-pager -o cat | sed 's/^/  /'
else
  journalctl -u sr-ops -n 20 --no-pager -o cat
  die "служба не запустилась"
fi

BOT_NAME="$(journalctl -u sr-ops -n 50 --no-pager -o cat | sed -n 's/^Пульт: @\([^,]*\),.*/\1/p' | tail -1)"
cat <<NEXT

Готово. Откройте @${BOT_NAME:-бота} в Telegram$( [ "$(get "$ENV_FILE" OPS_BOT_TEST_ENV)" = 1 ] && printf ' (тестовая среда)') и отправьте:
  /pult    — пульт-виджет (если Telegram его ещё не умеет — сводка текстом)
  /status  — сводка текстом
Тревоги придут сами: проверка каждые 5 минут.
Журнал: journalctl -u sr-ops -f
NEXT
