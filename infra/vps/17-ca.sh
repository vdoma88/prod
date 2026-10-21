#!/usr/bin/env bash
# Скомпрометированные промежуточные сертификаты eMudhra (октябрь 2026,
# https://emudhra.we-have-a-problem.com): закрыть доверие к ним на сервере.
#
#   sudo bash /var/www/prod/infra/vps/17-ca.sh
#
# Что делает:
#   1. проверка до: curl к пробному адресу (код 200 — сервер ещё доверяет);
#   2. обновляет пакет ca-certificates (исправлен в 20260816ubuntu0.*);
#   3. службам на Node — NODE_OPTIONS=--use-openssl-ca: встроенные в Node
#      корни обновление ОС не затрагивает, с этим флагом Node берёт системный
#      набор; перезапускает службы и ждёт ответа;
#   4. certifi во всех venv на сервере — обновляет;
#   5. проверка после: curl и Node должны выдать ошибку сертификата.
#
# Повторный запуск ничего не ломает: уже сделанное пропускается.
# Школа (flame-school) при перезапуске недоступна 5–15 секунд.
# shellcheck source-path=SCRIPTDIR source=lib.sh
cd "$(dirname "$0")" && . ./lib.sh
need_root

PROBES=(https://dv-g3b-emudhra.we-have-a-problem.com/ https://dv-g3b-aaa-emudhra.we-have-a-problem.com/)
# служба:порт (порт — чтобы дождаться ответа после перезапуска; пусто — не ждать)
SERVICES=(flame-school:3000 rodology:5000 runes:4173 polkas:3100 rodbot:4310 sr-accounts:4320)
DROPIN=emudhra-ca.conf
BUNDLE=/etc/ssl/certs/ca-certificates.crt
# Node: 0 — ошибка сертификата (хорошо), 1 — доверяет, 2 — не удалось проверить (сеть)
PROBE_JS='const q=require("https").get(process.argv[1],r=>{console.log("ДОВЕРЯЕТ ("+r.statusCode+")");process.exit(1)});q.setTimeout(15000,()=>q.destroy(new Error("timeout")));q.on("error",e=>{const c=e.code||e.message;if(/CERT|ISSUER|SELF_SIGNED|VERIFY/.test(c)){console.log("ошибка сертификата: "+c);process.exit(0)}console.log("не удалось проверить: "+c);process.exit(2)})'

# probe_curl — 0, если все пробные адреса дают ошибку сертификата
probe_curl() {
  local bad=0 url rc
  for url in "${PROBES[@]}"; do
    rc=0; curl -sS -o /dev/null --max-time 15 "$url" 2>/dev/null || rc=$?
    case "$rc" in
      0) warn "curl $url — открылся: сервер ДОВЕРЯЕТ скомпрометированному сертификату"; bad=1 ;;
      35|51|58|60|77|83) ok "curl $url — ошибка сертификата (не доверяет)" ;;
      *) warn "curl $url — не удалось проверить (код curl $rc: сеть или DNS)"; bad=1 ;;
    esac
  done
  return $bad
}

log "1. Проверка до"
probe_curl || true

log "2. Пакет ca-certificates"
apt-get update -qq
apt-get install -y -qq --only-upgrade ca-certificates >/dev/null
update-ca-certificates >/dev/null
ver="$(dpkg-query -W -f='${Version}' ca-certificates)"
if dpkg --compare-versions "$ver" ge 20260816; then
  ok "ca-certificates $ver — исправленная версия"
else
  warn "ca-certificates $ver — исправления в репозитории ещё нет (нужна 20260816ubuntu0.*)."
  warn "Обходной путь со страницы eMudhra отключает корни Comodo AAA и emSign ECC G3 целиком — может сломать и нормальные сайты; без вас не делаю."
fi
probe_curl && CURL_OK=1 || CURL_OK=0

