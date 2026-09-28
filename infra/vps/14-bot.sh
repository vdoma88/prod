#!/usr/bin/env bash
# Telegram-бот лендинга → https://belayarod.ru/tg/rod-bot  (bot/ в этом репозитории,
# порт 4310, systemd «rodbot»)
#
#   sudo bash infra/vps/14-bot.sh
#
# Первый запуск: пользователь rodbot, папка базы, /etc/rodbot.env с новыми
# секретами, служба. Токен бота вписывается в /etc/rodbot.env вручную (скрипт
# подскажет), потом скрипт запускается ещё раз. Повторный запуск — это и
# обновление: перезапуск службы после git pull (infra/update.sh).
# shellcheck source-path=SCRIPTDIR source=lib.sh
cd "$(dirname "$0")" && . ./lib.sh
need_root

REPO_DIR="$(cd ../.. && pwd)"
ENV_FILE=/etc/rodbot.env
PORT=4310

log "Проверки"
require_node
[ "$REPO_DIR" = /var/www/prod ] || warn "репозиторий не в /var/www/prod ($REPO_DIR) — служба ждёт его там"
systemctl is-active --quiet rodbot || require_port_free "$PORT" node

log "Пользователь и папки"
id rodbot >/dev/null 2>&1 || adduser --system --group --no-create-home --home /var/lib/rodbot rodbot
install -d -o rodbot -g rodbot -m 700 /var/lib/rodbot
ok "rodbot, /var/lib/rodbot"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
HOST=127.0.0.1
PORT=$PORT
BOT_DB_PATH=/var/lib/rodbot/bot.sqlite
PUBLIC_URL=https://$DOMAIN/tg/rod-bot
# Токен от @BotFather — вписать сюда
TELEGRAM_BOT_TOKEN=
WEBHOOK_SECRET=$(openssl rand -hex 24)
# Код привязки Екатерины: t.me/<бот>?start=admin-<ADMIN_CODE>
ADMIN_CODE=$(openssl rand -hex 8)
# Курсы шлют сюда сданные ДЗ (bot/README.md, «Уведомления о ДЗ»)
NOTIFY_SECRET=$(openssl rand -hex 24)
ENV
  chown root:rodbot "$ENV_FILE"; chmod 640 "$ENV_FILE"
  ok "создан $ENV_FILE"
else
  ok "$ENV_FILE уже есть — не трогаю"
fi
# Файл мог появиться до уведомлений о ДЗ — дописываем недостающий секрет.
if ! grep -q '^NOTIFY_SECRET=.\+' "$ENV_FILE"; then
  sed -i '/^NOTIFY_SECRET=/d' "$ENV_FILE"
  printf '# Курсы шлют сюда сданные ДЗ (bot/README.md, «Уведомления о ДЗ»)\nNOTIFY_SECRET=%s\n' "$(openssl rand -hex 24)" >> "$ENV_FILE"
  ok "добавлен NOTIFY_SECRET"
fi

if ! grep -q '^TELEGRAM_BOT_TOKEN=.\+' "$ENV_FILE"; then
  log "Нужен токен бота"
  cat <<NEXT
  1. В Telegram: @BotFather → /newbot → скопировать токен.
  2. Вписать его в $ENV_FILE: TELEGRAM_BOT_TOKEN=...
  3. Запустить этот скрипт ещё раз.
NEXT
  exit 0
fi

log "Служба"
install -m 644 "$REPO_DIR/bot/deploy/rodbot.service" /etc/systemd/system/rodbot.service
systemctl daemon-reload
systemctl enable rodbot >/dev/null 2>&1
systemctl restart rodbot
wait_http "http://127.0.0.1:$PORT/tg/rod-bot/health"

log "nginx"
install -m 644 "$REPO_DIR/infra/nginx/belayarod.ru.conf" /etc/nginx/sites-available/belayarod.ru
nginx -t
systemctl reload nginx
ok "вебхук: https://$DOMAIN/tg/rod-bot"

log "Готово"
# shellcheck disable=SC1090
ADMIN_CODE="$(. "$ENV_FILE"; printf '%s' "$ADMIN_CODE")"
cat <<NEXT
  Привязать Екатерину (заявки придут ей в Telegram): открыть в её Telegram
    https://t.me/<имя бота>?start=admin-$ADMIN_CODE
  Ссылка для лендинга: https://t.me/<имя бота>?start=landing
  Журнал: journalctl -u rodbot -f
  Уведомления о ДЗ из курсов: в .env каждого курса вписать
    ROD_NOTIFY_SECRET=<NOTIFY_SECRET из $ENV_FILE>
NEXT
