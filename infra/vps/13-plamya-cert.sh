#!/usr/bin/env bash
# Сертификат для plamya.belayarod.ru — будущего адреса школы «Язык Пламени».
#
#   sudo bash infra/vps/13-plamya-cert.sh
#
# Школу не трогает. Ставит временный блок nginx (plamya → belayarod.ru)
# и выпускает на него сертификат, чтобы в день переезда он уже был.
# Сам переезд делается отдельно, скриптом из репозитория flame-app.
# shellcheck source-path=SCRIPTDIR source=lib.sh
cd "$(dirname "$0")" && . ./lib.sh
need_root

HOST_NAME="plamya.$DOMAIN"

log "Проверки"
require_dns "$HOST_NAME"
if grep -rqs "server_name[^;]*\b$HOST_NAME\b" /etc/nginx/sites-enabled/ --exclude=plamya; then
  ok "$HOST_NAME уже обслуживает другой конфиг (школа переехала?) — временный блок не нужен"
  [ -d "/etc/letsencrypt/live/$HOST_NAME" ] || certbot_nginx "$HOST_NAME"
  exit 0
fi

log "nginx и HTTPS"
nginx_site plamya "$SCRIPT_DIR/nginx/plamya.conf" "$HOST_NAME"
code="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "https://$HOST_NAME/")"
ok "https://$HOST_NAME → $code"

log "Готово"
echo "  Сертификат: /etc/letsencrypt/live/$HOST_NAME/. Пока адрес ведёт на https://$DOMAIN."
