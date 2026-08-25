import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareCatalogEntries } from '../src/catalog.mjs'
import { validateCandidateRegistry } from '../src/candidates.mjs'
import { buildAutomationStatus } from '../src/automation-status.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const enrichGitHub = args.includes('--enrich-github')
const outputRoot = resolve(projectRoot, argValue('--out') || '_site')
const sourceSha = argValue('--source-sha') || process.env.GITHUB_SHA || 'local-worktree'
const automationRunsPath = argValue('--automation-runs')
const automationReportsPath = argValue('--automation-reports')
const siteOriginInput = argValue('--site-origin') || process.env.SITE_ORIGIN || 'https://dsh.store'
const siteOriginUrl = new URL(siteOriginInput)
if (siteOriginUrl.protocol !== 'https:' || siteOriginUrl.pathname !== '/' || siteOriginUrl.search || siteOriginUrl.hash) {
  throw new Error('The static site origin must be an HTTPS origin without a path, query, or hash')
}
const siteOrigin = siteOriginUrl.origin
const siteHost = siteOriginUrl.host
const alternateOriginInput = argValue('--alternate-origin') || process.env.ALTERNATE_ORIGIN || 'https://dsh-store.cn'
const alternateOriginUrl = new URL(alternateOriginInput)
if (alternateOriginUrl.protocol !== 'https:' || alternateOriginUrl.pathname !== '/' || alternateOriginUrl.search || alternateOriginUrl.hash) {
  throw new Error('The alternate site origin must be an HTTPS origin without a path, query, or hash')
}
const alternateOrigin = alternateOriginUrl.origin
if (alternateOrigin === siteOrigin) throw new Error('The alternate site origin must differ from the site origin')
const icpNumber = argValue('--icp') || process.env.ICP_NUMBER || ''
const defaultLocale = siteOriginUrl.host === 'dsh.store' ? 'en' : 'zh'
const htmlLanguage = defaultLocale === 'en' ? 'en' : 'zh-CN'
const outputRelative = relative(projectRoot, outputRoot)

if (!outputRelative || outputRelative.startsWith('..')) {
  throw new Error('The static output directory must be a child of the repository root')
}

const catalogPath = resolve(projectRoot, 'registry/catalog.json')
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.entries)) {
  throw new Error('registry/catalog.json is not a supported catalog')
}
const candidateRegistry = validateCandidateRegistry(JSON.parse(await readFile(resolve(projectRoot, 'registry/candidates.json'), 'utf8')))

async function readAutomationRuns(path) {
  if (!path) return {}
  const bytes = await readFile(resolve(path))
  if (bytes.length > 1_000_000) throw new Error('automation run evidence exceeds the byte bound')
  return JSON.parse(bytes.toString('utf8'))
}

async function readAutomationReports(directory) {
  if (!directory) return []
  const root = resolve(directory)
  const reports = []
  async function visit(current, depth = 0) {
    if (depth > 4 || reports.length >= 32) return
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name)
      if (entry.isDirectory()) await visit(absolute, depth + 1)
      else if (entry.isFile() && entry.name === 'catalog-automation-report.json') {
        const bytes = await readFile(absolute)
        if (bytes.length > 1_000_000) throw new Error('automation report exceeds the byte bound')
        const firstSegment = relative(root, absolute).split('/')[0]
        reports.push({ runId: /^\d+$/.test(firstSegment) ? Number(firstSegment) : null, report: JSON.parse(bytes.toString('utf8')) })
      }
    }
  }
  await visit(root)
  return reports
}

const automationRuns = await readAutomationRuns(automationRunsPath)
const automationReports = await readAutomationReports(automationReportsPath)

const snapshot = structuredClone(catalog)
const token = process.env.GITHUB_TOKEN || ''
if (enrichGitHub && !token) {
  throw new Error('GITHUB_TOKEN is required for scheduled GitHub metadata enrichment')
}

