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
# Телеметрия в Telegram: служба входа шлёт сводки через бота лендинга тем же
# секретом, что курсы (bot/README.md). Один раз переносим его из /etc/rodbot.env.
if [ -f /etc/rodbot.env ] && [ -f /etc/sr-accounts.env ] && ! grep -q '^ROD_NOTIFY_SECRET=.\+' /etc/sr-accounts.env; then
  NOTIFY_SECRET_VALUE="$(sed -n 's/^NOTIFY_SECRET=//p' /etc/rodbot.env | tail -n 1)"
  if [ -n "$NOTIFY_SECRET_VALUE" ]; then
    printf '# Телеметрия лендинга в Telegram через бота (accounts/pulse-watch.mjs)\nROD_NOTIFY_SECRET=%s\n' "$NOTIFY_SECRET_VALUE" >> /etc/sr-accounts.env
    echo "Телеметрия в Telegram: секрет бота добавлен в /etc/sr-accounts.env"
  fi
fi
# Действующую одноразовую ссылку задания пароля админка должна уметь показать
# повторно. Секрет создаётся один раз и не меняется при последующих обновлениях.
if [ -f /etc/sr-accounts.env ] && ! grep -q '^ACCOUNT_RESET_SECRET=.\+' /etc/sr-accounts.env; then
  printf '# Ссылки задания пароля: повторный показ до использования/истечения\nACCOUNT_RESET_SECRET=%s\n' "$(openssl rand -hex 32)" >> /etc/sr-accounts.env
  echo "Общий вход: добавлен ACCOUNT_RESET_SECRET"
fi
# Бот лендинга (bot/) и общий вход (accounts/) — перезапуск, если они уже поставлены
# (infra/vps/14-bot.sh, 15-accounts.sh). Telegram повторит вебхук, пришедший за эти секунды.
if systemctl is-enabled --quiet rodbot 2>/dev/null; then systemctl restart rodbot; fi
if systemctl is-enabled --quiet sr-accounts 2>/dev/null; then systemctl restart sr-accounts; fi

EXPECTED_SHA="$EXPECTED_COMMIT" LIVE_ATTEMPTS=6 \
  LIVE_REPORT_PATH=/var/log/prod-live-version.json node scripts/check-live.mjs

echo "belayarod.ru обновлён и подтверждён: $(git log -1 --format='%h %s')"

# Вызывается только после успешных сборки, reload и сверки опубликованного SHA.
# Без токена остаётся резервная проверка по push; настройка — infra/DEPLOY.md.
EXPECTED_SHA="$EXPECTED_COMMIT" node scripts/dispatch-live-audit.mjs
