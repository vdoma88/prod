#!/usr/bin/env python3
"""Encrypted on-demand and scheduled backups for the recovery VPS.
Scope: Rod DB + ALL existing media; Flame ACTIVE DB + ALL media;
hub SQLite + visual editor media + bot DB + service configuration.
No backups or user content are uploaded to GitHub.
"""
import argparse
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import urlsplit, unquote, quote
from urllib.request import Request, urlopen
import uuid

ROOT = Path('/root/sr-backups')
KEY = Path('/etc/sr-backup.key')
CHUNK = 35 * 1024 * 1024
KEEP = 14

def fail(s):
    raise RuntimeError(s)

def env(path):
    data = {}
    if not path.is_file():
        return data
    for line in path.read_text(encoding='utf8').splitlines():
        if '=' not in line or line.lstrip().startswith('#'):
            continue
        k, v = line.split('=', 1)
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', k.strip()):
            continue
        v = v.strip()
        if len(v) > 1 and v[0] == v[-1] and v[0] in ("'", '"'):
            v = v[1:-1]
        data[k.strip()] = v
    return data

def run(argv, **kw):
    result = subprocess.run(argv, check=False, **kw)
    if result.returncode:
        fail(f'{argv[0]} failed (exit {result.returncode})')
    return result

def active_flame_db():
    url = env(Path('/var/www/flame-app/.env.local')).get('DATABASE_URL', '')
    u = urlsplit(url)
    if u.scheme not in ('postgres', 'postgresql'):
        fail('Flame DATABASE_URL missing or invalid; refusing to guess a database')
    name = unquote(u.path.lstrip('/'))
    if not re.fullmatch(r'[a-zA-Z_][a-zA-Z_0-9]*', name):
        fail('Unexpected active Flame database name')
    return name

