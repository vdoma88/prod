#!/usr/bin/env bash
# Руны → https://runes.belayarod.ru  (vdoma88/runes-belaya, порт 4173, systemd «runes»)
#
#   sudo bash infra/vps/10-runes.sh
#
# Первый запуск: клон, пользователь runes, база, служба, nginx, сертификат.
# Повторный: резервная копия базы → git pull → сборка и проверки → перезапуск.
# Порядок и пути — как в runes-belaya/docs/DEPLOY_1_0.md (вариант B, systemd).
# shellcheck source-path=SCRIPTDIR source=lib.sh
cd "$(dirname "$0")" && . ./lib.sh
need_root

HOST_NAME="runes.$DOMAIN"
APP=/opt/runes
ENV_FILE=/etc/runes.env
PORT=4173

log "Проверки"
require_node
require_dns "$HOST_NAME"
require_port_free "$PORT" node

log "Пользователь и папки"
id runes >/dev/null 2>&1 || adduser --system --group --no-create-home --home /var/lib/runes runes
# /mnt/runes-offsite — второе место для копий базы. Здесь это тот же диск;
# настоящую независимость даст смонтированное сюда внешнее хранилище.
install -d -o runes -g runes -m 700 /var/lib/runes /var/backups/runes /mnt/runes-offsite
ok "runes, /var/lib/runes, /var/backups/runes, /mnt/runes-offsite"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=$PORT
RUNE_PUBLIC_ORIGIN=https://$HOST_NAME
RUNE_DB_PATH=/var/lib/runes/runes.sqlite
RUNE_BACKUP_DIR=/var/backups/runes
RUNE_BACKUP_MIRROR_DIR=/mnt/runes-offsite
ENV
  chown root:runes "$ENV_FILE"; chmod 640 "$ENV_FILE"
  ok "создан $ENV_FILE"
else
  ok "$ENV_FILE уже есть — не трогаю"
fi

if [ -d "$APP/.git" ] && [ -f /var/lib/runes/runes.sqlite ]; then
  log "Резервная копия перед обновлением"
  # Переменные из $ENV_FILE — без пробелов в значениях, разбиение по словам намеренное.
  # shellcheck disable=SC2046
  (cd "$APP" && sudo -u runes env $(grep -v '^#' "$ENV_FILE" | xargs) node scripts/backup.mjs)
  ls -t /var/backups/runes | head -n 1 | sed 's/^/  копия: /'
fi

log "Код"
clone_or_update runes-belaya "$APP"

share_sr_secret "$ENV_FILE" || true

log "Сборка и проверки"
(cd "$APP" && npm run build && npm run check)

log "Служба"
install -m 644 "$APP/deploy/runes.service" /etc/systemd/system/runes.service
systemctl daemon-reload
systemctl enable runes >/dev/null 2>&1
systemctl restart runes
wait_http "http://127.0.0.1:$PORT/api/health"

log "nginx и HTTPS"
nginx_site runes "$SCRIPT_DIR/nginx/runes.conf" "$HOST_NAME"
close_sr_internal runes
wait_http "https://$HOST_NAME/api/health" 10

log "Готово: https://$HOST_NAME"
cat <<NEXT
  Первый администратор (один раз, пароль — длинный и уникальный):
    cd $APP && sudo -u runes env \$(grep -v '^#' $ENV_FILE | xargs) \\
      node scripts/admin.mjs --email=почта --password='пароль' --name='Екатерина Белая'
  Журнал: journalctl -u runes -f
NEXT