log "3. Службы на Node — системный набор корней"
RESTART=()
node_ver="$(node -v 2>/dev/null || echo нет)"
ok "Node $node_ver (свой встроенный набор исправлен в 22.23.4 / 24.22.1 / 26.12.1; с флагом ниже он не используется)"
for item in "${SERVICES[@]}"; do
  unit="${item%%:*}"; port="${item#*:}"
  if ! systemctl cat "$unit.service" >/dev/null 2>&1; then
    ok "$unit — службы нет на этом сервере, пропускаю"; continue
  fi
  dir="/etc/systemd/system/$unit.service.d"
  want="$(printf '[Service]\nEnvironment=NODE_OPTIONS=--use-openssl-ca\nEnvironment=SSL_CERT_FILE=%s\n' "$BUNDLE")"
  if [ -f "$dir/$DROPIN" ] && [ "$(cat "$dir/$DROPIN")" = "$want" ]; then
    ok "$unit — уже с системным набором"
  else
    install -d -m 755 "$dir"
    printf '%s\n' "$want" > "$dir/$DROPIN"
    ok "$unit — NODE_OPTIONS=--use-openssl-ca"
  fi
  # NODE_OPTIONS из EnvironmentFile перебьёт наш — предупредить
  for f in $(systemctl show -p EnvironmentFiles --value "$unit" | grep -o '/[^ ]*' || true); do
    if grep -qs '^NODE_OPTIONS=' "$f"; then warn "$unit: в $f свой NODE_OPTIONS — добавьте туда --use-openssl-ca вручную"; fi
  done
  RESTART+=("$item")
done
systemctl daemon-reload
for item in "${RESTART[@]}"; do
  unit="${item%%:*}"; port="${item#*:}"
  if systemctl is-active -q "$unit" || systemctl is-enabled -q "$unit" 2>/dev/null; then
    systemctl restart "$unit"
    if [ -z "$port" ]; then ok "$unit перезапущен"
    elif http_up "http://127.0.0.1:$port/" 60; then ok "$unit перезапущен, отвечает ($HTTP_CODE)"
    else warn "$unit не ответил за минуту: journalctl -u $unit -n 50 --no-pager"; fi
    env_now="$(systemctl show -p Environment --value "$unit")"
    case "$env_now" in *--use-openssl-ca*) ok "$unit работает с --use-openssl-ca" ;; *) warn "$unit: флаг не применился" ;; esac
  fi
done
# PM2 (если что-то ещё в нём) systemd-настройки не видит
if command -v pm2 >/dev/null 2>&1 && [ -n "$(pm2 jlist 2>/dev/null | grep -o '"name"' || true)" ]; then
  warn "в PM2 ещё есть процессы — им флаг не задан: pm2 ls"
fi

log "4. Python: certifi в venv"
if python3 -c 'import certifi' 2>/dev/null; then
  ok "системный certifi смотрит в $(python3 -c 'import certifi;print(certifi.where())') (пакет Ubuntu берёт системный набор)"
fi
found=0
while IFS= read -r cfg; do
  venv="$(dirname "$cfg")"; found=1
  if [ -x "$venv/bin/python" ] && "$venv/bin/python" -c 'import certifi' 2>/dev/null; then
    if "$venv/bin/python" -m pip install -q -U certifi >/dev/null 2>&1; then
      ok "$venv — certifi $("$venv/bin/python" -c 'import certifi;print(certifi.__version__)')"
    else
      warn "$venv — certifi не обновился: $venv/bin/python -m pip install -U certifi"
    fi
  else
    ok "$venv — certifi нет, пропускаю"
  fi
done < <(find /opt /srv /var/www /home /root -maxdepth 6 -name pyvenv.cfg -not -path '*/node_modules/*' 2>/dev/null)
[ "$found" = 1 ] || ok "venv на сервере нет"

log "5. Контейнеры"
if command -v docker >/dev/null 2>&1 && [ -n "$(docker ps -q 2>/dev/null)" ]; then
  warn "запущены контейнеры — в каждом нужен свежий ca-certificates и пересборка образа:"
  docker ps --format '    {{.Names}}  ({{.Image}})' >&2
else
  ok "контейнеров нет"
fi

log "6. Проверка после"
probe_curl && CURL_OK=1 || CURL_OK=0
NODE_OK=1
for url in "${PROBES[@]}"; do
  printf '  Node: %s — ' "$url"
  NODE_OPTIONS=--use-openssl-ca SSL_CERT_FILE="$BUNDLE" timeout 25 node -e "$PROBE_JS" "$url" || NODE_OK=0
done

log "Итог"
if [ "$CURL_OK" = 1 ] && [ "$NODE_OK" = 1 ]; then
  ok "сервер и службы на Node больше не доверяют скомпрометированным сертификатам"
else
  warn "сервер ещё доверяет или проверить не удалось — см. предупреждения выше. Чаще всего: исправленного ca-certificates ещё нет в репозитории Ubuntu; запустите скрипт позже ещё раз."
fi
