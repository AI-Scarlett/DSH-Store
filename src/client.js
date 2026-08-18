window.__ModuleLoader__.load({
  id: 'dsh-safe-plugin-manager',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { Modal } = require('@deepseek-ai/dsh-client-ui-primitives')
    const { useCallback, useEffect, useMemo, useState } = React
    const ROUTES = {
      inventory: '/api2/dsh-safe-plugin-manager/inventory',
      market: '/api2/dsh-safe-plugin-manager/market',
      health: '/api2/dsh-safe-plugin-manager/health',
      runtime: '/api2/dsh-safe-plugin-manager/runtime',
      plan: '/api2/dsh-safe-plugin-manager/plan',
      execute: '/api2/dsh-safe-plugin-manager/execute',
      restartPlan: '/api2/dsh-safe-plugin-manager/restart/plan',
      restartExecute: '/api2/dsh-safe-plugin-manager/restart/execute',
      guardian: '/api2/dsh-safe-plugin-manager/guardian',
      guardianPlan: '/api2/dsh-safe-plugin-manager/guardian/plan',
      guardianExecute: '/api2/dsh-safe-plugin-manager/guardian/execute',
    }
    const SUPPORT_URL = 'https://dsh.store/'
    const RESTART_STORAGE_KEY = 'dsh-safe-plugin-manager:pending-restart:v1'

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

    function readPendingRestart() {
      try {
        const value = JSON.parse(window.localStorage.getItem(RESTART_STORAGE_KEY) || 'null')
        return value && value.schemaVersion === 1 ? value : null
      } catch { return null }
    }

    function storePendingRestart(result) {
      const value = {
        schemaVersion: 1, transactionId: result.transactionId, action: result.action,
        profile: result.profile, packageName: result.packageName, targetVersion: result.targetVersion,
        runtimeInstanceId: result.runtimeInstanceId, createdAt: new Date().toISOString(),
      }
      try { window.localStorage.setItem(RESTART_STORAGE_KEY, JSON.stringify(value)) } catch {}
      return value
    }

    function clearPendingRestart() {
      try { window.localStorage.removeItem(RESTART_STORAGE_KEY) } catch {}
    }

    function restartOutcome(pending, state) {
      if (!pending || state.status !== 'ready') return null
      if (!state.runtime || state.runtime.bootId === pending.runtimeInstanceId) return { status: 'pending' }
      const plugin = state.inventory.plugins.find(item => item.packageName === pending.packageName)
      const activated = pending.action === 'uninstall'
        ? !plugin
        : Boolean(plugin?.installed && (!pending.targetVersion || plugin.version === pending.targetVersion))
      const pluginHealth = state.health.plugins?.find(item => item.packageName === pending.packageName)
      if (activated && pluginHealth?.status !== 'unhealthy') return { status: 'verified', plugin, pluginHealth }
      return { status: 'failed', plugin, pluginHealth }
    }

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '920px' },
      toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' },
      nav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', width: '100%' },
      navTabs: {
        display: 'inline-flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', padding: '3px',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-2)',
      },
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
      compactButton: { borderRadius: '7px', padding: '4px 8px', fontSize: '11px', lineHeight: '18px' },
      tabButton: {
        border: '1px solid transparent', borderRadius: '9px', padding: '7px 13px', background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: '12px', lineHeight: '20px', fontWeight: 500,
        transition: 'background-color 120ms ease, color 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
      },
      activeTabButton: {
        background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-foreground)',
        borderColor: 'var(--dsw-alias-button-primary-fill)', fontWeight: 650, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.24)',
      },
      dangerButton: { borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
      primaryButton: { borderColor: 'var(--dsw-alias-label-primary)', fontWeight: 600 },
      disabledButton: { opacity: 0.45, cursor: 'not-allowed' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '12px' },
      card: {
        display: 'flex', flexDirection: 'column', gap: '10px', border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '12px', padding: '14px', background: 'var(--dsw-alias-bg-layer-3)', minWidth: 0,
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)',
      },
      cardHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' },
      cardHeading: { display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 },
      featuredMark: { color: 'var(--dsw-alias-label-primary)', fontSize: '12px', lineHeight: '18px' },
      cardDescription: {
        color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px', minHeight: '36px',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      },
      cardTags: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px' },
      cardFooter: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginTop: 'auto' },
      detailAction: { display: 'flex', marginLeft: 'auto' },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' },
      name: { minWidth: 0, overflowWrap: 'anywhere', fontSize: '13px', fontWeight: 650 },
      muted: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px' },
      badge: { display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '3px 7px', background: 'var(--dsw-alias-bg-layer-2)', fontSize: '11px' },
      statusPill: { display: 'inline-flex', alignItems: 'center', gap: '5px', flexShrink: 0, borderRadius: '999px', padding: '3px 7px', background: 'var(--dsw-alias-bg-layer-2)', fontSize: '11px' },
      stateDot: { width: '7px', height: '7px', borderRadius: '50%', flex: '0 0 7px' },
      actions: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '2px' },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px' },
      notice: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '11px 13px', fontSize: '12px', lineHeight: '18px' },
      plan: { border: '1px solid var(--dsw-alias-label-secondary)', borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' },
      code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere', fontSize: '12px' },
      link: { color: 'var(--dsw-alias-label-primary)', fontSize: '12px' },
      detailSection: { display: 'flex', flexDirection: 'column', gap: '8px' },
      detailHeading: { margin: '4px 0 0', fontSize: '13px', lineHeight: '20px', fontWeight: 650 },
      detailGrid: { display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', gap: '7px 12px', margin: 0 },
      detailLabel: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px' },
      detailValue: { margin: 0, color: 'var(--dsw-alias-label-primary)', fontSize: '12px', lineHeight: '18px', overflowWrap: 'anywhere' },
      detailBadges: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      detailFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', width: '100%' },
      detailFooterLinks: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginLeft: 'auto' },
    }

    const DETAIL_MODAL_CSS = `
      .dsh-safe-plugin-detail-modal { width: min(680px, 100%) !important; max-height: min(760px, calc(100vh - 48px)); }
      .dsh-safe-plugin-detail-content { min-height: 0; overflow-y: auto; }
    `

    const DETAIL_LABELS = {
      pluginType: { feature: '功能插件', theme: '主题', suite: '套件', client: '客户端', provider: 'Provider', unknown: '未知' },
      installSource: { npm: 'npm', github: 'GitHub', 'local-bundle': '本地 Bundle', unknown: '未知' },
      level: { low: '低', medium: '中', high: '高', unknown: '未知' },
      files: { none: '不访问', 'read-only': '只读', write: '可写', unknown: '未知' },
      network: { none: '无', 'specified-services': '指定服务', any: '任意网络', unknown: '未知' },
      commands: { none: '否', restricted: '受限', shell: '任意 Shell', unknown: '未知' },
      credentials: { none: '否', 'api-key': 'API Key', oauth: 'OAuth', keychain: '系统 Keychain', unknown: '未知' },
      reviewStatus: { unreviewed: '未审核', 'automated-scan': '自动扫描', 'manual-review': '人工检查', 'author-verified': '作者认证' },
    }

    function detailLabel(group, value) {
      return DETAIL_LABELS[group]?.[value] || String(value || '未知')
    }

    function licenseLabel(value) {
      if (!value || value === 'UNKNOWN') return '未知'
      if (value === 'UNLICENSED') return '未公开许可证'
      if (value === 'CC-BY-NC-SA-4.0') return '非商业（CC BY-NC-SA 4.0）'
      return value
    }

    function githubPublisher(repositoryUrl) {
      try {
        const url = new URL(repositoryUrl)
        const owner = url.hostname.toLowerCase() === 'github.com' ? decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] || '') : ''
        return owner ? `@${owner}` : '未知'
      } catch { return '未知' }
    }

    function detailSearchValues(entry) {
      const permissions = entry.details.permissions
      return [
        entry.name, entry.packageName, entry.description, entry.repositoryUrl, githubPublisher(entry.repositoryUrl), entry.details.license,
        detailLabel('pluginType', entry.details.pluginType), detailLabel('installSource', entry.details.installSource),
        detailLabel('level', permissions.level), detailLabel('files', permissions.files),
        detailLabel('network', permissions.network), detailLabel('commands', permissions.commands),
        ...permissions.credentials.map(value => detailLabel('credentials', value)),
        detailLabel('reviewStatus', entry.details.reviewStatus), ...entry.details.externalDependencies,
        ...entry.compatibility.systems, ...entry.compatibility.profiles, ...entry.categories,
      ]
    }

    function normalizeMarketEntry(entry) {
      const declaredDetails = entry?.details && typeof entry.details === 'object' ? entry.details : {}
      const declaredPermissions = declaredDetails.permissions && typeof declaredDetails.permissions === 'object'
        ? declaredDetails.permissions
        : {}
      const compatibility = entry?.compatibility && typeof entry.compatibility === 'object' ? entry.compatibility : {}
      const risk = entry?.risk && typeof entry.risk === 'object' ? entry.risk : {}
      return {
        ...entry,
        catalogDetailsAvailable: Boolean(entry?.details && entry.details.permissions),
        categories: Array.isArray(entry?.categories) ? entry.categories : [],
        entryIds: Array.isArray(entry?.entryIds) ? entry.entryIds : [],
        compatibility: {
          ...compatibility,
          dsh: typeof compatibility.dsh === 'string' ? compatibility.dsh : null,
          node: typeof compatibility.node === 'string' ? compatibility.node : null,
          systems: Array.isArray(compatibility.systems) ? compatibility.systems : [],
          profiles: Array.isArray(compatibility.profiles) ? compatibility.profiles : [],
        },
        details: {
          pluginType: declaredDetails.pluginType || 'unknown',
          installSource: declaredDetails.installSource || 'unknown',
          license: declaredDetails.license || 'UNKNOWN',
          permissions: {
            level: declaredPermissions.level || 'unknown',
            files: declaredPermissions.files || 'unknown',
            network: declaredPermissions.network || 'unknown',
            commands: declaredPermissions.commands || 'unknown',
            credentials: Array.isArray(declaredPermissions.credentials) && declaredPermissions.credentials.length > 0
              ? declaredPermissions.credentials
              : ['unknown'],
          },
          externalDependencies: Array.isArray(declaredDetails.externalDependencies) ? declaredDetails.externalDependencies : [],
          reviewStatus: declaredDetails.reviewStatus || 'unreviewed',
        },
        risk: { ...risk, installScripts: Array.isArray(risk.installScripts) ? risk.installScripts : [] },
      }
    }

    function currentInstallSource(entry) {
      if (entry.installedSource === 'npm') return 'npm（当前 Profile）'
      if (entry.installedSource === 'git') return 'GitHub（当前 Profile）'
      if (['link', 'file', 'workspace'].includes(entry.installedSource)) return '本地 Bundle（当前 Profile）'
      return `${detailLabel('installSource', entry.details.installSource)}（目录声明）`
    }

    function Button({ children, danger = false, primary = false, compact = false, disabled = false, onClick, ariaLabel, title }) {
      return React.createElement('button', {
        type: 'button', disabled, onClick, title, 'aria-label': ariaLabel,
        style: { ...styles.button, ...(compact ? styles.compactButton : {}), ...(danger ? styles.dangerButton : {}), ...(primary ? styles.primaryButton : {}), ...(disabled ? styles.disabledButton : {}) },
      }, children)
    }

    function StatusPill({ label, tone = 'var(--dsw-alias-label-tertiary)' }) {
      return React.createElement('span', { style: styles.statusPill },
        React.createElement('span', { 'aria-hidden': true, style: { ...styles.stateDot, background: tone } }),
        label)
    }

    function TabButton({ children, active, onClick }) {
      return React.createElement('button', {
        type: 'button', role: 'tab', 'aria-selected': active, onClick,
        style: { ...styles.tabButton, ...(active ? styles.activeTabButton : {}) },
      }, children)
    }

    function CatalogFilters({ query, category, categoryIds, categoryLabels, onQueryChange, onCategoryChange }) {
      return React.createElement('div', { style: styles.toolbar },
        React.createElement('input', {
          type: 'search', value: query, onChange: event => onQueryChange(event.target.value),
          style: { ...styles.input, flex: '1 1 360px' }, placeholder: '搜索名称、包名、分类、权限或 GitHub 仓库',
        }),
        React.createElement('select', {
          value: category, onChange: event => onCategoryChange(event.target.value),
          style: styles.select, 'aria-label': '按分类筛选',
        },
        React.createElement('option', { value: '' }, '全部分类'),
        categoryIds.map(id => React.createElement('option', { key: id, value: id }, categoryLabels[id] || id))))
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

    function MarketCard({ entry, health, beginPlan, openDetails, categoryLabels = {} }) {
      const state = entry.status === 'blocked' ? '商城不可安装'
        : entry.migrationAvailable ? (entry.updateAvailable ? '可迁移并更新' : '可迁移到商城')
          : entry.installed ? (entry.updateAvailable ? '有更新' : `已安装 ${entry.installedVersion || ''}`) : '可安装'
      const origin = entry.installOrigin === 'marketplace-managed' ? '商城安装'
        : entry.installOrigin === 'catalog-source-matched' ? '目录来源匹配 · 渠道未知'
          : entry.installOrigin === 'local-development' ? '本地开发安装'
            : entry.installOrigin === 'external-or-drifted' ? '外部安装 / 来源漂移' : null
      const stateTone = entry.status === 'blocked' ? 'var(--dsw-alias-state-error-primary)'
        : entry.updateAvailable || entry.migrationAvailable ? 'var(--dsw-alias-label-primary)'
          : entry.installed ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)'
      const titleId = `dsh-store-plugin-${entry.id}`
      return React.createElement('article', { style: styles.card, role: 'listitem', 'aria-labelledby': titleId },
        React.createElement('div', { style: styles.cardHeader },
          React.createElement('div', { style: styles.cardHeading },
            entry.featured ? React.createElement('span', { style: styles.featuredMark, title: '推荐插件', 'aria-label': '推荐插件' }, '★') : null,
            React.createElement('div', { id: titleId, style: styles.name }, entry.name)),
          React.createElement(StatusPill, { label: state, tone: stateTone })),
        React.createElement('div', { style: styles.code }, `${entry.packageName} · ${entry.version}`),
        React.createElement('div', { style: styles.cardDescription }, entry.description),
        React.createElement('div', { style: styles.muted }, `Commit ${entry.commit.slice(0, 12)} · ${entry.categories.map(id => categoryLabels[id] || id).join(' / ')}`),
        React.createElement('div', { style: styles.cardTags },
          React.createElement('span', { style: styles.badge }, `GitHub 发布者 ${githubPublisher(entry.repositoryUrl)}`),
          origin ? React.createElement('span', { style: styles.badge }, origin) : null,
          ...entry.categories.map(id => React.createElement('span', { key: id, style: styles.badge }, categoryLabels[id] || id)),
          Number.isInteger(entry.installCount) ? React.createElement('span', { style: styles.badge }, `累计安装 ${entry.installCount}`) : null),
        entry.risk.installScripts.length > 0
          ? React.createElement('div', { style: styles.error }, `安装脚本：${entry.risk.installScripts.join(', ')}`)
          : null,
        React.createElement('div', { style: styles.cardFooter },
          React.createElement('div', { style: styles.actions },
            React.createElement(PluginActions, { entry, health, beginPlan }),
            entry.status === 'blocked'
              ? React.createElement('a', { href: entry.repositoryUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, '前往 GitHub 手动安装')
              : null),
          React.createElement('div', { style: styles.detailAction },
            React.createElement(Button, { compact: true, onClick: () => openDetails(entry), ariaLabel: `查看 ${entry.name} 详情` }, '查看详情'))))
    }

    function InventoryOnlyCard({ plugin }) {
      const source = plugin.official ? '官方 · 只读' : `${plugin.source || 'unknown'} · 目录外只读`
      const titleId = `dsh-store-inventory-${String(plugin.packageName).replaceAll(/[^A-Za-z0-9_-]/g, '-')}`
      return React.createElement('article', { style: styles.card, role: 'listitem', 'aria-labelledby': titleId },
        React.createElement('div', { style: styles.cardHeader },
          React.createElement('div', { id: titleId, style: styles.name }, plugin.packageName),
          React.createElement(StatusPill, { label: source })),
        React.createElement('div', { style: styles.code }, `${plugin.version || '版本未知'} · ${plugin.declaredAsBundle ? 'Bundle' : '依赖'}`),
        React.createElement('div', { style: styles.cardDescription }, plugin.description || '本地 manifest 未提供插件介绍'),
        React.createElement('div', { style: styles.notice }, '该插件未进入 GitHub catalog.json，无法提供目录详情或商城受保护操作。'),
        plugin.repository
          ? React.createElement('div', { style: styles.cardFooter },
            React.createElement('a', { href: plugin.repository, target: '_blank', rel: 'noreferrer', style: styles.link }, '查看 GitHub 仓库'))
          : null)
    }

    function DetailRow({ label, value, code = false }) {
      return React.createElement(React.Fragment, null,
        React.createElement('dt', { style: styles.detailLabel }, label),
        React.createElement('dd', { style: { ...styles.detailValue, ...(code ? styles.code : {}) } }, value))
    }

    function PluginDetailsModal({ entry, categoryLabels, health, beginPlan, close }) {
      if (!entry) return null
      const permissions = entry.details.permissions
      const status = entry.status === 'approved' ? '可安装' : entry.status === 'blocked' ? '商城不可安装' : '已下架'
      const installed = entry.installed ? `已安装 ${entry.installedVersion || '版本未知'}` : '未安装'
      const beginDetailPlan = (action, selectedEntry) => {
        close()
        beginPlan(action, selectedEntry)
      }
      const footer = React.createElement('div', { style: styles.detailFooter },
        React.createElement(PluginActions, { entry, health, beginPlan: beginDetailPlan }),
        React.createElement('div', { style: styles.detailFooterLinks },
          React.createElement('a', { href: entry.repositoryUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, entry.status === 'blocked' ? '前往 GitHub 手动安装' : '查看 GitHub 仓库'),
          React.createElement(Button, { onClick: close }, '关闭')))
      return React.createElement(Modal, {
        open: true, onClose: close, title: entry.name, closeLabel: '关闭插件详情',
        description: entry.description, footer,
        className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
      },
      React.createElement('div', { style: styles.detailSection },
        React.createElement('div', { style: styles.detailBadges },
          entry.featured ? React.createElement('span', { style: styles.badge }, '推荐') : null,
          React.createElement('span', { style: styles.badge }, status),
          React.createElement('span', { style: styles.badge }, installed),
          ...(entry.categories || []).map(id => React.createElement('span', { key: id, style: styles.badge }, categoryLabels[id] || id))),
        React.createElement('h3', { style: styles.detailHeading }, '基本信息'),
        React.createElement('dl', { style: styles.detailGrid },
          React.createElement(DetailRow, { label: '包名', value: entry.packageName, code: true }),
          React.createElement(DetailRow, { label: '版本', value: entry.version }),
          React.createElement(DetailRow, { label: 'GitHub 发布者', value: githubPublisher(entry.repositoryUrl) }),
          React.createElement(DetailRow, { label: 'Git Commit', value: entry.commit, code: true }),
          React.createElement(DetailRow, { label: '分类', value: entry.categories.map(id => categoryLabels[id] || id).join(' / ') }),
          React.createElement(DetailRow, { label: '上架状态', value: status }),
          React.createElement(DetailRow, { label: '安装状态', value: installed }),
          Number.isInteger(entry.installCount) ? React.createElement(DetailRow, { label: '累计安装', value: String(entry.installCount) }) : null),
        React.createElement('h3', { style: styles.detailHeading }, '权限与审核'),
        React.createElement('dl', { style: styles.detailGrid },
          React.createElement(DetailRow, { label: '插件类型', value: detailLabel('pluginType', entry.details.pluginType) }),
          React.createElement(DetailRow, { label: '安装来源', value: currentInstallSource(entry) }),
          React.createElement(DetailRow, { label: '许可证', value: licenseLabel(entry.details.license) }),
          React.createElement(DetailRow, { label: '权限等级', value: detailLabel('level', permissions.level) }),
          React.createElement(DetailRow, { label: '文件权限', value: detailLabel('files', permissions.files) }),
          React.createElement(DetailRow, { label: '网络权限', value: detailLabel('network', permissions.network) }),
          React.createElement(DetailRow, { label: '命令执行', value: detailLabel('commands', permissions.commands) }),
          React.createElement(DetailRow, { label: '凭据访问', value: permissions.credentials.map(value => detailLabel('credentials', value)).join(' / ') }),
          React.createElement(DetailRow, { label: '外部依赖', value: entry.details.externalDependencies.length > 0 ? entry.details.externalDependencies.join(' / ') : '无' }),
          React.createElement(DetailRow, { label: '审核状态', value: detailLabel('reviewStatus', entry.details.reviewStatus) })),
        React.createElement('h3', { style: styles.detailHeading }, '兼容性'),
        React.createElement('dl', { style: styles.detailGrid },
          React.createElement(DetailRow, { label: 'DSH', value: entry.compatibility.dsh || '未声明' }),
          React.createElement(DetailRow, { label: 'Node.js', value: entry.compatibility.node || '未声明' }),
          React.createElement(DetailRow, { label: '系统', value: entry.compatibility.systems.length > 0 ? entry.compatibility.systems.join(' / ') : '未声明' }),
          React.createElement(DetailRow, { label: 'Profile', value: entry.compatibility.profiles.length > 0 ? entry.compatibility.profiles.join(' / ') : '未声明' })),
        !entry.catalogDetailsAvailable
          ? React.createElement('div', { style: styles.notice }, '当前 GitHub catalog.json 尚未提供完整详情字段；缺失值按“未知 / 未声明”显示，未使用本地推测数据替代。')
          : null,
        entry.statusReason ? React.createElement('div', { style: styles.error }, `策略说明：${entry.statusReason}`) : null,
        entry.status === 'blocked'
          ? React.createElement('div', { style: styles.notice }, '可前往 GitHub 阅读项目说明并自行决定是否手动安装；手动安装不受本商城的计划、备份、健康检查和失败回滚保护。')
          : null,
        entry.risk.installScripts.length > 0 ? React.createElement('div', { style: styles.error }, `安装生命周期脚本：${entry.risk.installScripts.join(', ')}`) : null,
        React.createElement('div', { style: styles.notice }, '详情来自 GitHub catalog.json 的固定 Commit 核验与声明；自动扫描或作者认证均不等于完成安全审计。')))
    }

    function HealthPanel({ health, permissionDecisions, setPermissionDecision, rerun }) {
      const [rerunState, setRerunState] = useState({ status: 'idle', message: '' })
      if (!health) return React.createElement('p', { style: styles.muted }, '正在执行健康检查…')
      const statusLabel = value => ({
        healthy: '健康', warning: '有警告', unhealthy: '不健康', 'action-required': '需要选择权限',
        'blocked-by-user': '已被用户拒绝', pass: '通过', error: '错误', unverified: '未验证',
        'action-required': '需要操作', denied: '用户拒绝',
      }[value] || value)
      const permissionName = field => ({ files: '文件访问', network: '网络访问', commands: '命令执行', credentials: '凭据访问', acceptUnknown: '未知权限' }[field] || field)
      const permissionFields = plugin => {
        const requested = plugin.permissions?.requested
        if (!requested) return plugin.official ? [] : ['acceptUnknown']
        return ['files', 'network', 'commands', 'credentials'].filter(field => field === 'credentials'
          ? requested.credentials?.some(value => value !== 'none') : requested[field] !== 'none')
      }
      const healthPlugins = Array.isArray(health.plugins) ? health.plugins : []
      const unresolved = healthPlugins.flatMap((plugin, pluginIndex) => permissionFields(plugin)
        .filter(field => typeof permissionDecisions[plugin.packageName]?.[field] !== 'boolean')
        .map(field => ({ plugin, pluginIndex, field })))
      const unresolvedPlugins = new Set(unresolved.map(item => item.plugin.packageName)).size
      const goToPermissions = () => document.getElementById('dsh-health-permissions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const runHealthCheck = async () => {
        if (unresolved.length > 0 || rerunState.status === 'checking') return
        setRerunState({ status: 'checking', message: '正在按当前权限选择重新检查…' })
        try {
          await rerun()
          setRerunState({ status: 'complete', message: `健康检查已完成 · ${new Date().toLocaleTimeString()}` })
        } catch (error) {
          setRerunState({ status: 'error', message: `健康检查失败：${String(error?.message || error)}` })
        }
      }
      const selector = (plugin, field, value) => React.createElement('label', { key: field, style: styles.muted },
        `${permissionName(field)}：`,
        React.createElement('select', {
          value: value === true ? 'allow' : value === false ? 'deny' : 'pending',
          onChange: event => setPermissionDecision(plugin.packageName, field, event.target.value),
          style: { ...styles.select, minWidth: '132px', marginLeft: '6px', padding: '5px 8px' },
        },
        React.createElement('option', { value: 'pending' }, '待选择'),
        React.createElement('option', { value: 'allow' }, '允许'),
        React.createElement('option', { value: 'deny' }, '拒绝')))
      if (health.schemaVersion !== 2 || !health.summary || !Array.isArray(health.plugins)) {
        return React.createElement(React.Fragment, null,
          React.createElement('div', { style: styles.error },
            `健康接口仍是旧版 schema v${health.schemaVersion || '未知'}。当前页面不能判断每个插件是否健康，请更新并重启 DSH Host。`),
          React.createElement('div', { style: styles.notice },
            '下面只能展示旧版 Profile 基础检查；这些结果不等于逐插件健康。请先更新插件商城，再通过 Guardian 执行一次安全重启。不要另开终端运行 pnpm dsh web 或 dsh web。'),
          React.createElement(Button, { primary: true, disabled: true }, '恢复 Guardian 后才能逐插件检查'),
          React.createElement('div', { style: styles.grid }, (health.checks || []).map(item => React.createElement('article', { key: item.id, style: styles.card },
            React.createElement('div', { style: styles.row }, React.createElement('div', { style: styles.name }, item.id), React.createElement('span', { style: styles.badge }, statusLabel(item.status))),
            React.createElement('div', { style: styles.muted }, item.message)))))
      }
      return React.createElement(React.Fragment, null,
        React.createElement('div', { style: styles.notice },
          React.createElement('div', { style: styles.name }, `总体状态：${statusLabel(health.status)} · Profile: ${health.profile}`),
          React.createElement('div', { style: styles.muted }, health.verdict),
          React.createElement('div', { style: styles.muted },
            `共 ${health.summary?.total || 0} 项 · 待选择 ${health.summary?.actionRequired || 0} · 用户拒绝 ${health.summary?.blockedByUser || 0} · 不健康 ${health.summary?.unhealthy || 0} · 目录外 ${health.summary?.uncatalogued || 0}`),
          React.createElement('div', { style: styles.error }, '权限选择仅用于健康审核结论，不会修改或限制插件的真实运行权限。')),
        unresolved.length > 0 ? React.createElement('div', { style: styles.notice },
          React.createElement('div', { style: styles.name }, `还需完成 ${unresolvedPlugins} 个插件、${unresolved.length} 项权限选择`),
          React.createElement('div', { style: styles.muted }, '商城不会自动替你允许或拒绝权限。请先逐项选择，再运行健康检查。'),
          React.createElement(Button, { primary: true, onClick: goToPermissions }, `前往选择 ${unresolvedPlugins} 个插件的权限`)) : null,
        React.createElement('h4', { style: styles.title }, 'Profile 基础检查'),
        React.createElement('div', { style: styles.grid }, health.checks.map(item => React.createElement('article', { key: item.id, style: styles.card },
          React.createElement('div', { style: styles.row }, React.createElement('div', { style: styles.name }, item.id), React.createElement('span', { style: styles.badge }, statusLabel(item.status))),
          React.createElement('div', { style: styles.muted }, item.message)))),
        React.createElement('h4', { style: styles.title }, '逐插件健康报告'),
        React.createElement('div', { id: 'dsh-health-permissions', style: styles.grid }, (health.plugins || []).map(plugin => {
          const decisions = permissionDecisions[plugin.packageName] || {}
          const requested = plugin.permissions?.requested
          const fields = permissionFields(plugin)
          const pluginPending = fields.filter(field => typeof decisions[field] !== 'boolean')
          return React.createElement('article', { key: plugin.packageName, style: styles.card },
            React.createElement('div', { style: styles.row },
              React.createElement('div', { style: styles.name }, plugin.catalogName || plugin.packageName),
              React.createElement('span', { style: styles.badge }, statusLabel(plugin.status))),
            React.createElement('div', { style: styles.code }, `${plugin.packageName} · ${plugin.version || '版本未知'} · ${plugin.source}`),
            requested ? React.createElement('div', { style: styles.muted },
              `声明权限：文件 ${detailLabel('files', requested.files)}；网络 ${detailLabel('network', requested.network)}；命令 ${detailLabel('commands', requested.commands)}；凭据 ${(requested.credentials || []).map(value => detailLabel('credentials', value)).join(' / ')}`)
              : React.createElement('div', { style: styles.error }, plugin.official ? '官方组件：不由商城授权' : '目录外插件：权限声明未知'),
            pluginPending.length > 0 ? React.createElement('div', { style: styles.error },
              `还需选择：${pluginPending.map(permissionName).join('、')}`) : null,
            fields.length > 0 ? React.createElement('div', { style: styles.detailSection }, fields.map(field => selector(
              plugin, field, decisions[field],
            ))) : null,
            React.createElement('div', { style: styles.detailSection }, plugin.checks.map(item => React.createElement('div', { key: item.id, style: styles.muted },
              `${statusLabel(item.status)} · ${item.id}：${item.message}`)))
          )
        })),
        React.createElement('div', { style: styles.notice },
          React.createElement('div', { style: styles.name }, unresolved.length > 0
            ? `完成剩余 ${unresolved.length} 项权限选择后才能重新检查`
            : '权限选择已完成，可以重新检查'),
          React.createElement('div', { style: styles.actions },
            React.createElement(Button, {
              primary: true, disabled: unresolved.length > 0 || rerunState.status === 'checking', onClick: runHealthCheck,
            }, rerunState.status === 'checking' ? '正在检查…' : '按当前权限选择重新检查')),
          rerunState.message ? React.createElement('div', {
            style: rerunState.status === 'error' ? styles.error : styles.muted,
          }, rerunState.message) : null))
    }

    function PlanPanel({ operation, confirmation, setConfirmation, execute, retryPlan, cancel, beginRestart }) {
      if (!operation || operation.status === 'idle') return null
      if (operation.status === 'planning' || operation.status === 'executing') {
        const planning = operation.status === 'planning'
        return React.createElement(Modal, {
          open: true, onClose: planning ? cancel : () => {},
          title: planning ? '正在生成操作计划' : '正在执行已确认操作',
          closeLabel: planning ? '取消生成操作计划' : '操作执行中',
          description: planning ? '正在进行只读检查，不会修改 Profile。' : '正在执行事务、健康检查与失败自动回滚，请勿关闭 DSH。',
          footer: planning ? React.createElement(Button, { onClick: cancel }, '取消') : null,
          className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
        }, React.createElement('div', { style: styles.notice }, planning ? '正在生成只读操作计划…' : '正在执行事务与健康检查…'))
      }
      if (operation.status === 'error') {
        const footer = React.createElement(React.Fragment, null,
          React.createElement(Button, { onClick: cancel }, '关闭'),
          operation.retry ? React.createElement(Button, { primary: true, onClick: retryPlan }, '重新校验') : null)
        return React.createElement(Modal, {
          open: true, onClose: cancel, title: operation.retry ? '操作计划生成失败' : '操作执行失败', closeLabel: '关闭错误信息',
          footer,
          className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
        }, React.createElement('div', { style: styles.error }, `${operation.code || 'ERROR'}：${operation.message}`))
      }
      if (operation.status === 'result') {
        const result = operation.value
        const footer = React.createElement(React.Fragment, null,
          React.createElement(Button, { onClick: cancel }, '完成'),
          result.status === 'applied' && result.restartRequired
            ? React.createElement(Button, { primary: true, onClick: beginRestart }, '一键安全重启 DSH Host') : null)
        return React.createElement(Modal, {
          open: true, onClose: cancel, title: result.status === 'applied' ? '操作已应用' : '操作失败并已触发回滚',
          closeLabel: '关闭操作结果', footer,
          className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
        }, React.createElement('div', { style: styles.detailSection },
          React.createElement('div', { style: styles.muted }, `事务 ${result.transactionId} · 回滚 ${result.rollback || '不需要'}`),
          result.rollbackDetails ? React.createElement('div', { style: styles.muted },
            `Profile 文件恢复：${result.rollbackDetails.profileFiles} · 依赖恢复：${result.rollbackDetails.dependencies}`) : null,
          result.error ? React.createElement('div', { style: styles.error }, `${result.error.code}：${result.error.message}`) : null,
          result.status === 'applied' && result.restartRequired ? React.createElement('div', { style: styles.notice },
            React.createElement('div', { style: styles.name }, '插件变更已写入，但尚未在当前 DSH Host 中生效'),
            React.createElement('div', { style: styles.muted }, '请使用“一键安全重启”；Guardian 会停止并启动同一个 web Profile。不要再手工启动第二个 DSH 实例。')) : null))
      }
      const plan = operation.value
      const matches = confirmation === plan.confirmation
      const footer = React.createElement(React.Fragment, null,
        React.createElement(Button, { onClick: cancel }, '取消'),
        React.createElement(Button, { primary: true, danger: true, disabled: !matches, onClick: execute }, '执行并启用自动回滚'))
      return React.createElement(Modal, {
        open: true, onClose: cancel, title: '操作预览与确认', closeLabel: '取消操作计划',
        description: '计划只在当前状态与确认语完全匹配时执行。', footer,
        className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
      }, React.createElement('div', { style: styles.detailSection },
        React.createElement('div', { style: styles.code }, `${plan.action} · ${plan.plugin.packageName} · ${plan.profile}`),
        React.createElement('div', { style: styles.muted }, `GitHub Commit：${plan.plugin.commit}`),
        React.createElement('div', { style: styles.muted }, `可能修改：${plan.impact.mayModify.join('、')}`),
        React.createElement('div', { style: styles.muted }, `永久保护：${plan.impact.neverModify.join('、')}`),
        plan.impact.sourceTransition ? React.createElement('div', { style: styles.notice }, plan.impact.sourceTransition) : null,
        plan.impact.installScripts.length > 0 ? React.createElement('div', { style: styles.error }, `此插件会运行：${plan.impact.installScripts.join('、')}`) : null,
        React.createElement('label', { style: styles.muted }, '输入以下确认语后才能执行：'),
        React.createElement('div', { style: styles.code }, plan.confirmation),
        React.createElement('input', { value: confirmation, onChange: event => setConfirmation(event.target.value), style: styles.input, placeholder: '精确输入确认语' })))
    }

    function RestartModal({ operation, confirmation, setConfirmation, execute, cancel }) {
      if (!operation || operation.status === 'idle') return null
      if (operation.status === 'planning' || operation.status === 'executing') {
        return React.createElement(Modal, {
          open: true, onClose: operation.status === 'planning' ? cancel : () => {},
          title: operation.status === 'planning' ? '正在生成重启计划' : '正在安排安全重启',
          closeLabel: '关闭重启流程', footer: operation.status === 'planning' ? React.createElement(Button, { onClick: cancel }, '取消') : null,
          className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
        }, React.createElement('div', { style: styles.notice }, operation.status === 'planning'
          ? '只读核对当前 Host 和 Profile，不会立即停止进程。'
          : '独立助手已准备接管；页面将等待新 Host 上线。'))
      }
      if (operation.status === 'error') {
        return React.createElement(Modal, {
          open: true, onClose: cancel, title: 'DSH Host 重启失败', closeLabel: '关闭重启错误',
          footer: React.createElement(Button, { onClick: cancel }, '关闭'),
          className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
        }, React.createElement('div', { style: styles.detailSection },
          React.createElement('div', { style: styles.error }, `${operation.code || 'RESTART_FAILED'}：${operation.message}`),
          React.createElement('div', { style: styles.muted }, 'Guardian 未完成重启时请查看守护状态；不要手工再运行 dsh web，以免与唯一启动所有者争抢 3080 端口。')))
      }
      const plan = operation.value
      const matches = confirmation === plan.confirmation
      return React.createElement(Modal, {
        open: true, onClose: cancel, title: '确认重启 DSH Host', closeLabel: '取消重启',
        description: '当前页面会短暂断开；新 Host 上线后将自动重新载入并验证插件。',
        footer: React.createElement(React.Fragment, null,
          React.createElement(Button, { onClick: cancel }, '取消'),
          React.createElement(Button, { primary: true, danger: true, disabled: !matches, onClick: execute }, '确认并重启')),
        className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
      }, React.createElement('div', { style: styles.detailSection },
        React.createElement('div', { style: styles.muted }, `当前 Boot ID：${plan.currentBootId}`),
        React.createElement('div', { style: styles.muted }, '不会修改 Profile；Guardian 是唯一启动所有者，并负责停止旧实例后再启动同一个 Profile。'),
        React.createElement('label', { style: styles.muted }, '输入以下确认语后才能重启：'),
        React.createElement('div', { style: styles.code }, plan.confirmation),
        React.createElement('input', { value: confirmation, onChange: event => setConfirmation(event.target.value), style: styles.input, placeholder: '精确输入确认语' })))
    }

    function GuardianModal({ operation, confirmation, setConfirmation, execute, cancel }) {
      if (!operation || operation.status === 'idle') return null
      if (operation.status === 'planning' || operation.status === 'executing') return React.createElement(Modal, {
        open: true, onClose: operation.status === 'planning' ? cancel : () => {}, title: '安装 DSH Guardian',
        footer: null, className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
      }, React.createElement('div', { style: styles.notice }, operation.status === 'planning' ? '正在核对 launchd 与守护文件预条件…' : '正在原子安装并接管 DSH Host…'))
      if (operation.status === 'error' || operation.status === 'result') return React.createElement(Modal, {
        open: true, onClose: cancel, title: operation.status === 'result' ? 'Guardian 已安装' : 'Guardian 安装失败',
        footer: React.createElement(Button, { onClick: cancel }, '关闭'), className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
      }, React.createElement('div', { style: operation.status === 'result' ? styles.notice : styles.error },
        operation.status === 'result' ? '外部 Guardian 已接管 DSH 启动监督；请等待健康状态变为正常。' : `${operation.code || 'GUARDIAN_FAILED'}：${operation.message}`))
      const plan = operation.value
      return React.createElement(Modal, {
        open: true, onClose: cancel, title: '确认安装商城内置 Guardian',
        description: 'Guardian 独立于 DSH 运行，并将替换当前 local.dsh.web 启动任务。',
        footer: React.createElement(React.Fragment, null,
          React.createElement(Button, { onClick: cancel }, '取消'),
          React.createElement(Button, { primary: true, danger: true, disabled: confirmation !== plan.confirmation, onClick: execute }, '安装并接管')),
        className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
      }, React.createElement('div', { style: styles.detailSection },
        React.createElement('div', { style: styles.muted }, `写入：${plan.impact.writes.join('、')}`),
        React.createElement('div', { style: styles.muted }, `永久保护：${plan.impact.neverModifies.join('、')}`),
        React.createElement('div', { style: styles.code }, plan.confirmation),
        React.createElement('input', { value: confirmation, onChange: event => setConfirmation(event.target.value), style: styles.input, placeholder: '精确输入确认语' })))
    }

    function ManagerPanel() {
      const [view, setView] = useState('market')
      const [query, setQuery] = useState('')
      const [category, setCategory] = useState('')
      const [state, setState] = useState({ status: 'loading' })
      const [confirmation, setConfirmation] = useState('')
      const [operation, setOperation] = useState({ status: 'idle' })
      const [detailEntry, setDetailEntry] = useState(null)
      const [permissionDecisions, setPermissionDecisions] = useState({})
      const [pendingRestart, setPendingRestart] = useState(() => readPendingRestart())
      const [restartConfirmation, setRestartConfirmation] = useState('')
      const [restartOperation, setRestartOperation] = useState({ status: 'idle' })
      const [guardianConfirmation, setGuardianConfirmation] = useState('')
      const [guardianOperation, setGuardianOperation] = useState({ status: 'idle' })

      const refresh = useCallback(async (force = false, decisions = {}) => {
        setState({ status: 'loading' })
        try {
          const [inventory, market, health, runtime, guardian] = await Promise.all([
            post(ROUTES.inventory), post(ROUTES.market, { refresh: force }),
            post(ROUTES.health, { refresh: force, permissionDecisions: decisions }),
            post(ROUTES.runtime),
            post(ROUTES.guardian),
          ])
          setState({ status: 'ready', inventory, market, health, runtime, guardian })
        } catch (error) {
          setState({ status: 'error', message: String(error?.message || error) })
        }
      }, [])
      useEffect(() => { void refresh(false) }, [refresh])

      const setPermissionDecision = useCallback((packageName, field, choice) => {
        setPermissionDecisions(current => {
          const plugin = { ...(current[packageName] || {}) }
          if (choice === 'pending') delete plugin[field]
          else plugin[field] = choice === 'allow'
          return { ...current, [packageName]: plugin }
        })
      }, [])

      const rerunHealth = useCallback(async () => {
        if (state.status !== 'ready') return
        const health = await post(ROUTES.health, { permissionDecisions })
        setState(current => current.status === 'ready' ? { ...current, health } : current)
        return health
      }, [permissionDecisions, state.status])

      const normalizedEntries = useMemo(() => {
        if (state.status !== 'ready') return []
        return state.market.entries
          .map(normalizeMarketEntry)
      }, [state])

      const scopedEntries = useMemo(() => {
        return normalizedEntries.filter(entry => view === 'installed' ? entry.installed : entry.listed !== false)
      }, [normalizedEntries, view])

      const entries = useMemo(() => {
        const needle = query.trim().toLowerCase()
        return scopedEntries
          .filter(entry => !category || entry.categories.includes(category))
          .filter(entry => !needle || detailSearchValues(entry).some(value => value.toLowerCase().includes(needle)))
          .sort((a, b) => Number(b.featured) - Number(a.featured) || (b.installCount ?? -1) - (a.installCount ?? -1) || a.name.localeCompare(b.name, 'zh-CN'))
      }, [category, query, scopedEntries])

      const beginPlan = useCallback(async (action, entry) => {
        setConfirmation('')
        setOperation({ status: 'planning' })
        try {
          const value = await post(ROUTES.plan, { action, pluginId: entry.id }, 'plan')
          setOperation({ status: 'plan', value })
        } catch (error) {
          setOperation({
            status: 'error', code: error?.code, message: String(error?.message || error), retry: { action, entry },
          })
        }
      }, [])

      const retryPlan = useCallback(() => {
        if (operation.status !== 'error' || !operation.retry) return
        void beginPlan(operation.retry.action, operation.retry.entry)
      }, [beginPlan, operation])

      const execute = useCallback(async () => {
        if (operation.status !== 'plan') return
        const plan = operation.value
        setOperation({ status: 'executing', value: plan })
        try {
          const value = await post(ROUTES.execute, { planId: plan.planId, confirmation }, 'execute')
          if (value.status === 'applied' && value.restartRequired) {
            const pending = storePendingRestart(value)
            setPendingRestart(pending)
          }
          setOperation({ status: 'result', value })
          await refresh(false, permissionDecisions)
        } catch (error) {
          setOperation({ status: 'error', code: error?.code, message: String(error?.message || error) })
        }
      }, [confirmation, operation, permissionDecisions, refresh, state])

      const cancel = useCallback(() => { setConfirmation(''); setOperation({ status: 'idle' }) }, [])
      const cancelRestart = useCallback(() => { setRestartConfirmation(''); setRestartOperation({ status: 'idle' }) }, [])
      const cancelGuardian = useCallback(() => { setGuardianConfirmation(''); setGuardianOperation({ status: 'idle' }) }, [])
      const beginGuardianInstall = useCallback(async () => {
        setGuardianConfirmation(''); setGuardianOperation({ status: 'planning' })
        try { setGuardianOperation({ status: 'plan', value: await post(ROUTES.guardianPlan, {}, 'guardian-plan') }) }
        catch (error) { setGuardianOperation({ status: 'error', code: error?.code, message: String(error?.message || error) }) }
      }, [])
      const executeGuardianInstall = useCallback(async () => {
        if (guardianOperation.status !== 'plan') return
        const plan = guardianOperation.value; setGuardianOperation({ status: 'executing', value: plan })
        try {
          const value = await post(ROUTES.guardianExecute, { planId: plan.planId, confirmation: guardianConfirmation }, 'guardian-execute')
          setGuardianOperation({ status: 'result', value })
        } catch (error) { setGuardianOperation({ status: 'error', code: error?.code, message: String(error?.message || error) }) }
      }, [guardianConfirmation, guardianOperation])
      const beginRestart = useCallback(async () => {
        setRestartConfirmation('')
        setRestartOperation({ status: 'planning' })
        try {
          const value = await post(ROUTES.restartPlan, {}, 'restart-plan')
          setOperation({ status: 'idle' })
          setRestartOperation({ status: 'plan', value })
        } catch (error) {
          setRestartOperation({ status: 'error', code: error?.code, message: String(error?.message || error) })
        }
      }, [])
      const executeRestart = useCallback(async () => {
        if (restartOperation.status !== 'plan') return
        const plan = restartOperation.value
        setRestartOperation({ status: 'executing', value: plan })
        try {
          const result = await post(ROUTES.restartExecute, {
            planId: plan.planId, confirmation: restartConfirmation,
          }, 'restart-execute')
          for (let attempt = 0; attempt < 60; attempt += 1) {
            await delay(1000)
            try {
              const runtime = await post(ROUTES.runtime)
              if (runtime.bootId !== result.previousBootId) {
                window.location.reload()
                return
              }
            } catch {}
          }
          setRestartOperation({ status: 'error', code: 'RESTART_TIMEOUT', message: '60 秒内未检测到新的 DSH Host' })
        } catch (error) {
          setRestartOperation({ status: 'error', code: error?.code, message: String(error?.message || error) })
        }
      }, [restartConfirmation, restartOperation])
      const closeDetails = useCallback(() => setDetailEntry(null), [])
      const heading = React.createElement('div', { style: styles.toolbar },
        React.createElement('div', null,
          React.createElement('h3', { style: styles.title }, 'DSH第三方插件商城'),
          React.createElement('p', { style: styles.subtitle },
            'GitHub-only 目录 · 计划确认 · Profile 备份 · 健康检查 · 失败回滚 · ',
            React.createElement('a', {
              href: SUPPORT_URL, target: '_blank', rel: 'noreferrer', style: styles.link,
            }, '技术支持：DSH-Store'))))

      const nav = React.createElement('div', { style: styles.nav },
        React.createElement('div', { style: styles.navTabs, role: 'tablist', 'aria-label': '插件商城视图' },
          [['market', '插件市场'], ['installed', '已安装'], ['health', '健康检查']].map(([id, label]) =>
            React.createElement(TabButton, { key: id, active: view === id, onClick: () => setView(id) }, label))),
        React.createElement(Button, { compact: true, onClick: () => refresh(true, permissionDecisions) }, '刷新 GitHub 目录'))

      const categoryIds = [...new Set(scopedEntries.flatMap(entry => entry.categories))].sort()
      const categoryLabels = state.status === 'ready' ? state.market.registry.categories || {} : {}
      const filters = React.createElement(CatalogFilters, {
        query, category, categoryIds, categoryLabels, onQueryChange: setQuery, onCategoryChange: setCategory,
      })
      const catalogPackageNames = new Set(normalizedEntries.map(entry => entry.packageName))
      const uncataloguedInstalledAll = state.status === 'ready'
        ? state.inventory.plugins.filter(plugin => plugin.installed && !catalogPackageNames.has(plugin.packageName))
        : []
      const needle = query.trim().toLowerCase()
      const uncataloguedInstalled = category ? [] : uncataloguedInstalledAll
        .filter(plugin => !needle || [plugin.packageName, plugin.version, plugin.description, plugin.repository, plugin.source]
          .some(value => String(value || '').toLowerCase().includes(needle)))
        .sort((a, b) => a.packageName.localeCompare(b.packageName, 'en'))

      const restartState = restartOutcome(pendingRestart, state)
      const dismissRestart = () => { clearPendingRestart(); setPendingRestart(null) }
      const restartBanner = !restartState ? null : React.createElement('div', {
        style: restartState.status === 'failed' ? styles.error : styles.notice,
      },
      React.createElement('div', { style: styles.name }, restartState.status === 'pending'
        ? '等待重启 DSH Host：插件变更尚未生效'
        : restartState.status === 'verified' ? '已检测到新的 DSH Host，插件变更已生效' : 'DSH 已重启，但插件变更未通过验收'),
      restartState.status === 'pending' ? React.createElement(React.Fragment, null,
        React.createElement('div', { style: styles.muted }, state.guardian.available
          ? 'DSH 已由 Guardian 管理；无需也不要再运行 pnpm dsh web 或 dsh web。'
          : 'Guardian 尚未成为唯一启动所有者，安全重启已禁用；不要手工启动第二个 DSH 实例。'),
        React.createElement('div', { style: styles.actions },
          React.createElement(Button, { primary: true, disabled: !state.guardian.available, onClick: beginRestart }, '一键安全重启'),
          React.createElement(Button, { onClick: () => { void refresh(false, permissionDecisions) } }, '我已重启，重新检查'))) : null,
      restartState.status === 'failed' ? React.createElement('div', { style: styles.muted },
        `目标 ${pendingRestart.packageName}${pendingRestart.targetVersion ? ` ${pendingRestart.targetVersion}` : ''} 未在新实例中确认加载，请查看健康检查详情。`) : null,
      restartState.status !== 'pending' ? React.createElement(Button, { onClick: dismissRestart }, '完成') : null)

      const guardianIsExternal = state.status === 'ready' && state.guardian.owner === 'external'
      const guardianHasPortConflict = state.status === 'ready' && state.guardian.errorCode === 'GUARDIAN_PORT_CONFLICT'
      const guardianBanner = state.status !== 'ready' ? null : React.createElement('div', {
        style: state.guardian.available ? styles.notice : styles.error,
      }, React.createElement('div', { style: styles.name }, state.guardian.available
        ? `DSH Guardian：${state.guardian.state} · 唯一启动所有者`
        : guardianIsExternal ? '检测到外部 DSH 实例：Guardian 未接管'
          : guardianHasPortConflict ? '3080 端口被未知进程占用：Guardian 已拒绝接管'
            : 'DSH Guardian 未运行：一键重启已被安全禁用'),
      React.createElement('div', { style: styles.muted }, state.guardian.available
        ? `DSH 已由 Guardian 管理；请勿再运行 pnpm dsh web 或 dsh web。心跳 ${state.guardian.heartbeatAgeMs}ms · 失败次数 ${state.guardian.failureCount || 0} · 熔断 ${state.guardian.circuit || '未知'}`
        : guardianIsExternal
          ? '当前 DSH 不是由 Guardian 启动。请先停止手工实例，再让 Guardian 启动；商城不会杀死或冒充接管该进程。'
          : guardianHasPortConflict
            ? '商城无法验证该进程属于 DSH，因此不会终止进程，也不会启动第二个实例。'
            : '安装商城自带的外部 Guardian 后，即使 DSH 冷启动失败也能继续诊断和恢复。'),
      !state.guardian.available && !guardianIsExternal && !guardianHasPortConflict
        ? React.createElement(Button, { primary: true, onClick: beginGuardianInstall }, '安装并接管 DSH 守护') : null)

      let content
      if (state.status === 'loading') content = React.createElement('p', { style: styles.muted }, '正在读取 Profile 与 GitHub 目录…')
      else if (state.status === 'error') content = React.createElement('p', { style: styles.error }, state.message)
      else if (view === 'health') content = React.createElement(HealthPanel, {
        health: state.health, permissionDecisions, setPermissionDecision, rerun: rerunHealth,
      })
      else if (view === 'installed') {
        content = React.createElement(React.Fragment, null,
          filters,
          React.createElement('div', { style: styles.notice },
            `${entries.length} / ${scopedEntries.length} 个目录内已安装插件`,
            uncataloguedInstalledAll.length > 0 ? ` · 另有 ${uncataloguedInstalledAll.length} 个目录外只读项` : ''),
          React.createElement('div', { style: styles.grid, role: 'list', 'aria-label': '已安装插件' }, entries.map(entry => React.createElement(MarketCard, {
            key: entry.id, entry, health: state.health, beginPlan, openDetails: setDetailEntry, categoryLabels,
          }))),
          uncataloguedInstalled.length > 0
            ? React.createElement(React.Fragment, null,
              React.createElement('h4', { style: styles.title }, '未进入商城目录'),
              React.createElement('div', { style: styles.muted }, '以下项目只展示本地 manifest 的真实信息，不提供 catalog 权限详情或商城操作。'),
              React.createElement('div', { style: styles.grid, role: 'list', 'aria-label': '目录外已安装插件' }, uncataloguedInstalled.map(plugin =>
                React.createElement(InventoryOnlyCard, { key: plugin.packageName, plugin }))))
            : null)
      } else {
        content = React.createElement(React.Fragment, null,
          filters,
          React.createElement('div', { style: styles.notice },
            `${state.market.source.kind === 'github' ? 'GitHub 在线目录' : '内置目录回退'} · ${entries.length} / ${scopedEntries.length} 个在架条目`,
            state.market.source.errorCode ? ` · ${state.market.source.errorCode}` : ''),
          React.createElement('div', { style: styles.grid, role: 'list', 'aria-label': '插件市场目录' }, entries.map(entry => React.createElement(MarketCard, {
            key: entry.id, entry, health: state.health, beginPlan, openDetails: setDetailEntry,
            categoryLabels,
          }))))
      }

      return React.createElement('section', { style: styles.root, 'aria-label': 'DSH-Store 插件商城' },
        React.createElement('style', null, DETAIL_MODAL_CSS),
        heading, nav, guardianBanner, restartBanner, content,
        React.createElement(PlanPanel, { operation, confirmation, setConfirmation, execute, retryPlan, cancel, beginRestart }),
        React.createElement(RestartModal, {
          operation: restartOperation, confirmation: restartConfirmation, setConfirmation: setRestartConfirmation,
          execute: executeRestart, cancel: cancelRestart,
        }),
        React.createElement(GuardianModal, {
          operation: guardianOperation, confirmation: guardianConfirmation, setConfirmation: setGuardianConfirmation,
          execute: executeGuardianInstall, cancel: cancelGuardian,
        }),
        React.createElement(PluginDetailsModal, {
          entry: detailEntry, categoryLabels: state.status === 'ready' ? state.market.registry.categories : {},
          health: state.status === 'ready' ? state.health : null, beginPlan, close: closeDetails,
        }))
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
