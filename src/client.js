window.__ModuleLoader__.load({
  id: 'dsh-safe-plugin-manager',
  factory: (require) => {
    const React = require('react')
    const { useCallback, useEffect, useState } = React
    const ROUTE = '/api2/dsh-safe-plugin-manager/inventory'

    async function loadInventory() {
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const payload = await response.json()
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error?.message || `HTTP ${response.status}`)
      }
      return payload.value
    }

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '760px' },
      toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
      title: { margin: 0, fontSize: '15px', lineHeight: '22px', fontWeight: 600 },
      muted: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px' },
      button: {
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '7px 12px',
        background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
      },
      card: {
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '8px 16px',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '12px 14px',
        background: 'var(--dsw-alias-bg-layer-3)',
      },
      name: { minWidth: 0, overflowWrap: 'anywhere', fontSize: '13px', fontWeight: 600 },
      badge: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px' },
    }

    function InventoryPanel({ load = loadInventory }) {
      const [state, setState] = useState({ status: 'loading' })
      const refresh = useCallback(async () => {
        setState({ status: 'loading' })
        try {
          setState({ status: 'ready', value: await load() })
        } catch (error) {
          setState({ status: 'error', message: String(error?.message || error) })
        }
      }, [load])
      useEffect(() => { void refresh() }, [refresh])

      const children = [
        React.createElement('div', { key: 'toolbar', style: styles.toolbar },
          React.createElement('div', null,
            React.createElement('h3', { style: styles.title }, '安全插件管理'),
            React.createElement('div', { style: styles.muted }, '只读预览：当前版本不提供安装、删除、启停或更新')),
          React.createElement('button', { type: 'button', style: styles.button, onClick: refresh }, '刷新')),
      ]

      if (state.status === 'loading') {
        children.push(React.createElement('p', { key: 'loading', style: styles.muted }, '正在读取插件清单…'))
      } else if (state.status === 'error') {
        children.push(React.createElement('p', { key: 'error', style: styles.error }, state.message))
      } else {
        children.push(React.createElement('p', { key: 'summary', style: styles.muted },
          `Profile: ${state.value.profile} · ${state.value.plugins.length} 个条目 · 运行态尚未核验`))
        for (const plugin of state.value.plugins) {
          children.push(React.createElement('div', { key: plugin.packageName, style: styles.card },
            React.createElement('div', { style: styles.name }, plugin.packageName),
            React.createElement('div', { style: styles.badge }, plugin.official ? '官方 · 只读' : '第三方'),
            React.createElement('div', { style: styles.muted }, plugin.description || '无描述'),
            React.createElement('div', { style: styles.muted }, plugin.version || '版本未知')))
        }
      }
      return React.createElement('section', { style: styles.root }, children)
    }

    const name = 'dsh-safe-plugin-manager'
    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'safe-plugin-manager',
        order: 90,
        label: () => '安全管理',
        inject: () => ({ load: loadInventory }),
      }, InventoryPanel))
    }

    module.exports = { name, inject, apply }
    return module.exports
  },
})

