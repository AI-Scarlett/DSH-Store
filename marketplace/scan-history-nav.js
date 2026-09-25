const navigationLabels = {
  scanHistory: { zh: '扫描记录', en: 'Scan history' },
  downloads: {
    zh: {
      trigger: '下载 DSH',
      mac: 'macOS 桌面端', macDetail: 'Apple Silicon · ARM64',
      windows: 'Windows 桌面端', windowsDetail: 'Windows · x64',
      web: 'Web UI 安装', webDetail: 'Node.js · GitHub 源码',
    },
    en: {
      trigger: 'Get DSH',
      mac: 'macOS desktop app', macDetail: 'Apple Silicon · ARM64',
      windows: 'Windows desktop app', windowsDetail: 'Windows · x64',
      web: 'Install Web UI', webDetail: 'Node.js · GitHub source',
    },
  },
}

const desktopDownloads = {
  mac: 'https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.1.7-rc.1.20260924.1-mac-arm64.dmg',
  windows: 'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.1.7-rc.1.20260924.1-win-x64.exe',
}

function selectedLocale() {
  const fixedLocale = document.documentElement.dataset.fixedLocale
  if (fixedLocale === 'zh-CN') return 'zh'
  let savedLocale = null
  try { savedLocale = localStorage.getItem('dsh-marketplace-locale') } catch {}
  if (savedLocale === 'zh' || savedLocale === 'en') return savedLocale
  return document.documentElement.dataset.defaultLocale === 'en' ? 'en' : 'zh'
}

function appendMenuOption(panel, { href, titleKey, detailKey, analytics }) {
  const link = document.createElement('a')
  link.className = 'download-menu-option'
  link.href = href
  link.dataset.downloadChoice = titleKey
  link.dataset.analyticsEvent = 'desktop_download_choice'
  link.dataset.analyticsItem = analytics
  const copy = document.createElement('span')
  copy.className = 'download-menu-copy'
  const title = document.createElement('strong')
  title.dataset.downloadLabel = titleKey
  const detail = document.createElement('small')
  detail.dataset.downloadLabel = detailKey
  copy.append(title, detail)
  const arrow = document.createElement('i')
  arrow.setAttribute('aria-hidden', 'true')
  arrow.textContent = titleKey === 'web' ? '↗' : '↓'
  link.append(copy, arrow)
  link.addEventListener('click', closeDownloadMenu)
  panel.append(link)
  return link
}

let activeDownloadMenu = null

function closeDownloadMenu() {
  if (!activeDownloadMenu) return
  activeDownloadMenu.panel.hidden = true
  activeDownloadMenu.button.setAttribute('aria-expanded', 'false')
}

function ensureDesktopDownloadMenu() {
  if (document.querySelector('[data-desktop-download-menu]')) return
  const headerTools = document.querySelector('.header-tools')
  const localeSwitch = headerTools?.querySelector('.locale-switch')
  const scanLink = document.querySelector('[data-scan-history-nav]')
  if (!headerTools || !localeSwitch || !scanLink) return

  const downloadsUrl = new URL('../downloads/', scanLink.href)
  const wrapper = document.createElement('div')
  wrapper.className = 'desktop-download-menu'
  wrapper.dataset.desktopDownloadMenu = ''
  const button = document.createElement('button')
  button.className = 'desktop-download-trigger'
  button.type = 'button'
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-controls', 'desktop-download-options')
  const buttonLabel = document.createElement('span')
  buttonLabel.dataset.downloadTriggerLabel = ''
  const chevron = document.createElement('i')
  chevron.setAttribute('aria-hidden', 'true')
  chevron.textContent = '⌄'
  button.append(buttonLabel, chevron)

  const panel = document.createElement('div')
  panel.className = 'desktop-download-panel'
  panel.id = 'desktop-download-options'
  panel.hidden = true
  appendMenuOption(panel, {
    href: desktopDownloads.mac,
    titleKey: 'mac', detailKey: 'macDetail', analytics: 'mac-arm64',
  })
  appendMenuOption(panel, {
    href: desktopDownloads.windows,
    titleKey: 'windows', detailKey: 'windowsDetail', analytics: 'windows-x64',
  })
  appendMenuOption(panel, {
    href: `${downloadsUrl.href}#web-ui`,
    titleKey: 'web', detailKey: 'webDetail', analytics: 'web-ui',
  })
  button.addEventListener('click', () => {
    const isOpen = button.getAttribute('aria-expanded') === 'true'
    panel.hidden = isOpen
    button.setAttribute('aria-expanded', String(!isOpen))
  })
  wrapper.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || panel.hidden) return
    closeDownloadMenu()
    button.focus()
  })
  document.addEventListener('click', event => {
    if (!wrapper.contains(event.target)) closeDownloadMenu()
  })
  wrapper.append(button, panel)
  headerTools.insertBefore(wrapper, localeSwitch)
  activeDownloadMenu = { button, panel }
}

function updateNavigationLabels() {
  const locale = selectedLocale()
  document.querySelectorAll('[data-scan-history-nav]').forEach(link => {
    link.textContent = navigationLabels.scanHistory[locale]
    link.setAttribute('aria-label', navigationLabels.scanHistory[locale])
  })
  const labels = navigationLabels.downloads[locale]
  document.querySelectorAll('[data-download-trigger-label]').forEach(node => {
    node.textContent = labels.trigger
  })
  document.querySelectorAll('[data-download-label]').forEach(node => {
    node.textContent = labels[node.dataset.downloadLabel]
  })
}

ensureDesktopDownloadMenu()
updateNavigationLabels()
document.addEventListener('click', event => {
  if (!event.target.closest('[data-locale]')) return
  window.setTimeout(updateNavigationLabels, 0)
})
window.addEventListener('storage', event => {
  if (event.key === 'dsh-marketplace-locale') updateNavigationLabels()
})
