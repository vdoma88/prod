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

EXPECTED_COMMIT="$(git rev-parse HEAD)"
LIVE_VERSION="$(curl -fsS --max-time 20 -H 'Cache-Control: no-cache' "https://belayarod.ru/version.json?ts=$(date +%s)" || true)"
LIVE_COMMIT="$(printf '%s' "$LIVE_VERSION" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).commit||'')}catch{console.log('')}})" 2>/dev/null)"
if [ "$LIVE_COMMIT" != "$EXPECTED_COMMIT" ]; then
  echo "ОШИБКА: live-версия не совпала с git HEAD."
  echo "ожидали: $EXPECTED_COMMIT"
  echo "live:     ${LIVE_COMMIT:-нет version.json}"
  exit 1
fi

echo "belayarod.ru обновлён и подтверждён: $(git log -1 --format='%h %s')"
