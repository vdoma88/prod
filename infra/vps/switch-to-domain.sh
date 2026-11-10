#!/usr/bin/env bash
# Зеркало → основной сервер на belayarod.ru (ноябрь 2026).
#
# Beget сообщил: облачные VPS утрачены вместе с IP, DNS-записи доменов .ru
# снова можно менять. Сервер 31.56.197.168 становится основным.
#
# Порядок:
#   1. В DNS домена (панель Beget) A-записи @, www, plamya, rod, taro, runes →
#      IP этого сервера. MX и TXT (почта) НЕ трогать.
#   2. Подождать, пока имена начнут указывать сюда (скрипт проверит сам).
#   3. bash /var/www/prod/infra/vps/switch-to-domain.sh
#
# Что делает: проверяет DNS, собирает лендинг с настоящими адресами, ставит
# сайты nginx и сертификаты Let's Encrypt для belayarod.ru и поддоменов,
# переводит адреса в настройках школы, Рода, общего входа, рун, Таро и бота
# на belayarod.ru (копия каждого файла настроек — рядом, .bak-ДАТА), перезапускает
# службы и проверяет ответы. Адреса *.sslip.io продолжают работать как
# запасной вход в школу и Род.
#
# Повторный запуск безопасен. Проверку DNS можно пропустить: SKIP_DNS_CHECK=1.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
. ./lib.sh
need_root

DOMAIN=belayarod.ru
STAMP="$(date +%Y%m%d-%H%M%S)"
IP="$(server_ip)"
has_unit() { systemctl cat "$1" >/dev/null 2>&1; }

HOSTS=("$DOMAIN" "www.$DOMAIN" "plamya.$DOMAIN" "rod.$DOMAIN")
has_unit polkas && HOSTS+=("taro.$DOMAIN")
has_unit runes && HOSTS+=("runes.$DOMAIN")

log "DNS: имена должны указывать на $IP"
if [ "${SKIP_DNS_CHECK:-0}" != 1 ]; then
  bad=()
  for h in "${HOSTS[@]}"; do
    got="$(getent ahostsv4 "$h" | awk '{print $1}' | sort -u | tr '\n' ' ')"
    if [[ " $got " == *" $IP "* ]]; then ok "$h → $IP"; else bad+=("$h (сейчас: ${got:-нет записи})"); fi
  done
  if [ "${#bad[@]}" -gt 0 ]; then
    printf '  ✗ %s\n' "${bad[@]}"
    die "Не все имена указывают на этот сервер. В панели Beget → DNS → $DOMAIN: A-записи @, www, plamya, rod, taro, runes → $IP (MX и TXT не трогать). Записи расходятся от 5 минут до пары часов — запустите скрипт снова."
  fi
fi

# set_env файл ключ значение — заменить или дописать строку; копия файла один раз за запуск
set_env() {
  local file="$1" key="$2" value="$3"
  [ -f "$file" ] || return 0
  [ -f "$file.bak-$STAMP" ] || cp -p "$file" "$file.bak-$STAMP"
  if grep -q "^$key=" "$file"; then sed -i "s|^$key=.*|$key=$value|" "$file"; else echo "$key=$value" >> "$file"; fi
}

# site имя хост порт размер_тела [путь_вложений] — сайт nginx-прокси для поддомена
site() {
  local name="$1" host="$2" port="$3" body="$4" uploads="${5:-}" f="/etc/nginx/sites-available/$1"
  if [ ! -f "$f" ] || ! grep -q "server_name $host;" "$f"; then
    {
      echo "# $host — ставит infra/vps/switch-to-domain.sh; HTTPS дописывает certbot"
      echo "server {"
      echo "    listen 80;"
      echo "    listen [::]:80;"
      echo "    server_name $host;"
      echo "    client_max_body_size $body;"
      echo "    location ^~ /sr-internal/ { return 404; }"
      if [ -n "$uploads" ]; then
        echo "    location ^~ /uploads/ {"
        echo "        alias $uploads/;"
        echo "        try_files \$uri =404;"
        echo "        add_header Cache-Control \"public, max-age=2592000\";"
        echo "    }"
      fi
      echo "    location / {"
      echo "        proxy_pass http://127.0.0.1:$port;"
      echo "        proxy_http_version 1.1;"
      echo "        proxy_set_header Host \$host;"
      echo "        proxy_set_header X-Real-IP \$remote_addr;"
      echo "        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
      echo "        proxy_set_header X-Forwarded-Proto \$scheme;"
      echo "        proxy_read_timeout 180s;"
      echo "    }"
      echo "}"
    } > "$f"
  fi
  ln -sfn "$f" "/etc/nginx/sites-enabled/$name"
  nginx -t && systemctl reload nginx
  grep -q "listen 443" "$f" || certbot_nginx "$host"
}