function repositoryParts(repositoryUrl) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?$/.exec(repositoryUrl || '')
  if (!match) throw new Error(`Unsupported GitHub repository URL: ${repositoryUrl}`)
  return { owner: match[1], repository: match[2] }
}

function manifestUrl(entry) {
  const { owner, repository } = repositoryParts(entry.repositoryUrl)
  const manifestPath = String(entry.manifestPath || '').split('/').filter(Boolean).map(encodeURIComponent).join('/')
  if (!manifestPath || !/^[0-9a-f]{40}$/.test(entry.commit || '')) {
    throw new Error(`Catalog entry ${entry.id} does not have a pinned manifest source`)
  }
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${entry.commit}/${manifestPath}`
}

async function fetchJson(url, { authenticated = false } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-store-static-builder',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (authenticated && token) headers.Authorization = `Bearer ${token}`
  let lastError
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
      if (response.ok) return response.json()
      lastError = new Error(`${url} returned HTTP ${response.status}`)
      if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError
    } catch (error) {
      lastError = error
    }
    if (attempt < 4) await new Promise(resolvePromise => setTimeout(resolvePromise, attempt * 750))
  }
  throw lastError
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

if (enrichGitHub) {
  const repositoryRequests = new Map()
  const repositoryMetadata = entry => {
    const { owner, repository } = repositoryParts(entry.repositoryUrl)
    const key = `${owner}/${repository}`.toLowerCase()
    if (!repositoryRequests.has(key)) {
      repositoryRequests.set(key, fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, { authenticated: true }))
    }
    return repositoryRequests.get(key)
  }

  await mapLimit(snapshot.entries.filter(entry => entry.status === 'approved'), 5, async entry => {
    const [repository, manifest] = await Promise.all([
      repositoryMetadata(entry),
      fetchJson(manifestUrl(entry)),
    ])
    if (manifest.version !== entry.version) {
      throw new Error(`${entry.id} catalog version ${entry.version} does not match pinned manifest ${manifest.version}`)
    }
    entry.github = {
      stars: repository.stargazers_count,
      forks: repository.forks_count,
      openIssues: repository.open_issues_count,
      archived: repository.archived,
      defaultBranch: repository.default_branch,
      description: repository.description,
      updatedAt: repository.updated_at,
      pushedAt: repository.pushed_at,
      license: repository.license?.spdx_id || 'UNKNOWN',
      manifestVersion: manifest.version,
    }
  })
}

// A scheduled build may run even when neither the catalog nor its GitHub
// metadata changed. Keep the published artifact reproducible in that case so
// the production sync can compare its signed file manifest and skip a needless
// release/backup cycle. The catalog's own update timestamp remains the
// canonical freshness marker for this snapshot.
const generatedAt = typeof snapshot.registry?.updatedAt === 'string' && snapshot.registry.updatedAt
  ? snapshot.registry.updatedAt
  : (process.env.SOURCE_DATE_EPOCH
      ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
      : new Date(0).toISOString())
snapshot.generated = {
  generatedAt,
  sourceRepository: 'https://github.com/AI-Scarlett/dsh-safe-plugin-manager',
  sourceCommit: sourceSha,
  catalogAuthority: 'registry/catalog.json',
  githubEnriched: enrichGitHub,
}

const manager = snapshot.entries.find(entry => entry.id === 'dsh-safe-plugin-manager')
if (!manager || manager.status !== 'approved' || !/^[0-9a-f]{40}$/.test(manager.commit || '')) {
  throw new Error('The approved dsh-safe-plugin-manager catalog entry is required for the static build')
}

const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const palette = ['#6f83ff', '#ff6c4a', '#8c6ce8', '#00a991', '#e0568c', '#4385c6', '#a36c45', '#6a9f39']
const pluginColor = id => palette[[...String(id)].reduce((total, character) => total + character.charCodeAt(0), 0) % palette.length]
const initials = name => String(name || 'DSH').replace(/^DSH\s*/i, '').split(/[\s_-]+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'D'
const categories = snapshot.registry?.categories || {}
const categoryLabel = id => categories[id] || id
const riskLabels = { low: '低权限', medium: '中权限', high: '高权限', unknown: '未知权限' }

const visibleEntries = snapshot.entries
  .filter(entry => entry.status !== 'unlisted')
  .sort(compareCatalogEntries)

function assuranceMarkup(entry) {
  const records = [
    ['已发现', entry.assurance?.discovery?.status || 'verified'],
    ['可安装验证', entry.assurance?.installability?.status || 'unknown'],
    ['运行验证', entry.assurance?.runtime?.status || 'unknown'],
    ['安全审查', entry.assurance?.securityReview?.status || 'unknown'],
  ]
  const label = status => ({ verified: '已验证', partial: '部分验证', failed: '未通过', unknown: '未知', 'not-applicable': '不适用' }[status] || '未知')
  return `<div class="assurance-rail">${records.map(([name, status]) => `<span class="assurance-item assurance-${htmlEscape(status)}"><b>${htmlEscape(name)}</b><em>${htmlEscape(label(status))}</em></span>`).join('')}</div>`
}

function pluginCard(entry) {
  const permissions = entry.details?.permissions || {}
  const topCategories = Array.isArray(entry.categories) ? entry.categories.slice(0, 2) : []
  return `<article class="plugin-card" style="--plugin-color:${pluginColor(entry.id)}" data-static-plugin-id="${htmlEscape(entry.id)}">
    <div class="plugin-card-top">
      <span class="plugin-card-icon" aria-hidden="true">${htmlEscape(initials(entry.name))}</span>
      <span class="status-tag${entry.status === 'approved' ? '' : ' blocked'}">${entry.status === 'approved' ? '可安装' : '仅展示'}</span>
    </div>
    <h3>${htmlEscape(entry.name)}</h3>
    <span class="package-line">${htmlEscape(entry.packageName)} · v${htmlEscape(entry.version)}</span>
    <p class="plugin-description">${htmlEscape(entry.description)}</p>
    <div class="plugin-badges">
      ${topCategories.map(id => `<span class="plugin-badge">${htmlEscape(categoryLabel(id))}</span>`).join('')}
      <span class="plugin-badge risk-${htmlEscape(permissions.level || 'unknown')}">${htmlEscape(riskLabels[permissions.level] || riskLabels.unknown)}</span>
    </div>
    ${assuranceMarkup(entry)}
    <footer class="plugin-card-footer">
      <button class="details-button" type="button" data-details-id="${htmlEscape(entry.id)}">查看插件详情 →</button>
      <a class="repo-link" href="${htmlEscape(entry.repositoryUrl)}" target="_blank" rel="noreferrer" aria-label="打开 GitHub 仓库: ${htmlEscape(entry.name)}" data-repo-id="${htmlEscape(entry.id)}">↗</a>
    </footer>
  </article>`
}

function featuredCard(entry, index) {
  return `<article class="featured-card reveal visible" style="--plugin-color:${pluginColor(entry.id)}" data-static-featured-id="${htmlEscape(entry.id)}">
    <div class="featured-top"><span class="feature-number">PICK / 0${index + 1}</span><span class="dialog-badge">${htmlEscape(categoryLabel(entry.categories?.[0] || 'tools'))}</span></div>
    <span class="featured-icon" aria-hidden="true"><span>${htmlEscape(initials(entry.name))}</span></span>
    <h3>${htmlEscape(entry.name)}</h3>
    <p>${htmlEscape(entry.description)}</p>
    <button class="featured-link details-button" type="button" data-details-id="${htmlEscape(entry.id)}"><span>查看插件详情</span><i aria-hidden="true">↗</i></button>
  </article>`
}

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Static template marker is missing: ${label}`)
  return source.replace(search, replacement)
}

