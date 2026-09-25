#!/usr/bin/env bash
# Проверка сервера перед раскладкой проектов «Сила Рода». Ничего не меняет.
#
#   sudo bash infra/vps/00-preflight.sh
#
# Показывает: память и swap, диск, Node.js, nginx/certbot/pm2/PostgreSQL,
# занятые порты, DNS всех адресов и что уже установлено. В конце — что
# делать дальше. Запускать можно сколько угодно раз.
# shellcheck source-path=SCRIPTDIR source=lib.sh
cd "$(dirname "$0")" && . ./lib.sh
need_root

problems=0
problem() { warn "$*"; problems=$((problems + 1)); }

log "Система"
ok "$(. /etc/os-release && echo "$PRETTY_NAME"), IP $(server_ip)"

log "Память"
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
swap_mb=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
avail_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
printf '  ОЗУ %s МБ (свободно %s), swap %s МБ\n' "$mem_mb" "$avail_mb" "$swap_mb"
if [ "$mem_mb" -lt 1900 ]; then
  problem "ОЗУ меньше 2 ГБ. Для школы + трёх приложений + PostgreSQL нужен тариф на 2–4 ГБ (Beget → VPS → изменить конфигурацию)."
fi
if [ "$swap_mb" -lt 1024 ]; then
  problem "swap меньше 1 ГБ — запустите 01-swap.sh (особенно пока ОЗУ 1 ГБ)."
else
  ok "swap есть"
fi

log "Диск"
free_mb=$(df -m / | awk 'NR==2 {print $4}')
printf '  свободно на /: %s МБ\n' "$free_mb"
[ "$free_mb" -ge 3000 ] || problem "меньше 3 ГБ свободно — сборки terapy и школы могут не поместиться."

log "Программы"
if node_ok; then ok "Node.js $(node -v)"; else problem "Node.js $(node -v 2>/dev/null || echo 'нет') — нужен 22.13+ (02-node.sh)."; fi
for bin in nginx certbot git curl; do
  if command -v "$bin" >/dev/null 2>&1; then ok "$bin"; else problem "нет $bin (apt-get install -y $bin)"; fi
done
if command -v pm2 >/dev/null 2>&1; then ok "pm2 $(pm2 -v 2>/dev/null)"; else problem "нет pm2 (нужен terapy): npm i -g pm2"; fi
if systemctl is-active --quiet postgresql; then ok "PostgreSQL работает"; else problem "PostgreSQL не запущен (нужен terapy)"; fi
if dpkg -s python3-certbot-nginx >/dev/null 2>&1; then ok "плагин certbot для nginx"; else problem "нет python3-certbot-nginx"; fi

log "Порты"
for pair in "3000:школа «Язык Пламени»" "3100:Таро" "4173:Руны" "5000:terapy"; do
  port="${pair%%:*}"; what="${pair#*:}"
  owner="$(port_owner "$port")"
  printf '  %-5s %-22s %s\n' "$port" "$what" "${owner:-свободен}"
done

log "DNS"
for sub in "" www. plamya. rod. taro. runes.; do
  name="${sub}$DOMAIN"; got="$(resolve_a "$name")"
  if [ "$got" = "$(server_ip)" ]; then ok "$name → $got"
  else problem "$name → ${got:-нет записи} (нужна A-запись на $(server_ip))"; fi
done

log "Уже установлено"
if [ -d /opt/runes/.git ]; then ok "Руны: /opt/runes ($(systemctl is-active runes 2>/dev/null || true))"; else printf '  Руны: нет\n'; fi
if [ -d /opt/polkas/app/.git ]; then ok "Таро: /opt/polkas/app ($(systemctl is-active polkas 2>/dev/null || true))"; else printf '  Таро: нет\n'; fi
if [ -d /var/www/rodology/.git ]; then ok "terapy: /var/www/rodology"; else printf '  terapy: нет\n'; fi
if [ -d /var/www/flame-app ]; then ok "школа: /var/www/flame-app"; else warn "школа не найдена в /var/www/flame-app"; fi
command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const p of JSON.parse(s))console.log(`  pm2: ${p.name} — ${p.pm2_env.status}`)}catch{}})' 2>/dev/null || true
for f in /etc/nginx/sites-enabled/*; do [ -e "$f" ] && printf '  nginx: %s\n' "$(basename "$f")"; done

log "Итог"
if [ "$problems" = 0 ]; then
  ok "всё готово: 10-runes.sh, 11-taro.sh, 12-rod.sh, 13-plamya-cert.sh"
else
  warn "замечаний: $problems. Порядок: 01-swap.sh → 02-packages.sh → DNS → 10/11/12/13 (подробно — infra/vps/README.md)."
fi
