#!/usr/bin/env bash
# Общий вход для курсов → https://belayarod.ru/account/  (accounts/ в этом
# репозитории, порт 4320, systemd «sr-accounts»)
#
#   sudo bash infra/vps/15-accounts.sh                       — поставить или обновить
#   sudo ADMIN_EMAIL=почта ADMIN_NAME="Екатерина Белая" bash infra/vps/15-accounts.sh
#                                                            — и завести администратора
#
# Первый запуск: пользователь sraccounts, папка базы, /etc/sr-accounts.env с
# новым SR_INTERNAL_SECRET, служба, nginx. Повторный запуск — обновление после
# git pull (infra/update.sh). Ссылка для пароля администратора печатается в конце.
# shellcheck source-path=SCRIPTDIR source=lib.sh
cd "$(dirname "$0")" && . ./lib.sh
need_root

REPO_DIR="$(cd ../.. && pwd)"
ENV_FILE=/etc/sr-accounts.env
PORT=4320

log "Проверки"
require_node
[ "$REPO_DIR" = /var/www/prod ] || warn "репозиторий не в /var/www/prod ($REPO_DIR) — служба ждёт его там"
systemctl is-active --quiet sr-accounts || require_port_free "$PORT" node

log "Пользователь и папки"
id sraccounts >/dev/null 2>&1 || adduser --system --group --no-create-home --home /var/lib/sr-accounts sraccounts
install -d -o sraccounts -g sraccounts -m 700 /var/lib/sr-accounts
ok "sraccounts, /var/lib/sr-accounts"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
HOST=127.0.0.1
PORT=$PORT
ACCOUNTS_DB_PATH=/var/lib/sr-accounts/accounts.sqlite
PUBLIC_ORIGIN=https://$DOMAIN
# Cookie входа видна всем курсам на поддоменах
COOKIE_DOMAIN=.$DOMAIN
TRUST_PROXY=1
# Общий секрет с курсами (accounts/README.md, «Подключение курса»)
SR_INTERNAL_SECRET=$(openssl rand -hex 24)
ENV
  chown root:sraccounts "$ENV_FILE"; chmod 640 "$ENV_FILE"
  ok "создан $ENV_FILE"
else
  ok "$ENV_FILE уже есть — не трогаю"
fi

log "Служба"
install -m 644 "$REPO_DIR/accounts/deploy/sr-accounts.service" /etc/systemd/system/sr-accounts.service
systemctl daemon-reload
systemctl enable sr-accounts >/dev/null 2>&1
systemctl restart sr-accounts
wait_http "http://127.0.0.1:$PORT/account/"

log "nginx"
install -m 644 "$REPO_DIR/infra/nginx/belayarod.ru.conf" /etc/nginx/sites-available/belayarod.ru
nginx -t
systemctl reload nginx
ok "https://$DOMAIN/account/"

log "Курсы"
# Подключённые курсы получают общий секрет и перезапускаются.
if share_sr_secret /etc/runes.env; then systemctl restart runes; fi
close_sr_internal runes
if [ -f /etc/systemd/system/polkas.service ]; then
  [ -f /etc/polkas.env ] || install -m 640 -o root -g polkas /dev/null /etc/polkas.env
  if share_sr_secret /etc/polkas.env; then systemctl restart polkas; fi
  close_sr_internal polkas
fi
ok "Таро: $(grep -q '^SR_INTERNAL_SECRET=.' /etc/polkas.env 2>/dev/null && echo подключено || echo не стоит)"
ok "Руны: $(grep -q '^SR_INTERNAL_SECRET=.' /etc/runes.env 2>/dev/null && echo подключены || echo не стоят)"

if [ -n "${ADMIN_EMAIL:-}" ]; then
  log "Администратор"
  # shellcheck disable=SC2046
  sudo -u sraccounts env $(grep -E '^(ACCOUNTS_DB_PATH|PUBLIC_ORIGIN)=' "$ENV_FILE" | xargs) \
    node --disable-warning=ExperimentalWarning "$REPO_DIR/accounts/cli.mjs" create-admin "$ADMIN_EMAIL" "${ADMIN_NAME:-Администратор}"
fi

log "Готово"
cat <<NEXT
  Вход: https://$DOMAIN/account/
  Администратор (если ещё нет):
    sudo ADMIN_EMAIL=почта ADMIN_NAME="Имя" bash infra/vps/15-accounts.sh
  Журнал: journalctl -u sr-accounts -f
  Курсы получают секрет сами (скрипт курса или этот скрипт повторно).
NEXT
