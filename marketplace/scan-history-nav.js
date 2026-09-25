const scanHistoryLabels = { zh: '扫描记录', en: 'Scan history' }

function updateScanHistoryNav() {
  const fixedLocale = document.documentElement.dataset.fixedLocale
  const defaultLocale = document.documentElement.dataset.defaultLocale
  let savedLocale = null
  try { savedLocale = localStorage.getItem('dsh-marketplace-locale') } catch {}
  const locale = fixedLocale === 'zh-CN'
    ? 'zh'
    : savedLocale === 'en' || savedLocale === 'zh'
      ? savedLocale
      : defaultLocale === 'en' ? 'en' : 'zh'
  document.querySelectorAll('[data-scan-history-nav]').forEach(link => {
    link.textContent = scanHistoryLabels[locale]
    link.setAttribute('aria-label', locale === 'en' ? 'Scan history' : '扫描记录')
  })
}

updateScanHistoryNav()
document.addEventListener('click', event => {
  if (!event.target.closest('[data-locale]')) return
  window.setTimeout(updateScanHistoryNav, 0)
})
window.addEventListener('storage', event => {
  if (event.key === 'dsh-marketplace-locale') updateScanHistoryNav()
})
