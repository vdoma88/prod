#!/usr/bin/env bash
# Сила Рода на запасном сервере без своего домена (ноябрь 2026, авария Beget).
#
# Ставит из этого репозитория лендинг, общий вход (/account/) и Telegram-бота
# на адрес https://1-2-3-4.sslip.io — IP сервера через дефисы. Школа и Род
# ставятся до этого скриптом flame-app/deploy/mirror.sh и живут на
# plamya.1-2-3-4.sslip.io и rod.1-2-3-4.sslip.io.
#
#   bash /var/www/prod/infra/vps/mirror.sh
#
# Что отличается от боевого belayarod.ru:
#   - конфиг nginx — тот же belayarod.ru.conf, домен подставляется при установке;
#   - в собранном сайте belayarod.ru заменён на адрес зеркала (ссылки на
#     кабинеты, вход), поисковикам зеркало закрыто (robots.txt);
#   - общий вход стартует с пустой базой: база с Beget в копии не попала.
#     Курсы к нему НЕ подключаются — Род и школа на зеркале пускают по своим
#     паролям. Администратор заводится здесь же (почта спрашивается);
#   - бот: токен спрашивается на сервере (в чат не присылать), вебхук
#     переезжает на зеркало. Род получает секрет бота — ночные копии Рода
#     снова поедут в Telegram.
#
# Повторный запуск безопасен: секреты и базы не пересоздаёт, сайт пересобирает.
set -euo pipefail
cd "$(dirname "$0")"
REPO_DIR="$(cd ../.. && pwd)"
[ "$(id -u)" = 0 ] || { echo "Запустите от root"; exit 1; }
[ "$REPO_DIR" = /var/www/prod ] || { echo "Репозиторий должен лежать в /var/www/prod (сейчас $REPO_DIR)"; exit 1; }

log() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }

IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
DOMAIN="${IP//./-}.sslip.io"
echo "Адрес зеркала: https://$DOMAIN"
command -v node >/dev/null || die "нет Node.js — сначала flame-app/deploy/mirror.sh"
command -v nginx >/dev/null || die "нет nginx — сначала flame-app/deploy/mirror.sh"

# Подставить адрес зеркала вместо belayarod.ru (и в регулярных выражениях nginx)
to_mirror() {
  python3 - "$DOMAIN" "$@" <<'PY'
import re, sys
domain, files = sys.argv[1], sys.argv[2:]
for f in files:
    s = open(f, encoding='utf-8').read()
    t = s.replace('belayarod\\.ru', re.escape(domain).replace('\\-', '-')).replace('belayarod.ru', domain)
    if t != s:
        open(f, 'w', encoding='utf-8').write(t)
PY
}

# --- 1. Лендинг ---
log "Собираю лендинг"
cd "$REPO_DIR"
node scripts/build.mjs
mapfile -t PAGES < <(grep -rlE 'belayarod\.ru' dist --include='*.html' --include='*.js' --include='*.json' --include='*.webmanifest' || true)
[ "${#PAGES[@]}" -gt 0 ] && to_mirror "${PAGES[@]}"
printf 'User-agent: *\nDisallow: /\n' > dist/robots.txt
echo "Страниц с адресами зеркала: ${#PAGES[@]}"

# --- 2. Общий вход ---
log "Общий вход"
ENV_ACC=/etc/sr-accounts.env
id sraccounts >/dev/null 2>&1 || adduser --system --group --no-create-home --home /var/lib/sr-accounts sraccounts
install -d -o sraccounts -g sraccounts -m 700 /var/lib/sr-accounts
if [ ! -f "$ENV_ACC" ]; then
  cat > "$ENV_ACC" <<ENV
HOST=127.0.0.1
PORT=4320
ACCOUNTS_DB_PATH=/var/lib/sr-accounts/accounts.sqlite
PUBLIC_ORIGIN=https://$DOMAIN
COOKIE_DOMAIN=.$DOMAIN
TRUST_PROXY=1
SR_INTERNAL_SECRET=$(openssl rand -hex 24)
ACCOUNT_RESET_SECRET=$(openssl rand -hex 32)
ENV
  chown root:sraccounts "$ENV_ACC"; chmod 640 "$ENV_ACC"
fi
install -m 644 accounts/deploy/sr-accounts.service /etc/systemd/system/sr-accounts.service

# --- 3. Бот ---
log "Telegram-бот"
ENV_BOT=/etc/rodbot.env
id rodbot >/dev/null 2>&1 || adduser --system --group --no-create-home --home /var/lib/rodbot rodbot
install -d -o rodbot -g rodbot -m 700 /var/lib/rodbot
if [ ! -f "$ENV_BOT" ]; then
  cat > "$ENV_BOT" <<ENV
HOST=127.0.0.1
PORT=4310
BOT_DB_PATH=/var/lib/rodbot/bot.sqlite
PUBLIC_URL=https://$DOMAIN/tg/rod-bot
TELEGRAM_BOT_TOKEN=
WEBHOOK_SECRET=$(openssl rand -hex 24)
ADMIN_CODE=$(openssl rand -hex 8)
NOTIFY_SECRET=$(openssl rand -hex 24)
ENV
  chown root:rodbot "$ENV_BOT"; chmod 640 "$ENV_BOT"
