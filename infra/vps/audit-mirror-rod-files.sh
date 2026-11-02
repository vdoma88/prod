#!/usr/bin/env bash
# Read-only inventory of media referenced by Rodology database on emergency VPS.
# Prints counts only. No user names, document names, URLs or secrets are printed.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root on the recovery VPS." >&2
  exit 1
fi
ROOT=/var/www/rodology/server/storage/uploads
[ -d /var/www/rodology/server ] || { echo "Rodology server directory is missing." >&2; exit 1; }
[ -d "$ROOT" ] || { echo "Local upload directory is missing." >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 is required." >&2; exit 1; }
command -v sudo >/dev/null || { echo "sudo is required." >&2; exit 1; }
echo '=== Rodology media integrity (read only) ==='
python3 - <<'PY'
import json
import subprocess
from pathlib import Path
from urllib.parse import urlsplit, unquote
from collections import Counter

root = Path('/var/www/rodology/server/storage/uploads').resolve()
sql = '''
SELECT COALESCE(json_agg(json_build_object(
  'path', "storedPath", 'size', size, 'mime', "mimeType"
)), '[]'::json)::text FROM "File"
'''
p = subprocess.run(
    ['sudo', '-u', 'postgres', 'psql', '-XAt', '-d', 'rodology', '-c', sql],
    capture_output=True, text=True, check=False, timeout=20,
)
if p.returncode:
    print('DATABASE ERROR: could not read File records (details withheld).')
    raise SystemExit(2)
try:
    entries = json.loads(p.stdout.strip())
except ValueError:
    print('DATABASE ERROR: invalid JSON from PostgreSQL.')
    raise SystemExit(2)

counts = Counter()
registered_on_disk = set()
for entry in entries:
    raw = (entry.get('path') or '').strip()
    if not raw:
        counts['empty_path'] += 1
        continue
    if raw.startswith(('https://', 'http://', '//')):
        counts['remote_url'] += 1
        continue
    if raw.startswith(('data:', 'cloudinary:')):
        counts['other_external'] += 1
        continue
    if not raw.startswith(('/uploads/', 'uploads/')):
        counts['unknown_format'] += 1
        continue
    suffix = raw.split('uploads/', 1)[1]
    # Only literal local paths; never allow traversal or dynamic URL segments.
    if (not suffix or '\\' in suffix or '%' in suffix or '?' in suffix or
        '#' in suffix or any(part in ('', '.', '..') for part in suffix.split('/'))):
        counts['invalid_path'] += 1
        continue
    candidate = (root / suffix).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        counts['local_missing'] += 1
        continue
    counts['local_present'] += 1
    registered_on_disk.add(candidate)

disk = [p for p in root.rglob('*') if p.is_file() and not p.is_symlink()]
print('Database File records:', len(entries))
print('Referenced local files present:', counts['local_present'])
print('Referenced local files missing:', counts['local_missing'])
print('References to external URLs:', counts['remote_url'] + counts['other_external'])
print('Unknown/invalid/blank file references:', counts['unknown_format'] + counts['invalid_path'] + counts['empty_path'])
print('Total regular files on current disk:', len(disk))
print('Local disk files without File record:', len(set(disk) - registered_on_disk))
print('Note: images in StepTemplate HTML, Questionnaire and other tables need a separate check.')

# Count only metadata of likely backup files, not contents or filenames.
for where in ('/root/mirror', '/var/backups'):
    folder = Path(where)
    if not folder.is_dir():
        continue
    backup_candidates = [
        f for f in folder.rglob('*')
        if f.is_file() and f.suffix.lower() in ('.gz', '.zip', '.tar', '.tgz', '.zst', '.bak')
    ]
    print(f'Backup archive candidates in {where}:', len(backup_candidates))
print('No files or database records were modified.')
PY
