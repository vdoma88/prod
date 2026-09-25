# Общие функции скриптов infra/vps/. Подключается через `. lib.sh`, сам не запускается.
# shellcheck shell=bash

set -euo pipefail

# Папка infra/vps: скрипты делают cd в неё перед подключением lib.sh.
# shellcheck disable=SC2034  # используется в скриптах, подключающих lib.sh
SCRIPT_DIR="$(pwd)"

DOMAIN="${DOMAIN:-belayarod.ru}"
GITHUB_OWNER="${GITHUB_OWNER:-vdoma88}"
# Необязательно: почта для Let's Encrypt, если на сервере ещё нет учётной записи certbot.
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\n\033[31mОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

need_root() {
  [ "$(id -u)" = 0 ] || die "Запускайте от root: sudo bash $0"
}

# confirm "Вопрос?" — да/нет. YES=1 отвечает «да» за вас (для повторных запусков).
confirm() {
  [ "${YES:-0}" = 1 ] && return 0
  local answer
  read -r -p "  $1 [y/N] " answer
  [[ "$answer" =~ ^([yY]|[дД]) ]]
}

# Node нужен не младше 22.13: node:sqlite у Таро и рун работает начиная с неё.
node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'
}

require_node() {
  node_ok || die "Нужен Node.js 22.13 или новее (сейчас: $(node -v 2>/dev/null || echo 'нет')). Запустите 02-packages.sh."
  [ "$(command -v node)" = /usr/bin/node ] ||
    warn "node лежит в $(command -v node), а systemd-службы ждут /usr/bin/node — проверьте ExecStart."
}

SERVER_IP_CACHE=""
server_ip() {
  if [ -z "$SERVER_IP_CACHE" ]; then
    SERVER_IP_CACHE="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  fi
  printf '%s' "$SERVER_IP_CACHE"
}

resolve_a() {
  { getent ahostsv4 "$1" 2>/dev/null || true; } | awk 'NR==1 {print $1}'
}

# require_dns имя — A-запись должна указывать на этот сервер, иначе certbot не выпустит сертификат.
require_dns() {
  local name="$1" got
  got="$(resolve_a "$name")"
  if [ "$got" != "$(server_ip)" ]; then
    die "$name указывает на «${got:-ничего}», а сервер — $(server_ip).
  Добавьте в панели Beget (DNS домена $DOMAIN) A-запись: ${name%%."$DOMAIN"} → $(server_ip),
  подождите 5–30 минут и запустите скрипт снова. Проверка: getent hosts $name"
  fi
  ok "DNS: $name → $(server_ip)"
}

port_owner() {
  command -v ss >/dev/null 2>&1 || { printf '?'; return 0; }
  ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*users:((\"\([^\"]*\)\".*/\1/p' | head -n1
}

# require_port_free порт [допустимый процесс] — порт свободен или уже занят «своим» процессом.
require_port_free() {
  local port="$1" allowed="${2:-}" owner
  owner="$(port_owner "$port")"
  [ "$owner" != "?" ] || die "нет команды ss (apt-get install -y iproute2) — не проверить, свободен ли порт $port"
  if [ -n "$owner" ] && [ "$owner" != "$allowed" ]; then
    die "Порт $port занят процессом «$owner». Школа «Язык Пламени» занимает 3000, остальным нужны свои порты (infra/DOMAINS.md)."
  fi
}

# wait_http url [секунд] — ждёт ответа 2xx/3xx от локального процесса.
wait_http() {
  local url="$1" tries="${2:-30}" code
  for _ in $(seq "$tries"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)"
    case "$code" in 2??|3??) ok "$url отвечает ($code)"; return 0 ;; esac
    sleep 1
  done
  die "$url не отвечает (последний код: ${code:-нет}). Смотрите журнал службы."
}

# github_https_url репозиторий — адрес с тем же доступом, что у школы.
#
# Школа (/var/www/flame-app) уже клонирована с GitHub по HTTPS. Если её токен
# даёт доступ и к другим репозиториям vdoma88, берём тот же адрес с другим
# именем репозитория — тогда deploy key не нужен. Иначе пусто.
FLAME_DIR="${FLAME_DIR:-/var/www/flame-app}"
# Токен может лежать и в адресе origin, и в credential.helper репозитория школы.
# Читается здесь, а не внутри функции: её вызывают в $(…), и присваивание
# оттуда не вернулось бы.
FLAME_CRED_HELPER="$(git -C "$FLAME_DIR" config --get credential.helper 2>/dev/null || true)"
github_https_url() {
  local origin url
  origin="$(git -C "$FLAME_DIR" remote get-url origin 2>/dev/null || true)"
  case "$origin" in https://*github.com/*/flame-app*) ;; *) return 0 ;; esac
  url="${origin/flame-app/$1}"
  if GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false \
      git -c credential.helper="$FLAME_CRED_HELPER" ls-remote "$url" HEAD >/dev/null 2>&1; then
    printf '%s' "$url"
  fi
}

# github_ssh_ok хост — пускает ли GitHub по ключу этого хоста.
#
# GitHub на `ssh -T` всегда отвечает кодом 1, даже когда вход удался, поэтому
# смотрим только на текст ответа (в конвейере с `set -o pipefail` код 1 от ssh
# перекрыл бы успех grep). Если вход не удался — показываем, что ответил ssh.
github_ssh_ok() {
  local out
  out="$(ssh -o BatchMode=yes -o ConnectTimeout=15 -T "$1" 2>&1 || true)"
  case "$out" in *"successfully authenticated"*) return 0 ;; esac
  printf '  ssh ответил: %s\n' "$(printf '%s' "$out" | tail -n 1)" >&2
  return 1
}

