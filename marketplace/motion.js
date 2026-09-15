(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const targetSelector = [
    '.reveal',
    '.seo-guide-hero',
    '.seo-guide-section',
    '.seo-guide-builder > .section-shell',
    '.seo-guide-faq',
    '.article-prose > section',
    '.article-endnote',
    '.plugin-card',
  ].join(',')
  let observer
  let mutationObserver

  function delayFor(element) {
    const siblings = Array.from(element.parentElement?.children || [])
    const index = Math.max(0, siblings.indexOf(element))
    return `${Math.min(index, 3) * 40}ms`
  }

  function show(element) {
    element.classList.add('visible')
  }

  function revealAll() {
    observer?.disconnect()
    mutationObserver?.disconnect()
    document.documentElement.classList.remove('motion-ready')
    document.querySelectorAll(targetSelector).forEach(show)
  }

  function register(root = document) {
    root.querySelectorAll?.(targetSelector).forEach((element) => {
      if (element.dataset.motionRegistered === 'true') return
      element.dataset.motionRegistered = 'true'
      element.classList.add('motion-reveal')
      element.style.setProperty('--motion-delay', delayFor(element))
      observer.observe(element)
    })
  }

  function setup() {
    if (reducedMotion.matches || !('IntersectionObserver' in window)) {
      revealAll()
      return
    }

    document.documentElement.classList.add('motion-ready')
    observer?.disconnect()
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        show(entry.target)
        observer.unobserve(entry.target)
      })
    }, { rootMargin: '0px 0px -7%', threshold: 0.08 })

    register()
    mutationObserver?.disconnect()
    mutationObserver = new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return
        if (node.matches(targetSelector) && node.dataset.motionRegistered !== 'true') {
          node.classList.add('motion-reveal')
          node.dataset.motionRegistered = 'true'
          node.style.setProperty('--motion-delay', delayFor(node))
          observer.observe(node)
        }
        register(node)
      }))
    })
    mutationObserver.observe(document.body, { childList: true, subtree: true })
  }

  setup()
  reducedMotion.addEventListener?.('change', setup)
  window.addEventListener('pagehide', () => {
    observer?.disconnect()
    mutationObserver?.disconnect()
  }, { once: true })
})()
