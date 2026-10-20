import { normalizePublicTrafficSnapshot } from './traffic-model.js'

const ENDPOINT = 'https://tracefence.com/_public/dsh-store-traffic.json'
const MAX_RESPONSE_BYTES = 16 * 1024
const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const SVG_NS = 'http://www.w3.org/2000/svg'

const copy = {
  zh: {
    nav: '国内站今日', pv: 'PV', uv: 'UV', loading: '读取中', unavailable: '暂不可用',
    chartTitle: 'DSH STORE 国内站近七日访问趋势', chartDesc: '按日展示过滤已知爬虫后的页面浏览量与按 IP 去重访客数。',
    chartUnavailable: '访问趋势暂不可用，请稍后重试。', stale: '统计源更新延迟，曲线显示最近一次可用快照。',
    updated: '统计更新于', pvLegend: 'PV 页面浏览', uvLegend: 'UV 按 IP 去重',
    day: '日期', tableSummary: '查看每日明细',
  },
  en: {
    nav: 'Domestic today', pv: 'PV', uv: 'UV', loading: 'Loading', unavailable: 'Unavailable',
    chartTitle: 'DSH STORE domestic visits · last seven days', chartDesc: 'Daily pageviews after known bot filtering and visitors deduplicated by IP.',
    chartUnavailable: 'Traffic data is temporarily unavailable. Please try again later.', stale: 'The source is delayed; the chart shows the latest available snapshot.',
    updated: 'Data updated', pvLegend: 'PV pageviews', uvLegend: 'UV, IP-deduplicated',
    day: 'Date', tableSummary: 'View daily details',
  },
}

const nav = document.querySelector('.site-nav')
const chart = document.querySelector('[data-traffic-chart]')
const chartStatus = document.querySelector('[data-traffic-status]')
const tableBody = document.querySelector('[data-traffic-table-body]')
const navLink = nav ? createNavLink(nav) : null
let lastPayload = null