function replaceBetweenMarkers(source, begin, end, content, label) {
  const start = source.indexOf(begin)
  const finish = source.indexOf(end, start + begin.length)
  if (start < 0 || finish < 0) throw new Error(`Static template markers are missing: ${label}`)
  return source.slice(0, start) + begin + content + end + source.slice(finish + end.length)
}

function replaceElementText(source, id, value) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const expression = new RegExp(`(<([a-z0-9]+)[^>]*\\bid="${escapedId}"[^>]*>)[\\s\\S]*?(<\\/\\2>)`, 'i')
  if (!expression.test(source)) throw new Error(`Static element is missing: #${id}`)
  return source.replace(expression, `$1${htmlEscape(value)}$3`)
}

const siteTextExtensions = new Set(['.html', '.js', '.json', '.txt', '.xml', '.webmanifest', '.css'])
async function rewriteSiteReferences(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      await rewriteSiteReferences(absolutePath)
      continue
    }
    if (!entry.isFile() || !siteTextExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase())) continue
    const source = await readFile(absolutePath, 'utf8')
    const rewritten = source.replaceAll('https://dsh.store', siteOrigin).replaceAll('dsh.store', siteHost)
    if (rewritten !== source) await writeFile(absolutePath, rewritten)
  }
}

const externalCatalogMarker = '<meta name="dsh-catalog-delivery" content="external-json">'
const featured = visibleEntries.filter(entry => entry.featured === true && entry.status === 'approved').slice(0, 4)
const categoryCount = new Set(visibleEntries.flatMap(entry => Array.isArray(entry.categories) ? entry.categories : [])).size
const installCommand = `dsh plugin --profile web add 'git+${manager.repositoryUrl}.git#${manager.commit}'`

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
const copyFilter = source => !/(^|\/)\._|(^|\/)\.DS_Store$/.test(source)
await cp(resolve(projectRoot, 'marketplace'), resolve(outputRoot, 'marketplace'), { recursive: true, filter: copyFilter })
await cp(resolve(projectRoot, 'registry'), resolve(outputRoot, 'registry'), { recursive: true, filter: copyFilter })
await rewriteSiteReferences(resolve(outputRoot, 'marketplace'))

