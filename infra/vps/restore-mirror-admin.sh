#!/usr/bin/env bash
# Bootstrap mirror administrator without redeploying nginx or courses.
# Runs on the recovery VPS; prints a one-time private password-setup link.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Run as root' >&2; exit 1; }
cd /var/www/prod
ENV_FILE=/etc/sr-accounts.env
[ -f "$ENV_FILE" ] || { echo 'Accounts environment missing; install mirror hub first.' >&2; exit 1; }
systemctl is-active --quiet sr-accounts || { echo 'sr-accounts is not running.' >&2; exit 1; }
EMAIL="${ADMIN_EMAIL:-}"
if [ -z "$EMAIL" ]; then read -r -p 'Email for the mirror administrator: ' EMAIL; fi
case "$EMAIL" in
  *@*.*) ;;
  *) echo 'Invalid administrator email.' >&2; exit 1 ;;
esac
NAME="${ADMIN_NAME:-Администратор}"
PUBLIC_ORIGIN="$(sed -n 's/^PUBLIC_ORIGIN=//p' "$ENV_FILE" | tail -1)"
SECRET="$(sed -n 's/^ACCOUNT_RESET_SECRET=//p' "$ENV_FILE" | tail -1)"
DATABASE="$(sed -n 's/^ACCOUNTS_DB_PATH=//p' "$ENV_FILE" | tail -1)"
[ -n "$PUBLIC_ORIGIN" ] && [ -n "$SECRET" ] && [ -n "$DATABASE" ] || { echo 'Incomplete accounts settings; refusing to create administrator.' >&2; exit 1; }
printf 'Creating/checking administrator for %s\n' "$PUBLIC_ORIGIN"
sudo -u sraccounts env ACCOUNTS_DB_PATH="$DATABASE" PUBLIC_ORIGIN="$PUBLIC_ORIGIN" ACCOUNT_RESET_SECRET="$SECRET" \
  node /var/www/prod/accounts/cli.mjs create-admin "$EMAIL" "$NAME"
echo 'Keep the password-setup URL private. It expires after 72 hours or first use.'
