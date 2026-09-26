const downloadTranslations = {
  zh: {
    'a11y.skip': '跳到主要内容',
    'nav.home': '首页', 'nav.plugins': '插件目录', 'nav.community': '社区与开发者',
    'nav.standards': '收录标准', 'nav.build': '开发插件', 'nav.faq': '常见问题',
    'nav.about': '关于我们', 'nav.guide': '使用说明', 'nav.submit': '提交插件',
    'hero.eyebrow': 'OFFICIAL DESKTOP BUILDS / DSH', 'hero.status': '官方发布',
    'hero.title': '把 DSH，带到你的桌面。',
    'hero.lead': '选择与你的设备架构相符的官方安装包。下方列出当前提供的平台与版本。',
    'release.label': '当前提供版本', 'downloads.title': '选择你的设备',
    'downloads.lead': '下载链接直达 DeepSeek 官方分发域名；请在安装前核对操作系统与芯片架构。',
    'mac.title': 'Apple 芯片 Mac', 'mac.description': '适用于 Apple Silicon（ARM64）的 Mac 安装包。',
    'mac.button': '下载 macOS 安装包', 'mac.aria': '下载 macOS Apple Silicon ARM64 安装包',
    'windows.title': 'Windows 64 位电脑',
    'windows.description': '适用于 x64 架构 Windows 电脑的安装程序。',
    'windows.button': '下载 Windows 安装包', 'windows.aria': '下载 Windows x64 安装程序',
    'note.title': '版本与支持状态',
    'note.body': '本页提供的文件为 DSH 0.1.7-rc.1（构建 2026.09.24.1）。DeepSeek 官方介绍将 Harness 标为开发者预览版，核心插件与 API 仍在持续迭代；正式安装前请先了解预览版状态。',
    'note.link': '查看 DeepSeek 官方介绍',
    'source.title': '不装桌面端，也能启动 DSH Web UI。',
    'source.body': 'DeepSeek 官方提供基于 Node.js 的 Web UI 快速体验；想查看项目或按源码方式安装，可直接打开 DSH GitHub 仓库。',
    'source.github': '打开 DSH GitHub 仓库 ↗', 'source.docs': '查看官方快速开始 ↗',
    'source.commandLabel': 'OFFICIAL WEB UI / NODE.JS',
    'source.requirement': '需要先安装 Node.js。命令来源：DeepSeek 官方 Harness 页面。',
    'footer.lead': 'DeepSeek Harness 官方桌面端下载入口。核对平台、架构与版本后再安装。',
    'footer.explore': '快速导航', 'footer.friends': '友情链接',
    'action.top': '回到顶部 ↑',
    'footer.note': '官方文件链接 · 平台架构标注 · 版本信息可核对',
  },
  en: {
    'a11y.skip': 'Skip to main content',
    'nav.home': 'Home', 'nav.plugins': 'Plugins', 'nav.community': 'Community',
    'nav.standards': 'Listing standards', 'nav.build': 'Build a plugin', 'nav.faq': 'FAQ',
    'nav.about': 'About', 'nav.guide': 'Guide', 'nav.submit': 'Submit a plugin',
    'hero.eyebrow': 'OFFICIAL DESKTOP BUILDS / DSH', 'hero.status': 'Official builds',
    'hero.title': 'Bring DSH to your desktop.',
    'hero.lead': 'Choose the official installer that matches your device architecture. Current platforms and build are listed below.',
    'release.label': 'Current build', 'downloads.title': 'Choose your device',
    'downloads.lead': 'Downloads link directly to DeepSeek’s official distribution domain. Check your operating system and CPU architecture before installing.',
    'mac.title': 'Apple Silicon Mac', 'mac.description': 'macOS installer for Apple Silicon (ARM64).',
    'mac.button': 'Download for macOS', 'mac.aria': 'Download the macOS Apple Silicon ARM64 installer',
    'windows.title': '64-bit Windows PC',
    'windows.description': 'Windows installer for x64 systems.', 'windows.button': 'Download for Windows',
    'windows.aria': 'Download the Windows x64 installer',
    'note.title': 'Version and support status',
    'note.body': 'These downloads are DSH 0.1.7-rc.1 (build 2026.09.24.1). DeepSeek describes Harness as a developer preview; core plugins and APIs continue to evolve. Review the preview status before installing.',
    'note.link': 'Official DeepSeek overview',
    'source.title': 'Prefer not to install the desktop app? Run the DSH Web UI.',
    'source.body': 'DeepSeek also documents a Node.js-based Web UI quick start. To inspect the project or install from source, open the official DSH GitHub repository.',
    'source.github': 'Open the DSH GitHub repository ↗', 'source.docs': 'Official quick start ↗',
    'source.commandLabel': 'OFFICIAL WEB UI / NODE.JS',
    'source.requirement': 'Node.js is required. Command from the official DeepSeek Harness page.',
    'footer.lead': 'Official desktop downloads for DeepSeek Harness. Check platform, architecture, and version before installing.',
    'footer.explore': 'Explore', 'footer.friends': 'Friends',
    'action.top': 'Back to top ↑',
    'footer.note': 'Official file links · Platform and architecture labels · Verifiable build version',
  },
}

function selectedDownloadLocale() {
  const fixedLocale = document.documentElement.dataset.fixedLocale
  if (fixedLocale === 'zh-CN') return 'zh'
  let savedLocale = null
  try { savedLocale = localStorage.getItem('dsh-marketplace-locale') } catch {}
  if (savedLocale === 'zh' || savedLocale === 'en') return savedLocale
  return document.documentElement.dataset.defaultLocale === 'en' ? 'en' : 'zh'
}

function setDownloadLocale(locale) {
  const translations = downloadTranslations[locale] ?? downloadTranslations.zh
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
  document.querySelectorAll('[data-i18n]').forEach(node => {
    const translation = translations[node.dataset.i18n]
    if (translation) node.textContent = translation
  })
  document.querySelectorAll('[data-i18n-aria]').forEach(node => {
    const translation = translations[node.dataset.i18nAria]
    if (translation) node.setAttribute('aria-label', translation)
  })
  document.querySelectorAll('[data-locale]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.locale === locale))
  })
  try { localStorage.setItem('dsh-marketplace-locale', locale) } catch {}
}

document.querySelectorAll('[data-locale]').forEach(button => {
  button.addEventListener('click', () => setDownloadLocale(button.dataset.locale))
})
window.addEventListener('storage', event => {
  if (event.key === 'dsh-marketplace-locale') setDownloadLocale(selectedDownloadLocale())
})
setDownloadLocale(selectedDownloadLocale())