const alternateIsDomestic = alternateOriginUrl.host === 'dsh-store.cn'
const alternateLabel = alternateIsDomestic ? '国内站' : '国际站'
const alternateCode = alternateIsDomestic ? 'CN' : 'INTL'
const alternateAriaLabel = alternateIsDomestic ? '切换到国内站 / Switch to China site' : '切换到国际站 / Switch to international site'
const alternateAnalyticsItem = alternateIsDomestic ? 'domestic' : 'international'
const alternateMarkup = `<a class="site-switch-link" href="${htmlEscape(`${alternateOrigin}/`)}" aria-label="${htmlEscape(alternateAriaLabel)}" data-analytics-event="alternate_site_open" data-analytics-item="${alternateAnalyticsItem}"><span>${alternateLabel}</span><small>${alternateCode}</small><i aria-hidden="true">↗</i></a>`

const canonicalPages = [
  { file: 'marketplace/index.html', route: '/' },
  { file: 'marketplace/plugins/index.html', route: '/plugins/' },
  { file: 'marketplace/build/index.html', route: '/build/' },
  { file: 'marketplace/faq/index.html', route: '/faq/' },
  { file: 'marketplace/about/index.html', route: '/about/' },
  { file: 'marketplace/dsh-plugins/index.html', route: '/dsh-plugins/' },
]
const hreflangMarkup = route => {
  const intl = siteOriginUrl.host === 'dsh.store' ? siteOrigin : alternateOrigin
  const domestic = siteOriginUrl.host === 'dsh-store.cn' ? siteOrigin : alternateOrigin
  return [
    `<link rel="alternate" hreflang="en" href="${htmlEscape(`${intl}${route}`)}">`,
    `<link rel="alternate" hreflang="zh-CN" href="${htmlEscape(`${domestic}${route}`)}">`,
    `<link rel="alternate" hreflang="x-default" href="${htmlEscape(`${intl}${route}`)}">`,
  ].join('\n  ')
}