log "Лендинг: сборка с настоящими адресами"
(cd /var/www/prod && node scripts/build.mjs)

log "nginx и сертификат belayarod.ru"
install -d /etc/nginx/snippets/belayarod-extra
install -m 644 ../nginx/snippets/sila-roda-headers.conf /etc/nginx/snippets/sila-roda-headers.conf
# Проверка Let's Encrypt — через папку на диске: и при выпуске (временный сайт
# на 80-м порту), и при продлении (сниппет внутри HTTPS-блока: http-запрос
# проверки уходит редиректом на https и попадает туда)
ACME=/var/www/letsencrypt
install -d "$ACME"
printf 'location ^~ /.well-known/acme-challenge/ { root %s; default_type text/plain; }\n' "$ACME" \
  > /etc/nginx/snippets/belayarod-extra/acme.conf
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  cat > /etc/nginx/sites-enabled/zz-acme-$DOMAIN <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    location ^~ /.well-known/acme-challenge/ { root $ACME; default_type text/plain; }
    location / { return 404; }
}
EOF
  nginx -t && systemctl reload nginx
  account=(--register-unsafely-without-email)
  [ -z "$CERTBOT_EMAIL" ] || account=(-m "$CERTBOT_EMAIL")
  if ! certbot certonly --webroot -w "$ACME" -n --agree-tos "${account[@]}" --cert-name "$DOMAIN" -d "$DOMAIN" -d "www.$DOMAIN"; then
    rm -f "/etc/nginx/sites-enabled/zz-acme-$DOMAIN"; systemctl reload nginx
    die "Сертификат для $DOMAIN не выдан — проверьте A-записи @ и www"
  fi
  rm -f "/etc/nginx/sites-enabled/zz-acme-$DOMAIN"
fi
install -m 644 ../nginx/belayarod.ru.conf "/etc/nginx/sites-available/$DOMAIN"
ln -sfn "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t && systemctl reload nginx
ok "https://$DOMAIN"

log "Поддомены"
site domain-plamya "plamya.$DOMAIN" 3000 30m /var/www/flame-app/public/uploads
site domain-rod "rod.$DOMAIN" 5000 55m /var/www/rodology/server/storage/uploads
has_unit polkas && site domain-taro "taro.$DOMAIN" 3100 128k
has_unit runes && site domain-runes "runes.$DOMAIN" 4173 2m

log "Адреса в настройках курсов"
set_env /var/www/flame-app/.env.local SCHOOL_URL "https://plamya.$DOMAIN"
set_env /var/www/rodology/server/.env CLIENT_URL "https://rod.$DOMAIN"
set_env /var/www/rodology/server/.env APP_URL "https://rod.$DOMAIN"
set_env /etc/sr-accounts.env PUBLIC_ORIGIN "https://$DOMAIN"
set_env /etc/sr-accounts.env COOKIE_DOMAIN ".$DOMAIN"
set_env /etc/runes.env RUNE_PUBLIC_ORIGIN "https://runes.$DOMAIN"
set_env /etc/polkas.env PUBLIC_ORIGIN "https://taro.$DOMAIN"
set_env /etc/rodbot.env PUBLIC_URL "https://$DOMAIN/tg/rod-bot"
for unit in flame-school rodology sr-accounts runes polkas rodbot; do
  if has_unit "$unit" && systemctl is-enabled --quiet "$unit" 2>/dev/null; then
    systemctl restart "$unit" && ok "перезапущено: $unit" || warn "не перезапустилось: $unit (journalctl -u $unit -n 30)"
  fi
done

log "Проверка"
sleep 5
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1"; }
for u in "https://$DOMAIN/" "https://$DOMAIN/account/" "https://plamya.$DOMAIN/" "https://rod.$DOMAIN/api/health"; do
  printf '  %s  %s\n' "$(code "$u")" "$u"
done
has_unit polkas && printf '  %s  %s\n' "$(code "https://taro.$DOMAIN/api/health")" "https://taro.$DOMAIN"
has_unit runes && printf '  %s  %s\n' "$(code "https://runes.$DOMAIN/api/health")" "https://runes.$DOMAIN"

cat <<NEXT

Готово. 200 — адрес работает.
  Лендинг и общий кабинет: https://$DOMAIN  ·  https://$DOMAIN/account/
  Школа: https://plamya.$DOMAIN    Род: https://rod.$DOMAIN
Запасной вход, если с доменом что-то случится:
  https://plamya.${IP//./-}.sslip.io    https://rod.${IP//./-}.sslip.io
Общий кабинет теперь работает только на $DOMAIN (вход по sslip.io — нет).
Копии прежних настроек: файлы *.bak-$STAMP рядом с исходными.
NEXT