def pg_dump(name, dest):
    with dest.open('wb') as out:
        run(['runuser', '-u', 'postgres', '--', 'pg_dump', '-Fc',
             '--no-owner', '--no-privileges', name],
            stdout=out, stderr=subprocess.DEVNULL)
    if dest.stat().st_size < 1000:
        fail(f'Suspiciously small database dump {name}')
    run(['pg_restore', '--list', str(dest)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def sqlite_copy(src, dest):
    if not src.is_file():
        fail(f'Missing SQLite DB {src}')
    uri = 'file:' + quote(str(src)) + '?mode=ro'
    with sqlite3.connect(uri, uri=True, timeout=30) as source:
        with sqlite3.connect(dest) as target:
            source.backup(target)
            if target.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                fail(f'SQLite verification failed: {src}')

def files_in(folder):
    return sum(1 for f in folder.rglob('*') if f.is_file() and not f.is_symlink()) if folder.is_dir() else 0

def rod_file_audit():
    check = subprocess.run(['runuser', '-u', 'postgres', '--', 'psql',
      '-XAt', '-d', 'rodology', '-c', 'SELECT "storedPath" FROM "File"'],
      text=True, capture_output=True)
    if check.returncode:
        return {'error': 'cannot_check_db_file_references'}
    rows = check.stdout.splitlines()
    root = Path('/var/www/rodology/server/storage/uploads').resolve()
    missing = 0
    for p in rows:
        if not p.startswith('/uploads/'):
            continue
        target = (root / p[len('/uploads/'):]).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            missing += 1
    return {'file_records': len(rows), 'referenced_local_files_missing': missing}

def add(tar, source, dest, required=True):
    p = Path(source)
    if not p.exists():
        if required:
            fail(f'Missing required path {source}')
        return
    tar.add(p, arcname=dest)

def snapshot(scope, stage, stamp):
    dest = stage / scope
    dest.mkdir(mode=0o700)
    meta = {'scope': scope, 'utc': stamp, 'format': 'recovery-v1',
            'contains_sensitive_data': True}
    if scope == 'rod':
        pg_dump('rodology', dest / 'rodology.dump')
        meta['file_audit'] = rod_file_audit()
        meta['media_count'] = files_in(Path('/var/www/rodology/server/storage/uploads'))
    elif scope == 'flame':
        db = active_flame_db()
        check = subprocess.run(['runuser', '-u', 'postgres', '--', 'psql',
            '-XAt', '-d', db, '-c', 'SELECT COUNT(*) FROM users'],
            capture_output=True, text=True)
        if check.returncode or not check.stdout.strip().isdigit() or int(check.stdout.strip()) == 0:
            fail('Active Flame DB does not contain users; refusing an empty backup')
        pg_dump(db, dest / 'flame.dump')
        meta['active_db'] = db
        meta['media_count'] = files_in(Path('/var/www/flame-app/public/uploads'))
    elif scope == 'hub':
        with (dest / 'postgres-roles.sql').open('wb') as out:
            run(['runuser', '-u', 'postgres', '--', 'pg_dumpall', '--globals-only'],
                stdout=out, stderr=subprocess.DEVNULL)
        sqlite_copy(Path('/var/lib/sr-accounts/accounts.sqlite'), dest / 'accounts.sqlite')
        bot = env(Path('/etc/rodbot.env'))
        bot_db = Path(bot.get('BOT_DB_PATH', '/var/lib/rodbot/bot.sqlite'))
        if bot_db.is_file():
            sqlite_copy(bot_db, dest / 'rodbot.sqlite')
        meta['bot_db_present'] = bot_db.is_file()
        meta['media_count'] = files_in(Path('/var/lib/sr-accounts/media'))
    sources = {
      'rod': [
        ('/var/www/rodology/server/storage/uploads', 'rod/storage/uploads', True),
        ('/var/www/rodology/server/public/content', 'rod/server/public/content', False),
        ('/var/www/rodology/server/.env', 'rod/server/.env', True),
        ('/etc/systemd/system/rodology.service', 'etc/systemd/rodology.service', False)],
      'flame': [
        ('/var/www/flame-app/public/uploads', 'flame/public/uploads', True),
        ('/var/www/flame-app/.env.local', 'flame/.env.local', True),
        ('/etc/systemd/system/flame-school.service', 'etc/systemd/flame-school.service', False)],
      'hub': [
        ('/var/lib/sr-accounts/media', 'hub/media', True),
        ('/var/www/prod/dist', 'hub/dist', True),
        ('/etc/sr-accounts.env', 'etc/sr-accounts.env', True),
        ('/etc/rodbot.env', 'etc/rodbot.env', False),
        ('/etc/nginx/sites-available/mirror', 'etc/nginx/mirror', False),
        ('/etc/nginx/sites-available/mirror-hub', 'etc/nginx/mirror-hub', False),
        ('/etc/cron.d/sr-mirror-backups', 'etc/cron/sr-mirror-backups', False),
        ('/etc/systemd/system/sr-accounts.service', 'etc/systemd/sr-accounts.service', False),
        ('/etc/systemd/system/rodbot.service', 'etc/systemd/rodbot.service', False)],
      'legacy': [
        ('/root/mirror', 'original-recovery/mirror', True),
        ('/root/flame-backups', 'original-recovery/flame-backups', False),
        ('/var/www/rodology/server/backups', 'original-recovery/rod-backups', False)],
    }
    (dest / 'manifest.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf8')
    raw = dest / (scope + '.tar.gz')
    with tarfile.open(raw, 'w:gz', dereference=False) as t:
        t.add(dest / 'manifest.json', arcname='manifest.json')
        for p in dest.iterdir():
            if p.name not in ('manifest.json', raw.name):
                t.add(p, arcname='snapshots/' + p.name)
        for src, logical, required in sources[scope]:
            add(t, src, logical, required)
    with tarfile.open(raw, 'r:gz') as t:
        entries = t.getnames()
        if 'manifest.json' not in entries or not any(n.startswith('snapshots/') for n in entries):
            fail('Snapshot failed archive verification')
    return raw, meta

def ensure_key():
    if not KEY.exists():
        fd = os.open(KEY, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(base64.urlsafe_b64encode(os.urandom(48)) + b'\n')
        print('CRITICAL: New /etc/sr-backup.key created. Save its contents OFF the VPS in a secure place.')
    if KEY.stat().st_mode & 0o077:
        fail('Backup encryption key must have permissions 0600')
    return KEY

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()

def encrypt(raw, output):
    k = ensure_key()
    run(['openssl', 'enc', '-aes-256-cbc', '-pbkdf2', '-iter', '250000',
         '-salt', '-in', str(raw), '-out', str(output), '-pass', f'file:{k}'],
        stdout=subprocess.DEVNULL)
    if output.stat().st_size < 100:
        fail('Empty encrypted archive')
    return digest(output)

def tg_settings():
    explicit = env(Path('/etc/sr-mirror-backup.env'))
    bot = env(Path('/etc/rodbot.env'))
    flame = env(Path('/var/www/flame-app/.env.local'))
    for token, chat in (
        (explicit.get('TELEGRAM_BOT_TOKEN'), explicit.get('TELEGRAM_CHAT_ID')),
        (bot.get('TELEGRAM_BOT_TOKEN'), bot.get('BACKUP_CHAT_IDS', '').split(',')[0].strip()),
        (flame.get('TELEGRAM_BOT_TOKEN'), flame.get('BACKUP_TELEGRAM_CHAT_ID')),
        (bot.get('TELEGRAM_BOT_TOKEN'), bot.get('ADMIN_CHAT_IDS', '').split(',')[0].strip()),
    ):
        if token and chat:
            return token, chat
    return '', ''

def send_telegram(encrypted, scope, sha):
    token, chat = tg_settings()
    if not token or not chat:
        print(f'  WARNING {scope}: Telegram bot/chat not configured. LOCAL backup only.')
        return 'not_configured'
    count = max(1, (encrypted.stat().st_size + CHUNK - 1) // CHUNK)
    if count > 100:
        print(f'  WARNING {scope}: encrypted archive too large for Telegram chunking ({count} parts)')
        return 'too_large'
    boundary = '----sr-backup-' + uuid.uuid4().hex
    with encrypted.open('rb') as f:
        for n in range(count):
            chunk = f.read(CHUNK)
            name = f'{encrypted.name}.part{n+1:03d}-of-{count:03d}'
            caption = f'Encrypted {scope} recovery {n+1}/{count}. Full SHA256: {sha}. Save encryption key OFF server.'
            body = b''.join([
                f'--{boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n{chat}\r\n'.encode(),
                f'--{boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n{caption}\r\n'.encode(),
                f'--{boundary}\r\nContent-Disposition: form-data; name="document"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode(),
                chunk, f'\r\n--{boundary}--\r\n'.encode(),
            ])
            req = Request(f'https://api.telegram.org/bot{token}/sendDocument', data=body,
                headers={'Content-Type': f'multipart/form-data; boundary={boundary}'}, method='POST')
            try:
                with urlopen(req, timeout=180) as resp:
                    ans = json.loads(resp.read(8192))
                if not ans.get('ok'):
                    fail('Telegram refused upload')
            except Exception as e:
                print(f'  WARNING {scope}: Telegram upload failed at chunk {n+1}/{count}: {type(e).__name__} (details withheld)')
                return 'failed'
    print(f'  Telegram delivered {scope}: {count} encrypted file(s)')
    return 'sent'

def create(scope, tmp, stamp, telegram=True):
    raw, meta = snapshot(scope, tmp, stamp)
    enc = tmp / (scope + '.enc')
    sha = encrypt(raw, enc)
    target = ROOT / f'{scope}-{stamp.replace("-", "").replace(":", "")}.tar.gz.enc'
    enc.replace(target)
    target.chmod(0o600)
    checksum = target.with_name(target.name + '.sha256')
    checksum.write_text(f'{sha}  {target.name}\n', encoding='ascii')
    checksum.chmod(0o600)
    print(f'LOCAL OK {scope}: {target} ({target.stat().st_size} bytes)')
    if scope == 'rod':
        print(f"  Existing media: {meta['media_count']}, database missing local file refs: {meta['file_audit'].get('referenced_local_files_missing')}")
    return send_telegram(target, scope, sha) if telegram else 'disabled'

def cleanup_old():
    for scope in ('rod', 'flame', 'hub'):
        found = sorted(ROOT.glob(f'{scope}-*.tar.gz.enc'), key=lambda x: x.stat().st_mtime, reverse=True)
        for old in found[KEEP:]:
            old.unlink()
            old.with_name(old.name + '.sha256').unlink(missing_ok=True)

def main():
    p = argparse.ArgumentParser(description='Full encrypted backup of recovery VPS')
    p.add_argument('--scope', choices=('all', 'rod', 'flame', 'hub', 'legacy'), default='all')
    p.add_argument('--no-telegram', action='store_true')
    args = p.parse_args()
    if os.geteuid():
        fail('Run as root on recovery VPS')
    os.umask(0o077)
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    ROOT.chmod(0o700)
    with (ROOT / '.backup.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail('Backup already running')
        stamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        scopes = ('rod', 'flame', 'hub') if args.scope == 'all' else (args.scope,)
        errors, statuses = [], []
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='.working-') as d:
            for s in scopes:
                try:
                    statuses.append((s, create(s, Path(d), stamp, not args.no_telegram)))
                except Exception as e:
                    errors.append(s)
                    print(f'ERROR {s}: {e}', file=sys.stderr)
        if not errors:
            cleanup_old()
        print('OFFSITE STATUS:', ', '.join(f'{s}={result}' for s, result in statuses))
        if errors:
            fail('Some backups failed: ' + ', '.join(errors))
        if not args.no_telegram and any(status != 'sent' for _, status in statuses):
            print('WARNING: All local backups exist but offsite Telegram delivery was incomplete.', file=sys.stderr)
            return 2
        print('SUCCESS: all selected encrypted backup archives saved locally')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        print('BACKUP ERROR:', e, file=sys.stderr)
        sys.exit(1)
