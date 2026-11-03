#!/usr/bin/env bash
# Учётки «Связи с Родом» → общий вход на аварийном зеркале (ноябрь 2026).
#
#   bash /var/www/prod/infra/vps/mirror-import-rod-users.sh
#
# База общего входа погибла вместе с сервером Beget, а ученицы и их пароли
# остались в базе Рода. Скрипт:
#   1. заводит в общем входе всех пользователей Рода с почтой (ученицы —
#      student, админы Рода — admin) и открывает им курс «Связь с Родом»;
#      уже заведённых не трогает, только открывает курс;
#   2. включает ROD_PASSWORD_FALLBACK=1: при первом входе пароль сверяется
#      с Родом и сохраняется в общем входе (accounts/app.mjs). Пароли из базы
#      Рода не копируются и никуда не выводятся.
# Повторный запуск безопасен.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Запустите от root"; exit 1; }
ENV_FILE=/etc/sr-accounts.env
REPO=/var/www/prod
[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE — общий вход не установлен"; exit 1; }
grep -q 'import-rod' "$REPO/accounts/cli.mjs" || { echo "Код общего входа старый: сначала cd $REPO и git pull"; exit 1; }

DB_OK="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='rodology'" || true)"
[ "$DB_OK" = 1 ] || { echo "Нет базы rodology"; exit 1; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
chmod 755 "$WORK"
USERS="$WORK/rod-users.json"
# Файлы пишет и читает root (скрипт под root); sudo — только для psql и node
# shellcheck disable=SC2024
sudo -u postgres psql -d rodology -tAc \
  "SELECT COALESCE(json_agg(json_build_object('email', lower(email), 'name', name, 'role', role::text)), '[]') FROM \"User\" WHERE email IS NOT NULL AND email <> ''" > "$USERS"
chmod 644 "$USERS"
NOMAIL="$(sudo -u postgres psql -d rodology -tAc "SELECT count(*) FROM \"User\" WHERE email IS NULL OR email = ''")"

get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
# shellcheck disable=SC2024
sudo -u sraccounts env ACCOUNTS_DB_PATH="$(get ACCOUNTS_DB_PATH)" PUBLIC_ORIGIN="$(get PUBLIC_ORIGIN)" ACCOUNT_RESET_SECRET="$(get ACCOUNT_RESET_SECRET)" \
  node --disable-warning=ExperimentalWarning "$REPO/accounts/cli.mjs" import-rod < "$USERS"
[ "$NOMAIL" = 0 ] || echo "Без почты (только логин) — $NOMAIL: в общий вход не заведены, входят в Род как раньше."

if grep -q '^ROD_PASSWORD_FALLBACK=' "$ENV_FILE"; then
  sed -i 's/^ROD_PASSWORD_FALLBACK=.*/ROD_PASSWORD_FALLBACK=1/' "$ENV_FILE"
else
  printf '\n# Зеркало: первый вход сверяется с паролем Рода (accounts/app.mjs)\nROD_PASSWORD_FALLBACK=1\n' >> "$ENV_FILE"
fi
systemctl restart sr-accounts
sleep 2
systemctl is-active --quiet sr-accounts && echo "Общий вход перезапущен." || { echo "sr-accounts не запустился: journalctl -u sr-accounts -n 30"; exit 1; }
echo
echo "Готово. Входите в $(get PUBLIC_ORIGIN)/account/ той же почтой и паролем, что в Роде."
