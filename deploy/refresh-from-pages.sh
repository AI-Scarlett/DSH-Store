#!/usr/bin/env bash
set -Eeuo pipefail

umask 022

readonly pages_base="${DSH_STORE_PAGES_BASE:-https://ai-scarlett.github.io/dsh-safe-plugin-manager}"
readonly deploy_root="${DSH_STORE_ROOT:-/opt/dsh-store}"
readonly current_link="$deploy_root/current"
readonly lock_file="${DSH_STORE_LOCK_FILE:-/run/lock/dsh-store-refresh.lock}"
readonly store_domain="${DSH_STORE_DOMAIN:-dsh.store}"
readonly pages_subdir="${DSH_STORE_PAGES_SUBDIR:-}"
readonly pages_path_prefix="${pages_subdir:+$pages_subdir/}"
readonly health_scheme="${DSH_STORE_HEALTH_SCHEME:-https}"
readonly site_prefix="${DSH_STORE_SITE_PREFIX:-}"

case "$store_domain" in
  dsh.store|dsh-store.cn) ;;
  *) printf 'Unsupported DSH Store domain: %s\n' "$store_domain" >&2; exit 2 ;;
esac
case "$deploy_root" in
  /opt/dsh-store|/opt/dsh-store-cn) ;;
  *) printf 'Unsupported DSH Store root: %s\n' "$deploy_root" >&2; exit 2 ;;
esac
case "$pages_base" in
  https://ai-scarlett.github.io/dsh-safe-plugin-manager) ;;
  *) printf 'Unsupported Pages authority: %s\n' "$pages_base" >&2; exit 2 ;;
esac
case "$store_domain:$pages_subdir" in
  dsh.store:|dsh-store.cn:domestic) ;;
  *) printf 'Unsupported Pages artifact path: %s %s\n' "$store_domain" "$pages_subdir" >&2; exit 2 ;;
esac
case "$store_domain:$health_scheme:$site_prefix" in
  dsh.store:http:/marketplace) readonly health_port=80 ;;
  dsh.store:https:) readonly health_port=443 ;;
  dsh-store.cn:https:) readonly health_port=443 ;;
  *) printf 'Unsupported DSH Store origin topology: %s %s %s\n' "$store_domain" "$health_scheme" "$site_prefix" >&2; exit 2 ;;
esac
readonly health_resolve="$store_domain:$health_port:127.0.0.1"
readonly health_base="$health_scheme://$store_domain"

exec 9>"$lock_file"
if ! flock -n 9; then
  printf '%s\n' 'DSH_STORE_REFRESH_SKIPPED reason=already-running'
  exit 0
fi

install -d -o root -g root -m 0755 "$deploy_root/incoming" "$deploy_root/releases" "$deploy_root/backups"
incoming=$(mktemp -d "$deploy_root/incoming/pages-sync.XXXXXX")
candidate=''
backup=''
old_target=''
switched=0
published=0

cleanup_incoming() {
  case "$incoming" in
    "$deploy_root"/incoming/pages-sync.*) rm -rf -- "$incoming" ;;
    *) printf 'Refusing to remove unexpected incoming path: %s\n' "$incoming" >&2 ;;
  esac
}

origin_health() {
  curl -fsS --resolve "$health_resolve" --connect-timeout 5 --max-time 30 \
    --retry 4 --retry-all-errors --retry-delay 1 "$@"
}