fi
if ! grep -q '^TELEGRAM_BOT_TOKEN=.\+' "$ENV_BOT"; then
  echo "Токен бота лендинга (@BotFather → бот → API Token). Вставьте и нажмите Enter;"
  echo "на экране он не виден. Пусто — бот пока не ставим."
  read -r -s -p "Токен: " TOKEN; echo
  if [ -n "$TOKEN" ]; then
    [[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] || die "не похоже на токен бота"
    sed -i "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=$TOKEN|" "$ENV_BOT"
  fi
  unset TOKEN
fi
BOT_ON=0
grep -q '^TELEGRAM_BOT_TOKEN=.\+' "$ENV_BOT" && BOT_ON=1
install -m 644 bot/deploy/rodbot.service /etc/systemd/system/rodbot.service

# --- 4. nginx и сертификат ---
log "nginx и HTTPS"
install -d /etc/nginx/snippets/belayarod-extra
install -m 644 infra/nginx/snippets/sila-roda-headers.conf /etc/nginx/snippets/sila-roda-headers.conf
rm -f /etc/nginx/sites-enabled/mirror-landing
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  certbot certonly --nginx -n --agree-tos --register-unsafely-without-email --cert-name "$DOMAIN" -d "$DOMAIN" -d "www.$DOMAIN" \
    || die "сертификат для $DOMAIN не выдан"
fi
install -m 644 infra/nginx/belayarod.ru.conf /etc/nginx/sites-available/sila-roda-mirror
to_mirror /etc/nginx/sites-available/sila-roda-mirror
ln -sf /etc/nginx/sites-available/sila-roda-mirror /etc/nginx/sites-enabled/sila-roda-mirror
nginx -t
systemctl reload nginx

# --- 5. Службы ---
log "Запускаю службы"
systemctl daemon-reload
systemctl enable sr-accounts >/dev/null 2>&1
systemctl restart sr-accounts
if [ "$BOT_ON" = 1 ]; then
  systemctl enable rodbot >/dev/null 2>&1
  systemctl restart rodbot
  # Общий вход шлёт боту сводку телеметрии, Род — уведомления о ДЗ и ночные копии
  NOTIFY="$(grep -E '^NOTIFY_SECRET=' "$ENV_BOT" | cut -d= -f2-)"
  if ! grep -q '^ROD_NOTIFY_SECRET=.' "$ENV_ACC"; then
    echo "ROD_NOTIFY_SECRET=$NOTIFY" >> "$ENV_ACC"
    systemctl restart sr-accounts
  fi
  ROD_ENV=/var/www/rodology/server/.env
  if [ -f "$ROD_ENV" ] && ! grep -q '^ROD_NOTIFY_SECRET=.' "$ROD_ENV"; then
    sed -i '/^ROD_NOTIFY_SECRET=/d' "$ROD_ENV"
    echo "ROD_NOTIFY_SECRET=$NOTIFY" >> "$ROD_ENV"
    systemctl restart rodology || true
  fi
  if [ -d /var/www/rodology/server ] && [ ! -f /etc/cron.d/rodology-backup ]; then
    printf '40 3 * * * root cd /var/www/rodology/server && %s scripts/backup.js >> /var/log/rodology-backup.log 2>&1\n' "$(command -v node)" > /etc/cron.d/rodology-backup
  fi
fi

# --- 6. Администратор общего входа ---
ADMIN_LINE=""
ADMIN_MARK=/var/lib/sr-accounts/.mirror-admin
if [ ! -f "$ADMIN_MARK" ]; then
  read -r -p "Почта администратора общего входа (Enter — пропустить): " ADMIN_EMAIL
  if [ -n "$ADMIN_EMAIL" ]; then
    read -r -p "Имя администратора: " ADMIN_NAME
    # shellcheck disable=SC2046
    ADMIN_LINE="$(sudo -u sraccounts env $(grep -E '^(ACCOUNTS_DB_PATH|PUBLIC_ORIGIN|ACCOUNT_RESET_SECRET)=' "$ENV_ACC" | xargs) \
      node --disable-warning=ExperimentalWarning "$REPO_DIR/accounts/cli.mjs" create-admin "$ADMIN_EMAIL" "${ADMIN_NAME:-Администратор}")"
    touch "$ADMIN_MARK"
  fi
fi

# --- 7. Проверка ---
sleep 3
log "Проверка"
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1"; }
echo "Лендинг:     $(code "https://$DOMAIN/")"
echo "Общий вход:  $(code "https://$DOMAIN/account/")"
[ "$BOT_ON" = 1 ] && echo "Бот:         $(code http://127.0.0.1:4310/tg/rod-bot/health)"
echo
echo "Готово."
echo "  Лендинг:     https://$DOMAIN"
echo "  Общий вход:  https://$DOMAIN/account/"
echo "  Школа:       https://plamya.$DOMAIN"
echo "  Род:         https://rod.$DOMAIN"
[ -n "$ADMIN_LINE" ] && { echo; echo "$ADMIN_LINE"; }
if [ "$BOT_ON" = 1 ]; then
  # shellcheck disable=SC1090
  CODE="$(. "$ENV_BOT"; printf '%s' "$ADMIN_CODE")"
  echo
  echo "Бот: заявки снова будут приходить Екатерине, если она откроет в своём Telegram"
  echo "  https://t.me/ИМЯ_БОТА?start=admin-$CODE"
else
  echo "Бот не поставлен (нет токена). Повторите скрипт, когда токен будет под рукой."
fi
