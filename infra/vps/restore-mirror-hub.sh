#!/usr/bin/env bash
# Emergency mirror for vdoma88/prod: static landing + accounts on sslip.io.
# Existing rodology/flame-school nginx and PostgreSQL are deliberately untouched.
# Run as root on the RECOVERY VPS after installing the two existing mirrors:
#   bash /var/www/prod/infra/vps/restore-mirror-hub.sh
# Optional: ADMIN_EMAIL=... ADMIN_NAME='...' bash ...
set -euo pipefail

log() { printf '\n==> %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail 'Run as root.'
command -v node >/dev/null || fail 'Node.js 22.13+ required.'
command -v certbot >/dev/null || fail 'certbot required.'
command -v nginx >/dev/null || fail 'nginx required.'
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||major===22&&minor>=13?0:1)' || fail 'Node.js 22.13+ required.'

IP="${MIRROR_IP:-$(curl -4fsS --max-time 8 https://api.ipify.org || hostname -I | awk '{print $1}')}"
[[ "$IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || fail 'Invalid MIRROR_IP.'
DASH="${IP//./-}"
HUB="$DASH.sslip.io"
ROD="rod.$HUB"
FLAME="plamya.$HUB"
DIR=/var/www/prod
ENV=/etc/sr-accounts.env
NGINX=/etc/nginx/sites-available/mirror-hub
LINK=/etc/nginx/sites-enabled/mirror-hub
OLD_LINK=/etc/nginx/sites-enabled/mirror-landing
mkdir -p /root/mirror

log "Preflight: $HUB"
# Never change the vhosts or services for working mirrors.
[ -f /etc/nginx/sites-enabled/mirror ] || log 'WARNING: mirror nginx config is missing; deploy the landing independently.'
systemctl is-active --quiet rodology || log 'WARNING: Rod is not active yet; recover it after the landing.'
systemctl is-active --quiet flame-school || log 'WARNING: Flame is not active yet; recover it after the landing.'
[ ! -e /etc/nginx/sites-enabled/belayarod.ru ] || fail 'Canonical belayarod.ru nginx site exists: this helper is only for the emergency sslip.io host.'

log 'Fetch vdoma88/prod, main'
if [ -d "$DIR/.git" ]; then
  [ -z "$(git -C "$DIR" status --porcelain --untracked-files=no)" ] || fail 'Local source edits: cannot overwrite /var/www/prod.'
  git -C "$DIR" fetch origin main
  branch="$(git -C "$DIR" symbolic-ref --quiet --short HEAD || true)"
  if [ "$branch" != main ]; then git -C "$DIR" switch main; fi
  git -C "$DIR" merge --ff-only origin/main
else
  [ ! -e "$DIR" ] || [ -z "$(ls -A "$DIR")" ] || fail '/var/www/prod exists and is not an empty git checkout.'
  git clone --branch main https://github.com/vdoma88/prod.git "$DIR"
fi

log 'Build production landing'
cd "$DIR"
node scripts/check.mjs --sources
node scripts/build.mjs

# The generated files are intentionally modified, never site/ source files.
# Preserve all links to not-yet-restored Taro/Runes until their final phase.
log 'Switch mirror links (canonical Beget domains remain unchanged)'
HUB="$HUB" ROD="$ROD" FLAME="$FLAME" python3 - <<'PY'
from pathlib import Path
import os
root=Path('/var/www/prod/dist')
replacements = (
    (b'https://rod.belayarod.ru', ('https://' + os.environ['ROD']).encode()),
    (b'https://plamya.belayarod.ru', ('https://' + os.environ['FLAME']).encode()),
    (b'https://belayarod.ru', ('https://' + os.environ['HUB']).encode()),
)
count=0
for path in root.rglob('*'):
    if not path.is_file() or path.suffix.lower() not in ('.html', '.js', '.css', '.json', '.xml', '.webmanifest'):
        continue
    old=path.read_bytes()
    new=old
    for source,target in replacements:
        new=new.replace(source, target)
    if old != new:
        path.write_bytes(new)
        count += 1
(root/'robots.txt').write_text('User-agent: *\nDisallow: /\n', encoding='utf-8')
print(f'Mirror URLs rewritten in {count} files; mirror excluded from search indexing.')
PY

log 'Service account, persistent SQLite and image folder'
id sraccounts >/dev/null 2>&1 || adduser --system --group --no-create-home --home /var/lib/sr-accounts sraccounts
install -d -o sraccounts -g sraccounts -m 700 /var/lib/sr-accounts
install -d -o sraccounts -g sraccounts -m 700 /var/lib/sr-accounts/media
if [ ! -e "$ENV" ]; then
  umask 077
  cat > "$ENV" <<VARS
HOST=127.0.0.1
PORT=4320
ACCOUNTS_DB_PATH=/var/lib/sr-accounts/accounts.sqlite
PUBLIC_ORIGIN=https://$HUB
COOKIE_DOMAIN=.$HUB
TRUST_PROXY=1
SR_INTERNAL_SECRET=$(openssl rand -hex 24)
ACCOUNT_RESET_SECRET=$(openssl rand -hex 32)
COURSE_ROD_URL=https://$ROD/
COURSE_PLAMYA_URL=https://$FLAME/
UPTIME_TARGETS=off
VARS
else
  # Preserve all secret values and database references; only mirror-specific
  # public host settings are changed. Save a root-only rollback copy.
  cp -p "$ENV" "/root/mirror/sr-accounts.env.$(date +%Y%m%d-%H%M%S).bak"
  ENV="$ENV" HUB="$HUB" ROD="$ROD" FLAME="$FLAME" python3 - <<'PY'
from pathlib import Path
import os
file=Path(os.environ['ENV'])
values={
  'PUBLIC_ORIGIN':'https://'+os.environ['HUB'],
  'COOKIE_DOMAIN':'.'+os.environ['HUB'],
  'COURSE_ROD_URL':'https://'+os.environ['ROD']+'/',
  'COURSE_PLAMYA_URL':'https://'+os.environ['FLAME']+'/',
  'UPTIME_TARGETS':'off',
}
lines=file.read_text().splitlines()
for key,val in values.items():
    updated=False
    for i,line in enumerate(lines):
        if line.startswith(key+'='):
            lines[i]=key+'='+val
            updated=True
            break
    if not updated:
        lines.append(key+'='+val)
file.write_text('\n'.join(lines)+'\n')
PY
fi
chown root:sraccounts "$ENV"
chmod 640 "$ENV"
[ -s /var/lib/sr-accounts/accounts.sqlite ] && log 'Existing accounts.sqlite found: keeping the database.' || log 'Fresh accounts.sqlite will be initialized; original users require a separate backup.'

log 'Start isolated accounts service on 127.0.0.1:4320'
install -m 644 "$DIR/accounts/deploy/sr-accounts.service" /etc/systemd/system/sr-accounts.service
systemctl daemon-reload
systemctl enable --now sr-accounts
systemctl restart sr-accounts
for ((i=1; i<=20; i++)); do
  if curl -fsS --max-time 2 -o /dev/null http://127.0.0.1:4320/account/; then break; fi
  sleep 1
done
curl -fsS --max-time 3 -o /dev/null http://127.0.0.1:4320/account/ || fail 'Account service failed. See journalctl -u sr-accounts.'

log 'Configure a SEPARATE sslip.io host (existing Rod/Flame remain untouched)'
cat > "$NGINX" <<NGINXCONF
server {
  listen 80;
  listen [::]:80;
  server_name $HUB;
  root /var/www/prod/dist;
  index index.html;
  charset utf-8;
  client_max_body_size 5m;
  add_header X-Robots-Tag "noindex, nofollow" always;
  add_header X-Content-Type-Options "nosniff" always;
  location = /account { return 301 /account/; }
  location ^~ /account/internal/ { return 404; }
  location ^~ /account/ {
    proxy_pass http://127.0.0.1:4320;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_http_version 1.1;
  }
  location ^~ /brand/ {
    add_header Cache-Control "public, max-age=3600";
    add_header Access-Control-Allow-Origin "*";
    add_header Cross-Origin-Resource-Policy "cross-origin";
    add_header X-Robots-Tag "noindex, nofollow" always;
    try_files \$uri =404;
  }
  location / { try_files \$uri \$uri/ \$uri.html =404; }
  error_page 404 /404.html;
}
NGINXCONF

# Previous emergency mirror landing has the same server_name and must be
# disabled to avoid ambiguous nginx selection. Keep a rollback copy.
if [ -e "$OLD_LINK" ] || [ -L "$OLD_LINK" ]; then
  cp -a "$OLD_LINK" "/root/mirror/mirror-landing.enabled.$(date +%Y%m%d-%H%M%S)"
  rm -f "$OLD_LINK"
fi
ln -sfn "$NGINX" "$LINK"
if ! nginx -t; then
  rm -f "$LINK"
  if [ -f /etc/nginx/sites-available/mirror-landing ]; then ln -sfn /etc/nginx/sites-available/mirror-landing "$OLD_LINK"; fi
  nginx -t || true
  fail 'New nginx configuration rejected; old landing restored.'
fi
systemctl reload nginx

log "HTTPS for $HUB"
certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email --redirect -d "$HUB" || fail 'Could not issue HTTPS cert. Existing mirror sites should still work.'
nginx -t && systemctl reload nginx

log 'Smoke test - verify EACH vhost separately (including SNI)'
check() {
  local host="$1" path="$2" importance="${3:-required}" code
  code="$(curl --silent --show-error --max-time 12 --resolve "$host:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$host$path" || true)"
  printf '  %-46s %s\n' "https://$host$path" "$code"
  case "$code" in
    2??|3??) ;;
    *) if [ "$importance" = required ]; then
         fail "$host$path is not responding. Check the nginx vhost and app logs."
       else
         log "WARNING: $host$path is not responding; recover this course next."
       fi ;;
  esac
}
check "$HUB" '/'
check "$HUB" '/courses.html'
check "$HUB" '/account/'
check "$ROD" '/' optional
check "$FLAME" '/' optional

if [ -n "${ADMIN_EMAIL:-}" ]; then
  log 'Create or recover mirror administrator'
  sudo -u sraccounts env ACCOUNTS_DB_PATH=/var/lib/sr-accounts/accounts.sqlite \
    PUBLIC_ORIGIN="https://$HUB" ACCOUNT_RESET_SECRET="$(sed -n 's/^ACCOUNT_RESET_SECRET=//p' "$ENV" | tail -1)" \
    node "$DIR/accounts/cli.mjs" create-admin "$ADMIN_EMAIL" "${ADMIN_NAME:-Администратор}"
else
  printf '\nAdministrator account: rerun with ADMIN_EMAIL=your-address to create one.\n'
fi

printf '\nREADY: https://%s/\nACCOUNT: https://%s/account/\nROD: https://%s/\nFLAME: https://%s/\n' "$HUB" "$HUB" "$ROD" "$FLAME"
printf 'Taro/Runes and full previous account/media data are deferred to later recovery stages.\n'