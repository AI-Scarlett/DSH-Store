window.__ModuleLoader__.load({
  id: 'dsh-safe-plugin-manager',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { useCallback, useEffect, useMemo, useState } = React
    const ROUTES = {
      inventory: '/api2/dsh-safe-plugin-manager/inventory',
      market: '/api2/dsh-safe-plugin-manager/market',
      health: '/api2/dsh-safe-plugin-manager/health',
      plan: '/api2/dsh-safe-plugin-manager/plan',
      execute: '/api2/dsh-safe-plugin-manager/execute',
    }

    async function post(route, body = {}, intent = null) {
      const headers = { 'content-type': 'application/json' }
      if (intent) headers['x-dsh-safe-intent'] = intent
      const response = await fetch(route, { method: 'POST', headers, body: JSON.stringify(body) })
      const payload = await response.json()
      if (!response.ok || !payload.ok) {
        const error = new Error(payload?.error?.message || `HTTP ${response.status}`)
        error.code = payload?.error?.code || 'REQUEST_FAILED'
        throw error
      }
      return payload.value
    }

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '920px' },
      toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' },
      nav: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
      title: { margin: 0, fontSize: '16px', lineHeight: '24px', fontWeight: 650 },
      subtitle: { margin: '3px 0 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px' },
      input: {
        width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '9px',
        padding: '9px 11px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)',
      },
      select: {
        boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '9px',
        padding: '9px 11px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', minWidth: '180px',
      },
      button: {
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '7px 11px',
        background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontSize: '12px',
      },
      activeButton: { background: 'var(--dsw-alias-bg-layer-3)', borderColor: 'var(--dsw-alias-label-secondary)', fontWeight: 600 },
      dangerButton: { borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
      primaryButton: { borderColor: 'var(--dsw-alias-label-primary)', fontWeight: 600 },
      disabledButton: { opacity: 0.45, cursor: 'not-allowed' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' },
      card: {
        display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '11px', padding: '13px 14px', background: 'var(--dsw-alias-bg-layer-3)', minWidth: 0,
      },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' },
      name: { minWidth: 0, overflowWrap: 'anywhere', fontSize: '13px', fontWeight: 650 },
      muted: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px' },
      badge: { display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '3px 7px', background: 'var(--dsw-alias-bg-layer-2)', fontSize: '11px' },
      actions: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '2px' },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px' },
      notice: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '11px 13px', fontSize: '12px', lineHeight: '18px' },
      plan: { border: '1px solid var(--dsw-alias-label-secondary)', borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' },
      code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere', fontSize: '12px' },
      link: { color: 'var(--dsw-alias-label-primary)', fontSize: '12px' },
    }

    function Button({ children, active = false, danger = false, primary = false, disabled = false, onClick }) {
      return React.createElement('button', {
        type: 'button', disabled, onClick,
        style: { ...styles.button, ...(active ? styles.activeButton : {}), ...(danger ? styles.dangerButton : {}), ...(primary ? styles.primaryButton : {}), ...(disabled ? styles.disabledButton : {}) },
      }, children)
    }

    function PluginActions({ entry, health, beginPlan }) {
      const allowed = new Set(entry.allowedActions || [])
      if (allowed.size === 0) return React.createElement('div', { style: styles.muted }, entry.managementBlockedReason || '当前没有可执行操作')
      const disabled = entry.entryIds.length > 0 && entry.entryIds.every(id => health?.disabledEntryIds?.includes(id))
      const actions = []
      if (allowed.has('install')) actions.push(React.createElement(Button, { key: 'install', primary: true, onClick: () => beginPlan('install', entry) }, '安装'))
      if (allowed.has('update')) actions.push(React.createElement(Button, { key: 'update', primary: true, onClick: () => beginPlan('update', entry) }, '更新'))
      if (allowed.has('migrate')) actions.push(React.createElement(Button, { key: 'migrate', primary: true, onClick: () => beginPlan('migrate', entry) }, '迁移到商城版'))
      if (entry.entryIds.length > 0 && (allowed.has('enable') || allowed.has('disable'))) {
        actions.push(React.createElement(Button, { key: 'toggle', onClick: () => beginPlan(disabled ? 'enable' : 'disable', entry) }, disabled ? '启用' : '停用'))
      }
      if (allowed.has('uninstall')) actions.push(React.createElement(Button, { key: 'remove', danger: true, onClick: () => beginPlan('uninstall', entry) }, '卸载'))
      return React.createElement('div', { style: styles.actions }, actions)
    }

    function MarketCard({ entry, health, beginPlan, categoryLabels = {} }) {
      const state = entry.status === 'blocked' ? '策略阻止'
        : entry.migrationAvailable ? (entry.updateAvailable ? '可迁移并更新' : '可迁移到商城')
          : entry.installed ? (entry.updateAvailable ? '有更新' : `已安装 ${entry.installedVersion || ''}`) : '可安装'
      const origin = entry.installOrigin === 'marketplace-managed' ? '商城安装'
        : entry.installOrigin === 'catalog-source-matched' ? '目录来源匹配 · 渠道未知'
          : entry.installOrigin === 'local-development' ? '本地开发安装'
            : entry.installOrigin === 'external-or-drifted' ? '外部安装 / 来源漂移' : null
      return React.createElement('article', { style: styles.card },
        React.createElement('div', { style: styles.row },
          React.createElement('div', { style: styles.name }, `${entry.featured ? '★ ' : ''}${entry.name}`),
          React.createElement('span', { style: styles.badge }, state)),
        React.createElement('div', { style: styles.code }, `${entry.packageName} · ${entry.version}`),
        React.createElement('div', { style: styles.muted }, entry.description),
        React.createElement('div', { style: styles.muted }, `Commit ${entry.commit.slice(0, 12)} · ${entry.categories.map(id => categoryLabels[id] || id).join(' / ')}`),
        origin ? React.createElement('div', { style: styles.badge }, origin) : null,
        Number.isInteger(entry.installCount) ? React.createElement('div', { style: styles.muted }, `累计安装 ${entry.installCount}`) : null,
        entry.risk.installScripts.length > 0
          ? React.createElement('div', { style: styles.error }, `安装脚本：${entry.risk.installScripts.join(', ')}`)
          : null,
        React.createElement('a', { href: entry.repositoryUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, '查看 GitHub 仓库'),
        React.createElement(PluginActions, { entry, health, beginPlan }))
    }

    function HealthPanel({ health }) {
      if (!health) return React.createElement('p', { style: styles.muted }, '正在执行健康检查…')
      return React.createElement(React.Fragment, null,
        React.createElement('div', { style: styles.notice }, `总体状态：${health.status} · Profile: ${health.profile}`),
        React.createElement('div', { style: styles.grid }, health.checks.map(item => React.createElement('article', { key: item.id, style: styles.card },
          React.createElement('div', { style: styles.row }, React.createElement('div', { style: styles.name }, item.id), React.createElement('span', { style: styles.badge }, item.status)),
          React.createElement('div', { style: styles.muted }, item.message)))))
    }

    function PlanPanel({ operation, confirmation, setConfirmation, execute, cancel }) {
      if (!operation || operation.status === 'idle') return null
      if (operation.status === 'planning' || operation.status === 'executing') {
        return React.createElement('div', { style: styles.notice }, operation.status === 'planning' ? '正在生成只读操作计划…' : '正在执行事务与健康检查…')
      }
      if (operation.status === 'error') return React.createElement('div', { style: styles.plan },
        React.createElement('div', { style: styles.error }, `${operation.code || 'ERROR'}：${operation.message}`),
        React.createElement(Button, { onClick: cancel }, '关闭'))
      if (operation.status === 'result') {
        const result = operation.value
        return React.createElement('div', { style: styles.plan },
          React.createElement('strong', null, result.status === 'applied' ? '操作已应用' : '操作失败并已触发回滚'),
          React.createElement('div', { style: styles.muted }, `事务 ${result.transactionId} · 回滚 ${result.rollback || '不需要'}`),
          result.error ? React.createElement('div', { style: styles.error }, `${result.error.code}：${result.error.message}`) : null,
          React.createElement(Button, { onClick: cancel }, '完成'))
      }
      const plan = operation.value
      const matches = confirmation === plan.confirmation
      return React.createElement('div', { style: styles.plan },
        React.createElement('strong', null, '操作预览与确认'),
        React.createElement('div', { style: styles.code }, `${plan.action} · ${plan.plugin.packageName} · ${plan.profile}`),
        React.createElement('div', { style: styles.muted }, `GitHub Commit：${plan.plugin.commit}`),
        React.createElement('div', { style: styles.muted }, `可能修改：${plan.impact.mayModify.join('、')}`),
        React.createElement('div', { style: styles.muted }, `永久保护：${plan.impact.neverModify.join('、')}`),
        plan.impact.sourceTransition ? React.createElement('div', { style: styles.notice }, plan.impact.sourceTransition) : null,
        plan.impact.installScripts.length > 0 ? React.createElement('div', { style: styles.error }, `此插件会运行：${plan.impact.installScripts.join('、')}`) : null,
        React.createElement('label', { style: styles.muted }, '输入以下确认语后才能执行：'),
        React.createElement('div', { style: styles.code }, plan.confirmation),
        React.createElement('input', { value: confirmation, onChange: event => setConfirmation(event.target.value), style: styles.input, placeholder: '精确输入确认语' }),
        React.createElement('div', { style: styles.actions },
          React.createElement(Button, { onClick: cancel }, '取消'),
          React.createElement(Button, { primary: true, danger: true, disabled: !matches, onClick: execute }, '执行并启用自动回滚')))
    }

    function ManagerPanel() {
      const [view, setView] = useState('market')
      const [query, setQuery] = useState('')
      const [category, setCategory] = useState('')
      const [state, setState] = useState({ status: 'loading' })
      const [confirmation, setConfirmation] = useState('')
      const [operation, setOperation] = useState({ status: 'idle' })

      const refresh = useCallback(async (force = false) => {
        setState({ status: 'loading' })
        try {
          const [inventory, market, health] = await Promise.all([
            post(ROUTES.inventory), post(ROUTES.market, { refresh: force }), post(ROUTES.health),
          ])
          setState({ status: 'ready', inventory, market, health })
        } catch (error) {
          setState({ status: 'error', message: String(error?.message || error) })
        }
      }, [])
      useEffect(() => { void refresh(false) }, [refresh])

      const entries = useMemo(() => {
        if (state.status !== 'ready') return []
        const needle = query.trim().toLowerCase()
        return state.market.entries
          .filter(entry => entry.listed !== false)
          .filter(entry => !category || entry.categories.includes(category))
          .filter(entry => !needle || [entry.name, entry.packageName, entry.description, entry.repositoryUrl, ...entry.categories]
            .some(value => value.toLowerCase().includes(needle)))
          .sort((a, b) => Number(b.featured) - Number(a.featured) || (b.installCount ?? -1) - (a.installCount ?? -1) || a.name.localeCompare(b.name, 'zh-CN'))
      }, [category, query, state])

      const beginPlan = useCallback(async (action, entry) => {
        setConfirmation('')
        setOperation({ status: 'planning' })
        try {
          const value = await post(ROUTES.plan, { action, pluginId: entry.id }, 'plan')
          setOperation({ status: 'plan', value })
        } catch (error) {
          setOperation({ status: 'error', code: error?.code, message: String(error?.message || error) })
        }
      }, [])

      const execute = useCallback(async () => {
        if (operation.status !== 'plan') return
        const plan = operation.value
        setOperation({ status: 'executing', value: plan })
        try {
          const value = await post(ROUTES.execute, { planId: plan.planId, confirmation }, 'execute')
          setOperation({ status: 'result', value })
          await refresh(false)
        } catch (error) {
          setOperation({ status: 'error', code: error?.code, message: String(error?.message || error) })
        }
      }, [confirmation, operation, refresh])

      const cancel = useCallback(() => { setConfirmation(''); setOperation({ status: 'idle' }) }, [])
      const heading = React.createElement('div', { style: styles.toolbar },
        React.createElement('div', null,
          React.createElement('h3', { style: styles.title }, 'DSH第三方插件商城'),
          React.createElement('p', { style: styles.subtitle }, 'GitHub-only 目录 · 计划确认 · Profile 备份 · 健康检查 · 失败回滚')),
        React.createElement(Button, { onClick: () => refresh(true) }, '刷新 GitHub 目录'))

      const nav = React.createElement('div', { style: styles.nav },
        [['market', '插件市场'], ['installed', '已安装'], ['health', '健康检查']].map(([id, label]) =>
          React.createElement(Button, { key: id, active: view === id, onClick: () => setView(id) }, label)))

      let content
      if (state.status === 'loading') content = React.createElement('p', { style: styles.muted }, '正在读取 Profile 与 GitHub 目录…')
      else if (state.status === 'error') content = React.createElement('p', { style: styles.error }, state.message)
      else if (view === 'health') content = React.createElement(HealthPanel, { health: state.health })
      else if (view === 'installed') {
        content = React.createElement('div', { style: styles.grid }, state.inventory.plugins.map(plugin => {
          const market = state.market.entries.find(entry => entry.packageName === plugin.packageName)
          return React.createElement('article', { key: plugin.packageName, style: styles.card },
            React.createElement('div', { style: styles.row }, React.createElement('div', { style: styles.name }, plugin.packageName), React.createElement('span', { style: styles.badge }, plugin.official ? '官方 · 只读' : plugin.source)),
            React.createElement('div', { style: styles.muted }, `${plugin.version || '版本未知'} · ${plugin.declaredAsBundle ? 'Bundle' : '依赖'}`),
            market ? React.createElement(React.Fragment, null,
              React.createElement('div', { style: styles.muted }, market.installOrigin === 'marketplace-managed' ? '通过本商城安装' : market.installOrigin === 'local-development' ? '本地开发安装' : '外部安装或渠道未知'),
              React.createElement(PluginActions, { entry: market, health: state.health, beginPlan }))
              : React.createElement('div', { style: styles.badge }, '外部插件 · 未进入集中目录'))
        }))
      } else {
        const categoryIds = [...new Set(state.market.entries.filter(entry => entry.listed !== false).flatMap(entry => entry.categories))].sort()
        content = React.createElement(React.Fragment, null,
          React.createElement('div', { style: styles.toolbar },
            React.createElement('input', { type: 'search', value: query, onChange: event => setQuery(event.target.value), style: { ...styles.input, flex: '1 1 360px' }, placeholder: '搜索名称、包名、分类或 GitHub 仓库' }),
            React.createElement('select', { value: category, onChange: event => setCategory(event.target.value), style: styles.select, 'aria-label': '按分类筛选' },
              React.createElement('option', { value: '' }, '全部分类'),
              categoryIds.map(id => React.createElement('option', { key: id, value: id }, state.market.registry.categories?.[id] || id)))),
          React.createElement('div', { style: styles.notice },
            `${state.market.source.kind === 'github' ? 'GitHub 在线目录' : '内置目录回退'} · ${entries.length} / ${state.market.entries.filter(entry => entry.listed !== false).length} 个在架条目`,
            state.market.source.errorCode ? ` · ${state.market.source.errorCode}` : ''),
          React.createElement('div', { style: styles.grid }, entries.map(entry => React.createElement(MarketCard, { key: entry.id, entry, health: state.health, beginPlan, categoryLabels: state.market.registry.categories }))))
      }

      return React.createElement('section', { style: styles.root },
        heading, nav, content,
        React.createElement(PlanPanel, { operation, confirmation, setConfirmation, execute, cancel }))
    }

    const name = 'dsh-safe-plugin-manager'
    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab', id: 'safe-plugin-manager', order: 90,
        label: () => '插件商城', inject: () => ({}),
      }, ManagerPanel))
    }

    module.exports = { name, inject, apply }
    return module.exports
  },
})
