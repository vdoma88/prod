#!/usr/bin/env bash
# Обновление belayarod.ru: git pull → проверка исходников → сборка
# (dist/ подменяется целиком, см. scripts/build.mjs) → nginx -t && reload.
# Если проверка не прошла, dist/ остаётся прежним.
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
node scripts/check.mjs --sources
node scripts/build.mjs

install -m 644 infra/nginx/snippets/sila-roda-headers.conf /etc/nginx/snippets/sila-roda-headers.conf
if [ -e /etc/nginx/sites-enabled/belayarod.ru ]; then
  install -m 644 infra/nginx/belayarod.ru.conf /etc/nginx/sites-available/belayarod.ru
fi
nginx -t
systemctl reload nginx
echo "belayarod.ru обновлён: $(git log -1 --format='%h %s')"
