import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const sha256 = value => createHash('sha256').update(value).digest('hex')

test('server article renderer builds production pages from a bounded persistent source bundle', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-server-articles-'))
  try {
    const source = join(fixture, 'content/articles/source')
    const siteRoot = join(fixture, 'release/marketplace')
    const stateRoot = join(fixture, 'release/server-state')
    await mkdir(source, { recursive: true })
    await mkdir(join(siteRoot, 'about'), { recursive: true })
    const article = {
      slug: 'synthetic-industry-case',
      title: 'Synthetic Industry Case <x>',
      summary: 'Synthetic summary for validating server-side article rendering safely.',
      category: '测试',
      datePublished: '2026-10-29',
      language: 'zh-CN',
      contentMarkdown: '# Synthetic case\n\n' + 'A'.repeat(520) + '\n\n<script>alert(1)</script>',
    }
    const files = {
      'articles.json': Buffer.from(JSON.stringify({
        schemaVersion: 1,
        collectionTitle: 'Synthetic cases',
        collectionDescription: 'Test-only article collection.',
        articles: [article],
      })),
      'articles.css': Buffer.from('.article-prose { color: black; }\n'),
      'index.template.html': Buffer.from([
        '<!doctype html><html lang="zh-CN"><head>',
        '<meta name="description" content="DSH Field Notes">',
        '<!-- DSH_BAIDU_VERIFICATION --><link rel="canonical" href="https://dsh.store/articles/">',
        '<!-- DSH_HREFLANG --><!-- DSH_ARTICLE_COLLECTION_SCHEMA --></head>',
        '<body><nav><!-- DSH_ALTERNATE_SITE --></nav><b id="article-count">—</b>',
        '<div id="article-list"><!-- DSH_STATIC_ARTICLE_LIST --></div>',
        '<nav class="footer-nav"><section class="footer-nav-group"><strong>Quick</strong><a href="../plugins/">Plugins</a></section><!-- DSH_FRIEND_SISTER_SITE --></nav>',
        '<!-- DSH_ICP --></body></html>',
      ].join('\n')),
      'article.template.html': Buffer.from([
        '<!doctype html><html lang="zh-CN"><head>',
        '<meta name="description" content="<!-- ARTICLE_DESCRIPTION -->"><meta property="article:published_time" content="<!-- ARTICLE_DATE -->">',
        '<meta property="og:image" content="<!-- ARTICLE_IMAGE -->">',
        '<meta name="article:section" content="<!-- ARTICLE_CATEGORY -->">',
        '<title><!-- ARTICLE_TITLE --></title><link rel="canonical" href="<!-- ARTICLE_URL -->">',
        '<link rel="stylesheet" href="../articles.css?v=<!-- ASSET_VERSION -->">',
        '<!-- DSH_BAIDU_VERIFICATION --><!-- DSH_HREFLANG --><!-- ARTICLE_SCHEMA --></head>',
        '<body><nav><!-- DSH_ALTERNATE_SITE --></nav><h1><!-- ARTICLE_TITLE --></h1>',
        '<article class="article-prose"><!-- ARTICLE_CONTENT --></article>',
        '<nav class="footer-nav"><section class="footer-nav-group"><strong>Quick</strong><a href="../../plugins/">Plugins</a></section><!-- DSH_FRIEND_SISTER_SITE --></nav>',
        '<!-- DSH_ICP --></body></html>',
      ].join('\n')),
    }
    for (const [name, bytes] of Object.entries(files)) await writeFile(join(source, name), bytes)
    await writeFile(join(source, 'migration-manifest.json'), JSON.stringify({
      schemaVersion: 1,
      planId: 'dsh-articles-to-server-20261029',
      files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)])),
    }))

    for (let index = 0; index < 8; index++) {
      const pagePath = index === 0 ? join(siteRoot, 'index.html') : join(siteRoot, 'about', 'page-' + index + '.html')
      await writeFile(pagePath, '<html lang="en" data-default-locale="en"><nav><!-- DSH_SERVER_ARTICLES_NAV --></nav></html>')
    }
    await writeFile(join(siteRoot, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://dsh.store/sitemap.xml\n')
    await writeFile(join(siteRoot, 'sitemap.xml'), '<urlset></urlset>\n')
    const builderBytes = await readFile(join(root, 'scripts/build-server-articles.py'))
    const buildManifest = join(fixture, 'release/build-manifest.json')
    await writeFile(buildManifest, JSON.stringify({
      schemaVersion: 1,
      sourceCommit: 'a'.repeat(40),
      runtimeAssetVersion: 'a'.repeat(12),
      siteOrigin: 'https://dsh.store',
      alternateOrigin: 'https://dsh-store.cn',
      icp: null,
      baiduSiteVerification: null,
      serverArticles: {
        schemaVersion: 1,
        builder: { path: 'scripts/build-server-articles.py', sha256: sha256(builderBytes), size: builderBytes.byteLength },
      },
    }))

    const result = await execFileAsync('python3', [
      join(root, 'scripts/build-server-articles.py'),
      '--source-dir', source,
      '--site-root', siteRoot,
      '--build-manifest', buildManifest,
    ], { cwd: fixture })
    assert.match(result.stdout, /SERVER_ARTICLES_OK origin=https:\/\/dsh\.store articles=1 source=[a-f0-9]{64} pages=8/)

    const articleIndex = await readFile(join(siteRoot, 'articles/index.html'), 'utf8')
    const detail = await readFile(join(siteRoot, 'articles/synthetic-industry-case/index.html'), 'utf8')
    const robots = await readFile(join(siteRoot, 'robots.txt'), 'utf8')
    const sitemap = await readFile(join(siteRoot, 'articles/sitemap.xml'), 'utf8')
    const releaseManifest = JSON.parse(await readFile(join(stateRoot, 'articles-manifest.json'), 'utf8'))
    assert.match(articleIndex, /"@type":"CollectionPage"/)
    assert.match(articleIndex, /Synthetic Industry Case &lt;x&gt;/)
    assert.match(detail, /"@type":"Article"/)
    assert.match(detail, /<h1>Synthetic Industry Case &lt;x&gt;<\/h1>/)
    assert.match(detail, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.doesNotMatch(detail, /<script>alert\(1\)<\/script>/)
    assert.match(detail, /<link rel="canonical" href="https:\/\/dsh\.store\/articles\/synthetic-industry-case\/">/)
    assert.match(detail, /href="\.\.\/" data-i18n="nav\.articles" aria-current="page"/)
    assert.match(await readFile(join(siteRoot, 'index.html'), 'utf8'), /href="articles\/" data-i18n="nav\.articles">DSH Field Notes/)
    assert.match(robots, /Sitemap: https:\/\/dsh\.store\/articles\/sitemap\.xml/)
    assert.match(sitemap, /https:\/\/dsh\.store\/articles\/synthetic-industry-case\//)
    assert.equal(releaseManifest.articleCount, 1)
    assert.equal(releaseManifest.articleSlugs[0], article.slug)
    assert.equal(releaseManifest.sourceSha256, sha256(files['articles.json']))
    assert.ok(releaseManifest.files['marketplace/articles/synthetic-industry-case/index.html'])
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('server article migration validates the plan path-bound source precondition', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-server-article-migration-'))
  try {
    const planPath = join(fixture, 'plan.json')
    const payload = join(fixture, 'source')
    await mkdir(payload)
    const plan = JSON.parse(await readFile(join(root, 'docs/ops/articles-server-migration-20261029.json'), 'utf8'))
    const server = plan.servers.find(item => item.id === 'dsh-store-intl')
    const current = '/opt/dsh-store/releases/test-pages'
    const manifestSha = 'a'.repeat(64)
    server.currentTarget = current
    server.currentReleaseManifestSha256 = manifestSha
    server.persistentArticleTargetPrecondition = '/opt/dsh-store/content/articles/source absent'
    const files = {
      'articles.json': Buffer.from(JSON.stringify({ articles: Array.from({ length: 12 }, (_, index) => ({ slug: `case-${index}` })) })),
      'articles.css': Buffer.from('article styles'),
      'index.template.html': Buffer.from('index template'),
      'article.template.html': Buffer.from('article template'),
    }
    for (const [name, bytes] of Object.entries(files)) await writeFile(join(payload, name), bytes)
    plan.serverPayload.files = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)]))
    await writeFile(planPath, JSON.stringify(plan))

    const migrator = await readFile(join(root, 'deploy/migrate-articles-to-server.sh'), 'utf8')
    const validator = /python3 - "\$plan_file" "\$payload_dir" "\$deploy_root" "\$expected_server" "\$expected_current" "\$current_manifest_sha" "\$expected_base" <<'PY'\n([\s\S]*?)\nPY/.exec(migrator)?.[1]
    assert.ok(validator, 'server migration plan validator must remain present')
    const runValidator = () => execFileAsync('python3', ['-c', validator, planPath, payload, '/opt/dsh-store',
      'dsh-store-intl', current, manifestSha, 'c8873c9473f601f6ecddb3783aea932574d37d97'])
    await runValidator()

    server.persistentArticleTargetPrecondition = 'absent'
    await writeFile(planPath, JSON.stringify(plan))
    await assert.rejects(runValidator(), error => {
      assert.match(error.stderr, /server release or persistent-content precondition changed/)
      return true
    })
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('server article migration reuses only a real empty backup directory', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-server-article-backup-'))
  try {
    const backup = join(fixture, 'backups/articles-before')
    await mkdir(backup, { recursive: true })
    const migrator = await readFile(join(root, 'deploy/migrate-articles-to-server.sh'), 'utf8')
    const gate = /backup_preexisting_empty=0\nif test -e "\$backup" \|\| test -L "\$backup"; then\n[\s\S]*?\nfi/.exec(migrator)?.[0]
    assert.ok(gate, 'article backup precondition gate must remain present')
    const runGate = () => execFileAsync('bash', ['-c', `set -e\n${gate}\nprintf '%s' "$backup_preexisting_empty"`], {
      env: { PATH: process.env.PATH, backup },
    })
    assert.equal((await runGate()).stdout, '1')
    await writeFile(join(backup, 'keep.txt'), 'existing content')
    await assert.rejects(runGate(), error => {
      assert.match(error.stderr, /Refusing non-empty article backup target/)
      return true
    })
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