rollback_on_error() {
  rc=$?
  trap - ERR EXIT
  if test "$switched" -eq 1 && test -n "$old_target"; then
    ln -s "$old_target" "$current_link.rollback.$BASHPID"
    mv -Tf "$current_link.rollback.$BASHPID" "$current_link"
    rollback_health=0
    origin_health -o /dev/null "$health_base$site_prefix/" || rollback_health=1
    origin_health -o /dev/null "$health_base/registry/catalog.json" || rollback_health=1
    printf 'DSH_STORE_REFRESH_ROLLBACK restored=%s failed_candidate=%s\n' "$old_target" "$candidate" >&2
    test "$rollback_health" -eq 0 || printf 'DSH_STORE_REFRESH_ROLLBACK_HEALTH_FAILED domain=%s\n' "$store_domain" >&2
  fi
  if test "$published" -eq 0 && test -n "$candidate" && test -e "$candidate"; then
    case "$candidate" in
      "$deploy_root"/releases/*) rm -rf -- "$candidate" ;;
      *) printf 'Refusing to remove unexpected failed candidate: %s\n' "$candidate" >&2 ;;
    esac
  fi
  cleanup_incoming
  exit "$rc"
}
trap rollback_on_error ERR
trap cleanup_incoming EXIT

check_public() {
  while read -r label path; do
    code='000'
    for attempt in 1 2 3 4 5; do
      code=$(origin_health -o "$incoming/health-$label" -w '%{http_code}' "$health_base$path" || true)
      test "$code" = 200 && break
      sleep 1
    done
    test "$code" = 200
  done <<EOF
home $site_prefix/
plugins $site_prefix/plugins/
build $site_prefix/build/
faq $site_prefix/faq/
about $site_prefix/about/
guide $site_prefix/dsh-plugins/
catalog /registry/catalog.json
sitemap $site_prefix/sitemap.xml
EOF

  python3 - "$incoming/health-home" "$incoming/health-catalog" <<'PY'
import json,sys
home=open(sys.argv[1],encoding='utf-8').read()
catalog=json.load(open(sys.argv[2],encoding='utf-8'))
manager=next(item for item in catalog['entries'] if item.get('id') == 'dsh-safe-plugin-manager')
if manager['commit'] not in home:
    raise SystemExit('public homepage install identity mismatch')
print('DSH_STORE_PUBLIC_OK', manager['version'], manager['commit'], manager['status'], manager['details']['license'])
PY
}

curl -fsSL --connect-timeout 10 --max-time 60 --retry 4 --retry-all-errors --retry-delay 2 \
  "$pages_base/${pages_path_prefix}release-manifest.json" -o "$incoming/release-manifest.json"

python3 - "$incoming/release-manifest.json" > "$incoming/files.list" <<'PY'
import json, pathlib, re, sys

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
if manifest.get('schemaVersion') != 1:
    raise SystemExit('unsupported release manifest')
source = manifest.get('sourceCommit', '')
if not re.fullmatch(r'[0-9a-f]{40}', source):
    raise SystemExit('release manifest source commit is not pinned')
files = manifest.get('files')
if not isinstance(files, dict):
    raise SystemExit('release manifest files are missing')
required = {
    'build-manifest.json',
    'marketplace/index.html',
    'marketplace/plugins/index.html',
    'marketplace/build/index.html',
    'marketplace/faq/index.html',
    'marketplace/about/index.html',
    'marketplace/dsh-plugins/index.html',
    'marketplace/sitemap.xml',
    'registry/catalog.json',
}
if not required.issubset(files):
    raise SystemExit('release manifest is incomplete')
for path, metadata in sorted(files.items()):
    if not re.fullmatch(r'[A-Za-z0-9._/-]+', path) or path.startswith('/') or '..' in path.split('/'):
        raise SystemExit(f'unsafe release path: {path}')
    if not isinstance(metadata, dict) or not re.fullmatch(r'[0-9a-f]{64}', str(metadata.get('sha256', ''))):
        raise SystemExit(f'invalid release hash: {path}')
    if not isinstance(metadata.get('size'), int) or metadata['size'] < 0:
        raise SystemExit(f'invalid release size: {path}')
    print(path)
PY

source_sha=$(python3 - "$incoming/release-manifest.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1], encoding='utf-8'))['sourceCommit'])
PY
)

if test -f "$current_link/release-manifest.json" && cmp -s "$incoming/release-manifest.json" "$current_link/release-manifest.json"; then
  check_public
  printf 'DSH_STORE_REFRESH_SKIPPED reason=already-current source=%s\n' "$source_sha"
  exit 0
fi

release_id="$(date -u +%Y%m%dT%H%M%SZ)-pages-${source_sha:0:12}"
candidate="$deploy_root/releases/$release_id"
backup="$deploy_root/backups/$release_id-before"
test ! -e "$candidate"
test ! -e "$backup"
install -d -o root -g root -m 0755 "$candidate"

while IFS= read -r path; do
  install -d -o root -g root -m 0755 "$candidate/$(dirname "$path")"
  curl -fsSL --connect-timeout 10 --max-time 300 --retry 4 --retry-all-errors --retry-delay 2 --continue-at - \
    "$pages_base/${pages_path_prefix}$path" -o "$candidate/$path"
done < "$incoming/files.list"
install -o root -g root -m 0644 "$incoming/release-manifest.json" "$candidate/release-manifest.json"

python3 - "$candidate" <<'PY'
import hashlib, json, os, pathlib, re, sys

root = pathlib.Path(sys.argv[1]).resolve()
manifest = json.loads((root / 'release-manifest.json').read_text(encoding='utf-8'))
for path, metadata in manifest['files'].items():
    target = (root / path).resolve()
    if root not in target.parents or not target.is_file() or target.is_symlink():
        raise SystemExit(f'unsafe or missing artifact: {path}')
    data = target.read_bytes()
    if len(data) != metadata['size'] or hashlib.sha256(data).hexdigest() != metadata['sha256']:
        raise SystemExit(f'artifact mismatch: {path}')

catalog = json.loads((root / 'registry/catalog.json').read_text(encoding='utf-8'))
build = json.loads((root / 'build-manifest.json').read_text(encoding='utf-8'))
manager = next(item for item in catalog['entries'] if item.get('id') == 'dsh-safe-plugin-manager')
actual = (manager['version'], manager['commit'], manager['status'], manager['details']['license'])
expected = (build['manager']['version'], build['manager']['commit'], build['manager']['status'], build['manager']['license'])
if actual != expected or build['sourceCommit'] != manifest['sourceCommit']:
    raise SystemExit('catalog and static build identities do not match')
home = (root / 'marketplace/index.html').read_text(encoding='utf-8')
plugins = (root / 'marketplace/plugins/index.html').read_text(encoding='utf-8')
styles = (root / 'marketplace/styles.css').read_text(encoding='utf-8')
if manager['commit'] not in home or 'data-static-featured-id=' not in home or 'data-static-plugin-id=' not in plugins:
    raise SystemExit('static marketplace content is incomplete')
if not re.search(r'\.load-error\[hidden\]\s*\{\s*display:\s*none;', styles):
    raise SystemExit('catalog error visibility guard is missing')
for path in root.rglob('*'):
    if path.is_symlink() or path.name == '.git' or path.name.startswith('.env') or path.name.startswith('._'):
        raise SystemExit(f'forbidden artifact entry: {path.relative_to(root)}')
print('DSH_STORE_CANDIDATE_OK', build['sourceCommit'], *actual)
PY

chown -R root:root "$candidate"
find "$candidate" -type d -exec chmod 0755 {} +
find "$candidate" -type f -exec chmod 0644 {} +

old_target=$(readlink -f "$current_link")
test -d "$old_target"
install -d -o root -g root -m 0750 "$backup"
cp -a "$old_target"/. "$backup"/
if test -f /etc/nginx/sites-available/dsh-store-pending.conf; then
  cp -a /etc/nginx/sites-available/dsh-store-pending.conf "$backup/dsh-store-pending.conf.before"
fi
printf 'backup_utc=%s\nold_target=%s\nnew_source_commit=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$old_target" "$source_sha" > "$backup/BACKUP.txt"
(
  cd "$backup"
  find . -type f ! -name MANIFEST.sha256 -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > MANIFEST.sha256
  sha256sum -c MANIFEST.sha256 >/dev/null
)

ln -s "$candidate" "$current_link.next.$BASHPID"
mv -Tf "$current_link.next.$BASHPID" "$current_link"
switched=1

check_public

published=1
switched=0
printf 'DSH_STORE_REFRESH_OK source=%s release=%s backup=%s\n' "$source_sha" "$candidate" "$backup"
