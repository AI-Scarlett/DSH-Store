#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly plan_file="${1:?usage: migrate-articles-to-server.sh PLAN PAYLOAD_DIR DEPLOY_ROOT}"
readonly payload_dir="${2:?usage: migrate-articles-to-server.sh PLAN PAYLOAD_DIR DEPLOY_ROOT}"
readonly deploy_root="${3:?usage: migrate-articles-to-server.sh PLAN PAYLOAD_DIR DEPLOY_ROOT}"
readonly plan_id="dsh-articles-to-server-20261029"
readonly current_link="$deploy_root/current"
readonly source_target="$deploy_root/content/articles/source"
readonly backup="$deploy_root/backups/articles-before-20261029"
readonly upload_root="$deploy_root/incoming/article-migration-upload-20261029"
readonly expected_base="c8873c9473f601f6ecddb3783aea932574d37d97"
readonly expected_files="articles.json articles.css index.template.html article.template.html"
stage=''
installed=0

rollback_on_error() {
  rc=$?
  trap - ERR EXIT
  mkdir -p -m 0750 "$backup"
  if test -n "$stage" && test -d "$stage"; then
    failed_stage="$backup/staged-source-failed.$BASHPID"
    mv -T "$stage" "$failed_stage"
    printf 'DSH_ARTICLES_MIGRATION_PRESERVED_FAILED_STAGE=%s\n' "$failed_stage" >&2
  fi
  if test "$installed" -eq 1 && test -e "$source_target"; then
    failed_source="$backup/source-failed.$BASHPID"
    mv -T "$source_target" "$failed_source"
    printf 'DSH_ARTICLES_MIGRATION_ROLLBACK_SOURCE=%s\n' "$failed_source" >&2
  fi
  exit "$rc"
}
trap rollback_on_error ERR

test "$(id -u)" -eq 0
case "$deploy_root" in
  /opt/dsh-store|/opt/dsh-store-cn) ;;
  *) printf 'Unsupported DSH Store root: %s\n' "$deploy_root" >&2; exit 2 ;;
esac
test "$plan_file" = "$upload_root/plan.json"
test "$payload_dir" = "$upload_root/source"
test -f "$plan_file"
test -d "$payload_dir"
test ! -L "$upload_root"
test ! -L "$plan_file"
test ! -L "$payload_dir"
test ! -e "$source_target"
test ! -L "$source_target"
test ! -e "$backup"
test ! -L "$backup"

case "$deploy_root" in
  /opt/dsh-store) readonly expected_server="dsh-store-intl"; readonly expected_current="/opt/dsh-store/releases/20261029T015120Z-pages-c8873c9473f6" ;;
  /opt/dsh-store-cn) readonly expected_server="dsh-store-cn-814823065"; readonly expected_current="/opt/dsh-store-cn/releases/20261029T015119Z-pages-c8873c9473f6" ;;
esac

old_target=$(readlink -f "$current_link")
test "$old_target" = "$expected_current"
test -f "$old_target/release-manifest.json"
current_manifest_sha=$(sha256sum "$old_target/release-manifest.json" | awk '{print $1}')

python3 - "$plan_file" "$payload_dir" "$deploy_root" "$expected_server" "$expected_current" "$current_manifest_sha" "$expected_base" <<'PY'
import hashlib, json, pathlib, re, sys
plan_path, payload, deploy_root, server_id, current, manifest_sha, base = sys.argv[1:]
plan = json.loads(pathlib.Path(plan_path).read_text(encoding='utf-8'))
if plan.get('schemaVersion') != 1 or plan.get('planId') != 'dsh-articles-to-server-20261029':
    raise SystemExit('migration plan identity mismatch')
if plan.get('baseCommit') != base or plan.get('repositoryPrecondition', {}).get('status') != 'clean':
    raise SystemExit('migration plan source precondition mismatch')
