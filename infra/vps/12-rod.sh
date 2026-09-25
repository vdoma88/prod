#!/usr/bin/env bash
# «Связь с Родом» (terapy) → https://rod.belayarod.ru  (vdoma88/terapy, порт 5000, PM2 «rodology-platform»)
#
#   sudo bash infra/vps/12-rod.sh
#
# Первый запуск: база и пользователь PostgreSQL со случайным паролем,
# server/.env с новыми секретами, схема и начальные данные, сборка клиента,
# PM2, nginx, сертификат. Пароль первого специалиста (admin) печатается
# один раз — скрипт сохраняет его в /root/rodology-admin.txt.
# Повторный: git pull → схема без потери данных → сборка → перезапуск.
# Как в terapy/deploy/DEPLOY_BEGET.md, без удаления nginx «default» и без ufw.
# shellcheck source-path=SCRIPTDIR source=lib.sh
cd "$(dirname "$0")" && . ./lib.sh
need_root

HOST_NAME="rod.$DOMAIN"
APP=/var/www/rodology
PORT=5000
PM2_NAME=rodology-platform
DB_NAME=rodology
DB_USER=rodology_user

log "Проверки"
require_node
require_dns "$HOST_NAME"
require_port_free "$PORT" node
command -v pm2 >/dev/null 2>&1 || { npm install -g pm2; ok "pm2 установлен"; }
systemctl is-active --quiet postgresql || die "PostgreSQL не запущен: systemctl start postgresql"

log "Код"
clone_or_update terapy "$APP"
ENV_FILE="$APP/server/.env"

# Отметка об успешной первичной загрузке: если она оборвалась, следующий
# запуск повторит её, а не примет сервер за уже настроенный.
BOOTSTRAP_MARK=/root/.rodology-bootstrap-done
if [ ! -f "$ENV_FILE" ]; then
  log "PostgreSQL: база $DB_NAME"
  db_pass="$(openssl rand -hex 24)"
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
    sudo -u postgres psql -qc "ALTER USER $DB_USER WITH PASSWORD '$db_pass'"
  else
    sudo -u postgres psql -qc "CREATE USER $DB_USER WITH PASSWORD '$db_pass'"
  fi
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 ||
    sudo -u postgres psql -qc "CREATE DATABASE $DB_NAME OWNER $DB_USER"
  ok "база $DB_NAME, пользователь $DB_USER"

  log "server/.env"
  sed -e "s#^DATABASE_URL=.*#DATABASE_URL=\"postgresql://$DB_USER:$db_pass@127.0.0.1:5432/$DB_NAME?schema=public\"#" \
      -e "s#^JWT_SECRET=.*#JWT_SECRET=\"$(openssl rand -hex 32)\"#" \
      -e "s#^JWT_REFRESH_SECRET=.*#JWT_REFRESH_SECRET=\"$(openssl rand -hex 32)\"#" \
      -e "s#^RESEND_API_KEY=.*#RESEND_API_KEY=\"\"#" \
      "$APP/server/.env.beget.example" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "секреты сгенерированы; почта (RESEND_API_KEY) пустая — письма пишутся в журнал, пока ключ не задан"
else
  ok "server/.env уже есть — секреты и база не трогаются"
fi
grep -q "CHANGE_ME" "$ENV_FILE" && die "в $ENV_FILE остались заглушки CHANGE_ME — впишите значения"

log "Сервер: зависимости и схема базы"
cd "$APP/server" || die "нет $APP/server"
npm ci --no-audit --no-fund
if [ -z "$(env_line "$ENV_FILE" VAPID_PUBLIC_KEY)" ]; then
  keys="$(node -e 'const k=require("web-push").generateVAPIDKeys();console.log(k.publicKey+" "+k.privateKey)')"
  sed -i -e "s#^VAPID_PUBLIC_KEY=.*#VAPID_PUBLIC_KEY=\"${keys% *}\"#" -e "s#^VAPID_PRIVATE_KEY=.*#VAPID_PRIVATE_KEY=\"${keys#* }\"#" "$ENV_FILE"
  ok "VAPID-ключи для push-уведомлений"
fi
if [ ! -f "$BOOTSTRAP_MARK" ]; then
  umask 077
  npm run db:bootstrap:beget 2>&1 | tee /root/rodology-admin.txt
  umask 022
  touch "$BOOTSTRAP_MARK"
  ok "начальные данные загружены; пароль admin — в /root/rodology-admin.txt (сменить при первом входе, потом файл удалить)"
else
  # Без --accept-data-loss: если изменение схемы удаляет данные, prisma
  # остановится и ничего не тронет.
  npx prisma generate
  npx prisma db push
fi

log "Клиент: сборка"
cd "$APP/client" || die "нет $APP/client"
npm ci --include=dev --no-audit --no-fund
npm run build
install -d "$APP/server/public"
cp -r dist/. "$APP/server/public/"
ok "статика → server/public"

log "PM2"
cd "$APP/server" || die "нет $APP/server"
install -d "$APP/logs"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save
wait_http "http://127.0.0.1:$PORT/api/health"

log "nginx и HTTPS"
nginx_site rodology "$APP/deploy/nginx.rodology.conf" "$HOST_NAME"
wait_http "https://$HOST_NAME/api/health" 10

log "Готово: https://$HOST_NAME"
cat <<NEXT
  Вход специалиста: admin и пароль из /root/rodology-admin.txt (система попросит сменить).
  Журнал: pm2 logs $PM2_NAME
  Почта: впишите RESEND_API_KEY в $ENV_FILE и pm2 restart $PM2_NAME --update-env
NEXT
