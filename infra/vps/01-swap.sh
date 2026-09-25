#!/usr/bin/env bash
# Память: swap-файл, пока тариф VPS с 1 ГБ ОЗУ.
#
#   sudo bash infra/vps/01-swap.sh            # 2 ГБ по умолчанию
#   sudo SWAP_SIZE=4G bash infra/vps/01-swap.sh
#
# Swap не заменяет ОЗУ: он спасает сборки (Next.js, Vite) и пики от падения
# с «out of memory», но под постоянной нагрузкой всё будет медленным.
# Настоящее решение — тариф на 2–4 ГБ: панель Beget → VPS → изменить
# конфигурацию. Скрипт это не делает и сделать не может.
# shellcheck source-path=SCRIPTDIR source=lib.sh
cd "$(dirname "$0")" && . ./lib.sh
need_root

SWAP_SIZE="${SWAP_SIZE:-2G}"
SWAP_FILE="${SWAP_FILE:-/swapfile}"

log "Swap"
if swapon --show=NAME --noheadings | grep -q .; then
  ok "swap уже включён:"; swapon --show
else
  [ ! -e "$SWAP_FILE" ] || die "$SWAP_FILE существует, но не подключён. Проверьте вручную: swapon $SWAP_FILE"
  fallocate -l "$SWAP_SIZE" "$SWAP_FILE" 2>/dev/null || dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$(numfmt --from=iec "$SWAP_SIZE" | awk '{print int($1/1048576)}')" status=none
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE" >/dev/null
  swapon "$SWAP_FILE"
  ok "включён $SWAP_FILE ($SWAP_SIZE)"
fi
grep -q "^$SWAP_FILE " /etc/fstab || { [ ! -e "$SWAP_FILE" ] || echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab; }
ok "переживёт перезагрузку (/etc/fstab)"

# Ядро уходит в swap только когда ОЗУ правда кончается.
echo 'vm.swappiness=10' > /etc/sysctl.d/99-sila-roda-swap.conf
sysctl -q -p /etc/sysctl.d/99-sila-roda-swap.conf
ok "vm.swappiness=10"

log "Итог"
free -h
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
[ "$mem_mb" -ge 1900 ] || warn "ОЗУ $mem_mb МБ. Смените тариф на 2–4 ГБ в панели Beget: с одним гигабайтом четыре приложения будут тормозить."