# deploy_key_host репозиторий — имя хоста для ssh-доступа по deploy key.
#
# Для каждого репозитория свой ключ /root/.ssh/deploy-<repo> и своё имя хоста
# github-<repo> в /root/.ssh/config: GitHub принимает один deploy key только
# для одного репозитория, а ключи школы и других проектов не трогаются.
deploy_key_host() {
  local repo="$1" key="/root/.ssh/deploy-$1" host="github-$1"
  install -d -m 700 /root/.ssh
  [ -f "$key" ] || ssh-keygen -t ed25519 -N '' -C "deploy-$repo@$(hostname)" -f "$key" -q
  if ! grep -q "^Host $host\$" /root/.ssh/config 2>/dev/null; then
    printf '\nHost %s\n  HostName github.com\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$host" "$key" >> /root/.ssh/config
    chmod 600 /root/.ssh/config
  fi
  grep -q '^github.com ' /root/.ssh/known_hosts 2>/dev/null ||
    ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null
  until github_ssh_ok "$host"; do
    printf '\n  Серверу нужен доступ на чтение к %s/%s. Добавьте ключ:\n' "$GITHUB_OWNER" "$repo" >&2
    printf '  GitHub → %s/%s → Settings → Deploy keys → Add deploy key\n' "$GITHUB_OWNER" "$repo" >&2
    printf '  (галочку «Allow write access» не ставить)\n\n' >&2
    cat "$key.pub" >&2
    printf '\n' >&2
    read -r -p "  Добавили? Enter — проверить ещё раз, Ctrl+C — выйти. "
  done
  printf '%s' "$host"
}

# clone_or_update репозиторий папка — закрытый репозиторий vdoma88.
# Сначала пробует доступ школы (github_https_url), потом deploy key.
clone_or_update() {
  local repo="$1" dir="$2" url
  if [ -d "$dir/.git" ]; then
    git -C "$dir" pull --ff-only
  else
    [ ! -e "$dir" ] || [ -z "$(ls -A "$dir")" ] || die "$dir уже существует и не пуст — это не git-клон. Разберитесь вручную."
    url="$(github_https_url "$repo")"
    if [ -n "$url" ]; then
      ok "доступ к $GITHUB_OWNER/$repo — тот же, что у школы"
      git -c credential.helper="$FLAME_CRED_HELPER" clone "$url" "$dir"
      [ -z "$FLAME_CRED_HELPER" ] || git -C "$dir" config credential.helper "$FLAME_CRED_HELPER"
    else
      url="$(deploy_key_host "$repo"):$GITHUB_OWNER/$repo.git"
      ok "доступ к $GITHUB_OWNER/$repo — по deploy key"
      git clone "$url" "$dir"
    fi
  fi
  ok "код: $dir ($(git -C "$dir" log -1 --format='%h %s'))"
}

# nginx_site имя исходный_файл домен — ставит сайт nginx один раз.
#
# Если сайт уже стоит, файл не перезаписывается: certbot дописал в него HTTPS,
# и чистая копия из репозитория выключила бы сертификат. Обновить принудительно:
# FORCE_NGINX=1 — тогда certbot заново подключит сертификат.
nginx_site() {
  local name="$1" src="$2" host="$3"
  local avail="/etc/nginx/sites-available/$name" enabled="/etc/nginx/sites-enabled/$name"
  local fresh=0
  if [ ! -f "$avail" ] || [ "${FORCE_NGINX:-0}" = 1 ]; then
    [ ! -f "$avail" ] || cp "$avail" "$avail.bak-$(date +%Y%m%d-%H%M%S)"
    install -m 644 "$src" "$avail"
    fresh=1
  fi
  ln -sfn "$avail" "$enabled"
  if ! nginx -t 2>/tmp/nginx-test.log; then
    cat /tmp/nginx-test.log >&2
    [ "$fresh" = 0 ] || rm -f "$enabled"
    die "nginx -t не прошёл после добавления $name — сайт выключен, остальные не тронуты."
  fi
  systemctl reload nginx
  ok "nginx: $name ($host)"
  if [ "$fresh" = 1 ] || [ ! -d "/etc/letsencrypt/live/$host" ]; then
    certbot_nginx "$host"
  fi
}

# certbot_nginx домен — сертификат Let's Encrypt, HTTPS и редирект с http в блоке этого домена.
certbot_nginx() {
  local host="$1" account=()
  if [ -n "$CERTBOT_EMAIL" ]; then account=(-m "$CERTBOT_EMAIL"); else account=(--register-unsafely-without-email); fi
  certbot --nginx -d "$host" --redirect --hsts --non-interactive --agree-tos --keep-until-expiring "${account[@]}"
  nginx -t && systemctl reload nginx
  ok "HTTPS: https://$host"
}

# env_line файл КЛЮЧ — значение переменной из файла вида KEY="value".
env_line() {
  sed -n "s/^$2=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" "$1" | head -n1
}
