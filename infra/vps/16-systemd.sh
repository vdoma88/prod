#!/usr/bin/env bash
# Школа «Язык Пламени» из PM2 → служба systemd flame-school.
#
#   sudo bash /var/www/flame-app/deploy/sila-roda.sh systemd
#   (или: sudo bash /var/www/prod/infra/vps/16-systemd.sh)
#
# Руны, Таро, бот и общий вход давно службы systemd; школа и terapy жили в
# PM2, и ради них держался демон PM2 (~80 МБ). Этот шаг переносит школу:
# убирает flame-school из PM2, запускает службу с тем же именем, папкой,
# портом 3000 и .env.local, ждёт ответа. Не ответила за минуту — школа
# возвращается в PM2, как была. Школа недоступна 5–15 секунд — делайте в
# спокойное время. terapy переносит 12-rod.sh при следующем запуске; когда в
# PM2 ничего не осталось, его демон останавливается.
#
# Повторный запуск ничего не меняет, а если юнит в репозитории изменился —
# применяет его и перезапускает школу. Дальше школа обновляется как обычно —
# deploy/update.sh в flame-app сам перезапускает службу.
# shellcheck source-path=SCRIPTDIR source=lib.sh
cd "$(dirname "$0")" && . ./lib.sh
need_root

APP=/var/www/flame-app
UNIT=flame-school
PORT=3000
NEXT_BIN="$APP/node_modules/next/dist/bin/next"

log "Проверки"
require_node
[ -f "$NEXT_BIN" ] || die "нет $NEXT_BIN — школа не установлена? (cd $APP && npm install)"
[ -f "$APP/.next/BUILD_ID" ] || die "нет сборки школы — cd $APP && npm run build"
[ -f "$APP/.env.local" ] || die "нет $APP/.env.local — без него школа не подключится к базе"
ok "школа собрана, .env.local на месте"

log "Служба systemd"
install_unit "$SCRIPT_DIR/systemd/$UNIT.service"
if systemctl is-active -q "$UNIT" && ! pm2_has "$UNIT"; then
  if [ "$UNIT_CHANGED" = 1 ]; then
    systemctl restart "$UNIT"
    ok "юнит $UNIT обновлён — школа перезапущена"
  else
    ok "школа уже служба systemd $UNIT — ничего не меняю"
  fi
else
  flame_back_to_pm2() { (cd "$APP" && pm2 start "$NEXT_BIN" --name "$UNIT" -- start >/dev/null); }
  pm2_to_systemd "$UNIT" "$UNIT" "http://127.0.0.1:$PORT/" flame_back_to_pm2
fi
wait_http "http://127.0.0.1:$PORT/"
# Школа слушает только 127.0.0.1. nginx с proxy_pass на localhost:3000 сперва
# стучится на ::1 и пишет в журнал ошибку на каждый запрос — подсказываем.
if grep -rqs 'proxy_pass[[:space:]]*http://localhost:3000' /etc/nginx/sites-enabled/; then
  warn "в nginx proxy_pass на localhost:3000 — замените на 127.0.0.1:3000: grep -rn localhost:3000 /etc/nginx/sites-enabled/"
fi
wait_http "https://plamya.$DOMAIN/" 10
pm2_retire

log "Готово"
cat <<NEXT
  Состояние: systemctl status $UNIT --no-pager
  Журнал:    journalctl -u $UNIT -n 100 --no-pager
  Обновление школы — как раньше: cd $APP && bash deploy/update.sh
NEXT