function locale() {
  return document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

function labels() {
  return copy[locale()]
}

function createNavLink(parent) {
  const language = locale()
  const link = document.createElement('a')
  link.className = 'traffic-nav-link'
  link.dataset.trafficState = 'loading'
  const basePath = location.pathname.startsWith('/marketplace/') ? '/marketplace/' : '/'
  link.href = `${basePath}about/#traffic-weekly`
  link.setAttribute('aria-label', `${copy[language].nav}: ${copy[language].loading}`)

  const kicker = document.createElement('span')
  kicker.className = 'traffic-nav-kicker'
  kicker.dataset.trafficNavLabel = ''
  kicker.textContent = copy[language].nav
  const pv = document.createElement('span')
  pv.className = 'traffic-nav-metric'
  pv.append(document.createTextNode(`${copy[language].pv} `))
  const pvValue = document.createElement('b')
  pvValue.dataset.trafficPv = ''
  pvValue.textContent = '—'
  pv.append(pvValue)
  const uv = document.createElement('span')
  uv.className = 'traffic-nav-metric'
  uv.append(document.createTextNode(`${copy[language].uv} `))
  const uvValue = document.createElement('b')
  uvValue.dataset.trafficUv = ''
  uvValue.textContent = '—'
  uv.append(uvValue)
  link.append(kicker, pv, uv)
  parent.append(link)
  return link
}

function updateLocale() {
  const language = labels()
  document.querySelectorAll('[data-traffic-i18n]').forEach(element => {
    const value = language[element.dataset.trafficI18n]
    if (value) element.textContent = value
  })
  if (navLink) {
    navLink.querySelector('[data-traffic-nav-label]').textContent = language.nav
    const pv = navLink.querySelector('.traffic-nav-metric')
    const uv = navLink.querySelectorAll('.traffic-nav-metric')[1]
    if (pv) pv.firstChild.textContent = `${language.pv} `
    if (uv) uv.firstChild.textContent = `${language.uv} `
  }
  if (lastPayload) renderSnapshot(lastPayload)
}

function setNavUnavailable() {
  if (!navLink) return
  const language = labels()
  navLink.dataset.trafficState = 'unavailable'
  navLink.querySelector('[data-traffic-pv]').textContent = '—'
  navLink.querySelector('[data-traffic-uv]').textContent = '—'
  navLink.setAttribute('aria-label', `${language.nav}: ${language.unavailable}`)
  navLink.removeAttribute('title')
}

function svgElement(name, attributes = {}, text = '') {
  const element = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  if (text) element.textContent = text
  return element
}

function dateLabel(value) {
  const language = locale() === 'en' ? 'en-US' : 'zh-CN'
  return new Intl.DateTimeFormat(language, {
    month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai',
  }).format(new Date(`${value}T12:00:00+08:00`))
}

function formatNumber(value) {
  return new Intl.NumberFormat(locale() === 'en' ? 'en-US' : 'zh-CN').format(value)
}

function formatTime(value) {
  return new Intl.DateTimeFormat(locale() === 'en' ? 'en-US' : 'zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

function drawChart(snapshot) {
  if (!chart) return
  const language = labels()
  const width = 360
  const bounds = { left: 48, right: 350, top: 25, bottom: 176 }
  const maxValue = Math.max(1, ...snapshot.days.flatMap(item => [item.pv, item.uv]))
  const step = maxValue / 4
  const xFor = index => bounds.left + index * (bounds.right - bounds.left) / 6
  const yFor = value => bounds.bottom - value / maxValue * (bounds.bottom - bounds.top)
  const title = svgElement('title', { id: 'traffic-chart-title' }, language.chartTitle)
  const description = svgElement('desc', { id: 'traffic-chart-desc' }, language.chartDesc)
  const items = [title, description]

  for (let index = 0; index <= 4; index++) {
    const value = maxValue - step * index
    const y = bounds.top + (bounds.bottom - bounds.top) * index / 4
    items.push(svgElement('line', { class: 'traffic-chart-grid', x1: bounds.left, x2: bounds.right, y1: y, y2: y }))
    items.push(svgElement('text', { class: 'traffic-chart-axis', x: bounds.left - 7, y: y + 3, 'text-anchor': 'end' }, formatNumber(Math.round(value))))
  }

  const pvPoints = snapshot.days.map((item, index) => `${xFor(index)},${yFor(item.pv)}`).join(' ')
  const uvPoints = snapshot.days.map((item, index) => `${xFor(index)},${yFor(item.uv)}`).join(' ')
  items.push(svgElement('polyline', { class: 'traffic-chart-line traffic-chart-line-pv', points: pvPoints }))
  items.push(svgElement('polyline', { class: 'traffic-chart-line traffic-chart-line-uv', points: uvPoints }))

  for (const [index, item] of snapshot.days.entries()) {
    for (const [metric, value] of [['pv', item.pv], ['uv', item.uv]]) {
      const point = svgElement('circle', {
        class: `traffic-chart-point traffic-chart-point-${metric}`,
        cx: xFor(index), cy: yFor(value), r: 3.8,
      })
      point.append(svgElement('title', {}, `${dateLabel(item.date)} · ${metric.toUpperCase()} ${formatNumber(value)}`))
      items.push(point)
    }
    items.push(svgElement('text', {
      class: 'traffic-chart-date', x: xFor(index), y: bounds.bottom + 25, 'text-anchor': 'middle',
    }, dateLabel(item.date)))
  }

  chart.setAttribute('viewBox', `0 0 ${width} 218`)
  chart.setAttribute('aria-labelledby', 'traffic-chart-title traffic-chart-desc')
  chart.replaceChildren(...items)
}

function renderTable(snapshot) {
  if (!tableBody) return
  const language = locale()
  const rows = snapshot.days.map(item => {
    const row = document.createElement('tr')
    for (const value of [dateLabel(item.date), formatNumber(item.pv), formatNumber(item.uv)]) {
      const cell = document.createElement('td')
      cell.textContent = value
      row.append(cell)
    }
    return row
  })
  tableBody.replaceChildren(...rows)
  const details = document.querySelector('[data-traffic-table-summary]')
  if (details) details.textContent = language.tableSummary
}

function renderSnapshot(payload) {
  const snapshot = normalizePublicTrafficSnapshot(payload)
  if (!snapshot) {
    setNavUnavailable()
    if (chartStatus) chartStatus.textContent = labels().chartUnavailable
    return
  }

  if (navLink) {
    const language = labels()
    if (snapshot.today) {
      navLink.dataset.trafficState = 'fresh'
      navLink.querySelector('[data-traffic-pv]').textContent = formatNumber(snapshot.today.pv)
      navLink.querySelector('[data-traffic-uv]').textContent = formatNumber(snapshot.today.uv)
      navLink.setAttribute('aria-label', `${language.nav}: ${language.pv} ${formatNumber(snapshot.today.pv)}, ${language.uv} ${formatNumber(snapshot.today.uv)}`)
      navLink.title = `${language.updated} ${formatTime(snapshot.sourceUpdatedAt)}`
    } else {
      navLink.dataset.trafficState = 'stale'
      navLink.querySelector('[data-traffic-pv]').textContent = '—'
      navLink.querySelector('[data-traffic-uv]').textContent = '—'
      navLink.setAttribute('aria-label', `${language.nav}: ${language.unavailable}`)
      navLink.title = `${language.updated} ${formatTime(snapshot.sourceUpdatedAt)}`
    }
  }

  drawChart(snapshot)
  renderTable(snapshot)
  if (chartStatus) {
    const language = labels()
    chartStatus.textContent = snapshot.fresh
      ? `${language.updated} ${formatTime(snapshot.sourceUpdatedAt)}`
      : `${language.stale} ${language.updated} ${formatTime(snapshot.sourceUpdatedAt)}`
  }
}

async function readBoundedJson(response) {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error('response too large')
  const body = await response.text()
  if (body.length > MAX_RESPONSE_BYTES) throw new Error('response too large')
  return JSON.parse(body)
}

async function refresh() {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(ENDPOINT, {
      method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-cache',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    })
    if (!response.ok) throw new Error('traffic endpoint unavailable')
    lastPayload = await readBoundedJson(response)
    renderSnapshot(lastPayload)
  } catch {
    if (!lastPayload) {
      setNavUnavailable()
      if (chartStatus) chartStatus.textContent = labels().chartUnavailable
    } else {
      renderSnapshot(lastPayload)
    }
  } finally {
    window.clearTimeout(timeout)
  }
}

const localeObserver = new MutationObserver(updateLocale)
localeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
document.addEventListener('click', event => {
  if (event.target instanceof Element && event.target.closest('[data-locale]')) queueMicrotask(updateLocale)
})
updateLocale()
void refresh()
window.setInterval(() => { if (!document.hidden) void refresh() }, REFRESH_INTERVAL_MS)
