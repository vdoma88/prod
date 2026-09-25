#!/usr/bin/env bash
# Программы для всех проектов сервера: nginx, certbot, PostgreSQL, Node.js 22, PM2.
#
#   sudo bash infra/vps/02-packages.sh
#
# Ставит только то, чего нет; уже установленное не обновляет (apt --no-upgrade).
# Исключение — Node.js: Таро и руны работают на встроенном node:sqlite, ему
# нужен Node 22.13+. Школа (Next.js 16) и terapy на Node 22 тоже работают.
# Обновление Node общее: процессы PM2 (школа) перезапускаются на новой
# версии — несколько секунд недоступности, поэтому скрипт спрашивает.
# shellcheck source-path=SCRIPTDIR source=lib.sh
cd "$(dirname "$0")" && . ./lib.sh
need_root

log "Пакеты"
missing=()
for pkg in nginx certbot python3-certbot-nginx git curl iproute2 openssl; do
  dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
done
# PostgreSQL нужен terapy; у школы он обычно уже стоит.
dpkg -s postgresql >/dev/null 2>&1 || missing+=(postgresql postgresql-contrib)
if [ "${#missing[@]}" -gt 0 ]; then
  apt-get update -q
  apt-get install -y --no-upgrade "${missing[@]}"
  ok "установлено: ${missing[*]}"
else
  ok "nginx, certbot, PostgreSQL и остальное уже есть"
fi
systemctl enable --now postgresql >/dev/null 2>&1 || true

log "Node.js"
if node_ok; then
  ok "$(node -v) — обновлять не нужно"
else
  warn "сейчас $(node -v 2>/dev/null || echo 'Node не установлен'), нужен 22.13+"
  confirm "Поставить Node.js 22 из NodeSource и перезапустить процессы PM2 (школа будет недоступна несколько секунд)?" ||
    die "отменено"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  node_ok || die "после установки node -v = $(node -v) — ожидался 22.13+"
  ok "Node.js $(node -v), $(command -v node)"
  if command -v pm2 >/dev/null 2>&1; then
    pm2 update
    pm2 save
    ok "процессы PM2 перезапущены на новом Node. Проверьте школу: https://$DOMAIN"
  fi
fi

log "PM2"
if command -v pm2 >/dev/null 2>&1; then
  ok "pm2 $(pm2 -v)"
else
  npm install -g pm2
  ok "pm2 установлен"
fi
pm2 list
