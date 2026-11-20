#!/usr/bin/env bash
# Задать пароль в общем кабинете belayarod.ru/account/ — прямо с сервера.
#
#   sudo bash /var/www/prod/infra/vps/accounts-password.sh почта ["Имя"]
#
# Нет такой почты — заводится администратор (имя по желанию). Пароль
# вводится дважды и скрыто: в историю команд и в журнал он не попадает.
# Прежние входы и ссылка для пароля этой учётки сбрасываются, а служба
# перезапускается — заодно снимается пауза после неверных попыток.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Запустите от root: sudo bash $0 почта"; exit 1; }
EMAIL="${1:-}"; NAME="${2:-}"
case "$EMAIL" in *@*.*) ;; *) echo "Укажите почту: sudo bash $0 почта [\"Имя\"]"; exit 1 ;; esac
ENV_FILE=/etc/sr-accounts.env
REPO="${REPO:-/var/www/prod}"
[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE — общий кабинет не установлен"; exit 1; }
grep -q "'set-password'" "$REPO/accounts/cli.mjs" || { echo "Код общего кабинета старый: cd $REPO && git pull"; exit 1; }
get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }

read -rsp "Новый пароль (не короче 10 знаков): " P1; echo
read -rsp "Ещё раз: " P2; echo
[ "$P1" = "$P2" ] || { echo "Пароли не совпали"; exit 1; }
[ "${#P1}" -ge 10 ] || { echo "Короче 10 знаков"; exit 1; }

printf '%s\n' "$P1" | sudo -u sraccounts env ACCOUNTS_DB_PATH="$(get ACCOUNTS_DB_PATH)" PUBLIC_ORIGIN="$(get PUBLIC_ORIGIN)" ACCOUNT_RESET_SECRET="$(get ACCOUNT_RESET_SECRET)" \
  node --disable-warning=ExperimentalWarning "$REPO/accounts/cli.mjs" set-password "$EMAIL" ${NAME:+"$NAME"}
unset P1 P2
systemctl restart sr-accounts && echo "Общий кабинет перезапущен — можно входить."