const sitemapDate = (() => {
  const candidate = new Date(snapshot.registry?.updatedAt || generatedAt)
  return Number.isNaN(candidate.valueOf()) ? generatedAt.slice(0, 10) : candidate.toISOString().slice(0, 10)
})()
const sitemapPriority = { '/': '1.0', '/plugins/': '0.9', '/dsh-plugins/': '0.9', '/build/': '0.8', '/faq/': '0.8', '/about/': '0.7' }
const sitemapChangefreq = { '/': 'weekly', '/plugins/': 'daily', '/dsh-plugins/': 'weekly', '/build/': 'weekly', '/faq/': 'monthly', '/about/': 'monthly' }
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${canonicalPages.map(({ route }) => `  <url><loc>${htmlEscape(`${siteOrigin}${route}`)}</loc><lastmod>${sitemapDate}</lastmod><changefreq>${sitemapChangefreq[route]}</changefreq><priority>${sitemapPriority[route]}</priority></url>`).join('\n')}
</urlset>
`
await writeFile(resolve(outputRoot, 'marketplace/sitemap.xml'), sitemap)

const icpMarkup = icpNumber
  ? `<a class="icp-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">${htmlEscape(icpNumber)}</a>`
  : ''
for (const { file: pagePath, route } of canonicalPages) {
  const absolutePath = resolve(outputRoot, pagePath)
  const page = await readFile(absolutePath, 'utf8')
  const withAlternate = replaceRequired(page, '<!-- DSH_ALTERNATE_SITE -->', alternateMarkup, `${pagePath} alternate site marker`)
  const withHreflang = replaceRequired(withAlternate, '<!-- DSH_HREFLANG -->', hreflangMarkup(route), `${pagePath} hreflang marker`)
  const withIcp = replaceRequired(withHreflang, '<!-- DSH_ICP -->', icpMarkup, `${pagePath} ICP marker`)
  const localizedDocument = withIcp.replace('<html lang="zh-CN">', `<html lang="${htmlLanguage}" data-default-locale="${defaultLocale}">`)
  if (localizedDocument === withIcp) throw new Error(`${pagePath} html language marker is missing`)
  await writeFile(absolutePath, localizedDocument)
}

let home = await readFile(resolve(outputRoot, 'marketplace/index.html'), 'utf8')
home = replaceRequired(home, '<!-- DSH_STATIC_CATALOG -->', externalCatalogMarker, 'home external catalog marker')
home = replaceBetweenMarkers(home, '<!-- DSH_STATIC_FEATURED_BEGIN -->', '<!-- DSH_STATIC_FEATURED_END -->', featured.map(featuredCard).join(''), 'featured catalog')
home = home.replace(/"softwareVersion"\s*:\s*"[^"]*"/, `"softwareVersion": "${htmlEscape(manager.version)}"`)
home = replaceElementText(home, 'install-version', `v${manager.version} · SHA PINNED`)
home = replaceElementText(home, 'install-command', installCommand)
home = replaceElementText(home, 'manager-protocol', `STANDARD BUNDLE / v${manager.version}`)
home = replaceElementText(home, 'manager-commit-short', manager.commit.slice(0, 7))
home = replaceElementText(home, 'stat-total', String(visibleEntries.length).padStart(2, '0'))
home = replaceElementText(home, 'stat-approved', String(visibleEntries.filter(entry => entry.status === 'approved').length).padStart(2, '0'))
home = replaceElementText(home, 'stat-categories', String(categoryCount).padStart(2, '0'))
home = replaceElementText(home, 'stat-candidates', String(candidateRegistry.entries.length).padStart(2, '0'))
home = replaceElementText(home, 'catalog-date', `catalog.json · ${snapshot.registry.updatedAt}`)
await writeFile(resolve(outputRoot, 'marketplace/index.html'), home)

let plugins = await readFile(resolve(outputRoot, 'marketplace/plugins/index.html'), 'utf8')
plugins = replaceRequired(plugins, '<!-- DSH_STATIC_CATALOG -->', externalCatalogMarker, 'plugins external catalog marker')
const staticCards = visibleEntries.slice(0, 24).map(pluginCard).join('')
plugins = plugins.replace(/<!-- DSH_STATIC_PLUGIN_CARDS_BEGIN -->[\s\S]*?<!-- DSH_STATIC_PLUGIN_CARDS_END -->/, `<!-- DSH_STATIC_PLUGIN_CARDS_BEGIN -->${staticCards}<!-- DSH_STATIC_PLUGIN_CARDS_END -->`)
plugins = replaceElementText(plugins, 'stat-total', String(visibleEntries.length).padStart(2, '0'))
plugins = replaceElementText(plugins, 'stat-approved', String(visibleEntries.filter(entry => entry.status === 'approved').length).padStart(2, '0'))
plugins = replaceElementText(plugins, 'stat-categories', String(categoryCount).padStart(2, '0'))
plugins = replaceElementText(plugins, 'stat-candidates', String(candidateRegistry.entries.length).padStart(2, '0'))
plugins = replaceElementText(plugins, 'catalog-date', `catalog.json · ${snapshot.registry.updatedAt}`)
plugins = replaceElementText(plugins, 'catalog-meta', `静态目录已生成 · 首屏 ${Math.min(24, visibleEntries.length)} / ${visibleEntries.length}`)
await writeFile(resolve(outputRoot, 'marketplace/plugins/index.html'), plugins)

await writeFile(resolve(outputRoot, 'marketplace/catalog.snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n')
await writeFile(resolve(outputRoot, 'automation-status.json'), JSON.stringify(buildAutomationStatus({
  catalog: snapshot,
  candidates: candidateRegistry,
  runs: automationRuns,
  reports: automationReports,
  generatedAt: new Date().toISOString(),
  sourceCommit: sourceSha,
}), null, 2) + '\n')
await writeFile(resolve(outputRoot, 'build-manifest.json'), JSON.stringify({
  schemaVersion: 1,
  generatedAt,
  sourceCommit: sourceSha,
  siteOrigin,
  alternateOrigin,
  icp: icpNumber || null,
  catalogUpdatedAt: snapshot.registry.updatedAt,
  entryCount: snapshot.entries.length,
  manager: { version: manager.version, commit: manager.commit, license: manager.details?.license, status: manager.status },
  githubEnriched: enrichGitHub,
}, null, 2) + '\n')
await writeFile(resolve(outputRoot, 'index.html'), `<!doctype html>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0; url=marketplace/">\n<title>DSH STORE</title>\n<a href="marketplace/">打开 DSH STORE</a>\n`)
await writeFile(resolve(outputRoot, '.nojekyll'), '')

async function artifactFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await artifactFiles(absolutePath, relativePath))
    else if (entry.isFile() && !['release-manifest.json', 'automation-status.json'].includes(relativePath)) files.push({ relativePath, absolutePath })
    else if (!entry.isFile()) throw new Error(`Unsupported artifact entry: ${relativePath}`)
  }
  return files
}

const releaseFiles = {}
for (const file of await artifactFiles(outputRoot)) {
  const bytes = await readFile(file.absolutePath)
  const metadata = await stat(file.absolutePath)
  releaseFiles[file.relativePath] = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: metadata.size,
  }
}
await writeFile(resolve(outputRoot, 'release-manifest.json'), JSON.stringify({
  schemaVersion: 1,
  generatedAt,
  sourceCommit: sourceSha,
  files: releaseFiles,
}, null, 2) + '\n')

console.log(`STATIC_MARKETPLACE_OK entries=${snapshot.entries.length} manager=${manager.version} commit=${manager.commit} origin=${siteOrigin} enriched=${enrichGitHub}`)
