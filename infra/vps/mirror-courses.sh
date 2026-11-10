#!/usr/bin/env bash
# Руны и Таро на запасном сервере без своего домена (ноябрь 2026, авария Beget).
#
#   bash /var/www/prod/infra/vps/mirror-courses.sh
#
# Адреса: https://runes.1-2-3-4.sslip.io и https://taro.1-2-3-4.sslip.io.
# Если курс уже стоит (служба runes / polkas есть) — только адрес, nginx,
# сертификат и PUBLIC_ORIGIN. Если нет — ставит его штатным скриптом
# (10-runes.sh / 11-taro.sh) с DOMAIN зеркала: сайт nginx кладётся заранее
# с адресом зеркала, и штатный скрипт его не перезаписывает.
set -euo pipefail
cd "$(dirname "$0")"
VPS_DIR="$(pwd)"
[ "$(id -u)" = 0 ] || { echo "Запустите от root"; exit 1; }

IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
DOMAIN="${IP//./-}.sslip.io"
export DOMAIN

log() { printf '\n=== %s ===\n' "$*"; }

# site имя хост порт размер_тела — сайт nginx для курса на адресе зеркала
site() {
  local name="$1" host="$2" port="$3" body="$4" f="/etc/nginx/sites-available/$1"
  if [ ! -f "$f" ] || ! grep -q "server_name $host;" "$f"; then
    [ ! -f "$f" ] || cp "$f" "$f.bak-$(date +%Y%m%d-%H%M%S)"
    cat > "$f" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $host;
    client_max_body_size $body;
    location ^~ /sr-internal/ { return 404; }
    location / {
        proxy_pass http://127.0.0.1:$port;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 60s;
    }
}
EOF
  fi
  ln -sfn "$f" "/etc/nginx/sites-enabled/$name"
  nginx -t && systemctl reload nginx
  if ! grep -q "listen 443" "$f"; then
    certbot --nginx -n --agree-tos --register-unsafely-without-email --redirect -d "$host"
  fi
}

# set_env файл ключ значение — заменить или дописать строку
set_env() {
  local file="$1" key="$2" value="$3"
  touch "$file"
  if grep -q "^$key=" "$file"; then sed -i "s|^$key=.*|$key=$value|" "$file"; else echo "$key=$value" >> "$file"; fi
}

has_unit() { systemctl cat "$1" >/dev/null 2>&1; }

log "Руны → https://runes.$DOMAIN"
site runes "runes.$DOMAIN" 4173 2m
if has_unit runes; then
  set_env /etc/runes.env RUNE_PUBLIC_ORIGIN "https://runes.$DOMAIN"
  systemctl restart runes
else
  bash "$VPS_DIR/10-runes.sh"
fi

log "Таро → https://taro.$DOMAIN"
site polkas "taro.$DOMAIN" 3100 128k
if has_unit polkas; then
  [ -f /etc/polkas.env ] || { install -m 640 /dev/null /etc/polkas.env; chown root:polkas /etc/polkas.env 2>/dev/null || true; }
  set_env /etc/polkas.env PUBLIC_ORIGIN "https://taro.$DOMAIN"
  systemctl restart polkas
else
  bash "$VPS_DIR/11-taro.sh"
fi

sleep 3
log "Проверка"
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1"; }
echo "Руны: $(code "https://runes.$DOMAIN/api/health")   https://runes.$DOMAIN"
echo "Таро: $(code "https://taro.$DOMAIN/api/health")   https://taro.$DOMAIN"
