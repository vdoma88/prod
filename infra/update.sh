#!/usr/bin/env bash
# Обновление belayarod.ru: git pull → проверка исходников → сборка
# (dist/ подменяется целиком, см. scripts/build.mjs) → nginx -t && reload.
# Если проверка не прошла, dist/ остаётся прежним.
set -euo pipefail
cd "$(dirname "$0")/.."

# Не прерываем публикацию посередине и не собираем две версии одновременно.
exec 9>/var/lock/belayarod-deploy.lock
flock 9

# На сервере всегда публикуем main. Раньше git pull обновлял текущую
# ветку: если VPS случайно оставался на feature-ветке, скрипт успешно
# пересобирал старый commit и live-проверка считала его ожидаемым.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Есть локальные изменения в /var/www/prod. Деплой остановлен, чтобы их не потерять." >&2
  git status --short >&2
  exit 1
fi
git fetch origin main
CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Переключаю репозиторий с ${CURRENT_BRANCH:-detached HEAD} на main"
  git switch main
fi
git merge --ff-only origin/main
EXPECTED_COMMIT="$(git rev-parse HEAD)"
REMOTE_MAIN="$(git rev-parse origin/main)"
if [ "$EXPECTED_COMMIT" != "$REMOTE_MAIN" ]; then
  echo "Локальный main не совпадает с origin/main: $EXPECTED_COMMIT != $REMOTE_MAIN" >&2
  exit 1
fi
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
