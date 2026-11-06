#!/usr/bin/env bash
# Вебхук бота пульта: показать и, только с подтверждения, снять.
#
#   bash /var/www/prod/infra/vps/ops-bot-webhook.sh
#
# Пульт (ops/bot.mjs) читает команды через getUpdates, а Telegram не отдаёт их
# так, пока у бота есть вебхук. Скрипт показывает, куда смотрит вебхук, и
# подсказывает, можно ли его снять: если по этому адресу работает другая
# служба (бот школы, бот лендинга), снимать нельзя — для пульта нужен свой бот.
# Токен берётся из /etc/sr-ops.env и в командную строку не попадает.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
. ./lib.sh
need_root

ENV_FILE=/etc/sr-ops.env
[ -f "$ENV_FILE" ] || die "нет $ENV_FILE — сначала install-ops-widget.sh"
get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
TOKEN="$(get OPS_BOT_TOKEN)"; BASE="$(get OPS_BOT_API)"; TEST="$(get OPS_BOT_TEST_ENV)"
[ -n "$TOKEN" ] || die "в $ENV_FILE нет OPS_BOT_TOKEN"
SUFFIX=""; [ "$TEST" = 1 ] && SUFFIX="/test"

call() { # метод — ответ Telegram (JSON)
  local cfg out
  cfg="$(mktemp)"; chmod 600 "$cfg"
  printf 'url = "%s/bot%s%s/%s"\n' "${BASE%/}" "$TOKEN" "$SUFFIX" "$1" > "$cfg"
  out="$(curl -sS --max-time 20 -K "$cfg" || true)"
  rm -f "$cfg"
  printf '%s' "$out"
}
field() { sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p"; }

log "Вебхук бота пульта"
INFO="$(call getWebhookInfo)"
URL="$(printf '%s' "$INFO" | field url)"
PENDING="$(printf '%s' "$INFO" | sed -n 's/.*"pending_update_count":\([0-9]*\).*/\1/p')"
ERR="$(printf '%s' "$INFO" | field last_error_message)"
if [ -z "$URL" ]; then
  ok "вебхука нет — команды должны доходить (перезапуск: systemctl restart sr-ops)"
  exit 0
fi
echo "  Адрес:            $URL"
echo "  Ждут доставки:    ${PENDING:-0}"
[ -z "$ERR" ] || echo "  Последняя ошибка: $ERR"

# Кто на этом сервере принимает этот адрес
HOST="$(printf '%s' "$URL" | sed -E 's#^https?://([^/:]+).*#\1#')"
PATHPART="/$(printf '%s' "$URL" | sed -E 's#^https?://[^/]+/?##')"
case "$PATHPART" in
  /tg/rod-bot*) OWNER="бот лендинга (служба rodbot)"; UNIT=rodbot ;;
  /api/telegram*|/api/bot*) OWNER="бот школы «Язык Пламени»"; UNIT=flame-school ;;
  *) OWNER="неизвестная служба"; UNIT="" ;;
esac
echo "  Похоже на:        $OWNER ($HOST)"
if [ -n "$UNIT" ] && systemctl is-active --quiet "$UNIT" 2>/dev/null; then
  echo
  warn "служба $UNIT на этом сервере работает и, видимо, принимает этот вебхук."
  echo "  Снимать вебхук нельзя — сломается $OWNER. Для пульта заведите отдельного бота:"
  echo "    @BotFather → /newbot, затем: RECONFIGURE=1 bash $(pwd)/install-ops-widget.sh"
  echo "  и на вопрос о боте ответьте 3 (другой бот) и вставьте его токен."
  exit 0
fi
[ -z "$ERR" ] || echo "  Telegram не может доставить сообщения по этому адресу — вебхук, скорее всего, остался от старого сервера."

echo
read -r -p "Снять вебхук, чтобы команды шли пульту? Сообщения, ждущие доставки, сохранятся. [д/Н] " ANS
case "$ANS" in
  [дДyY]*)
    RES="$(call deleteWebhook)"
    if printf '%s' "$RES" | grep -q '"ok":true'; then
      ok "вебхук снят"
      systemctl restart sr-ops && ok "пульт перезапущен — отправьте боту /status"
    else
      die "Telegram не снял вебхук: $RES"
    fi
    ;;
  *) echo "Ничего не менял." ;;
esac
