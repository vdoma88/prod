#!/usr/bin/env bash
# Карты Таро → https://taro.belayarod.ru  (vdoma88/tarot, порт 3100, systemd «polkas»)
#
#   sudo bash infra/vps/11-taro.sh
#
# Первый запуск: клон, пользователь polkas, служба, nginx, сертификат,
# ежедневная копия базы. Повторный: копия → git pull → перезапуск.
# Как в tarot/docs/deploy-beget.md, но без шагов, опасных на общем
# сервере: сайт nginx «default» не удаляется, ufw не включается.
# shellcheck source-path=SCRIPTDIR source=lib.sh
cd "$(dirname "$0")" && . ./lib.sh
need_root

HOST_NAME="taro.$DOMAIN"
APP=/opt/polkas/app
PORT=3100

log "Проверки"
require_node
require_dns "$HOST_NAME"
require_port_free "$PORT" node

log "Пользователь и папки"
id polkas >/dev/null 2>&1 || adduser --system --group --home /opt/polkas polkas
install -d -o polkas -g polkas -m 700 /var/lib/polkas
install -d -m 755 /opt/polkas
ok "polkas, /var/lib/polkas"

if [ -d "$APP/.git" ] && [ -x /etc/cron.daily/polkas-backup ] && [ -f /var/lib/polkas/cabinet.db ]; then
  log "Резервная копия перед обновлением"
  /etc/cron.daily/polkas-backup && ls -t /var/backups/polkas | head -n 1 | sed 's/^/  копия: /'
fi

log "Код"
clone_or_update tarot "$APP"
grep -q 'Environment=PORT=3100' "$APP/server/deploy/polkas.service" ||
  die "в $APP/server/deploy/polkas.service порт не 3100 — нужна версия tarot после PR #3"

log "Служба"
install -m 644 "$APP/server/deploy/polkas.service" /etc/systemd/system/polkas.service
systemctl daemon-reload
systemctl enable polkas >/dev/null 2>&1
systemctl restart polkas
wait_http "http://127.0.0.1:$PORT/"

log "Ежедневная копия базы"
install -m 755 "$APP/server/deploy/backup.sh" /etc/cron.daily/polkas-backup
ok "/etc/cron.daily/polkas-backup → /var/backups/polkas, 14 дней"

log "nginx и HTTPS"
nginx_site polkas "$APP/server/deploy/nginx.conf" "$HOST_NAME"
wait_http "https://$HOST_NAME/" 10

log "Готово: https://$HOST_NAME"
cat <<NEXT
  Первый администратор (напечатает ссылку, по ней задаётся пароль):
    cd $APP && sudo -u polkas env DATA_DIR=/var/lib/polkas PUBLIC_ORIGIN=https://$HOST_NAME \\
      node server/cli.js create-admin почта "Екатерина Белая"
  Журнал: journalctl -u polkas -f
NEXT
