#!/usr/bin/env bash
# Обновление belayarod.ru: git pull → проверка исходников → сборка
# (dist/ подменяется целиком, см. scripts/build.mjs) → nginx -t && reload.
# Если проверка не прошла, dist/ остаётся прежним.
set -euo pipefail
cd "$(dirname "$0")/.."

# Не прерываем публикацию посередине и не собираем две версии одновременно.
exec 9>/var/lock/belayarod-deploy.lock
flock 9

git pull --ff-only
EXPECTED_COMMIT="$(git rev-parse HEAD)"
node scripts/check.mjs --sources
node scripts/build.mjs

install -m 644 infra/nginx/snippets/sila-roda-headers.conf /etc/nginx/snippets/sila-roda-headers.conf
if [ -e /etc/nginx/sites-enabled/belayarod.ru ]; then
  install -m 644 infra/nginx/belayarod.ru.conf /etc/nginx/sites-available/belayarod.ru
fi
nginx -t
systemctl reload nginx
# Общий вход (accounts/) — перезапуск, если он уже поставлен (infra/vps/15-accounts.sh).
if systemctl is-enabled --quiet sr-accounts 2>/dev/null; then systemctl restart sr-accounts; fi

EXPECTED_SHA="$EXPECTED_COMMIT" LIVE_ATTEMPTS=6 \
  LIVE_REPORT_PATH=/var/log/prod-live-version.json node scripts/check-live.mjs

echo "belayarod.ru обновлён и подтверждён: $(git log -1 --format='%h %s')"

# Вызывается только после успешных сборки, reload и сверки опубликованного SHA.
# Без токена остаётся резервная проверка по push; настройка — infra/DEPLOY.md.
EXPECTED_SHA="$EXPECTED_COMMIT" node scripts/dispatch-live-audit.mjs