server = next((item for item in plan.get('servers', []) if item.get('id') == server_id), None)
if not server or server.get('root') != deploy_root or server.get('currentTarget') != current:
    raise SystemExit('migration plan server target mismatch')
if server.get('currentReleaseManifestSha256') != manifest_sha or server.get('persistentArticleTargetPrecondition') != 'absent':
    raise SystemExit('server release or persistent-content precondition changed')
files = plan.get('serverPayload', {}).get('files')
if not isinstance(files, dict) or set(files) != {'articles.json', 'articles.css', 'index.template.html', 'article.template.html'}:
    raise SystemExit('migration plan payload file scope mismatch')
root = pathlib.Path(payload)
if root.is_symlink() or not root.is_dir() or {p.name for p in root.iterdir()} != set(files):
    raise SystemExit('uploaded article payload file set mismatch')
for name, expected in files.items():
    path = root / name
    if path.is_symlink() or not path.is_file() or not re.fullmatch(r'[a-f0-9]{64}', str(expected)):
        raise SystemExit('uploaded article payload is unsafe or malformed')
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise SystemExit('uploaded article payload hash mismatch: ' + name)
collection = json.loads((root / 'articles.json').read_text(encoding='utf-8'))
if len(collection.get('articles', [])) != plan.get('serverPayload', {}).get('expectedArticleCount'):
    raise SystemExit('uploaded article count differs from the migration plan')
PY

stage="$deploy_root/incoming/articles-migration-20261029.$BASHPID"
test ! -e "$stage"
test ! -L "$stage"
install -d -o root -g root -m 0755 "$deploy_root/content/articles" "$deploy_root/backups"
mkdir -m 0750 "$stage"
for file in $expected_files; do
  install -o root -g root -m 0640 "$payload_dir/$file" "$stage/$file"
done
python3 - "$plan_file" "$stage" "$expected_server" "$expected_current" "$current_manifest_sha" <<'PY'
import json, pathlib, sys
plan = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
server_id, current, manifest_sha = sys.argv[3:]
manifest = {
    'schemaVersion': 1,
    'planId': plan['planId'],
    'sourceCommit': plan['baseCommit'],
    'serverId': server_id,
    'currentTargetBeforeMigration': current,
    'currentReleaseManifestSha256BeforeMigration': manifest_sha,
    'articleCountAtMigration': plan['serverPayload']['expectedArticleCount'],
    'files': plan['serverPayload']['files'],
}
(pathlib.Path(sys.argv[2]) / 'migration-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
PY
chmod 0640 "$stage/migration-manifest.json"

mkdir -m 0750 "$backup"
printf 'plan_id=%s\nserver_id=%s\nprior_content_target=absent\ncurrent_release=%s\ncurrent_release_manifest_sha256=%s\n' \
  "$plan_id" "$expected_server" "$old_target" "$current_manifest_sha" > "$backup/BACKUP.txt"
(
  cd "$stage"
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > "$backup/SOURCE.MANIFEST.sha256"
  sha256sum -c "$backup/SOURCE.MANIFEST.sha256" >/dev/null
)
mv -T "$stage" "$source_target"
stage=''
installed=1
(
  cd "$source_target"
  sha256sum -c "$backup/SOURCE.MANIFEST.sha256" >/dev/null
)
test "$(readlink -f "$current_link")" = "$old_target"
test "$(sha256sum "$old_target/release-manifest.json" | awk '{print $1}')" = "$current_manifest_sha"
article_count=$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1],encoding="utf-8"))["articles"]))' "$source_target/articles.json")
case "$deploy_root" in
  /opt/dsh-store) site_domain=dsh.store ;;
  /opt/dsh-store-cn) site_domain=dsh-store.cn ;;
esac
curl -4 --http1.1 -fsS --connect-timeout 5 --max-time 30 "https://$site_domain/articles/" -o /dev/null
printf 'DSH_ARTICLES_SERVER_SOURCE_OK server=%s target=%s articles=%s\n' \
  "$expected_server" "$source_target" "$article_count"
trap - ERR
