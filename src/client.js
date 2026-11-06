window.__ModuleLoader__.load({
  id: 'dsh-safe-plugin-manager',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { Modal } = require('@deepseek-ai/dsh-client-ui-primitives')
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const OFFICIAL_DESKTOP_RENDERER = window.location?.protocol === 'dsh-app:'
    const ROUTES = {
      operations: '/api2/dsh-safe-plugin-manager/operations',
      inventory: '/api2/dsh-safe-plugin-manager/inventory',
      market: '/api2/dsh-safe-plugin-manager/market',
      health: '/api2/dsh-safe-plugin-manager/health',
      sourceUpdate: '/api2/dsh-safe-plugin-manager/source-update',
      dshVersion: '/api2/dsh-safe-plugin-manager/dsh-version',
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
    const MARKET_PAGE_SIZE = 20
    const RESTART_STORAGE_KEY = 'dsh-safe-plugin-manager:pending-restart:v1'
    const BOOT_RECOVERY_STORAGE_KEY = 'dsh-safe-plugin-manager:tab-boot:v1'
    const BOOT_RECOVERY_NAVIGATED_KEY = 'dsh-safe-plugin-manager:last-recovered-boot:v1'
    const BOOT_RECOVERY_CHANNEL = 'dsh-safe-plugin-manager:boot-recovery:v1'
    const BOOT_RECOVERY_BANNER_ID = 'dsh-safe-plugin-manager-boot-recovery'
    const BOOT_RECOVERY_TIMEOUT_MS = 90_000
    const BOOT_RECOVERY_REQUEST_TIMEOUT_MS = 2_500
    const BOOT_RECOVERY_RAPID_POLL_MS = 1_000
    const BOOT_RECOVERY_IDLE_POLL_MS = 5_000
    const BOOT_RECOVERY_STABLE_SAMPLES = 3
    const HEALTH_PERMISSION_STORAGE_KEY = 'dsh-safe-plugin-manager:health-permission-decisions:v1'
    const HEALTH_PERMISSION_FIELDS = ['files', 'network', 'commands', 'credentials', 'acceptUnknown']
    let activeBootRecovery = null

    async function post(route, body = {}, intent = null, options = {}) {
      const headers = { 'content-type': 'application/json' }
      if (intent) headers['x-dsh-safe-intent'] = intent
      const response = await fetch(route, {
        method: 'POST', headers, body: JSON.stringify(body),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.cache ? { cache: options.cache } : {}),
      })
      const payload = await response.json()
      if (!response.ok || !payload.ok) {
        const error = new Error(payload?.error?.message || `HTTP ${response.status}`)
        error.code = payload?.error?.code || 'REQUEST_FAILED'
        throw error
      }
      return payload.value
    }

    async function readOperations(id = null) {
      const response = await fetch(ROUTES.operations + (id ? `?id=${encodeURIComponent(id)}` : ''), { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload.ok) throw new Error('无法读取操作进度；请刷新后查看记录，勿重复执行。')
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

    function validPermissionRevision(value) {
      return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    }

    function normalizeHealthPermissionDecisions(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
      const normalized = {}
      for (const [packageName, record] of Object.entries(value).slice(0, 512)) {
        if (typeof packageName !== 'string' || packageName.length === 0 || packageName.length > 255) continue
        if (!record || typeof record !== 'object' || Array.isArray(record)
          || record.schemaVersion !== 1 || !validPermissionRevision(record.revision)) continue
        const raw = record.decisions && typeof record.decisions === 'object' && !Array.isArray(record.decisions)
          ? record.decisions : {}
        const decisions = Object.fromEntries(HEALTH_PERMISSION_FIELDS
          .filter(field => typeof raw[field] === 'boolean')
          .map(field => [field, raw[field]]))
        if (Object.keys(decisions).length > 0) normalized[packageName] = { schemaVersion: 1, revision: record.revision, decisions }
      }
      return normalized
    }

    function readHealthPermissionDecisions() {
      try { return normalizeHealthPermissionDecisions(JSON.parse(window.localStorage.getItem(HEALTH_PERMISSION_STORAGE_KEY) || 'null')) } catch { return {} }
    }

    function storeHealthPermissionDecisions(value) {
      const normalized = normalizeHealthPermissionDecisions(value)
      try {
        if (Object.keys(normalized).length === 0) window.localStorage.removeItem(HEALTH_PERMISSION_STORAGE_KEY)
        else window.localStorage.setItem(HEALTH_PERMISSION_STORAGE_KEY, JSON.stringify(normalized))
      } catch {}
      return normalized
    }

    function permissionValuesForPlugin(permissionDecisions, plugin) {
      const revision = plugin?.permissions?.decisionRevision
      const record = permissionDecisions?.[plugin?.packageName]
      if (!validPermissionRevision(revision) || record?.schemaVersion !== 1 || record.revision !== revision) return {}
      return record.decisions || {}
    }

    function restartOutcome(pending, state) {
      if (!pending || state.status !== 'ready') return null
      if (!state.runtime?.bootId || state.runtime.bootId === pending.runtimeInstanceId) return { status: 'pending' }
      const plugin = state.inventory.plugins.find(item => item.packageName === pending.packageName)
      const activated = pending.action === 'uninstall'
        ? !plugin
        : Boolean(plugin?.installed && (!pending.targetVersion || plugin.version === pending.targetVersion))
      const pluginHealth = state.health.plugins?.find(item => item.packageName === pending.packageName)
      if (activated && pluginHealth?.status !== 'unhealthy') return { status: 'verified', plugin, pluginHealth }
      return { status: 'failed', plugin, pluginHealth }
    }

    function validBootId(value) {
      return typeof value === 'string' && value.length >= 8 && value.length <= 128
        && /^[A-Za-z0-9._:-]+$/.test(value)
    }

    function readSessionValue(key) {
      try { return window.sessionStorage.getItem(key) } catch { return null }
    }

    function writeSessionValue(key, value) {
      try { window.sessionStorage.setItem(key, value) } catch {}
    }

    function bootIdFromLocation() {
      try {
        const value = new URL(window.location.href).searchParams.get('dshBoot')
        return validBootId(value) ? value : null
      } catch { return null }
    }

    function removeBootRecoveryBanner() {
      if (typeof document === 'undefined') return
      document.getElementById(BOOT_RECOVERY_BANNER_ID)?.remove()
    }

    function showBootRecoveryBanner(kind, retry) {
      if (typeof document === 'undefined' || !document.body) return
      let banner = document.getElementById(BOOT_RECOVERY_BANNER_ID)
      if (!banner) {
        banner = document.createElement('div')
        banner.id = BOOT_RECOVERY_BANNER_ID
        banner.setAttribute('role', kind === 'failed' ? 'alert' : 'status')
        banner.style.cssText = 'position:fixed;left:50%;top:12px;z-index:2147483000;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:min(760px,calc(100vw - 24px));padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px rgba(0,0,0,.28);font:12px/18px system-ui,sans-serif'
        const message = document.createElement('span')
        message.setAttribute('data-role', 'message')
        message.style.flex = '1 1 auto'
        banner.appendChild(message)
        const retryButton = document.createElement('button')
        retryButton.type = 'button'
        retryButton.textContent = '重新检测'
        retryButton.setAttribute('data-role', 'retry')
        retryButton.style.cssText = 'display:none;border:1px solid currentColor;border-radius:7px;padding:4px 8px;background:transparent;color:inherit;cursor:pointer'
        retryButton.addEventListener('click', () => retry?.())
        banner.appendChild(retryButton)
        const reloadButton = document.createElement('button')
        reloadButton.type = 'button'
        reloadButton.textContent = '手动刷新'
        reloadButton.setAttribute('data-role', 'reload')
        reloadButton.style.cssText = retryButton.style.cssText
        reloadButton.addEventListener('click', () => {
          const url = new URL(window.location.href)
          url.searchParams.set('dshRecoveryManual', String(Date.now()))
          window.location.replace(url.toString())
        })
        banner.appendChild(reloadButton)
        document.body.appendChild(banner)
      }
      banner.setAttribute('role', kind === 'failed' ? 'alert' : 'status')
      const message = banner.querySelector('[data-role="message"]')
      if (message) message.textContent = kind === 'failed'
        ? '新的 DSH Host 尚未通过 Guardian 稳定性验证。当前页面不会自动循环刷新。'
        : kind === 'checking'
          ? '检测到新的 DSH Host，正在等待 Guardian 稳定并校验页面资源…'
          : 'DSH 正在安全重启；所有标签页会在新 Host 稳定后自动恢复。未保存的草稿可能丢失。'
      const retryButton = banner.querySelector('[data-role="retry"]')
      const reloadButton = banner.querySelector('[data-role="reload"]')
      if (retryButton) retryButton.style.display = kind === 'failed' ? 'inline-flex' : 'none'
      if (reloadButton) reloadButton.style.display = kind === 'failed' ? 'inline-flex' : 'none'
    }

    function createBootRecoveryController() {
      let disposed = false
      let running = false
      let timer = null
      let channel = null
      let knownBootId = bootIdFromLocation() || readSessionValue(BOOT_RECOVERY_STORAGE_KEY)
      if (!validBootId(knownBootId)) knownBootId = null
      let expectedPreviousBootId = null
      let candidateBootId = null
      let stableSamples = 0
      let rapidUntil = 0
      let recoveryDeadline = 0
      let navigationIssued = false
      const waiters = new Set()
      const handleOnline = () => schedule(0)

      function publish(message) {
        try { channel?.postMessage({ schemaVersion: 1, ...message }) } catch {}
      }

      function schedule(delayMs) {
        if (disposed || navigationIssued) return
        if (timer !== null) window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          timer = null
          return check()
        }, Math.max(0, delayMs))
      }

      async function requestPost(route) {
        const controller = typeof window.AbortController === 'function' ? new window.AbortController() : null
        const timeout = controller
          ? window.setTimeout(() => controller.abort(), BOOT_RECOVERY_REQUEST_TIMEOUT_MS)
          : null
        try {
          return await post(route, {}, null, { signal: controller?.signal, cache: 'no-store' })
        } finally {
          if (timeout !== null) window.clearTimeout(timeout)
        }
      }

      async function rootIsReady(bootId) {
        const controller = typeof window.AbortController === 'function' ? new window.AbortController() : null
        const timeout = controller
          ? window.setTimeout(() => controller.abort(), BOOT_RECOVERY_REQUEST_TIMEOUT_MS)
          : null
        try {
          const url = new URL('/', window.location.origin)
          url.searchParams.set('dshBootProbe', bootId)
          const response = await fetch(url.toString(), {
            method: 'GET', cache: 'no-store', headers: { accept: 'text/html' },
            ...(controller ? { signal: controller.signal } : {}),
          })
          if (!response.ok) return false
          const contentType = response.headers?.get?.('content-type') || ''
          const content = await response.text()
          return contentType.toLowerCase().includes('text/html') && /<!doctype html|<html/i.test(content)
        } finally {
          if (timeout !== null) window.clearTimeout(timeout)
        }
      }

      function guardianIsStable(guardian, runtime) {
        return guardian?.schemaVersion === 1
          && guardian.available === true
          && guardian.state === 'healthy'
          && guardian.owner === 'guardian'
          && guardian.heartbeatFresh === true
          && guardian.profile === runtime.profile
          && guardian.health?.bootId === runtime.bootId
      }

      function settleWaiters(bootId) {
        for (const waiter of [...waiters]) {
          if (!waiter.previousBootId || waiter.previousBootId !== bootId) {
            waiters.delete(waiter)
            waiter.resolve(bootId)
          }
        }
      }

      function rejectExpiredWaiters(now) {
        for (const waiter of [...waiters]) {
          if (now < waiter.deadline) continue
          waiters.delete(waiter)
          const error = new Error('新的 DSH Host 未在限定时间内通过 Guardian 稳定性验证')
          error.code = 'BOOT_RECOVERY_TIMEOUT'
          waiter.reject(error)
        }
      }

      function acceptBootWithoutNavigation(bootId) {
        knownBootId = bootId
        candidateBootId = null
        stableSamples = 0
        expectedPreviousBootId = null
        recoveryDeadline = 0
        writeSessionValue(BOOT_RECOVERY_STORAGE_KEY, bootId)
        settleWaiters(bootId)
        removeBootRecoveryBanner()
      }

      function navigateToBoot(bootId) {
        const alreadyNavigated = readSessionValue(BOOT_RECOVERY_NAVIGATED_KEY)
        if (alreadyNavigated === bootId || bootIdFromLocation() === bootId) {
          acceptBootWithoutNavigation(bootId)
          return
        }
        knownBootId = bootId
        candidateBootId = null
        stableSamples = 0
        expectedPreviousBootId = null
        recoveryDeadline = 0
        writeSessionValue(BOOT_RECOVERY_STORAGE_KEY, bootId)
        writeSessionValue(BOOT_RECOVERY_NAVIGATED_KEY, bootId)
        settleWaiters(bootId)
        publish({ type: 'boot-stable', bootId })
        const url = new URL(window.location.href)
        url.searchParams.set('dshBoot', bootId)
        url.searchParams.set('recovered', '1')
        navigationIssued = true
        window.location.replace(url.toString())
      }

      function beginRecovery(previousBootId, broadcast = true) {
        const previous = validBootId(previousBootId) ? previousBootId : knownBootId
        if (validBootId(previous) && !knownBootId) knownBootId = previous
        if (validBootId(previous)) expectedPreviousBootId = previous
        rapidUntil = Date.now() + BOOT_RECOVERY_TIMEOUT_MS
        recoveryDeadline = rapidUntil
        showBootRecoveryBanner('pending', retry)
        if (broadcast) publish({ type: 'restart-pending', previousBootId: previous || null })
        schedule(0)
      }

      function retry() {
        navigationIssued = false
        rapidUntil = Date.now() + BOOT_RECOVERY_TIMEOUT_MS
        recoveryDeadline = rapidUntil
        stableSamples = 0
        showBootRecoveryBanner('checking', retry)
        schedule(0)
      }

      async function check() {
        if (disposed || navigationIssued) return
        if (running) {
          schedule(250)
          return
        }
        running = true
        const now = Date.now()
        try {
          rejectExpiredWaiters(now)
          const runtime = await requestPost(ROUTES.runtime)
          if (!validBootId(runtime?.bootId)) throw new Error('invalid runtime boot identity')
          if (!knownBootId) {
            acceptBootWithoutNavigation(runtime.bootId)
            return
          }
          if (runtime.bootId === knownBootId) {
            candidateBootId = null
            stableSamples = 0
            writeSessionValue(BOOT_RECOVERY_STORAGE_KEY, runtime.bootId)
            return
          }
          if (candidateBootId !== runtime.bootId) {
            candidateBootId = runtime.bootId
            stableSamples = 0
            rapidUntil = Date.now() + BOOT_RECOVERY_TIMEOUT_MS
            if (!recoveryDeadline) recoveryDeadline = rapidUntil
            publish({ type: 'boot-observed', previousBootId: knownBootId, bootId: candidateBootId })
          }
          showBootRecoveryBanner('checking', retry)
          const [guardian, rootReady] = await Promise.all([
            requestPost(ROUTES.guardian), rootIsReady(runtime.bootId),
          ])
          if (!guardianIsStable(guardian, runtime) || !rootReady) {
            stableSamples = 0
            return
          }
          stableSamples += 1
          if (stableSamples >= BOOT_RECOVERY_STABLE_SAMPLES) navigateToBoot(runtime.bootId)
        } catch {
          stableSamples = 0
        } finally {
          running = false
          const finishedAt = Date.now()
          rejectExpiredWaiters(finishedAt)
          if (!navigationIssued) {
            const timedOut = recoveryDeadline > 0 && finishedAt >= recoveryDeadline
            if (timedOut) showBootRecoveryBanner('failed', retry)
            schedule(!timedOut && (candidateBootId || expectedPreviousBootId || finishedAt < rapidUntil)
              ? BOOT_RECOVERY_RAPID_POLL_MS
              : BOOT_RECOVERY_IDLE_POLL_MS)
          }
        }
      }

      function waitForSuccessor(previousBootId, timeoutMs = BOOT_RECOVERY_TIMEOUT_MS) {
        beginRecovery(previousBootId)
        return new Promise((resolve, reject) => {
          waiters.add({ previousBootId, deadline: Date.now() + timeoutMs, resolve, reject })
        })
      }

      function onChannelMessage(event) {
        const message = event?.data
        if (!message || message.schemaVersion !== 1) return
        if (message.type === 'restart-pending') beginRecovery(message.previousBootId, false)
        else if ((message.type === 'boot-observed' || message.type === 'boot-stable') && validBootId(message.bootId)) {
          if (message.bootId !== knownBootId) {
            candidateBootId = message.bootId
            stableSamples = 0
            rapidUntil = Date.now() + BOOT_RECOVERY_TIMEOUT_MS
            showBootRecoveryBanner('checking', retry)
            schedule(0)
          }
        }
      }

      function start() {
        if (disposed) return
        if (typeof window.BroadcastChannel === 'function') {
          try {
            channel = new window.BroadcastChannel(BOOT_RECOVERY_CHANNEL)
            channel.addEventListener('message', onChannelMessage)
          } catch { channel = null }
        }
        window.addEventListener?.('online', handleOnline)
        schedule(0)
      }

      function dispose() {
        disposed = true
        if (timer !== null) window.clearTimeout(timer)
        timer = null
        window.removeEventListener?.('online', handleOnline)
        try { channel?.removeEventListener('message', onChannelMessage) } catch {}
        try { channel?.close() } catch {}
        channel = null
        for (const waiter of waiters) {
          const error = new Error('Boot recovery disposed')
          error.code = 'BOOT_RECOVERY_DISPOSED'
          waiter.reject(error)
        }
        waiters.clear()
        removeBootRecoveryBanner()
      }

      return { start, dispose, waitForSuccessor, retry, wake: handleOnline }
    }

    function installBootRecovery(ctx) {
      activeBootRecovery?.dispose()
      const controller = createBootRecoveryController()
      activeBootRecovery = controller
      controller.start()
      const stopReset = typeof ctx?.on === 'function'
        ? ctx.on('connection/reset', controller.wake)
        : null
      return () => {
        if (typeof stopReset === 'function') stopReset()
        if (activeBootRecovery === controller) activeBootRecovery = null
        controller.dispose()
      }
    }

    function waitForStableSuccessorBoot(previousBootId) {
      if (!activeBootRecovery) {
        activeBootRecovery = createBootRecoveryController()
        activeBootRecovery.start()
      }
      return activeBootRecovery.waitForSuccessor(previousBootId)
    }

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '920px' },
      toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' },
      headingCopy: { minWidth: '240px', flex: '1 1 360px' },
      versionBox: {
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '7px',
        minWidth: 'min(100%, 320px)', flex: '1 1 320px',
      },
      nav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', width: '100%' },
      navTabs: {
        display: 'inline-flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', padding: '3px',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-2)',
      },
      title: { margin: 0, fontSize: '16px', lineHeight: '24px', fontWeight: 650 },
      subtitle: { margin: '3px 0 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px' },
      input: {
        width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '9px',
        padding: '11px 12px', minHeight: '44px', fontSize: '14px', lineHeight: '20px',
        background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)',
      },
      select: {
        boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px',
        padding: '10px 34px 10px 12px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)',
        fontSize: '14px', lineHeight: '20px', minHeight: '44px', minWidth: '200px',
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
      disabledButton: {
        opacity: 0.82, cursor: 'not-allowed', color: 'var(--dsw-alias-label-secondary)',
        borderColor: 'var(--dsw-alias-border-l2)',
      },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '12px' },
      marketRoot: {
        display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '1180px', minWidth: 0, minHeight: 0,
        height: 'calc(100vh - 24px)', maxHeight: 'calc(100vh - 24px)', boxSizing: 'border-box',
        marginInline: 'auto', padding: '14px clamp(16px, 2.5vw, 30px) 28px',
        overflowX: 'hidden', overflowY: 'auto', overscrollBehaviorY: 'contain', WebkitOverflowScrolling: 'touch',
      },
      marketHero: {
        display: 'flex', flexDirection: 'column', gap: '14px', border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '14px', padding: '16px', background: 'linear-gradient(135deg, var(--dsw-alias-bg-layer-2), var(--dsw-alias-bg-layer-3))',
      },
      marketHeroTitle: { margin: 0, fontSize: '20px', lineHeight: '28px', fontWeight: 700, letterSpacing: '-0.02em' },
      marketStats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' },
      marketStat: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '9px 11px', borderRadius: '10px', background: 'var(--dsw-alias-bg-layer-2)' },
      marketStatValue: { fontSize: '17px', lineHeight: '22px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
      marketStatLabel: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px', lineHeight: '16px' },
      marketToolbar: { display: 'flex', alignItems: 'stretch', flexWrap: 'wrap', gap: '8px' },
      marketDirectoryControls: {
        position: 'sticky', top: 0, zIndex: 2, display: 'flex', flexDirection: 'column', gap: '8px',
        padding: '7px 0', background: 'var(--dsw-alias-bg-layer-1)',
      },
      marketViewBar: {
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start',
        gap: '8px 10px', paddingBottom: '12px', borderBottom: '1px solid var(--dsw-alias-border-l2)',
      },
      marketViewTab: {
        boxSizing: 'border-box', width: 'auto', maxWidth: '100%', flex: '0 0 auto',
        minHeight: '46px', padding: '8px 14px', borderRadius: '9px',
        justifyContent: 'center', textAlign: 'center', whiteSpace: 'normal',
        overflowWrap: 'normal', lineHeight: '1.35', fontSize: '13px',
        border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer',
      },
      marketHeroLink: {
        display: 'inline-flex', alignItems: 'center', height: '28px', padding: '0 10px',
        borderRadius: '7px', fontSize: '11px', textDecoration: 'none',
        border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)', lineHeight: '26px', boxSizing: 'border-box',
      },
      marketFilterRow: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '8px',
      },
      marketFacetGroup: {
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
      },
      marketNotice: {
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px',
        padding: '10px 14px', background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)', fontSize: '11.5px', lineHeight: '17px',
      },
      actionHeaderCard: {
        display: 'flex', flexDirection: 'column', gap: '8px',
        padding: '12px 14px', borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l2)',
      },
      specBox: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '10px', lineHeight: '1.4', wordBreak: 'break-all', overflowWrap: 'anywhere',
        color: 'var(--dsw-alias-label-primary)',
        padding: '8px 10px', borderRadius: '7px',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l2)',
        marginTop: '2px',
      },
      actionNoticeCard: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '10px',
        padding: '10px 13px',
        fontSize: '12px',
        lineHeight: '18px',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      actionConfirmCard: {
        display: 'flex', flexDirection: 'column', gap: '8px',
        padding: '12px 14px', borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l2)',
        marginTop: '4px',
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '100%',
      },
      actionConfirmLabel: {
        display: 'flex', flexDirection: 'column', gap: '8px',
        width: '100%', maxWidth: '100%', minWidth: 0,
        fontSize: '10px', lineHeight: '14px',
      },
      actionConfirmCode: {
        boxSizing: 'border-box', width: '100%', maxWidth: '100%', minWidth: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '10px', lineHeight: '14px', fontWeight: 600,
        height: '44px', padding: '6px 8px', borderRadius: '7px',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-primary)',
        wordBreak: 'break-all',
        overflowWrap: 'anywhere',
        whiteSpace: 'pre-wrap', resize: 'none', userSelect: 'text',
        cursor: 'text',
      },
      actionConfirmInput: {
        boxSizing: 'border-box', width: '100%', maxWidth: '100%', minWidth: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '10px', lineHeight: '16px',
        height: '32px',
        padding: '0 8px',
        borderRadius: '7px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
      },
      marketPluginTabs: {
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start', alignSelf: 'flex-start',
        boxSizing: 'border-box', maxWidth: '100%', gap: '8px', padding: '8px',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-2)',
      },
      marketFilterTabs: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' },
      marketResults: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' },
      marketListViewport: { width: '100%', minWidth: 0, overflow: 'visible' },
      marketGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: '14px', alignItems: 'stretch' },
      marketCard: {
        display: 'flex', flexDirection: 'column', gap: '9px', minWidth: 0, padding: '13px',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-3)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
      },
      marketCardTitle: { minWidth: 0, overflowWrap: 'anywhere', fontSize: '14px', lineHeight: '20px', fontWeight: 650 },
      marketBadges: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px' },
      marketCardActions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' },
      marketSectionHeading: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', margin: '4px 0 0' },
      marketExternalCard: {
        display: 'flex', flexDirection: 'column', gap: '9px', minWidth: 0, padding: '13px',
        border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-2)',
      },
      marketEmpty: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px', padding: '24px 16px', border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: '12px', textAlign: 'center' },
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
      versionPill: { display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '999px', padding: '5px 9px', background: 'var(--dsw-alias-bg-layer-2)', fontSize: '11px', whiteSpace: 'nowrap' },
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
      compatibilityMatrix: { display: 'grid', gap: '4px', marginTop: '2px' },
      compatibilityCell: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '7px', padding: '4px 3px', minWidth: 0 },
      compatibilityKey: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '10px', fontWeight: 700 },
      compatibilityValue: { fontSize: '10px', lineHeight: '14px' },
      assuranceGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '4px', marginTop: '2px' },
      assuranceCell: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '7px', padding: '5px 3px', minWidth: 0 },
      diffGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '5px' },
      diffCell: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '7px', padding: '6px 8px', minWidth: 0 },
      detailFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', width: '100%' },
      detailFooterLinks: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginLeft: 'auto' },
      pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '6px', marginTop: '2px' },
      pageStatus: { minWidth: '108px', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px' },
    }

    const DETAIL_MODAL_CSS = `
      .dsh-safe-plugin-detail-modal { width: min(720px, calc(100vw - 32px)) !important; max-height: min(820px, calc(100vh - 40px)); }
      .dsh-safe-plugin-detail-content { min-height: 0; overflow-y: auto; overflow-x: hidden; line-height: 1.55; }
      .dsh-safe-plugin-detail-modal [role="dialog"] { max-height: calc(100vh - 40px); }
    `

    const DETAIL_LABELS = {
      pluginType: { feature: '功能插件', theme: '主题', suite: '套件', client: '客户端', provider: 'Provider', unknown: '未知' },
      installSource: { npm: 'npm', github: 'GitHub', 'local-bundle': '本地 Bundle', unknown: '未知' },
      level: { low: '低', medium: '中', high: '高', unknown: '未知' },
      files: { none: '不访问', 'read-only': '只读', write: '可写', unknown: '未知' },
      network: { none: '无', 'specified-services': '指定服务', any: '任意网络', unknown: '未知' },
      commands: { none: '否', restricted: '受限', shell: '任意 Shell', unknown: '未知' },
      credentials: { none: '否', 'api-key': 'API Key', oauth: 'OAuth', keychain: '系统 Keychain', 'proxy-credentials': '代理订阅/节点凭据', 'web-session-token': '网页登录会话令牌', unknown: '未知' },
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

    const LEGACY_DSH_VERSIONS = { 'rc.7': '0.1.0-rc.7', 'rc.8': '0.1.0-rc.8', '0.1.1-rc.1': '0.1.1-rc.1', '0.1.1-rc.2': '0.1.1-rc.2', '0.1.2-alpha.2': '0.1.2-alpha.2', '0.1.2-alpha.3': '0.1.2-alpha.3', '0.1.2-alpha.4': '0.1.2-alpha.4', '0.1.2-alpha.5': '0.1.2-alpha.5' }
    const COMPATIBILITY_STATUSES = new Set(['compatible', 'incompatible', 'unknown'])
    const OPERATION_STATUSES = new Set(['passed', 'failed', 'unknown'])
    const unknownOperations = () => Object.fromEntries(DSH_OPERATIONS.map(([operation]) => [operation, 'unknown']))
    function fallbackReleaseViews(compatibility, releaseContext) {
      const declaredReleases = compatibility.dshReleases && typeof compatibility.dshReleases === 'object' ? compatibility.dshReleases : {}
      const declaredOperations = compatibility.dshOperations && typeof compatibility.dshOperations === 'object' ? compatibility.dshOperations : {}
      const contextReleases = Array.isArray(releaseContext?.releases) ? releaseContext.releases : []
      const releases = contextReleases.length > 0 ? contextReleases : [...new Set([...Object.keys(LEGACY_DSH_VERSIONS), ...Object.keys(declaredReleases), ...Object.keys(declaredOperations)])]
        .map(key => ({ key, version: LEGACY_DSH_VERSIONS[key] || key, aliases: [key], latest: false }))
      return releases.map((release, index) => {
        const keys = [...new Set([release.key, ...(Array.isArray(release.aliases) ? release.aliases : [])].filter(Boolean))]
        const declaredKey = keys.find(key => Object.hasOwn(declaredReleases, key)) || null
        const operationKey = keys.find(key => Object.hasOwn(declaredOperations, key)) || null
        return {
          key: release.key || release.version, version: release.version || release.key, label: release.label || release.version || release.key,
          latest: release.latest === true || (releaseContext?.latestVersion == null && index === releases.length - 1),
          status: COMPATIBILITY_STATUSES.has(declaredReleases[declaredKey]) ? declaredReleases[declaredKey] : 'unknown',
          basis: declaredKey ? 'catalog' : 'unknown', rangeStatus: 'unknown', declaredKey,
          operations: { ...unknownOperations(), ...(operationKey ? declaredOperations[operationKey] : {}) },
        }
      })
    }
    function normalizeReleaseViews(compatibility, releaseContext) {
      const views = Array.isArray(compatibility.dshReleaseViews) && compatibility.dshReleaseViews.length > 0
        ? compatibility.dshReleaseViews : fallbackReleaseViews(compatibility, releaseContext)
      return views.slice(-64).map(view => ({
        key: String(view?.key || view?.version || 'unknown'), version: String(view?.version || view?.key || 'unknown'),
        label: String(view?.label || view?.version || view?.key || 'unknown'), latest: view?.latest === true,
        status: COMPATIBILITY_STATUSES.has(view?.status) ? view.status : 'unknown',
        basis: ['catalog', 'range', 'unknown'].includes(view?.basis) ? view.basis : 'unknown',
        rangeStatus: COMPATIBILITY_STATUSES.has(view?.rangeStatus) ? view.rangeStatus : 'unknown',
        declaredKey: typeof view?.declaredKey === 'string' ? view.declaredKey : null,
        operations: Object.fromEntries(DSH_OPERATIONS.map(([operation]) => [operation,
          OPERATION_STATUSES.has(view?.operations?.[operation]) ? view.operations[operation] : 'unknown'])),
      }))
    }
    const compatibilityViewLabel = view => view.basis === 'range'
      ? view.rangeStatus === 'compatible' ? '范围支持·待验证' : view.rangeStatus === 'incompatible' ? '范围不支持' : '未声明'
      : ({ compatible: '兼容', incompatible: '不兼容', unknown: '未声明' }[view.status] || '未声明')
    const compatibilityViewColor = view => ({
      compatible: 'var(--dsw-alias-state-success-primary)', incompatible: 'var(--dsw-alias-state-error-primary)', unknown: 'var(--dsw-alias-label-tertiary)',
    }[view.basis === 'range' ? (view.rangeStatus === 'incompatible' ? 'incompatible' : 'unknown') : view.status] || 'var(--dsw-alias-label-tertiary)')
    function cardReleaseViews(views) {
      const latestIndex = views.findIndex(view => view.latest)
      const end = latestIndex < 0 ? views.length : latestIndex + 1
      return views.slice(Math.max(0, end - 3), end)
    }
    function CompatibilityMatrix({ entry, all = false }) {
      const available = entry.compatibility.dshReleaseViews || []
      const releases = all ? available : cardReleaseViews(available)
      if (releases.length === 0) return React.createElement('div', { style: styles.muted }, '尚无 DSH 版本兼容信息')
      const releaseLabel = `${releases[0].version} 至 ${releases[releases.length - 1].version}`
      return React.createElement('div', { style: { ...styles.compatibilityMatrix, gridTemplateColumns: `repeat(${Math.min(releases.length, 3)}, minmax(0, 1fr))` }, role: 'list', 'aria-label': `DSH ${releaseLabel} 兼容性` },
        releases.map(view => React.createElement('div', { key: view.key, role: 'listitem', style: { ...styles.compatibilityCell, color: compatibilityViewColor(view) } },
          React.createElement('span', { style: styles.compatibilityKey }, `DSH ${view.version}${view.latest ? ' · 最新' : ''}`),
          React.createElement('span', { style: styles.compatibilityValue }, compatibilityViewLabel(view)))))
    }

    const ASSURANCE_LEVELS = [
      ['discovery', '已发现'], ['installability', '可安装'], ['runtime', '运行验证'], ['securityReview', '安全审查'],
    ]
    const assuranceStatusLabel = status => ({
      verified: '已验证', partial: '部分验证', failed: '未通过', unknown: '未知', 'not-applicable': '不适用',
    }[status] || '未知')
    const assuranceStatusColor = status => ({
      verified: 'var(--dsw-alias-state-success-primary)',
      partial: '#c78300',
      failed: 'var(--dsw-alias-state-error-primary)',
      unknown: 'var(--dsw-alias-label-tertiary)',
      'not-applicable': 'var(--dsw-alias-label-tertiary)',
    }[status] || 'var(--dsw-alias-label-tertiary)')
    function AssuranceMatrix({ entry }) {
      return React.createElement('div', { style: styles.assuranceGrid, role: 'list', 'aria-label': '插件可信证据等级' },
        ASSURANCE_LEVELS.map(([key, label]) => {
          const evidence = entry.assurance[key]
          return React.createElement('div', {
            key, role: 'listitem', title: evidence.summary || `${label}：${assuranceStatusLabel(evidence.status)}`,
            style: { ...styles.assuranceCell, color: assuranceStatusColor(evidence.status) },
          }, React.createElement('span', { style: styles.compatibilityKey }, label),
          React.createElement('span', { style: styles.compatibilityValue }, assuranceStatusLabel(evidence.status)))
        }))
    }

    const DSH_OPERATIONS = [['install', '安装'], ['start', '启动'], ['uninstall', '卸载'], ['rollback', '回滚']]
    const operationStatusLabel = status => ({ passed: '通过', failed: '失败', unknown: '未知' }[status] || '未知')
    function OperationEvidence({ entry }) {
      return React.createElement('div', { style: styles.detailSection }, entry.compatibility.dshReleaseViews.map(view => {
        return React.createElement('div', { key: view.key, style: styles.diffCell },
          React.createElement('div', { style: styles.name }, `DSH ${view.version}${view.latest ? ' · 最新' : ''}`),
          React.createElement('div', { style: styles.muted }, DSH_OPERATIONS
            .map(([key, label]) => `${label}：${operationStatusLabel(view.operations[key])}`).join(' · ')))
      }))
    }

    function defaultEvidence(status = 'unknown', summary = null) {
      return { status, method: null, checkedAt: null, evidenceUrl: null, dshRelease: null, systems: [], profiles: [], summary }
    }

    function normalizeMarketEntry(entry, releaseContext) {
      const declaredDetails = entry?.details && typeof entry.details === 'object' ? entry.details : {}
      const declaredPermissions = declaredDetails.permissions && typeof declaredDetails.permissions === 'object'
        ? declaredDetails.permissions
        : {}
      const compatibility = entry?.compatibility && typeof entry.compatibility === 'object' ? entry.compatibility : {}
      const risk = entry?.risk && typeof entry.risk === 'object' ? entry.risk : {}
      const assurance = entry?.assurance && typeof entry.assurance === 'object' ? entry.assurance : {}
      const source = entry?.source && typeof entry.source === 'object' ? entry.source : {}
      const dshReleaseViews = normalizeReleaseViews(compatibility, releaseContext)
      return {
        ...entry,
        catalogDetailsAvailable: Boolean(entry?.details && entry.details.permissions),
        categories: Array.isArray(entry?.categories) ? entry.categories : [],
        entryIds: Array.isArray(entry?.entryIds) ? entry.entryIds : [],
        compatibility: {
          ...compatibility,
          dsh: typeof compatibility.dsh === 'string' ? compatibility.dsh : null,
          dshReleases: compatibility.dshReleases && typeof compatibility.dshReleases === 'object' ? compatibility.dshReleases : {},
          dshOperations: compatibility.dshOperations && typeof compatibility.dshOperations === 'object' ? compatibility.dshOperations : {},
          dshReleaseViews,
          node: typeof compatibility.node === 'string' ? compatibility.node : null,
          systems: Array.isArray(compatibility.systems) ? compatibility.systems : [],
          profiles: Array.isArray(compatibility.profiles) ? compatibility.profiles : [],
        },
        details: {
          screenshots: declaredDetails.screenshots || [],
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
        source: {
          updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
          observedAt: typeof source.observedAt === 'string' ? source.observedAt : null,
          provenance: source.provenance || 'unknown',
        },
        assurance: Object.fromEntries(ASSURANCE_LEVELS.map(([key]) => [key,
          assurance[key] && typeof assurance[key] === 'object' ? { ...defaultEvidence(), ...assurance[key] } : defaultEvidence()])),
        risk: { ...risk, installScripts: Array.isArray(risk.installScripts) ? risk.installScripts : [] },
      }
    }

    function currentInstallSource(entry) {
      if (entry.installedSource === 'npm') return 'npm（当前 Profile）'
      if (entry.installedSource === 'git') return 'GitHub（当前 Profile）'
      if (['link', 'file', 'workspace'].includes(entry.installedSource)) return '本地 Bundle（当前 Profile）'
      return `${detailLabel('installSource', entry.details.installSource)}（目录声明）`
    }

    function Button({ children, danger = false, primary = false, compact = false, disabled = false, onClick, ariaLabel, ariaPressed, title }) {
      return React.createElement('button', {
        type: 'button', disabled, onClick, title, 'aria-label': ariaLabel, 'aria-pressed': ariaPressed,
        style: { ...styles.button, ...(compact ? styles.compactButton : {}), ...(danger ? styles.dangerButton : {}), ...(primary ? styles.primaryButton : {}), ...(disabled ? styles.disabledButton : {}) },
      }, children)
    }

    function StatusPill({ label, tone = 'var(--dsw-alias-label-tertiary)' }) {
      return React.createElement('span', { style: styles.statusPill },
        React.createElement('span', { 'aria-hidden': true, style: { ...styles.stateDot, background: tone } }),
        label)
    }

    function TabButton({ children, active, onClick, style }) {
      return React.createElement('button', {
        type: 'button', role: 'tab', 'aria-selected': active, onClick,
        style: { ...styles.tabButton, ...(active ? styles.activeTabButton : {}), ...(style || {}) },
      }, children)
    }

    function CatalogFilters({ query, category, categoryIds, categoryLabels, featuredOnly, showFeatured, onQueryChange, onCategoryChange, onFeaturedChange, compatibleWith, currentVersion, onCompatibilityChange }) {
      return React.createElement('div', { style: styles.toolbar },
        React.createElement('input', {
          type: 'search', value: query, onChange: event => onQueryChange(event.target.value),
          style: { ...styles.input, flex: '1 1 360px', minWidth: 'min(100%, 280px)' }, placeholder: '搜索名称、包名、分类、权限或 GitHub 仓库',
        }),
        React.createElement('select', {
          value: category, onChange: event => onCategoryChange(event.target.value),
          style: styles.select, 'aria-label': '按分类筛选',
        },
        React.createElement('option', { value: '' }, '全部分类'),
        categoryIds.map(id => React.createElement('option', { key: id, value: id }, categoryLabels[id] || id))),
        currentVersion ? React.createElement(Button, { compact: true, primary: Boolean(compatibleWith), onClick: () => onCompatibilityChange(compatibleWith ? '' : currentVersion) }, compatibleWith ? `DSH ${compatibleWith} 兼容 · 显示全部` : `只看兼容 DSH ${currentVersion}`) : null,
        showFeatured ? React.createElement(Button, {
          compact: true, primary: featuredOnly, ariaPressed: featuredOnly,
          onClick: () => onFeaturedChange(!featuredOnly),
        }, featuredOnly ? '显示全部' : '只看推荐') : null)
    }

    function Pagination({ pagination, loading, onPageChange }) {
      if (!pagination || pagination.pageCount <= 1) return null
      const pages = []
      const start = Math.max(1, Math.min(pagination.page - 2, pagination.pageCount - 4))
      const end = Math.min(pagination.pageCount, start + 4)
      for (let page = start; page <= end; page += 1) pages.push(page)
      return React.createElement('nav', { style: styles.pagination, 'aria-label': '插件目录分页' },
        React.createElement(Button, {
          compact: true, disabled: loading || !pagination.hasPrevious,
          onClick: () => onPageChange(pagination.page - 1), ariaLabel: '上一页',
        }, '上一页'),
        pages.map(page => React.createElement(Button, {
          key: page, compact: true, primary: page === pagination.page, disabled: loading || page === pagination.page,
          onClick: () => onPageChange(page), ariaLabel: `第 ${page} 页`,
        }, String(page))),
        React.createElement('span', { style: styles.pageStatus, role: 'status' },
          loading ? '正在读取…' : `${pagination.page} / ${pagination.pageCount} 页`),
        React.createElement(Button, {
          compact: true, disabled: loading || !pagination.hasNext,
          onClick: () => onPageChange(pagination.page + 1), ariaLabel: '下一页',
        }, '下一页'))
    }

    function PluginActions({ entry, health, beginPlan, checkSource, readOnly = false }) {
      if (readOnly) return React.createElement('div', { style: styles.muted }, '官方 Desktop 中请使用内置“插件”页管理安装、更新与启停。')
      const allowed = new Set(entry.allowedActions || [])
      if (allowed.size === 0) return React.createElement('div', { style: styles.muted }, entry.managementBlockedReason || '当前没有可执行操作')
      const disabled = entry.entryIds.length > 0 && entry.entryIds.every(id => health?.disabledEntryIds?.includes(id))
      const actions = []
      if (allowed.has('install')) actions.push(React.createElement(Button, { key: 'install', primary: true, onClick: () => beginPlan('install', entry) }, '安装'))
      if (entry.sourceUpdate?.status === 'update-ready') actions.push(React.createElement(Button, {
        key: 'source-update', primary: true,
        onClick: () => beginPlan('update', { ...entry, sourceCommit: entry.sourceUpdate.candidateCommit }),
      }, `更新至 ${entry.sourceUpdate.candidateVersion}`))
      else if (entry.sourceUpdate?.status === 'user-review-required') actions.push(React.createElement(Button, {
        key: 'source-risk-update', primary: true, danger: true,
        onClick: () => beginPlan('update', {
          ...entry, sourceCommit: entry.sourceUpdate.candidateCommit, sourceRiskAccepted: true,
        }),
      }, `审阅风险并更新至 ${entry.sourceUpdate.candidateVersion}`))
      else {
        if (allowed.has('update')) actions.push(React.createElement(Button, { key: 'update', primary: true, onClick: () => beginPlan('update', entry) }, '更新'))
        if (entry.installed && entry.status === 'approved' && typeof checkSource === 'function') actions.push(React.createElement(Button, {
          key: 'check-source', compact: true, disabled: entry.sourceUpdate?.status === 'checking', onClick: () => checkSource(entry),
        }, entry.sourceUpdate?.status === 'checking' ? '正在检查源仓库…' : '检查源仓库更新'))
      }
      if (allowed.has('migrate')) actions.push(React.createElement(Button, { key: 'migrate', primary: true, onClick: () => beginPlan('migrate', entry) }, '迁移到商城版'))
      if (entry.entryIds.length > 0 && (allowed.has('enable') || allowed.has('disable'))) {
        actions.push(React.createElement(Button, { key: 'toggle', onClick: () => beginPlan(disabled ? 'enable' : 'disable', entry) }, disabled ? '启用' : '停用'))
      }
      if (allowed.has('uninstall')) actions.push(React.createElement(Button, { key: 'remove', danger: true, onClick: () => beginPlan('uninstall', entry) }, '卸载'))
      return React.createElement('div', { style: styles.actions }, actions)
    }

    function SourceDiffSummary({ update }) {
      if (!update?.diff) return null
      const signals = update.diff.permissionSignals || {}
      const signalLabels = [
        ['filesystem', '文件系统'], ['network', '网络'], ['commandExecution', '命令执行'], ['credentials', '凭据'], ['protectedDsh', 'DSH 核心'],
      ].filter(([key]) => signals[key]).map(([, label]) => label)
      return React.createElement('details', { style: styles.notice },
        React.createElement('summary', { style: { cursor: 'pointer', fontWeight: 600 } },
          `更新差异：${update.checkedCommits ?? '未知'} 个提交 · ${update.checkedFiles ?? update.diff.files?.length ?? 0} 个文件 · +${update.diff.additions || 0} / -${update.diff.deletions || 0}`),
        React.createElement('div', { style: { ...styles.diffGrid, marginTop: '8px' } },
          React.createElement('div', { style: styles.diffCell }, React.createElement('div', { style: styles.name }, '提交范围'),
            React.createElement('div', { style: styles.code }, `${String(update.catalogCommit || '').slice(0, 12)} → ${String(update.candidateCommit || '').slice(0, 12)}`)),
          React.createElement('div', { style: styles.diffCell }, React.createElement('div', { style: styles.name }, '新增网络主机'),
            React.createElement('div', { style: styles.muted }, update.diff.networkHosts?.length ? update.diff.networkHosts.join(' / ') : '无')),
          React.createElement('div', { style: styles.diffCell }, React.createElement('div', { style: styles.name }, '权限变化信号'),
            React.createElement('div', { style: signalLabels.length ? styles.error : styles.muted }, signalLabels.length ? signalLabels.join(' / ') : '未发现'))),
        update.diff.files?.length ? React.createElement('div', { style: { ...styles.detailSection, marginTop: '8px' } },
          update.diff.files.map(file => React.createElement('div', { key: `${file.status}:${file.path}`, style: styles.muted },
            `${file.status} · ${file.path} · +${file.additions} / -${file.deletions}${file.patchComplete ? '' : ' · diff 不完整'}`))) : null,
        React.createElement('div', { style: { ...styles.muted, marginTop: '8px' } }, '只显示受限元数据，不返回或展示源码补丁；风险信号不等于完整安全审计。'))
    }

    function ReviewAdvice({ reason, compact = false, allowDesktopHandoff = true }) {
      const guidance = desktopReviewGuidance(reason)
      if (!guidance) return null
      const shownItems = compact ? guidance.items.slice(0, 2) : guidance.items
      return React.createElement('div', { style: styles.notice, role: 'note' },
        React.createElement('div', { style: styles.name }, '商城审核建议'),
        React.createElement('div', { style: { ...styles.muted, marginTop: '4px' } },
          shownItems.length === 1 ? shownItems[0]
            : React.createElement('ul', { style: { margin: '5px 0 0', paddingInlineStart: '20px' } },
              shownItems.map(item => React.createElement('li', { key: item, style: { marginTop: '3px' } }, item))),
          compact && guidance.items.length > shownItems.length ? ` 另有 ${guidance.items.length - shownItems.length} 项提醒。` : ''),
        React.createElement('div', { style: { ...styles.muted, marginTop: '6px' } },
          allowDesktopHandoff
            ? '这是 DSH Store 的参考提示，不代表 DSH Desktop 已拒绝安装，也不等于插件一定有问题。若本页提供“交由 DSH 检查安装”入口，你确认后可以提交；最终结果以 DSH 官方插件管理器返回为准。'
            : '这是 DSH Store 对候选项目的说明，不代表插件一定有问题；这条候选记录还没有商城安装入口。可在“全部已知插件”中查找可提交给 DSH 官方管理器检查的来源。'),
        React.createElement('details', { style: { marginTop: '6px' } },
          React.createElement('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '查看技术检查详情'),
          React.createElement('div', { style: { ...styles.code, marginTop: '5px', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' } }, guidance.raw)))
    }

    function CandidateCard({ entry }) {
      const titleId = `dsh-store-candidate-${String(entry.id).replaceAll(/[^A-Za-z0-9_-]/g, '-')}`
      const status = entry.status === 'rejected' ? '已拒绝 / 已隔离' : entry.status === 'reviewing' ? '审核中' : '已发现'
      return React.createElement('article', { style: styles.card, role: 'listitem', 'aria-labelledby': titleId },
        React.createElement('div', { style: styles.cardHeader },
          React.createElement('div', { id: titleId, style: styles.name }, entry.name),
          React.createElement(StatusPill, { label: `${status} · 不可安装`, tone: entry.status === 'rejected' ? 'var(--dsw-alias-state-error-primary)' : undefined })),
        React.createElement('div', { style: styles.cardDescription }, entry.description),
        entry.recommendation ? React.createElement('a', { href: entry.recommendation.evidenceUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, '作者互动推荐 · 查看公开交流') : null,
        React.createElement('div', { style: styles.cardTags },
          React.createElement('span', { style: styles.badge }, `发现来源 ${(entry.discoverySources || []).join(' / ') || '未知'}`),
          React.createElement('span', { style: styles.badge }, `审核路径 ${entry.route || '未知'}`)),
        entry.status === 'rejected' ? React.createElement(ReviewAdvice, { reason: entry.statusReason, allowDesktopHandoff: false })
          : React.createElement('div', { style: styles.notice }, '该项目尚未晋升到可信安装目录，不提供安装、更新、启停或卸载操作。'),
        React.createElement('div', { style: styles.cardFooter },
          React.createElement('span', { style: styles.muted }, entry.sourceUpdatedAt ? `源更新 ${new Date(entry.sourceUpdatedAt).toLocaleDateString()}` : `发现于 ${new Date(entry.discoveredAt).toLocaleDateString()}`),
          React.createElement('a', { href: entry.repositoryUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, '查看 GitHub 证据')))
    }

    function MarketCard({ entry, health, beginPlan, checkSource, openDetails, categoryLabels = {}, readOnly = false }) {
      const state = readOnly ? (entry.installed ? `已安装 ${entry.installedVersion || ''}` : 'Desktop 中仅供查看')
        : entry.sourceUpdate?.status === 'update-ready' ? '源更新审核通过'
        : entry.sourceUpdate?.status === 'user-review-required' ? '发现高风险更新 · 用户决定'
          : entry.sourceUpdate?.status === 'external-only' ? '商城禁止更新 · 仅外部入口'
            : entry.sourceUpdate?.status === 'update-blocked' ? '源更新无法验证'
          : ['blocked', 'unlisted'].includes(entry.status) ? '商城不可安装'
        : entry.migrationAvailable ? (entry.updateAvailable ? '可迁移并更新' : '可迁移到商城')
          : entry.manualSourceUpdate ? '同版本源码已更新 · GitHub 手动更新'
          : entry.installed ? (entry.updateAvailable ? '有更新' : `已安装 ${entry.installedVersion || ''}`) : '可安装'
      const origin = entry.installOrigin === 'marketplace-managed' ? '商城安装'
        : entry.installOrigin === 'catalog-source-matched' ? '目录来源匹配 · 渠道未知'
          : entry.installOrigin === 'local-development' ? '本地开发安装'
            : entry.installOrigin === 'external-or-drifted' ? '外部安装 / 来源漂移' : null
      const stateTone = entry.status === 'blocked' ? 'var(--dsw-alias-state-error-primary)'
        : entry.updateAvailable || entry.migrationAvailable || entry.manualSourceUpdate ? 'var(--dsw-alias-label-primary)'
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
        ['blocked', 'unlisted'].includes(entry.status) && entry.statusReason
          ? React.createElement(ReviewAdvice, { reason: entry.statusReason, compact: true }) : null,
        entry.recommendation ? React.createElement('a', { href: entry.recommendation.evidenceUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, '作者互动推荐 · 查看公开交流') : null,
        entry.source.updatedAt ? React.createElement('div', { style: styles.muted },
          `固定提交时间 ${new Date(entry.source.updatedAt).toLocaleDateString()} · ${entry.source.provenance}`) : null,
        React.createElement('div', { style: styles.cardTags },
          React.createElement('span', { style: styles.badge }, `GitHub 发布者 ${githubPublisher(entry.repositoryUrl)}`),
          origin ? React.createElement('span', { style: styles.badge }, origin) : null,
          ...entry.categories.map(id => React.createElement('span', { key: id, style: styles.badge }, categoryLabels[id] || id)),
          Number.isInteger(entry.installCount) ? React.createElement('span', { style: styles.badge }, `累计安装 ${entry.installCount}`) : null),
        React.createElement(AssuranceMatrix, { entry }),
        React.createElement(CompatibilityMatrix, { entry }),
        React.createElement('div', { style: styles.muted }, entry.activation ? `生效状态：${{ live: '运行中', restart: '等待重启', inert: '未加载', broken: '加载失败', missing: '文件缺失', disabled: '已禁用', unknown: '未知' }[entry.activation.status] || '未知'}` : ''),
        entry.risk.installScripts.length > 0
          ? React.createElement('div', { style: styles.error }, `安装脚本：${entry.risk.installScripts.join(', ')}`)
          : null,
        ['user-review-required', 'external-only', 'update-blocked'].includes(entry.sourceUpdate?.status)
          ? React.createElement('div', { style: styles.error }, entry.sourceUpdate.reasons.join('；'))
          : entry.sourceUpdate?.status === 'current'
            ? React.createElement('div', { style: styles.notice }, entry.sourceUpdate.sameVersionSourceChange
              ? (entry.sourceUpdate.catalogReviewed
                ? 'Catalog 已固定同版本的新 Commit；商城不会覆盖已安装副本，请使用下方 GitHub 固定 Commit 手动更新。'
                : '源仓库有尚未进入 Catalog 的同版本提交；等待固定源自动审核，商城不会生成同版本更新计划。')
              : '已在本机按需检查 GitHub 源仓库，当前没有可用的新 Commit。')
            : entry.sourceUpdate?.status === 'error'
              ? React.createElement('div', { style: styles.error }, `${entry.sourceUpdate.code}：${entry.sourceUpdate.message}`)
              : null,
        entry.manualSourceUpdate && !readOnly ? React.createElement('div', { style: styles.notice },
          React.createElement('div', null, entry.manualSourceUpdate.reason),
          React.createElement('div', { style: { ...styles.code, marginTop: '6px', overflowWrap: 'anywhere' } }, entry.manualSourceUpdate.commandText),
          React.createElement('div', { style: { ...styles.muted, marginTop: '6px' } }, '手动更新不受商城计划、备份、健康检查和失败回滚保护。')) : null,
        React.createElement(SourceDiffSummary, { update: entry.sourceUpdate }),
        React.createElement('div', { style: styles.cardFooter },
          React.createElement('div', { style: styles.actions },
            React.createElement(PluginActions, { entry, health, beginPlan, checkSource, readOnly }),
            entry.manualSourceUpdate
              ? React.createElement('a', { href: entry.manualSourceUpdate.evidenceUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, '查看同版本固定 Commit')
              : entry.status === 'blocked' || entry.sourceUpdate?.status === 'external-only'
                ? React.createElement('a', { href: entry.repositoryUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, '查看 GitHub（不受商城保护）')
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

    function PersonalNotes({ entry }) {
      const key = `dsh-safe-plugin-manager:notes:v1:${entry.repositoryUrl}:${entry.packageName}`
      const [value, setValue] = useState(() => { try { const raw = window.localStorage.getItem(key) || '{}'; const parsed = raw.length <= 4096 ? JSON.parse(raw) : {}; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} } catch { return {} } })
      const [error, setError] = useState('')
      const save = next => { setValue(next); try { window.localStorage.setItem(key, JSON.stringify(next)); setError('') } catch { setError('本地保存失败') } }
      return React.createElement('div', { style: styles.detailSection },
        React.createElement(Button, { onClick: () => save({ ...value, favorite: !value.favorite }) }, value.favorite ? '已收藏 · 取消收藏' : '收藏插件'),
        React.createElement('textarea', { 'aria-label': '个人备注', placeholder: '个人备注，仅保存于本机浏览器', maxLength: 1000, value: typeof value.note === 'string' ? value.note : '', onChange: event => save({ ...value, note: event.target.value.slice(0, 1000) }), style: styles.input }),
        error ? React.createElement('div', { role: 'alert' }, error) : null)
    }
    function VerifiedScreenshots({ entry }) {
      const [images, setImages] = useState([])
      useEffect(() => {
        const controller = new AbortController(); const urls = []
        void (async () => {
          for (const shot of (entry.details.screenshots || []).slice(0, 3)) {
            try {
              if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry.repositoryUrl) || !/^[a-f0-9]{40}$/.test(entry.commit)) continue
              if (!/^[A-Za-z0-9_./-]+\.(png|jpg|jpeg|webp)$/.test(shot.path) || shot.path.startsWith('/') || shot.path.split('/').some(part => !part || part === '.' || part === '..')) continue
              const url = entry.repositoryUrl.replace('github.com', 'raw.githubusercontent.com') + '/' + entry.commit + '/' + shot.path
              const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: controller.signal, referrerPolicy: 'no-referrer' })
              if (!response.ok || !/^image\/(png|jpeg|webp)(;|$)/.test(response.headers.get('content-type') || '')) continue
              const reader = response.body.getReader(); const chunks = []; let total = 0
              try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 2 * 1024 * 1024) throw new Error('image too large'); chunks.push(value) } } finally { await reader.cancel() }
              const blob = new Blob(chunks, { type: response.headers.get('content-type') })
              const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('')
              if (digest !== shot.sha256 || controller.signal.aborted) continue
              urls.push(URL.createObjectURL(blob)); setImages([...urls])
            } catch { /* Unverifiable assets remain hidden. */ }
          }
        })()
        return () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)) }
      }, [entry.commit, entry.repositoryUrl])
      return React.createElement('div', null, images.map(url => React.createElement('img', { key: url, src: url, alt: `${entry.name} 插件截图`, style: { maxWidth: '100%' } })))
    }

    function PluginDetailsModal({ entry, categoryLabels, health, beginPlan, close, readOnly = false }) {
      if (!entry) return null
      const permissions = entry.details.permissions
      const status = readOnly ? 'Desktop 中仅供查看'
        : entry.status === 'approved' ? '可安装' : entry.status === 'blocked' ? '商城不可安装' : '已下架'
      const installed = entry.installed ? `已安装 ${entry.installedVersion || '版本未知'}` : '未安装'
      const beginDetailPlan = (action, selectedEntry) => {
        close()
        beginPlan(action, selectedEntry)
      }
      const footer = React.createElement('div', { style: styles.detailFooter },
        React.createElement(PluginActions, { entry, health, beginPlan: beginDetailPlan, readOnly }),
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
          React.createElement('span', { style: styles.badge }, `DSH Desktop 客户端：${desktopClientAdaptationLabel(entry.compatibility.profiles)}`),
          ...(entry.categories || []).map(id => React.createElement('span', { key: id, style: styles.badge }, categoryLabels[id] || id))),
        React.createElement(PersonalNotes, { key: entry.id, entry }),
        React.createElement(VerifiedScreenshots, { key: `${entry.id}:${entry.commit}`, entry }),
        React.createElement('h3', { style: styles.detailHeading }, '基本信息'),
        React.createElement('dl', { style: styles.detailGrid },
          React.createElement(DetailRow, { label: '包名', value: entry.packageName, code: true }),
          React.createElement(DetailRow, { label: '版本', value: entry.version }),
          React.createElement(DetailRow, { label: 'GitHub 发布者', value: githubPublisher(entry.repositoryUrl) }),
          React.createElement(DetailRow, { label: 'DSH Desktop 客户端', value: desktopClientAdaptationLabel(entry.compatibility.profiles) }),
          React.createElement(DetailRow, { label: 'Git Commit', value: entry.commit, code: true }),
          React.createElement(DetailRow, { label: '固定提交时间', value: entry.source.updatedAt ? new Date(entry.source.updatedAt).toLocaleString() : '未知' }),
          React.createElement(DetailRow, { label: '时间证据来源', value: entry.source.provenance }),
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
        React.createElement('h3', { style: styles.detailHeading }, '可信证据（互不替代）'),
        React.createElement(AssuranceMatrix, { entry }),
        React.createElement('div', { style: styles.detailSection }, ASSURANCE_LEVELS.map(([key, label]) => {
          const evidence = entry.assurance[key]
          return React.createElement('div', { key, style: styles.diffCell },
            React.createElement('div', { style: styles.name }, `${label} · ${assuranceStatusLabel(evidence.status)}`),
            React.createElement('div', { style: styles.muted }, [
              evidence.method ? `方法 ${evidence.method}` : null,
              evidence.checkedAt ? `时间 ${new Date(evidence.checkedAt).toLocaleString()}` : null,
              evidence.dshRelease ? `DSH ${evidence.dshRelease}` : null,
            ].filter(Boolean).join(' · ') || '尚无可验证证据'),
            evidence.summary ? React.createElement('div', { style: styles.muted }, evidence.summary) : null,
            evidence.evidenceUrl ? React.createElement('a', { href: evidence.evidenceUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, '打开证据') : null)
        })),
        React.createElement('h3', { style: styles.detailHeading }, '兼容性'),
        React.createElement(CompatibilityMatrix, { entry, all: true }),
        React.createElement('dl', { style: styles.detailGrid },
          React.createElement(DetailRow, { label: 'Node.js', value: entry.compatibility.node || '未声明' }),
          React.createElement(DetailRow, { label: '系统', value: entry.compatibility.systems.length > 0 ? entry.compatibility.systems.join(' / ') : '未声明' }),
          React.createElement(DetailRow, { label: 'Profile', value: entry.compatibility.profiles.length > 0 ? entry.compatibility.profiles.join(' / ') : '未声明' })),
        React.createElement('h3', { style: styles.detailHeading }, 'DSH 版本操作证据'),
        React.createElement(OperationEvidence, { entry }),
        !entry.catalogDetailsAvailable
          ? React.createElement('div', { style: styles.notice }, '当前 GitHub Catalog 详情文件尚未提供完整字段；缺失值按“未知 / 未声明”显示，未使用本地推测数据替代。')
          : null,
        entry.statusReason ? React.createElement(ReviewAdvice, { reason: entry.statusReason }) : null,
        entry.manualSourceUpdate && !readOnly ? React.createElement('div', { style: styles.notice },
          React.createElement('div', { style: styles.name }, '同版本源码更新：仅限 GitHub 手动操作'),
          React.createElement('div', { style: { ...styles.muted, marginTop: '6px' } }, entry.manualSourceUpdate.reason),
          React.createElement('div', { style: { ...styles.code, marginTop: '6px', overflowWrap: 'anywhere' } }, entry.manualSourceUpdate.commandText),
          React.createElement('a', { href: entry.manualSourceUpdate.evidenceUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, '打开 Catalog 固定 Commit'),
          React.createElement('div', { style: { ...styles.muted, marginTop: '6px' } }, '该命令绕过商城事务保护；执行前应自行备份 Profile。')) : null,
        entry.status === 'blocked'
          ? React.createElement('div', { style: styles.notice }, '可前往 GitHub 阅读项目说明并自行决定是否手动安装；手动安装不受本商城的计划、备份、健康检查和失败回滚保护。')
          : null,
        entry.risk.installScripts.length > 0 ? React.createElement('div', { style: styles.error }, `安装生命周期脚本：${entry.risk.installScripts.join(', ')}`) : null,
        React.createElement('div', { style: styles.notice }, '详情来自 GitHub catalog.json 主索引、对应插件详情文件的固定 Commit 核验与声明；自动扫描或作者认证均不等于完成安全审计。')))
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
        .filter(field => typeof permissionValuesForPlugin(permissionDecisions, plugin)[field] !== 'boolean')
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
          onChange: event => setPermissionDecision(plugin.packageName, plugin.permissions?.decisionRevision, field, event.target.value),
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
          React.createElement('div', { style: styles.error }, '权限选择仅保存在此浏览器；插件版本、固定 Commit 或权限声明变化时会失效并要求重新确认，不会修改或限制插件的真实运行权限。')),
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
          const decisions = permissionValuesForPlugin(permissionDecisions, plugin)
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
        const legacyRepairRequired = result.error?.diagnostic?.code === 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED'
        const footer = React.createElement(React.Fragment, null,
          React.createElement(Button, { onClick: cancel }, '完成'),
          result.status === 'applied' && result.restartRequired
            ? React.createElement(Button, { primary: true, onClick: beginRestart }, '一键安全重启 DSH Host') : null)
        return React.createElement(Modal, {
          open: true, onClose: cancel, title: result.status === 'applied' ? '操作已应用' : result.status === 'rolled-back' ? '操作失败，已回滚' : result.status === 'recovery-required' ? '操作失败，需要恢复' : '操作失败',
          closeLabel: '关闭操作结果', footer,
          className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
        }, React.createElement('div', { style: styles.detailSection },
          React.createElement('div', { style: styles.muted }, `事务 ${result.transactionId} · 回滚 ${result.rollback || '不需要'}`),
          result.rollbackDetails ? React.createElement('div', { style: styles.muted },
            `Profile 文件恢复：${result.rollbackDetails.profileFiles} · 依赖恢复：${result.rollbackDetails.dependencies}`) : null,
          result.error ? React.createElement(React.Fragment, null,
            React.createElement('div', { style: styles.error }, `${result.error.code}：${result.error.message}`),
            result.error.diagnostic ? React.createElement('div', { style: styles.notice },
              `${result.error.diagnostic.code}：${result.error.diagnostic.message}`) : null) : null,
          legacyRepairRequired ? React.createElement('div', { style: styles.notice },
            React.createElement('div', { style: styles.name }, '不要放开第三方 prepare 权限，也不要手改 Profile。'),
            React.createElement('div', { style: styles.muted }, '请前往以下任一地址查看官方修复/升级方案：'),
            React.createElement('a', { href: 'https://dsh-store.cn/repair/', target: '_blank', rel: 'noreferrer', style: styles.link }, '国内站修复/升级方案'),
            React.createElement('span', { style: styles.muted }, ' · '),
            React.createElement('a', { href: 'https://ai-scarlett.github.io/DSH-Store/marketplace/repair/', target: '_blank', rel: 'noreferrer', style: styles.link }, 'GitHub Pages 修复/升级方案')) : null,
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
        plan.impact.sourceReview?.warnings?.length > 0 ? React.createElement('div', { style: styles.error },
          React.createElement('div', { style: styles.name }, '本机扫描发现高风险变化，是否更新由你决定'),
          React.createElement('ul', null, plan.impact.sourceReview.warnings.map(item => React.createElement('li', { key: item }, item))),
          React.createElement('div', { style: styles.muted }, '本机静态扫描不是完整安全审计；确认后仍使用固定 Commit、备份、健康检查和失败回滚。')) : null,
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
      const upgrading = operation.value?.action === 'upgrade-guardian'
        || operation.value?.status === 'update-scheduled' || operation.value?.status === 'updated'
      if (operation.status === 'planning' || operation.status === 'executing' || operation.status === 'handoff') return React.createElement(Modal, {
        open: true, onClose: operation.status === 'planning' ? cancel : () => {}, title: upgrading ? '升级 DSH Guardian' : '安装 DSH Guardian',
        footer: null, className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
      }, React.createElement('div', { style: styles.notice }, operation.status === 'planning'
        ? '正在核对 launchd 与守护文件预条件…'
        : operation.status === 'handoff'
          ? upgrading
            ? '独立升级交接器已验证旧 Guardian、Profile 与 Boot ID；正在替换守护并等待新 Guardian 成为唯一启动所有者，页面会自动重新连接。'
            : 'Guardian 已验证，DSH 正在交接，页面会自动重新连接。'
          : upgrading ? '正在生成绑定旧 Guardian、Profile、Boot ID 与文件哈希的一次性交接计划…' : '正在原子安装并验证 Guardian 心跳…'))
      if (operation.status === 'error' || operation.status === 'result') return React.createElement(Modal, {
        open: true, onClose: cancel, title: operation.status === 'result'
          ? upgrading ? 'Guardian 升级交接已启动' : 'Guardian 已安装'
          : upgrading ? 'Guardian 升级失败' : 'Guardian 安装失败',
        footer: React.createElement(Button, { onClick: cancel }, '关闭'), className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
      }, React.createElement('div', { style: operation.status === 'result' ? styles.notice : styles.error },
        operation.status === 'result'
          ? upgrading ? '独立交接器已启动；它会在当前响应结束后升级 Guardian，并在失败时恢复上一版。' : '外部 Guardian 已接管 DSH 启动监督；请等待健康状态变为正常。'
          : `${operation.code || 'GUARDIAN_FAILED'}：${operation.message}`))
      const plan = operation.value
      return React.createElement(Modal, {
        open: true, onClose: cancel, title: upgrading ? '确认升级商城内置 Guardian' : '确认安装商城内置 Guardian',
        description: upgrading
          ? '升级计划绑定当前 Guardian PID、DSH Host PID、Profile、Boot ID 与守护文件哈希；独立交接器会在本次响应结束后执行，失败自动恢复上一版。'
          : 'Guardian 独立于 DSH 运行，并将替换当前 local.dsh.web 启动任务。',
        footer: React.createElement(React.Fragment, null,
          React.createElement(Button, { onClick: cancel }, '取消'),
          React.createElement(Button, { primary: true, danger: true, disabled: confirmation !== plan.confirmation, onClick: execute }, upgrading ? '升级并安全交接' : '安装并接管')),
        className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
      }, React.createElement('div', { style: styles.detailSection },
        React.createElement('div', { style: styles.muted }, `写入：${plan.impact.writes.join('、')}`),
        React.createElement('div', { style: styles.muted }, `永久保护：${plan.impact.neverModifies.join('、')}`),
        plan.impact.activeHandoff ? React.createElement('div', { style: styles.notice },
          `主动交接：Guardian PID ${plan.impact.activeHandoff.guardianPid} · Host PID ${plan.impact.activeHandoff.hostPid} · Boot ID ${plan.impact.activeHandoff.hostBootId}`) : null,
        React.createElement('div', { style: styles.code }, plan.confirmation),
        React.createElement('input', { value: confirmation, onChange: event => setConfirmation(event.target.value), style: styles.input, placeholder: '精确输入确认语' })))
    }

    function OperationHistory({ revision }) {
      const [records, setRecords] = useState([])
      const [error, setError] = useState('')
      useEffect(() => {
        let cancelled = false; let timer
        const refresh = async () => {
          try {
            const value = await readOperations()
            if (!cancelled) { setRecords(value); setError('') }
            if (!cancelled && value.some(row => ['queued', 'running'].includes(row.state))) timer = setTimeout(refresh, 1500)
          } catch (err) { if (!cancelled) setError(err.message) }
        }
        void refresh()
        return () => { cancelled = true; clearTimeout(timer) }
      }, [revision])
      return React.createElement('details', { style: styles.notice },
        React.createElement('summary', null, '操作记录与恢复状态'),
        error ? React.createElement('div', { role: 'alert' }, error) : null,
        records.slice(0, 12).map(row => React.createElement('div', { key: row.id },
          `${row.packageName} · ${{ queued: '等待执行', running: '执行及健康检查中', succeeded: '已完成', failed: '失败', 'rolled-back': '已回滚', 'recovery-required': '需要恢复' }[row.state]} · ${row.createdAt}`)))
    }

    const DESKTOP_CATALOG_URL = 'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/catalog.json'
    const DESKTOP_CATALOG_PAGES_URL = 'https://ai-scarlett.github.io/DSH-Store/registry/catalog.json'
    const DESKTOP_CATALOG_SOURCES = [
      { id: 'github-raw', url: DESKTOP_CATALOG_URL },
      { id: 'github-pages', url: DESKTOP_CATALOG_PAGES_URL },
    ]
    const DESKTOP_CATALOG_MAX_BYTES = 4 * 1024 * 1024
    const DESKTOP_CATALOG_MAX_ENTRIES = 2_000
    const DESKTOP_CATALOG_TIMEOUT_MS = 12_000
    const DESKTOP_CATALOG_INDEX_MAX_BYTES = 2 * 1024 * 1024
    const DESKTOP_DISCOVERY_MAX_BYTES = 12 * 1024 * 1024
    const DESKTOP_DISCOVERY_MAX_RECORDS = 50_000
    const DESKTOP_DISCOVERY_TIMEOUT_MS = 45_000
    const DESKTOP_CANDIDATE_MAX_BYTES = 5 * 1024 * 1024
    const DESKTOP_CANDIDATE_MAX_RECORDS = 20_000
    const DESKTOP_RANKING_MAX_BYTES = 2 * 1024 * 1024
    const DESKTOP_RANKING_INDEX_MAX_BYTES = 256 * 1024
    const DESKTOP_RANKING_MAX_RECORDS = 10_000
    const DESKTOP_RANKING_PAGE_SIZE = 30
    const DESKTOP_DIRECTORY_SOURCES = {
      catalogIndex: [
        { url: 'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/catalog-index.json', host: 'raw.githubusercontent.com', path: '/AI-Scarlett/DSH-Store/main/registry/catalog-index.json' },
        { url: 'https://ai-scarlett.github.io/DSH-Store/registry/catalog-index.json', host: 'ai-scarlett.github.io', path: '/DSH-Store/registry/catalog-index.json' },
      ],
      discovery: [
        { url: 'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/discovery-index.json', host: 'raw.githubusercontent.com', path: '/AI-Scarlett/DSH-Store/main/registry/discovery-index.json' },
        { url: 'https://ai-scarlett.github.io/DSH-Store/registry/discovery-index.json', host: 'ai-scarlett.github.io', path: '/DSH-Store/registry/discovery-index.json' },
      ],
      candidates: [
        { url: 'https://raw.githubusercontent.com/AI-Scarlett/DSH-Store/main/registry/candidates.json', host: 'raw.githubusercontent.com', path: '/AI-Scarlett/DSH-Store/main/registry/candidates.json' },
        { url: 'https://ai-scarlett.github.io/DSH-Store/registry/candidates.json', host: 'ai-scarlett.github.io', path: '/DSH-Store/registry/candidates.json' },
      ],
      rankings: [{
        index: { url: 'https://ai-scarlett.github.io/DSH-Store/marketplace/rankings/index.html', host: 'ai-scarlett.github.io', path: '/DSH-Store/marketplace/rankings/index.html' },
        data: { url: 'https://ai-scarlett.github.io/DSH-Store/marketplace/rankings/data.json', host: 'ai-scarlett.github.io', path: '/DSH-Store/marketplace/rankings/data.json' },
      }],
    }
    const DESKTOP_DISCOVERY_CATEGORY_LABELS = {
      ai: 'AI 与智能体', audio: '音频', automation: '自动化', browser: '浏览器', 'code-review': '代码审查',
      content: '内容创作', creator: '创作工具', data: '数据', database: '数据库', desktop: '桌面端',
      developer: '开发工具', file: '文件处理', finance: '金融', game: '游戏与娱乐', git: 'Git 工具',
      github: 'GitHub 集成', knowledge: '知识管理', launcher: '启动器', markdown: 'Markdown', mcp: 'MCP 集成',
      media: '媒体', memory: '记忆', network: '网络', notification: '通知', notify: '通知', ocr: 'OCR',
      office: '办公', pdf: 'PDF', productivity: '效率工具', proxy: '代理', scheduler: '定时任务', search: '搜索',
      security: '安全与隐私', 'skin-theme': '主题外观', spreadsheet: '表格', storage: '存储', telegram: 'Telegram 集成',
      terminal: '终端', ui: '界面增强', uncategorized: '未分类', video: '视频', vision: '视觉', web: 'Web',
      'web-search': '网络搜索', agent: '智能体', 'agent-orchestration': '智能体编排',
    }
    const DESKTOP_OPERATION_TIMEOUT_MS = 90_000
    const DESKTOP_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
    const DESKTOP_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
    const DESKTOP_COMMIT = /^[0-9a-f]{40}$/
    const DESKTOP_INSTALL_SCRIPTS = new Set(['preinstall', 'install', 'postinstall', 'prepare'])
    const DESKTOP_PROTECTED_ENTRY_IDS = new Set(['ui-settings-plugin-inventory', 'dsh-safe-plugin-manager'])
    const DESKTOP_LEGACY_RELEASES = { 'rc.7': '0.1.0-rc.7', 'rc.8': '0.1.0-rc.8' }
    let desktopPluginManager = null
    const desktopPluginManagerWaiters = new Set()

    function setDesktopPluginManager(service) {
      desktopPluginManager = service
      for (const resolve of desktopPluginManagerWaiters) resolve(service)
      desktopPluginManagerWaiters.clear()
    }

    function waitForDesktopPluginManager(timeoutMs = 10_000) {
      if (desktopPluginManager) return Promise.resolve(desktopPluginManager)
      return new Promise(resolve => {
        let settled = false
        const finish = value => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          desktopPluginManagerWaiters.delete(finish)
          resolve(value)
        }
        const timer = window.setTimeout(() => finish(null), timeoutMs)
        desktopPluginManagerWaiters.add(finish)
      })
    }

    function unwrapDesktopRemote(result, code = 'DESKTOP_REMOTE_FAILED') {
      if (result && typeof result === 'object' && Object.hasOwn(result, 'ok')) {
        if (!result.ok) {
          const error = new Error(code)
          error.code = result.error?.code || code
          error.reason = desktopManagerReason(result.error)
          throw error
        }
        return result.value
      }
      return result
    }

    function desktopSafeReasonText(value, limit = 320) {
      if (typeof value !== 'string') return null
      const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
      return normalized ? normalized.slice(0, limit) : null
    }

    function desktopReviewGuidance(value) {
      const raw = desktopSafeReasonText(value, 2_000)
      if (!raw) return null
      const source = raw.replace(/^Automatic policy blocked installation:\s*/i, '')
        .replace(/^Fixed-source recheck blocked installation:\s*/i, '')
        .replace(/^DSH_LATEST_THREE_COMPATIBILITY_HOLD:\s*/i, '')
      const items = []
      const add = (pattern, message) => { if (pattern.test(source) && !items.includes(message)) items.push(message) }
      add(/files permission signal|filesystem permission signal/i, '插件可能会读取或修改本机文件；请确认它确实需要访问这些文件。')
      add(/network permission signal/i, '插件会连接网络；请确认它访问的服务和用途符合你的预期。')
      add(/commands permission signal|command execution permission signal/i, '插件可能会运行系统命令；这会带来比普通界面插件更多的本机操作。')
      add(/credentials permission signal|credential permission signal/i, '插件可能会接触登录凭证、密钥或令牌；请确认来源可信并了解它为什么需要这些信息。')
      add(/nativeorexecutableartifacts permission signal|native or executable artifacts/i, '安装包包含可执行程序；商城不能只靠文本源码完整判断它运行时会做什么。')
      add(/protecteddsh permission signal|protected dsh|@deepseek-ai namespace/i, '检查发现它可能触及 DSH 官方组件或核心功能；商城不会管理这类修改。')
      const lifecycle = /install lifecycle scripts are present:\s*([^;]+)/i.exec(source)
      if (lifecycle) items.push(`安装或更新时会自动运行脚本（${lifecycle[1]}）；建议先查看仓库里的脚本内容。`)
      add(/runtime or optional dependencies require|runtime dependencies do not have one unambiguous fixed lockfile/i,
        '插件还需要安装其他软件包；商城尚未核实完整依赖来源或具体版本。')
      add(/fixed-source scan is incomplete|unobserved capability signals are unknown|source metadata exceeds|source exceeds the automatic review|tree exceeds the automatic review bound|scanner budget/i,
        '商城没能检查完整源码，因此还不能确认它会访问哪些文件、网络或系统功能。')
      add(/fixed-source security warnings require review|security findings require quarantine|dynamic module loading|code evaluation/i,
        '自动检查发现需要人工确认的代码执行方式；这不等于已经判定有害，但商城还不能完成审核。')
      add(/dsh compatibility is not explicitly declared|latest .* releases need rechecking|range-only or unknown compatibility|no compatible result/i,
        '作者没有提供商城可核对的当前 DSH 版本兼容说明；安装是否适合你的环境由 DSH Desktop 再检查。')
      add(/node(?:\.js)? compatibility is not explicitly declared/i,
        '项目没有说明支持哪些 Node.js 版本；DSH Desktop 会按当前环境继续检查。')
      add(/manifest repository does not match the canonical github repository|manifest and github repository metadata conflict/i,
        '插件清单登记的 GitHub 地址和当前仓库信息对不上；请先确认这是正确的项目来源。')
      add(/license metadata|license evidence|license does not match|license.*noassertion/i,
        '项目的许可证信息缺失或互相不一致；商城暂时无法确认这份代码的使用许可。')
      add(/runtime artifact is missing|local module is missing|artifact pattern has targets outside/i,
        '安装清单需要的文件没有在发布源码中找到，或引用路径对不上；安装后可能缺少运行所需文件。')
      add(/no package\.json declaring dsh\.bundle\.patch|no unambiguous standard dsh bundle|bundle patch contract is invalid/i,
        '商城没有找到清晰有效的 DSH 插件安装配置；它可能不是 DSH 插件，或仓库还没准备好安装文件。')
      add(/multiple dsh plugins|multiple package manifests|more than .* package manifests|set plugin path/i,
        '仓库里有多个插件或安装目录，当前无法确定你想安装哪一个。')
      add(/package ignore rules|unsupported artifacts|package contains symbolic links|package contains git submodules/i,
        '仓库含有商城无法自动核对的发布文件或打包规则，需要进一步确认实际安装内容。')
      add(/manifest does not declare an explicit distributable files list|files selectors are unsupported or ambiguous/i,
        '插件没有清楚列出要发布的安装文件，商城无法确认最终安装包是否完整。')
      add(/external discovery signal only|fixed-source catalog review required/i,
        '商城只在公开目录里发现了这个项目，还没有完成对固定源码版本的审核。')
      add(/store review is still pending|review is pending|awaiting (?:a |the )?review|pending review/i,
        'DSH Store 还没有完成这项来源的收录审核；你仍可确认 GitHub 来源后交给 DSH Desktop 检查。')
      add(/not listed|not in (?:the )?catalog|discovery.only|not approved for the catalog/i,
        'DSH Store 目前没有这项插件的已收录记录；确认 GitHub 来源后，仍可交给 DSH Desktop 检查安装。')
      if (!items.length) items.push('商城检查尚未通过，但这条原因还没有对应的简明解释；可展开查看原始检查记录。')
      return { raw, items }
    }

    function desktopIncompatibilityReason(records) {
      if (!Array.isArray(records)) return null
      const rows = records.slice(0, 5).map(record => {
        if (!record || typeof record !== 'object') return null
        const name = desktopSafeReasonText(record.name, 120)
        const version = desktopSafeReasonText(record.version, 80)
        const runtime = desktopSafeReasonText(record.runtimeVersion, 80)
        const requirements = record.requirements && typeof record.requirements === 'object' && !Array.isArray(record.requirements)
          ? Object.entries(record.requirements).slice(0, 8).map(([key, value]) => {
            if (!/^[A-Za-z0-9@/._-]{1,120}$/.test(key)) return null
            const requirement = desktopSafeReasonText(value, 120)
            return requirement ? `${key}=${requirement}` : null
          }).filter(Boolean) : []
        const identity = name ? `${name}${version ? `@${version}` : ''}` : '插件'
        return `${identity}${runtime ? ` · DSH ${runtime}` : ''}${requirements.length ? ` · 未满足 ${requirements.join(', ')}` : ''}`
      }).filter(Boolean)
      return rows.length ? 'DSH 官方兼容性校验拒绝：' + rows.join('；') : null
    }

    function desktopManagerReason(value) {
      const failure = value?.error && typeof value.error === 'object' ? value.error : value
      const incompatibility = desktopIncompatibilityReason(failure?.incompatible ?? value?.packageResult?.incompatible)
      if (incompatibility) return incompatibility
      const code = desktopErrorCode(failure)
      return `DSH Desktop 官方插件管理器拒绝，错误码：${code}。`
    }

    function desktopOperationError(outcome, fallbackCode) {
      const error = desktopFailure(desktopErrorCode(outcome?.error || outcome || { code: fallbackCode }))
      if (outcome?.error || outcome?.problem || outcome?.packageResult?.incompatible) {
        error.reason = desktopManagerReason(outcome)
      }
      return error
    }

    function desktopOperationSucceeded(outcome) {
      return Boolean(outcome && ['applied', 'restart-required'].includes(outcome.application))
    }

    function validateDesktopInstallEntry(entry, index, categoryLabels = {}) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`CATALOG_ENTRY_${index}_INVALID`)
      if (!['approved', 'blocked', 'unlisted'].includes(entry.status)) throw new Error(`CATALOG_ENTRY_${index}_STATUS_INVALID`)
      if (entry.status === 'unlisted') {
        const id = typeof entry.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(entry.id) ? entry.id : null
        const name = typeof entry.name === 'string' && entry.name.trim().length <= 160 ? entry.name.trim() : null
        if (!id || !name) return null
        const packageName = typeof entry.packageName === 'string' && DESKTOP_PACKAGE_NAME.test(entry.packageName)
          && !entry.packageName.includes('..') ? entry.packageName : ''
        const repositoryUrl = desktopSafeRepositoryUrl(entry.repositoryUrl) ? entry.repositoryUrl || '' : ''
        const safeCategories = Array.isArray(entry.categories)
          ? entry.categories.filter(id => typeof id === 'string' && Object.hasOwn(categoryLabels, id)).slice(0, 32) : []
        const safeSearchTerms = Array.isArray(entry.searchTerms)
          ? entry.searchTerms.filter(term => typeof term === 'string' && term.length <= 160).slice(0, 64) : []
        const sourceDetails = entry.details && typeof entry.details === 'object' ? entry.details : {}
        const sourcePermissions = sourceDetails.permissions && typeof sourceDetails.permissions === 'object' ? sourceDetails.permissions : {}
        const statusReason = typeof entry.statusReason === 'string' && entry.statusReason.trim()
          ? entry.statusReason.trim().slice(0, 2_000) : 'Catalog 当前未上架此条目。'
        return {
          id, name, description: typeof entry.description === 'string' ? entry.description.slice(0, 2_000) : '',
          packageName, repositoryUrl, version: typeof entry.version === 'string' && DESKTOP_VERSION.test(entry.version) ? entry.version : '未知版本',
          commit: typeof entry.commit === 'string' && DESKTOP_COMMIT.test(entry.commit) ? entry.commit : '',
          categories: safeCategories, searchTerms: safeSearchTerms, status: 'unlisted', statusReason,
          compatibility: { profiles: Array.isArray(entry.compatibility?.profiles)
            ? entry.compatibility.profiles.filter(profile => typeof profile === 'string').slice(0, 32) : [] },
          details: {
            license: typeof sourceDetails.license === 'string' && sourceDetails.license.trim() ? sourceDetails.license.slice(0, 128) : '未知',
            externalDependencies: Array.isArray(sourceDetails.externalDependencies)
              ? sourceDetails.externalDependencies.filter(value => typeof value === 'string').slice(0, 64) : [],
            permissions: {
              level: ['low', 'medium', 'high', 'unknown'].includes(sourcePermissions.level) ? sourcePermissions.level : 'unknown',
              files: ['none', 'read-only', 'write', 'unknown'].includes(sourcePermissions.files) ? sourcePermissions.files : 'unknown',
              network: ['none', 'specified-services', 'any', 'unknown'].includes(sourcePermissions.network) ? sourcePermissions.network : 'unknown',
              commands: ['none', 'restricted', 'shell', 'unknown'].includes(sourcePermissions.commands) ? sourcePermissions.commands : 'unknown',
              credentials: Array.isArray(sourcePermissions.credentials)
                ? sourcePermissions.credentials.filter(value => typeof value === 'string').slice(0, 32) : ['unknown'],
            },
          },
          risk: { installScripts: Array.isArray(entry.risk?.installScripts)
            ? entry.risk.installScripts.filter(script => DESKTOP_INSTALL_SCRIPTS.has(script)) : [] },
        }
      }
      if (entry.status === 'blocked') {
        const id = typeof entry.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(entry.id) ? entry.id : null
        const packageName = typeof entry.packageName === 'string' && DESKTOP_PACKAGE_NAME.test(entry.packageName)
          && !entry.packageName.includes('..') ? entry.packageName : null
        const name = typeof entry.name === 'string' && entry.name.trim().length <= 160 ? entry.name.trim() : null
        if (!id || !packageName || !name) return null
        const safeCategories = Array.isArray(entry.categories)
          ? entry.categories.filter(id => typeof id === 'string' && Object.hasOwn(categoryLabels, id)).slice(0, 32) : []
        const safeSearchTerms = Array.isArray(entry.searchTerms)
          ? entry.searchTerms.filter(term => typeof term === 'string' && term.length <= 160).slice(0, 64) : []
        const sourceCompatibility = entry.compatibility && typeof entry.compatibility === 'object' && !Array.isArray(entry.compatibility)
          ? entry.compatibility : {}
        const sourcePermissions = entry.details?.permissions && typeof entry.details.permissions === 'object'
          ? entry.details.permissions : {}
        const enumValue = (value, allowed) => allowed.includes(value) ? value : 'unknown'
        const repositoryUrl = typeof entry.repositoryUrl === 'string' && entry.repositoryUrl.length <= 512 ? entry.repositoryUrl : ''
        const commit = typeof entry.commit === 'string' && DESKTOP_COMMIT.test(entry.commit) ? entry.commit : ''
        const version = typeof entry.version === 'string' && DESKTOP_VERSION.test(entry.version) ? entry.version : '未知版本'
        const statusReason = typeof entry.statusReason === 'string' && entry.statusReason.trim()
          ? entry.statusReason.trim().slice(0, 2_000) : 'Catalog 将此条目标记为 blocked；当前仅展示来源与审核信息。'
        return {
          ...entry,
          id, name,
          description: typeof entry.description === 'string' ? entry.description.slice(0, 2_000) : '',
          packageName, repositoryUrl, commit, version, categories: safeCategories, searchTerms: safeSearchTerms,
          statusReason,
          source: entry.source && typeof entry.source === 'object' ? entry.source : {},
          compatibility: {
            ...sourceCompatibility,
            profiles: Array.isArray(sourceCompatibility.profiles)
              ? sourceCompatibility.profiles.filter(profile => typeof profile === 'string').slice(0, 32) : [],
            dshReleases: sourceCompatibility.dshReleases && typeof sourceCompatibility.dshReleases === 'object'
              && !Array.isArray(sourceCompatibility.dshReleases) ? sourceCompatibility.dshReleases : {},
          },
          details: {
            ...(entry.details && typeof entry.details === 'object' ? entry.details : {}),
            license: typeof entry.details?.license === 'string' && entry.details.license.trim() ? entry.details.license.slice(0, 128) : '未知',
            externalDependencies: Array.isArray(entry.details?.externalDependencies)
              ? entry.details.externalDependencies.filter(value => typeof value === 'string').slice(0, 64) : [],
            permissions: {
              level: enumValue(sourcePermissions.level, ['low', 'medium', 'high', 'unknown']),
              files: enumValue(sourcePermissions.files, ['none', 'read-only', 'write', 'unknown']),
              network: enumValue(sourcePermissions.network, ['none', 'specified-services', 'any', 'unknown']),
              commands: enumValue(sourcePermissions.commands, ['none', 'restricted', 'shell', 'unknown']),
              credentials: Array.isArray(sourcePermissions.credentials)
                ? sourcePermissions.credentials.filter(value => typeof value === 'string').slice(0, 32) : ['unknown'],
            },
          },
          risk: {
            ...(entry.risk && typeof entry.risk === 'object' ? entry.risk : {}),
            installScripts: Array.isArray(entry.risk?.installScripts)
              ? entry.risk.installScripts.filter(script => DESKTOP_INSTALL_SCRIPTS.has(script)) : [],
          },
        }
      }
      if (typeof entry.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(entry.id)) throw new Error(`CATALOG_ENTRY_${index}_ID_INVALID`)
      if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 160) throw new Error(`CATALOG_ENTRY_${index}_NAME_INVALID`)
      if (typeof entry.description !== 'string' || !entry.description.trim() || entry.description.length > 2_000) throw new Error(`CATALOG_ENTRY_${index}_DESCRIPTION_INVALID`)
      if (typeof entry.packageName !== 'string' || !DESKTOP_PACKAGE_NAME.test(entry.packageName) || entry.packageName.includes('..')) throw new Error(`CATALOG_ENTRY_${index}_PACKAGE_INVALID`)
      if (typeof entry.repositoryUrl !== 'string' || !/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(entry.repositoryUrl)) throw new Error(`CATALOG_ENTRY_${index}_REPOSITORY_INVALID`)
      if (typeof entry.commit !== 'string' || !DESKTOP_COMMIT.test(entry.commit)) throw new Error(`CATALOG_ENTRY_${index}_COMMIT_INVALID`)
      if (typeof entry.version !== 'string' || !DESKTOP_VERSION.test(entry.version)) throw new Error(`CATALOG_ENTRY_${index}_VERSION_INVALID`)
      if (!entry.source || entry.source.provenance !== 'github-commit' || !Number.isFinite(Date.parse(entry.source.updatedAt))) throw new Error(`CATALOG_ENTRY_${index}_SOURCE_INVALID`)
      const installPath = entry.installPath == null ? null : entry.installPath
      const manifestPath = entry.manifestPath ?? 'package.json'
      const validPath = value => typeof value === 'string' && value.length <= 160 && !value.startsWith('/')
        && value.split('/').every(part => /^[\p{L}\p{N}@._+-]+$/u.test(part) && part !== '.' && part !== '..')
      if (installPath !== null && !validPath(installPath)) throw new Error(`CATALOG_ENTRY_${index}_INSTALL_PATH_INVALID`)
      if (installPath ? manifestPath !== `${installPath}/package.json` : manifestPath !== 'package.json') throw new Error(`CATALOG_ENTRY_${index}_MANIFEST_PATH_INVALID`)
      if (!Array.isArray(entry.categories) || entry.categories.length > 32
        || entry.categories.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id))) throw new Error(`CATALOG_ENTRY_${index}_CATEGORIES_INVALID`)
      if (entry.searchTerms !== undefined && (!Array.isArray(entry.searchTerms) || entry.searchTerms.length > 64
        || entry.searchTerms.some(term => typeof term !== 'string' || term.length > 160))) throw new Error(`CATALOG_ENTRY_${index}_SEARCH_TERMS_INVALID`)
      if (!Array.isArray(entry.entryIds) || entry.entryIds.length === 0 || entry.entryIds.length > 64
        || entry.entryIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id))) throw new Error(`CATALOG_ENTRY_${index}_ENTRY_IDS_INVALID`)
      if (!entry.compatibility || typeof entry.compatibility !== 'object' || Array.isArray(entry.compatibility)
        || !entry.compatibility.dshReleases || typeof entry.compatibility.dshReleases !== 'object' || Array.isArray(entry.compatibility.dshReleases)
        || Object.keys(entry.compatibility.dshReleases).length === 0
        || Object.entries(entry.compatibility.dshReleases).some(([release, status]) => release.length > 64
          || !['compatible', 'incompatible', 'unknown'].includes(status))) throw new Error(`CATALOG_ENTRY_${index}_COMPATIBILITY_INVALID`)
      if (!Array.isArray(entry.compatibility.profiles) || entry.compatibility.profiles.length > 32
        || entry.compatibility.profiles.some(profile => typeof profile !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile))
        || new Set(entry.compatibility.profiles).size !== entry.compatibility.profiles.length) {
        throw new Error(`CATALOG_ENTRY_${index}_PROFILES_INVALID`)
      }
      if (!entry.details || typeof entry.details !== 'object' || Array.isArray(entry.details) || !entry.details.permissions
        || typeof entry.details.license !== 'string' || !entry.details.license.trim() || entry.details.license.length > 128
        || !Array.isArray(entry.details.externalDependencies) || entry.details.externalDependencies.length > 64
        || entry.details.externalDependencies.some(value => typeof value !== 'string' || value.length > 160)) throw new Error(`CATALOG_ENTRY_${index}_DETAILS_INVALID`)
      const permissions = entry.details.permissions
      if (!['low', 'medium', 'high', 'unknown'].includes(permissions.level)
        || !['none', 'read-only', 'write', 'unknown'].includes(permissions.files)
        || !['none', 'specified-services', 'any', 'unknown'].includes(permissions.network)
        || !['none', 'restricted', 'shell', 'unknown'].includes(permissions.commands)
        || !Array.isArray(permissions.credentials) || permissions.credentials.length === 0 || permissions.credentials.length > 32
        || permissions.credentials.some(value => typeof value !== 'string' || value.length > 120)) throw new Error(`CATALOG_ENTRY_${index}_PERMISSIONS_INVALID`)
      if (entry.risk !== undefined && (!entry.risk || typeof entry.risk !== 'object' || Array.isArray(entry.risk))) throw new Error(`CATALOG_ENTRY_${index}_RISK_INVALID`)
      const scripts = entry.risk?.installScripts ?? []
      if (!Array.isArray(scripts) || scripts.length > DESKTOP_INSTALL_SCRIPTS.size
        || scripts.some(script => !DESKTOP_INSTALL_SCRIPTS.has(script))) throw new Error(`CATALOG_ENTRY_${index}_SCRIPTS_INVALID`)
      return entry
    }

    function validateDesktopCatalog(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1
        || !value.registry || value.registry.repositoryUrl !== 'https://github.com/AI-Scarlett/DSH-Store'
        || !value.registry.categories || typeof value.registry.categories !== 'object' || Array.isArray(value.registry.categories)
        || Object.keys(value.registry.categories).length > 128
        || Object.entries(value.registry.categories).some(([id, label]) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)
          || typeof label !== 'string' || label.length > 100)
        || !Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > DESKTOP_CATALOG_MAX_ENTRIES) {
        throw new Error('CATALOG_DOCUMENT_INVALID')
      }
      const ids = new Set()
      const packageNames = new Set()
      const entries = []
      const directoryEntries = []
      for (const [index, entry] of value.entries.entries()) {
        const normalized = validateDesktopInstallEntry(entry, index, value.registry.categories)
        if (!normalized) continue
        if (normalized.status !== 'unlisted' && normalized.categories.some(id => !Object.hasOwn(value.registry.categories, id))) throw new Error(`CATALOG_ENTRY_${index}_CATEGORY_UNKNOWN`)
        if (ids.has(normalized.id) || (normalized.packageName && packageNames.has(normalized.packageName))) throw new Error('CATALOG_IDENTITY_DUPLICATE')
        ids.add(normalized.id)
        if (normalized.packageName) packageNames.add(normalized.packageName)
        directoryEntries.push(normalized)
        if (normalized.status !== 'unlisted') entries.push(normalized)
      }
      if (entries.length === 0) throw new Error('CATALOG_HAS_NO_LISTED_ENTRIES')
      return { registry: value.registry, generatedAt: value.generatedAt ?? value.registry.updatedAt ?? null, entries, directoryEntries }
    }

    function desktopFailure(code) {
      return Object.assign(new Error(code), { code })
    }

    function withDesktopTimeout(promise, code, timeoutMs = DESKTOP_CATALOG_TIMEOUT_MS) {
      return new Promise((resolve, reject) => {
        let settled = false
        const timer = window.setTimeout(() => {
          if (settled) return
          settled = true
          reject(desktopFailure(code))
        }, timeoutMs)
        Promise.resolve(promise).then(value => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          resolve(value)
        }, error => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          reject(error)
        })
      })
    }

    async function fetchDesktopCatalogSource(source) {
      let controller = null
      let timeout = null
      try {
        controller = new AbortController()
        timeout = window.setTimeout(() => controller.abort(), DESKTOP_CATALOG_TIMEOUT_MS)
        const response = await fetch(source.url, {
          cache: 'no-store', redirect: 'error', headers: { accept: 'application/json' }, signal: controller.signal,
        })
        if (!response.ok) throw desktopFailure('DESKTOP_CATALOG_HTTP_FAILED')
        if (response.url && response.url !== source.url) throw desktopFailure('DESKTOP_CATALOG_REDIRECT_REFUSED')
        const lengthHeader = response.headers?.get?.('content-length')
        if (typeof lengthHeader === 'string' && /^\d+$/.test(lengthHeader)
          && Number(lengthHeader) > DESKTOP_CATALOG_MAX_BYTES) throw desktopFailure('DESKTOP_CATALOG_TOO_LARGE')
        const reader = response.body?.getReader?.()
        if (!reader) throw desktopFailure('DESKTOP_CATALOG_STREAM_UNAVAILABLE')
        const decoder = new TextDecoder('utf-8', { fatal: true })
        let byteLength = 0
        let raw = ''
        try {
          while (true) {
            let chunk
            try { chunk = await reader.read() } catch (error) {
              if (controller.signal.aborted || error?.name === 'AbortError') throw desktopFailure('DESKTOP_CATALOG_TIMEOUT')
              if (typeof error?.code === 'string') throw error
              throw desktopFailure('DESKTOP_CATALOG_FETCH_FAILED')
            }
            if (chunk.done) break
            if (!(chunk.value instanceof Uint8Array)) throw desktopFailure('DESKTOP_CATALOG_STREAM_INVALID')
            byteLength += chunk.value.byteLength
            if (byteLength > DESKTOP_CATALOG_MAX_BYTES) {
              try { await reader.cancel() } catch {}
              throw desktopFailure('DESKTOP_CATALOG_TOO_LARGE')
            }
            try { raw += decoder.decode(chunk.value, { stream: true }) }
            catch { throw desktopFailure('DESKTOP_CATALOG_ENCODING_INVALID') }
          }
          try { raw += decoder.decode() } catch { throw desktopFailure('DESKTOP_CATALOG_ENCODING_INVALID') }
        } catch (error) {
          if (typeof error?.code === 'string') throw error
          if (controller.signal.aborted || error?.name === 'AbortError') throw desktopFailure('DESKTOP_CATALOG_TIMEOUT')
          throw desktopFailure('DESKTOP_CATALOG_FETCH_FAILED')
        } finally {
          reader.releaseLock?.()
        }
        if (byteLength === 0) throw desktopFailure('DESKTOP_CATALOG_EMPTY')
        try { return JSON.parse(raw) } catch { throw desktopFailure('DESKTOP_CATALOG_JSON_INVALID') }
      } catch (error) {
        if (typeof error?.code === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(error.code)) throw error
        if (controller?.signal?.aborted || error?.name === 'AbortError') throw desktopFailure('DESKTOP_CATALOG_TIMEOUT')
        throw desktopFailure('DESKTOP_CATALOG_FETCH_FAILED')
      } finally {
        if (timeout !== null) window.clearTimeout(timeout)
      }
    }

    async function fetchDesktopCatalogDocument() {
      let lastError = null
      for (const source of DESKTOP_CATALOG_SOURCES) {
        try {
          return { document: await fetchDesktopCatalogSource(source), deliverySource: source.id }
        } catch (error) {
          lastError = error
          if (!['DESKTOP_CATALOG_TIMEOUT', 'DESKTOP_CATALOG_FETCH_FAILED', 'DESKTOP_CATALOG_HTTP_FAILED'].includes(error?.code)) throw error
        }
      }
      throw lastError || desktopFailure('DESKTOP_CATALOG_FETCH_FAILED')
    }

    function desktopExactObjectKeys(value, expected) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const actual = Object.keys(value).sort()
      const wanted = [...expected].sort()
      return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
    }

    function desktopBoundedString(value, min, max) {
      return typeof value === 'string' && value.length >= min && value.length <= max
    }

    function desktopSafeRepositoryUrl(value) {
      if (value === null) return true
      if (!desktopBoundedString(value, 1, 512)) return false
      try {
        const url = new URL(value)
        const parts = url.pathname.split('/').filter(Boolean)
        return url.protocol === 'https:' && url.hostname.toLowerCase() === 'github.com'
          && !url.username && !url.password && !url.search && !url.hash
          && parts.length === 2 && parts.every(part => /^[A-Za-z0-9_.-]+$/.test(part))
          && !parts[1].toLowerCase().endsWith('.git')
          && value === `https://github.com/${parts[0]}/${parts[1]}`
      } catch { return false }
    }

    function validateDesktopDiscoveryIndex(value) {
      if (!desktopExactObjectKeys(value, ['schemaVersion', 'source', 'entries']) || value.schemaVersion !== 1
        || !desktopExactObjectKeys(value.source, ['name', 'url', 'generatedAt', 'recordCount', 'license'])
        || value.source.name !== 'dsh.so public discovery index'
        || value.source.url !== 'https://www.dsh.so/plugins-index.json'
        || typeof value.source.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.source.generatedAt))
        || !desktopExactObjectKeys(value.source.license, ['spdx', 'attribution'])
        || value.source.license.spdx !== 'CC-BY-4.0'
        || value.source.license.attribution !== 'dsh.so — DSH Developer Hub (https://www.dsh.so)'
        || !Array.isArray(value.entries) || value.entries.length === 0
        || value.entries.length > DESKTOP_DISCOVERY_MAX_RECORDS
        || value.source.recordCount !== value.entries.length) throw desktopFailure('DESKTOP_DISCOVERY_SCHEMA_INVALID')
      for (const [index, entry] of value.entries.entries()) {
        if (!desktopExactObjectKeys(entry, ['sourceIndex', 'sourceId', 'alias', 'name', 'description', 'stars', 'categories', 'kind', 'repositoryUrl', 'detailUrl'])
          || entry.sourceIndex !== index
          || !desktopBoundedString(entry.sourceId, 1, 240)
          || !desktopBoundedString(entry.alias, 0, 500)
          || !desktopBoundedString(entry.name, 1, 240)
          || !desktopBoundedString(entry.description, 0, 221)
          || !Number.isSafeInteger(entry.stars) || entry.stars < 0
          || !Array.isArray(entry.categories) || entry.categories.length < 1 || entry.categories.length > 64
          || entry.categories.some(category => !desktopBoundedString(category, 1, 48) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category))
          || new Set(entry.categories).size !== entry.categories.length
          || !desktopBoundedString(entry.kind, 1, 80)
          || !desktopSafeRepositoryUrl(entry.repositoryUrl)
          || !desktopBoundedString(entry.detailUrl, 1, 2_000)) throw desktopFailure(`DESKTOP_DISCOVERY_ENTRY_${index}_INVALID`)
        try {
          const url = new URL(entry.detailUrl)
          if (url.protocol !== 'https:' || url.hostname !== 'www.dsh.so' || !url.pathname.startsWith('/artifact/')
            || !url.pathname.endsWith('/') || url.username || url.password || url.search || url.hash
            || entry.detailUrl !== url.href) throw new Error('invalid detail URL')
        } catch { throw desktopFailure(`DESKTOP_DISCOVERY_ENTRY_${index}_DETAIL_URL_INVALID`) }
      }
      return value
    }

    function validateDesktopCandidateRegistry(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1
        || value.registry?.repositoryUrl !== 'https://github.com/AI-Scarlett/DSH-Store'
        || value.registry?.trustBoundary?.installActionsDisabled !== true
        || value.registry?.trustBoundary?.catalogPromotionRequired !== true
        || value.registry?.trustBoundary?.unknownIsNotVerified !== true
        || !Array.isArray(value.entries) || value.entries.length > DESKTOP_CANDIDATE_MAX_RECORDS) {
        throw desktopFailure('DESKTOP_CANDIDATE_REGISTRY_INVALID')
      }
      for (const [index, entry] of value.entries.entries()) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
          || !desktopBoundedString(entry.id, 1, 240)
          || !desktopBoundedString(entry.name, 1, 240)
          || !desktopBoundedString(entry.description, 0, 2_000)
          || !desktopSafeRepositoryUrl(entry.repositoryUrl)
          || !['discovered', 'reviewing', 'rejected'].includes(entry.status)
          || (entry.latestCommit != null && !DESKTOP_COMMIT.test(entry.latestCommit))
          || !Array.isArray(entry.topics) || entry.topics.length > 64
          || entry.topics.some(topic => !desktopBoundedString(topic, 1, 80))) {
          throw desktopFailure(`DESKTOP_CANDIDATE_ENTRY_${index}_INVALID`)
        }
      }
      return value
    }

    function validateDesktopRankingSnapshot(value) {
      if (!desktopExactObjectKeys(value, ['schemaVersion', 'sourceCommit', 'catalogUpdatedAt', 'candidatesUpdatedAt',
        'starsObservedAt', 'weeklyStarsObservedAt', 'categories', 'entries'])
        || value.schemaVersion !== 4 || !DESKTOP_COMMIT.test(value.sourceCommit || '')
        || !Number.isFinite(Date.parse(value.catalogUpdatedAt))
        || !Array.isArray(value.categories) || value.categories.length === 0 || value.categories.length > 64
        || !Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > DESKTOP_RANKING_MAX_RECORDS) {
        throw desktopFailure('DESKTOP_RANKING_SCHEMA_INVALID')
      }
      for (const key of ['candidatesUpdatedAt', 'starsObservedAt', 'weeklyStarsObservedAt']) {
        if (value[key] !== null && (typeof value[key] !== 'string' || !Number.isFinite(Date.parse(value[key])))) {
          throw desktopFailure(`DESKTOP_RANKING_${key.toUpperCase()}_INVALID`)
        }
      }
      const categoryIds = new Set()
      for (const category of value.categories) {
        if (!desktopExactObjectKeys(category, ['id', 'zh', 'en'])
          || !desktopBoundedString(category.id, 1, 80) || !/^[a-z0-9-]+$/.test(category.id)
          || categoryIds.has(category.id) || !desktopBoundedString(category.zh, 1, 160)
          || !desktopBoundedString(category.en, 1, 160)) throw desktopFailure('DESKTOP_RANKING_CATEGORY_INVALID')
        categoryIds.add(category.id)
      }
      const ids = new Set()
      for (const [index, entry] of value.entries.entries()) {
        const keys = ['id', 'nameZh', 'nameEn', 'version', 'repositoryUrl', 'description', 'categories',
          'listingStatus', 'listingReason', 'source', 'reviewStatus', 'stars', 'weeklyStars',
          'weeklySnapshotMember', 'weeklyCategories']
        const optionalKeys = ['communityRecommendation', 'featured', 'order']
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
          || keys.some(key => !Object.hasOwn(entry, key))
          || Object.keys(entry).some(key => !keys.includes(key) && !optionalKeys.includes(key))
          || !desktopBoundedString(entry.id, 1, 240) || ids.has(entry.id)
          || !desktopBoundedString(entry.nameZh, 1, 240) || !desktopBoundedString(entry.nameEn, 1, 240)
          || !desktopBoundedString(entry.version, 0, 120) || !desktopSafeRepositoryUrl(entry.repositoryUrl)
          || !desktopBoundedString(entry.description, 0, 256)
          || !Array.isArray(entry.categories) || entry.categories.some(id => !categoryIds.has(id))
          || !['listed', 'not-listed'].includes(entry.listingStatus)
          || (entry.listingStatus === 'listed'
            ? entry.listingReason !== null || entry.source !== 'catalog' || entry.reviewStatus !== 'approved'
            : !desktopBoundedString(entry.listingReason, 1, 600))
          || !['catalog', 'candidate'].includes(entry.source)
          || !(entry.source === 'catalog' ? ['approved', 'blocked', 'unlisted'] : ['discovered', 'reviewing', 'rejected']).includes(entry.reviewStatus)
          || (entry.source === 'candidate' && entry.featured === true)
          || (entry.featured !== undefined && typeof entry.featured !== 'boolean')
          || (entry.order !== undefined && (!Number.isSafeInteger(entry.order) || entry.order < 0))
          || (entry.stars !== null && (!Number.isSafeInteger(entry.stars) || entry.stars < 0 || value.starsObservedAt === null))
          || (entry.weeklyStars !== null && (!Number.isSafeInteger(entry.weeklyStars) || entry.weeklyStars < 0 || value.weeklyStarsObservedAt === null))
          || typeof entry.weeklySnapshotMember !== 'boolean'
          || !Array.isArray(entry.weeklyCategories) || entry.weeklyCategories.some(id => !categoryIds.has(id))
          || (!entry.weeklySnapshotMember && (entry.weeklyStars !== null || entry.weeklyCategories.length > 0))) {
          throw desktopFailure(`DESKTOP_RANKING_ENTRY_${index}_INVALID`)
        }
        if (entry.communityRecommendation !== undefined) {
          const recommendation = entry.communityRecommendation
          if (!desktopExactObjectKeys(recommendation, ['basis', 'evidenceUrl', 'occurredAt'])
            || recommendation.basis !== 'author-interaction'
            || !/^https:\/\/github\.com\/AI-Scarlett\/DSH-Store\/(?:issues|pull)\/\d+(?:#issuecomment-\d+)?$/.test(recommendation.evidenceUrl)
            || !Number.isFinite(Date.parse(recommendation.occurredAt))) throw desktopFailure(`DESKTOP_RANKING_ENTRY_${index}_RECOMMENDATION_INVALID`)
        }
        ids.add(entry.id)
      }
      return value
    }

    function desktopRankingEntries(data, type) {
      const validStars = value => Number.isSafeInteger(value) && value >= 0
      const compareId = (left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0
      const compareStars = (left, right) => right.stars - left.stars || compareId(left, right)
      const scoreField = type === 'recommended' || type === 'essential' ? 'weeklyStars' : null
      if (!scoreField || !['recommended', 'essential'].includes(type)) return []
      const known = data.entries.filter(entry => validStars(entry[scoreField]))
        .map(entry => ({ ...entry, stars: entry[scoreField] })).sort(compareStars)
      const officialRepositories = [
        'https://github.com/AI-Scarlett/DSH-Store',
        'https://github.com/AI-Scarlett/build-dsh-plugin',
      ]
      const isOfficial = entry => officialRepositories.some(url => url.toLowerCase() === entry.repositoryUrl.toLowerCase())
      const withOfficialSlots = (rows, limit = DESKTOP_RANKING_PAGE_SIZE) => {
        const seen = new Set()
        const official = []
        for (const repositoryUrl of officialRepositories) {
          const source = rows.find(entry => entry.repositoryUrl.toLowerCase() === repositoryUrl.toLowerCase())
            || data.entries.find(entry => entry.repositoryUrl.toLowerCase() === repositoryUrl.toLowerCase())
          if (!source || ['blocked', 'rejected'].includes(source.reviewStatus) || seen.has(source.id)) continue
          seen.add(source.id)
          const entry = { ...source, officialToolPick: true,
            stars: validStars(source.weeklyStars) ? source.weeklyStars : null }
          if (type === 'recommended') entry.recommendationKind = 'official-tool'
          else entry.wins = Array.isArray(source.wins) ? source.wins : []
          official.push(entry)
        }
        if (!official.length) return rows.slice(0, limit)
        const seedDate = data.weeklyStarsObservedAt || 'weekly-snapshot-unavailable'
        let randomState = 2166136261
        for (const character of `${seedDate}:${type}:official-dsh-tools`) {
          randomState = Math.imul(randomState ^ character.charCodeAt(0), 16777619)
        }
        if (randomState === 0) randomState = 0x6d2b79f5
        const random = () => {
          randomState = (randomState + 0x6d2b79f5) | 0
          let value = randomState
          value = Math.imul(value ^ (value >>> 15), value | 1)
          value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
          return ((value ^ (value >>> 14)) >>> 0) / 4294967296
        }
        const ordinary = rows.filter(entry => !isOfficial(entry)).slice(0, limit - official.length)
        const total = ordinary.length + official.length
        const windowSize = Math.min(10, total)
        const slots = Array.from({ length: windowSize }, (_, index) => index)
        for (let index = slots.length - 1; index > 0; index--) {
          const other = Math.floor(random() * (index + 1))
          ;[slots[index], slots[other]] = [slots[other], slots[index]]
        }
        const output = new Array(windowSize)
        official.forEach((entry, index) => { output[slots[index]] = entry })
        let nextOrdinary = 0
        for (let index = 0; index < output.length; index++) if (!output[index]) output[index] = ordinary[nextOrdinary++]
        return [...output, ...ordinary.slice(nextOrdinary)]
      }

      if (type === 'recommended') {
        const communityPicks = known.filter(entry => entry.stars > 0 && !['rejected', 'blocked'].includes(entry.reviewStatus))
          .map(entry => ({ ...entry, recommendationKind: 'community-stars' }))
        const interactions = data.entries.filter(entry => entry.communityRecommendation)
          .sort((left, right) => Date.parse(right.communityRecommendation.occurredAt) - Date.parse(left.communityRecommendation.occurredAt)
            || compareId(left, right))
          .map(entry => ({ ...entry, stars: entry.weeklyStars, recommendationKind: 'author-interaction' }))
        if (!interactions.length) return withOfficialSlots(communityPicks)
        const interactionIds = new Set(interactions.map(entry => entry.id))
        const regular = communityPicks.filter(entry => !interactionIds.has(entry.id)).slice(0, DESKTOP_RANKING_PAGE_SIZE)
        return withOfficialSlots([...interactions, ...regular],
          Math.max(DESKTOP_RANKING_PAGE_SIZE, interactions.length + regular.length + 2))
      }

      const winners = new Map()
      for (const category of data.categories) {
        const members = data.entries.filter(entry => entry.weeklySnapshotMember
          && entry.weeklyCategories.includes(category.id) && !['rejected', 'blocked'].includes(entry.reviewStatus))
        if (!members.length || members.some(entry => !validStars(entry.weeklyStars))) continue
        const eligible = known.filter(entry => entry.weeklySnapshotMember && entry.weeklyCategories.includes(category.id)
          && !['rejected', 'blocked'].includes(entry.reviewStatus))
        const winner = eligible[0]
        if (!winner) continue
        if (!winners.has(winner.id)) winners.set(winner.id, { ...winner, wins: [] })
        winners.get(winner.id).wins.push({ ...category, tied: eligible.filter(entry => entry.stars === winner.stars).length > 1 })
      }
      const result = [...winners.values()].sort(compareStars)
      const selected = new Set(result.map(entry => entry.id))
      const categoryMembers = data.categories.map(category => {
        const snapshotMembers = data.entries.filter(entry => entry.weeklySnapshotMember && entry.weeklyCategories.includes(category.id)
          && !['rejected', 'blocked'].includes(entry.reviewStatus))
        return {
          category,
          members: known.filter(entry => entry.weeklySnapshotMember && entry.weeklyCategories.includes(category.id)
            && !['rejected', 'blocked'].includes(entry.reviewStatus)),
          unknownStars: snapshotMembers.filter(entry => !validStars(entry.weeklyStars)).length,
        }
      })
      for (let rank = 0; rank < known.length && result.length < DESKTOP_RANKING_PAGE_SIZE; rank++) {
        let any = false
        for (const { category, members, unknownStars } of categoryMembers) {
          const entry = members[rank]
          if (!entry) continue
          any = true
          if (result.length >= DESKTOP_RANKING_PAGE_SIZE) break
          if (selected.has(entry.id) || entry.stars === 0 || ['rejected', 'blocked'].includes(entry.reviewStatus)) continue
          selected.add(entry.id)
          result.push({ ...entry, wins: [], categoryPick: { ...category, observedRank: rank + 1, unknownStars } })
        }
        if (!any) break
      }
      return withOfficialSlots(result)
    }

    function createDesktopRankingRows(directoryRows, snapshot, type) {
      if (!snapshot) return []
      const byId = new Map()
      const byRepository = new Map()
      for (const row of directoryRows) {
        for (const id of [row.sourceId, row.catalogIndexEntry?.id, row.catalogEntry?.id, row.candidateEntry?.id]) {
          if (typeof id === 'string' && !byId.has(id.toLowerCase())) byId.set(id.toLowerCase(), row)
        }
        if (typeof row.repositoryUrl === 'string' && !byRepository.has(row.repositoryUrl.toLowerCase())) {
          byRepository.set(row.repositoryUrl.toLowerCase(), row)
        }
      }
      return desktopRankingEntries(snapshot, type).map(ranked => {
        const existing = byId.get(ranked.id.toLowerCase()) || byRepository.get(ranked.repositoryUrl.toLowerCase())
        if (existing) return { ...existing, rankingEntry: ranked, categories: [...ranked.categories] }
        const catalogIndexEntry = ranked.source === 'catalog' ? {
          id: ranked.id, nameZh: ranked.nameZh, nameEn: ranked.nameEn, packageName: '',
          version: ranked.version, featured: false, order: Number.MAX_SAFE_INTEGER,
          repositoryUrl: ranked.repositoryUrl, status: ranked.reviewStatus, categories: ranked.categories, searchTerms: [],
        } : null
        const candidateEntry = ranked.source === 'candidate' ? {
          id: ranked.id, name: ranked.nameZh, description: ranked.description,
          repositoryUrl: ranked.repositoryUrl, status: ranked.reviewStatus, topics: ranked.categories,
        } : null
        return {
          id: `ranking:${ranked.id}`, source: ranked.source === 'candidate' ? 'candidate' : 'catalog',
          sourceId: ranked.id, alias: '', packageName: '', name: ranked.nameZh || ranked.nameEn,
          description: ranked.description, categories: [...ranked.categories], stars: ranked.stars || 0,
          kind: ranked.source === 'candidate' ? 'ranking-candidate' : 'ranking-catalog',
          repositoryUrl: ranked.repositoryUrl, detailUrl: null, order: Number.MAX_SAFE_INTEGER,
          catalogIndexEntry, catalogEntry: null, candidateEntry, rankingEntry: ranked,
          listingStatus: ranked.listingStatus === 'listed' ? 'listed' : 'unlisted', primaryCategory: ranked.categories[0] || 'uncategorized',
        }
      })
    }

    async function fetchDesktopDirectoryDocument(sources, { maxBytes, timeoutMs, errorCode }) {
      const failures = []
      for (const source of sources) {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
        try {
          const response = await fetch(source.url, {
            cache: 'no-store', credentials: 'omit', redirect: 'error',
            headers: { accept: 'application/json' }, signal: controller.signal, referrerPolicy: 'no-referrer',
          })
          if (!response.ok) throw desktopFailure(`${errorCode}_HTTP_FAILED`)
          if (response.url) {
            const finalUrl = new URL(response.url)
            if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== source.host || finalUrl.pathname !== source.path
              || finalUrl.username || finalUrl.password || finalUrl.search || finalUrl.hash) throw desktopFailure(`${errorCode}_REDIRECT_REFUSED`)
          }
          const lengthHeader = response.headers?.get?.('content-length')
          if (typeof lengthHeader === 'string' && /^\d+$/.test(lengthHeader) && Number(lengthHeader) > maxBytes) {
            throw desktopFailure(`${errorCode}_TOO_LARGE`)
          }
          const reader = response.body?.getReader?.()
          let raw = ''
          let byteLength = 0
          if (reader) {
            const decoder = new TextDecoder('utf-8', { fatal: true })
            try {
              while (true) {
                const chunk = await reader.read()
                if (chunk.done) break
                if (!(chunk.value instanceof Uint8Array)) throw desktopFailure(`${errorCode}_STREAM_INVALID`)
                byteLength += chunk.value.byteLength
                if (byteLength > maxBytes) {
                  try { await reader.cancel() } catch {}
                  throw desktopFailure(`${errorCode}_TOO_LARGE`)
                }
                raw += decoder.decode(chunk.value, { stream: true })
              }
              raw += decoder.decode()
            } finally { reader.releaseLock?.() }
          } else {
            raw = await response.text()
            byteLength = new TextEncoder().encode(raw).byteLength
            if (byteLength > maxBytes) throw desktopFailure(`${errorCode}_TOO_LARGE`)
          }
          if (byteLength === 0) throw desktopFailure(`${errorCode}_EMPTY`)
          try { return { value: JSON.parse(raw), raw, source: source.host === 'raw.githubusercontent.com' ? 'GitHub Raw' : 'GitHub Pages' } }
          catch { throw desktopFailure(`${errorCode}_JSON_INVALID`) }
        } catch (error) {
          failures.push(desktopErrorCode(error))
        } finally { window.clearTimeout(timeout) }
      }
      throw desktopFailure(`${errorCode}_UNAVAILABLE_${failures.join('_') || 'UNKNOWN'}`)
    }

    async function fetchDesktopBoundedText(source, { maxBytes, timeoutMs, errorCode }) {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(source.url, {
          cache: 'no-store', credentials: 'omit', redirect: 'error',
          headers: { accept: 'text/html' }, signal: controller.signal, referrerPolicy: 'no-referrer',
        })
        if (!response.ok) throw desktopFailure(`${errorCode}_HTTP_FAILED`)
        if (response.url) {
          const finalUrl = new URL(response.url)
          if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== source.host || finalUrl.pathname !== source.path
            || finalUrl.username || finalUrl.password || finalUrl.search || finalUrl.hash) throw desktopFailure(`${errorCode}_REDIRECT_REFUSED`)
        }
        const lengthHeader = response.headers?.get?.('content-length')
        if (typeof lengthHeader === 'string' && /^\d+$/.test(lengthHeader) && Number(lengthHeader) > maxBytes) {
          throw desktopFailure(`${errorCode}_TOO_LARGE`)
        }
        const reader = response.body?.getReader?.()
        let raw = ''
        let byteLength = 0
        if (reader) {
          const decoder = new TextDecoder('utf-8', { fatal: true })
          try {
            while (true) {
              const chunk = await reader.read()
              if (chunk.done) break
              if (!(chunk.value instanceof Uint8Array)) throw desktopFailure(`${errorCode}_STREAM_INVALID`)
              byteLength += chunk.value.byteLength
              if (byteLength > maxBytes) {
                try { await reader.cancel() } catch {}
                throw desktopFailure(`${errorCode}_TOO_LARGE`)
              }
              raw += decoder.decode(chunk.value, { stream: true })
            }
            raw += decoder.decode()
          } finally { reader.releaseLock?.() }
        } else {
          raw = await response.text()
          byteLength = new TextEncoder().encode(raw).byteLength
          if (byteLength > maxBytes) throw desktopFailure(`${errorCode}_TOO_LARGE`)
        }
        if (byteLength === 0) throw desktopFailure(`${errorCode}_EMPTY`)
        return raw
      } finally { window.clearTimeout(timeout) }
    }

    async function fetchDesktopRankingSnapshot() {
      const failures = []
      for (const source of DESKTOP_DIRECTORY_SOURCES.rankings) {
        try {
          const indexHtml = await fetchDesktopBoundedText(source.index, {
            maxBytes: DESKTOP_RANKING_INDEX_MAX_BYTES, timeoutMs: DESKTOP_DISCOVERY_TIMEOUT_MS,
            errorCode: 'DESKTOP_RANKING_INDEX',
          })
          const digestMatch = /<meta\s+name="dsh-rankings-sha256"\s+content="([0-9a-f]{64})"\s*>/i.exec(indexHtml)
          if (!digestMatch) throw desktopFailure('DESKTOP_RANKING_DIGEST_MISSING')
          const document = await fetchDesktopDirectoryDocument([source.data], {
            maxBytes: DESKTOP_RANKING_MAX_BYTES, timeoutMs: DESKTOP_DISCOVERY_TIMEOUT_MS,
            errorCode: 'DESKTOP_RANKING_DATA',
          })
          const bytes = new TextEncoder().encode(document.raw)
          if (!window.crypto?.subtle || typeof window.crypto.subtle.digest !== 'function') throw desktopFailure('DESKTOP_RANKING_INTEGRITY_UNAVAILABLE')
          const digest = [...new Uint8Array(await window.crypto.subtle.digest('SHA-256', bytes))]
            .map(value => value.toString(16).padStart(2, '0')).join('')
          if (digest !== digestMatch[1]) throw desktopFailure('DESKTOP_RANKING_INTEGRITY_MISMATCH')
          return { snapshot: validateDesktopRankingSnapshot(document.value), source: document.source,
            digest, rankingIndexUrl: source.index.url }
        } catch (error) { failures.push(desktopErrorCode(error)) }
      }
      throw desktopFailure(`DESKTOP_RANKING_UNAVAILABLE_${failures.join('_') || 'UNKNOWN'}`)
    }

    async function fetchDesktopCatalogIndex(catalog) {
      const metadata = catalog?.registry
      if (metadata?.indexPath !== 'catalog-index.json'
        || !/^[0-9a-f]{64}$/.test(metadata.indexSha256 || '')
        || !Number.isSafeInteger(metadata.indexBytes) || metadata.indexBytes < 1 || metadata.indexBytes > DESKTOP_CATALOG_INDEX_MAX_BYTES
        || metadata.indexEntryCount !== catalog.directoryEntries?.length) throw desktopFailure('DESKTOP_CATALOG_INDEX_METADATA_INVALID')
      const result = await fetchDesktopDirectoryDocument(DESKTOP_DIRECTORY_SOURCES.catalogIndex, {
        maxBytes: DESKTOP_CATALOG_INDEX_MAX_BYTES, timeoutMs: DESKTOP_DISCOVERY_TIMEOUT_MS, errorCode: 'DESKTOP_CATALOG_INDEX',
      })
      const bytes = new TextEncoder().encode(result.raw)
      if (bytes.byteLength !== metadata.indexBytes) throw desktopFailure('DESKTOP_CATALOG_INDEX_SIZE_MISMATCH')
      if (!window.crypto?.subtle || typeof window.crypto.subtle.digest !== 'function') throw desktopFailure('DESKTOP_CATALOG_INDEX_INTEGRITY_UNAVAILABLE')
      const digest = [...new Uint8Array(await window.crypto.subtle.digest('SHA-256', bytes))]
        .map(value => value.toString(16).padStart(2, '0')).join('')
      if (digest !== metadata.indexSha256) throw desktopFailure('DESKTOP_CATALOG_INDEX_INTEGRITY_MISMATCH')
      const value = result.value
      if (!value || value.schemaVersion !== 2 || value.catalogType !== 'index'
        || value.registry?.repositoryUrl !== 'https://github.com/AI-Scarlett/DSH-Store'
        || value.registry?.updatedAt !== metadata.updatedAt
        || typeof value.registry?.detailsPath !== 'string' || value.registry.detailsPath !== 'catalog/details'
        || !Array.isArray(value.entries) || value.entries.length !== metadata.indexEntryCount) {
        throw desktopFailure('DESKTOP_CATALOG_INDEX_SCHEMA_INVALID')
      }
      for (const [index, entry] of value.entries.entries()) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
          || !desktopBoundedString(entry.id, 1, 240)
          || !desktopBoundedString(entry.nameZh, 1, 240)
          || !desktopBoundedString(entry.nameEn, 1, 240)
          || !desktopBoundedString(entry.packageName, 1, 500)
          || !desktopBoundedString(entry.version, 1, 120)
          || typeof entry.featured !== 'boolean' || !Number.isSafeInteger(entry.order) || entry.order < 0
          || !desktopSafeRepositoryUrl(entry.repositoryUrl)
          || !desktopBoundedString(entry.detailPath, 1, 500)
          || !['approved', 'blocked', 'unlisted'].includes(entry.status)
          || !Array.isArray(entry.categories) || entry.categories.length > 32
          || entry.categories.some(category => !desktopBoundedString(category, 1, 80))
          || !Array.isArray(entry.searchTerms) || entry.searchTerms.length > 64
          || entry.searchTerms.some(term => !desktopBoundedString(term, 0, 160))) {
          throw desktopFailure(`DESKTOP_CATALOG_INDEX_ENTRY_${index}_INVALID`)
        }
      }
      return value.entries
    }

    async function fetchDesktopDirectorySnapshot(catalog) {
      const catalogIndexPromise = fetchDesktopCatalogIndex(catalog)
      const discoveryPromise = fetchDesktopDirectoryDocument(DESKTOP_DIRECTORY_SOURCES.discovery, {
        maxBytes: DESKTOP_DISCOVERY_MAX_BYTES, timeoutMs: DESKTOP_DISCOVERY_TIMEOUT_MS, errorCode: 'DESKTOP_DISCOVERY',
      }).then(result => ({ ...result, value: validateDesktopDiscoveryIndex(result.value) }))
      const candidatePromise = fetchDesktopDirectoryDocument(DESKTOP_DIRECTORY_SOURCES.candidates, {
        maxBytes: DESKTOP_CANDIDATE_MAX_BYTES, timeoutMs: DESKTOP_DISCOVERY_TIMEOUT_MS, errorCode: 'DESKTOP_CANDIDATE',
      }).then(result => ({ ...result, value: validateDesktopCandidateRegistry(result.value) }))
      const [catalogIndexResult, discoveryResult, candidateResult] = await Promise.allSettled([
        catalogIndexPromise, discoveryPromise, candidatePromise,
      ])
      if (catalogIndexResult.status === 'rejected') throw catalogIndexResult.reason
      if (discoveryResult.status === 'rejected') throw discoveryResult.reason
      return {
        catalogIndexEntries: catalogIndexResult.value,
        discovery: discoveryResult.value.value,
        candidates: candidateResult.status === 'fulfilled' ? candidateResult.value.value.entries : [],
        source: discoveryResult.value.source,
        candidateSource: candidateResult.status === 'fulfilled' ? candidateResult.value.source : null,
        candidateError: candidateResult.status === 'rejected' ? desktopErrorCode(candidateResult.reason) : null,
      }
    }

    function desktopDirectoryCategories(values, allowed = null) {
      const categories = [...new Set((Array.isArray(values) ? values : []).map(value => typeof value === 'string'
        ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) : '')
        .filter(value => value && (!allowed || allowed.has(value))))]
      return categories.length ? categories : ['uncategorized']
    }

    function desktopDirectoryCategoryLabel(id, catalogLabels = {}) {
      return catalogLabels[id] || DESKTOP_DISCOVERY_CATEGORY_LABELS[id] || id
    }

    function createDesktopKnownDirectory(catalog, directorySnapshot) {
      const discoveryRows = Array.isArray(directorySnapshot?.discovery?.entries) ? directorySnapshot.discovery.entries : []
      const candidates = Array.isArray(directorySnapshot?.candidates) ? directorySnapshot.candidates : []
      const catalogRows = Array.isArray(directorySnapshot?.catalogIndexEntries)
        ? directorySnapshot.catalogIndexEntries
        : (Array.isArray(catalog?.directoryEntries) ? catalog.directoryEntries : (catalog?.entries || []))
      const trustedCatalogRows = Array.isArray(catalog?.directoryEntries) ? catalog.directoryEntries : (catalog?.entries || [])
      const trustedCatalogById = new Map(trustedCatalogRows.map(entry => [entry.id.toLowerCase(), entry]))
      const trustedCatalogEntry = indexEntry => indexEntry
        ? trustedCatalogById.get(indexEntry.id.toLowerCase()) || null : null
      const allowedCategories = new Set(discoveryRows.flatMap(entry => Array.isArray(entry.categories) ? entry.categories : []))
      const catalogIndexes = { byId: new Map(), byPackage: new Map(), byRepository: new Map() }
      for (const entry of catalogRows) {
        catalogIndexes.byId.set(entry.id.toLowerCase(), entry)
        if (entry.packageName) catalogIndexes.byPackage.set(entry.packageName.toLowerCase(), entry)
        if (entry.repositoryUrl && !catalogIndexes.byRepository.has(entry.repositoryUrl.toLowerCase())) {
          catalogIndexes.byRepository.set(entry.repositoryUrl.toLowerCase(), entry)
        }
      }
      const rows = []
      const bySourceId = new Map()
      const byAlias = new Map()
      const byPackage = new Map()
      const byRepository = new Map()
      const add = row => {
        const item = { ...row, categories: desktopDirectoryCategories(row.categories) }
        item.listingStatus = item.catalogIndexEntry ? 'listed' : 'unlisted'
        rows.push(item)
        if (item.sourceId) bySourceId.set(item.sourceId.toLowerCase(), item)
        if (item.alias) byAlias.set(item.alias.toLowerCase(), item)
        if (item.packageName) byPackage.set(item.packageName.toLowerCase(), item)
        if (item.repositoryUrl) {
          const matches = byRepository.get(item.repositoryUrl.toLowerCase()) || []
          matches.push(item)
          byRepository.set(item.repositoryUrl.toLowerCase(), matches)
        }
        return item
      }
      const findExisting = identity => bySourceId.get(identity.sourceId?.toLowerCase())
        || byAlias.get(identity.alias?.toLowerCase())
        || byPackage.get(identity.packageName?.toLowerCase())
        || (identity.repositoryUrl ? byRepository.get(identity.repositoryUrl.toLowerCase())?.[0] : null)
        || null
      const catalogMatch = identity => catalogIndexes.byId.get(identity.sourceId?.toLowerCase())
        || catalogIndexes.byPackage.get(identity.alias?.toLowerCase())
        || catalogIndexes.byPackage.get(identity.packageName?.toLowerCase())
        || catalogIndexes.byRepository.get(identity.repositoryUrl?.toLowerCase())
        || null

      discoveryRows.forEach((entry, index) => {
        const sourceId = entry.sourceId
        const alias = entry.alias
        const repository = entry.repositoryUrl
        const identity = { sourceId, alias, packageName: alias, repositoryUrl: repository }
        const matchedCatalog = catalogMatch(identity)
        add({
          id: `discovery:${entry.sourceIndex}:${sourceId}`, source: 'discovery', sourceId,
          sourceIndex: entry.sourceIndex, alias, packageName: alias, name: entry.name,
          description: entry.description, categories: desktopDirectoryCategories(entry.categories, allowedCategories),
          stars: entry.stars, kind: entry.kind, repositoryUrl: repository, detailUrl: entry.detailUrl,
          order: Number.isSafeInteger(entry.sourceIndex) ? entry.sourceIndex : index,
          catalogIndexEntry: matchedCatalog, catalogEntry: trustedCatalogEntry(matchedCatalog), candidateEntry: null,
        })
      })

      for (const entry of catalogRows) {
        const identity = { sourceId: entry.id, alias: '', packageName: entry.packageName, repositoryUrl: entry.repositoryUrl }
        const existing = findExisting(identity)
        if (existing) {
          existing.catalogIndexEntry = entry
          existing.catalogEntry = trustedCatalogEntry(entry)
          existing.listingStatus = 'listed'
          continue
        }
        add({
          id: `catalog:${entry.id}`, source: 'catalog', sourceId: entry.id, sourceIndex: null,
          alias: '', packageName: entry.packageName, name: entry.nameZh || entry.nameEn || entry.packageName, description: '',
          categories: desktopDirectoryCategories(entry.categories, allowedCategories), stars: 0,
          kind: 'store-catalog', repositoryUrl: entry.repositoryUrl || null, detailUrl: null,
          order: Number.isSafeInteger(entry.order) ? entry.order : Number.MAX_SAFE_INTEGER,
          catalogIndexEntry: entry, catalogEntry: trustedCatalogEntry(entry), candidateEntry: null,
        })
      }

      candidates.forEach((entry, index) => {
        const alias = entry.packageName || entry.name
        const identity = { sourceId: entry.id, alias, packageName: alias, repositoryUrl: entry.repositoryUrl }
        const existing = findExisting(identity)
        if (existing) {
          existing.candidateEntry = entry
          return
        }
        add({
          id: `candidate:${entry.id || index}`, source: 'candidate', sourceId: entry.id,
          sourceIndex: null, alias, packageName: alias, name: entry.name,
          description: entry.description, categories: desktopDirectoryCategories(entry.topics, allowedCategories),
          stars: 0, kind: 'store-candidate', repositoryUrl: entry.repositoryUrl, detailUrl: null,
          order: Number.MAX_SAFE_INTEGER,
          catalogIndexEntry: catalogMatch(identity), catalogEntry: trustedCatalogEntry(catalogMatch(identity)), candidateEntry: entry,
        })
      })

      const categoryCounts = new Map()
      for (const row of rows) for (const category of row.categories) categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1)
      for (const row of rows) {
        row.categories.sort((left, right) => (categoryCounts.get(right) || 0) - (categoryCounts.get(left) || 0) || left.localeCompare(right))
        row.primaryCategory = row.categories[0] || 'uncategorized'
      }
      return rows
    }

    function desktopDirectoryStatusLabel(row) {
      const catalogStatus = row.catalogIndexEntry?.status || row.catalogEntry?.status
      if (catalogStatus === 'approved') return 'Catalog 已审核'
      if (catalogStatus === 'blocked') return 'Catalog 已拦截 · DSH 可检查'
      if (catalogStatus === 'unlisted') return 'Catalog 未上架'
      const candidateStatus = row.candidateEntry?.status
      if (candidateStatus === 'rejected') return '候选审核未通过'
      if (candidateStatus === 'reviewing') return '候选审核中'
      if (candidateStatus === 'discovered') return '候选待审核'
      return '官网发现 · Store 未收录'
    }

    async function readDesktopCatalogSnapshot() {
      const result = await fetchDesktopCatalogDocument()
      return { ...validateDesktopCatalog(result.document), deliverySource: result.deliverySource }
    }

    async function readDesktopInventorySnapshot() {
      const manager = await waitForDesktopPluginManager()
      if (!manager || typeof manager.listBundles !== 'function') throw Object.assign(new Error('DESKTOP_PLUGIN_MANAGER_UNAVAILABLE'), { code: 'DESKTOP_PLUGIN_MANAGER_UNAVAILABLE' })
      const bundlesResult = await withDesktopTimeout(manager.listBundles(), 'DESKTOP_INVENTORY_TIMEOUT')
      const bundles = unwrapDesktopRemote(bundlesResult, 'DESKTOP_INVENTORY_FAILED')
      if (!Array.isArray(bundles)) throw Object.assign(new Error('DESKTOP_INVENTORY_INVALID'), { code: 'DESKTOP_INVENTORY_INVALID' })
      const versions = new Set(bundles.map(bundle => bundle?.official === true ? bundle.installTarget?.version : null)
        .filter(version => typeof version === 'string' && DESKTOP_VERSION.test(version)))
      const runtimeVersion = versions.size === 1 ? [...versions][0] : null
      return { bundles, runtimeVersion }
    }

    async function readDesktopStoreSnapshot() {
      const [catalog, inventory] = await Promise.all([readDesktopCatalogSnapshot(), readDesktopInventorySnapshot()])
      return { catalog, ...inventory }
    }

    function desktopDirectoryGitHubInstallEntry(row) {
      const discoveryPlugin = row?.source === 'discovery' && row.kind === 'dsh-plugin'
      const catalogPlugin = Boolean(row?.catalogIndexEntry || row?.catalogEntry)
      const candidatePlugin = Boolean(row?.candidateEntry)
      if ((!discoveryPlugin && !catalogPlugin && !candidatePlugin)
        || typeof row.repositoryUrl !== 'string' || !desktopSafeRepositoryUrl(row.repositoryUrl)) return null
      const repositoryUrl = row.repositoryUrl
      const normalizedRepository = repositoryUrl.toLowerCase()
      const catalogEntry = row.catalogEntry || null
      const catalogIndexEntry = row.catalogIndexEntry || null
      const packageNameHint = catalogEntry?.packageName || catalogIndexEntry?.packageName || row.alias || row.packageName || ''
      if (packageNameHint === 'dsh-safe-plugin-manager' || packageNameHint.startsWith('@deepseek-ai/')
        || normalizedRepository === 'https://github.com/ai-scarlett/dsh-store'
        || normalizedRepository.startsWith('https://github.com/deepseek-ai/')) return null
      if (catalogEntry && desktopHasProtectedEntryId(catalogEntry)) return null
      const repositoryName = repositoryUrl.split('/').at(-1).toLowerCase()
      const packageName = DESKTOP_PACKAGE_NAME.test(packageNameHint) && !packageNameHint.includes('..')
        ? packageNameHint : repositoryName
      const details = catalogEntry?.details || {
        license: '未知', externalDependencies: [],
        permissions: { level: 'unknown', files: 'unknown', network: 'unknown', commands: 'unknown', credentials: ['unknown'] },
      }
      return {
        id: row.id || row.sourceId || repositoryName,
        name: row.name || catalogEntry?.name || packageName,
        packageName,
        version: 'GitHub 默认分支',
        commit: 'DEFAULT_BRANCH',
        status: catalogEntry?.status || catalogIndexEntry?.status || 'unlisted',
        candidateStatus: row.candidateEntry?.status || null,
        statusReason: catalogEntry?.statusReason || catalogIndexEntry?.statusReason || row.candidateEntry?.statusReason || '',
        updatePolicy: null,
        repositoryUrl,
        installPath: null,
        manifestPath: 'package.json',
        entryIds: catalogEntry?.entryIds || [],
        compatibility: catalogEntry?.compatibility || { profiles: [] },
        details,
        risk: catalogEntry?.risk || { installScripts: [] },
        installMode: 'github-default-branch',
        directorySource: discoveryPlugin ? 'discovery' : catalogPlugin ? 'catalog' : 'candidate',
        discoveryKind: discoveryPlugin ? row.kind : null,
      }
    }

    function desktopDirectoryGitHubInstallReady(entry) {
      if (entry?.installMode !== 'github-default-branch'
        || !['discovery', 'catalog', 'candidate'].includes(entry.directorySource)
        || (entry.directorySource === 'discovery' && entry.discoveryKind !== 'dsh-plugin')
        || !desktopSafeRepositoryUrl(entry.repositoryUrl)
        || entry.packageName === 'dsh-safe-plugin-manager'
        || entry.packageName.startsWith('@deepseek-ai/')
        || entry.repositoryUrl.toLowerCase() === 'https://github.com/ai-scarlett/dsh-store'
        || entry.repositoryUrl.toLowerCase().startsWith('https://github.com/deepseek-ai/')
        || desktopHasProtectedEntryId(entry)) return false
      return true
    }

    function desktopInstallSpecifier(entry) {
      if (entry?.installMode === 'github-default-branch') {
        if (!desktopDirectoryGitHubInstallReady(entry)) throw Object.assign(new Error('DESKTOP_INSTALL_SOURCE_INVALID'), { code: 'DESKTOP_INSTALL_SOURCE_INVALID' })
        return `git+${entry.repositoryUrl}.git`
      }
      const repository = entry.repositoryUrl
      if (!/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository)
        || !DESKTOP_COMMIT.test(entry.commit)) throw Object.assign(new Error('DESKTOP_INSTALL_SOURCE_INVALID'), { code: 'DESKTOP_INSTALL_SOURCE_INVALID' })
      const installPath = entry.installPath ?? null
      const validPath = value => typeof value === 'string' && value.length <= 160 && !value.startsWith('/')
        && value.split('/').every(part => /^[\p{L}\p{N}@._+-]+$/u.test(part) && part !== '.' && part !== '..')
      const manifestPath = entry.manifestPath ?? (installPath ? `${installPath}/package.json` : 'package.json')
      if ((installPath !== null && !validPath(installPath))
        || manifestPath !== (installPath ? `${installPath}/package.json` : 'package.json')) {
        throw Object.assign(new Error('DESKTOP_INSTALL_PATH_INVALID'), { code: 'DESKTOP_INSTALL_PATH_INVALID' })
      }
      return `git+${repository}.git#${entry.commit}${installPath ? `&path:${installPath}` : ''}`
    }

    function desktopBlockedInstallReady(entry) {
      if (entry.status !== 'blocked') return true
      const ids = entry.entryIds
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 64
        || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id))
        || new Set(ids).size !== ids.length || ids.some(id => DESKTOP_PROTECTED_ENTRY_IDS.has(id))) return false
      if (typeof entry.version !== 'string' || !DESKTOP_VERSION.test(entry.version)) return false
      try {
        desktopInstallSpecifier(entry)
        return true
      } catch {
        return false
      }
    }

    function desktopHasProtectedEntryId(entry) {
      return Array.isArray(entry.entryIds) && entry.entryIds.some(id => DESKTOP_PROTECTED_ENTRY_IDS.has(id))
    }

    function desktopCatalogCompatibility(entry, runtimeVersion) {
      if (typeof runtimeVersion !== 'string' || !DESKTOP_VERSION.test(runtimeVersion)) return 'unknown'
      const status = Object.entries(entry.compatibility?.dshReleases ?? {}).find(([release]) =>
        (DESKTOP_LEGACY_RELEASES[release] ?? release) === runtimeVersion)?.[1]
      return status === 'compatible' || status === 'incompatible' ? status : 'unknown'
    }

    function desktopClientAdaptationLabel(profiles) {
      return Array.isArray(profiles) && profiles.includes('desktop') ? '已声明适配' : '未声明适配'
    }

    function desktopSourceRepository(source) {
      if (typeof source !== 'string' || source.length > 1_024) return null
      const address = source.trim().replace(/^git\+/, '').split('#', 1)[0]
      let repository = null
      if (address.startsWith('github:')) repository = address.slice('github:'.length)
      else if (/^git@github\.com:/i.test(address)) repository = address.slice('git@github.com:'.length)
      else {
        try {
          const url = new URL(address)
          if (url.protocol === 'https:' && url.hostname.toLowerCase() === 'github.com') repository = url.pathname
        } catch { return null }
      }
      if (!repository) return null
      const parts = repository.replace(/^\/+/, '').replace(/\.git$/i, '').split('/')
      if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part))) return null
      return `https://github.com/${parts[0]}/${parts[1]}`.toLowerCase()
    }

    function desktopEntryRepository(entry) {
      return typeof entry?.repositoryUrl === 'string' ? entry.repositoryUrl.replace(/\.git$/i, '').toLowerCase() : null
    }

    function desktopSourceRevision(source) {
      if (typeof source !== 'string' || source.length > 1_024) return null
      return source.match(/#([a-f0-9]{40})(?:&|$)/i)?.[1]?.toLowerCase() ?? null
    }

    function desktopBundleMatchesCatalogEntry(entry, bundle) {
      return desktopSourceRepository(bundle?.source) !== null
        && desktopSourceRepository(bundle.source) === desktopEntryRepository(entry)
    }

    function desktopBundleConfirmsInstall(entry, bundle) {
      if (entry?.installMode === 'github-default-branch') {
        return Boolean(bundle?.installed === true && desktopDirectoryGitHubInstallReady(entry)
          && desktopSourceRepository(bundle.source) === desktopEntryRepository(entry))
      }
      if (!bundle || bundle.name !== entry.packageName || bundle.installed !== true
        || bundle.version !== entry.version || !desktopBundleMatchesCatalogEntry(entry, bundle)) return false
      return desktopSourceRevision(bundle.source) === entry.commit
    }

    function desktopBundleNeedsUpdate(entry, bundle) {
      if (!bundle || bundle.name !== entry.packageName || bundle.installed !== true
        || bundle.official === true || bundle.optional === true || bundle.readOnlyReason
        || entry.packageName.startsWith('@deepseek-ai/')
        || entry.status !== 'approved'
        || !DESKTOP_COMMIT.test(entry.commit || '')
        || !desktopBundleMatchesCatalogEntry(entry, bundle)) return false
      if (entry.packageName === 'dsh-safe-plugin-manager'
        && (entry.id !== 'dsh-safe-plugin-manager'
          || desktopEntryRepository(entry) !== 'https://github.com/ai-scarlett/dsh-store')) return false
      if (entry.packageName === 'dsh-safe-plugin-manager') return desktopStoreNeedsUpdate(entry, bundle)
      const installedCommit = desktopSourceRevision(bundle.source)
      return installedCommit !== null && installedCommit !== entry.commit
    }

    function desktopBundleConfirmsPreviousInstall(entry, bundle, previous) {
      if (!bundle || bundle.name !== entry.packageName || bundle.installed !== true
        || bundle.version !== previous?.version || !desktopBundleMatchesCatalogEntry(entry, bundle)) return false
      const previousCommit = desktopSourceRevision(previous?.source)
      if (previousCommit === null && entry.packageName === 'dsh-safe-plugin-manager') {
        return typeof previous?.source === 'string' && bundle.source === previous.source
      }
      return previousCommit !== null && desktopSourceRevision(bundle.source) === previousCommit
    }

    function desktopStoreVersionParts(value) {
      if (typeof value !== 'string') return null
      const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
      return match ? match.slice(1) : null
    }

    function desktopStoreNeedsUpdate(entry, bundle) {
      const installedCommit = desktopSourceRevision(bundle?.source)
      if (installedCommit === entry.commit) return false
      const installedVersion = desktopStoreVersionParts(bundle?.version)
      const targetVersion = desktopStoreVersionParts(entry?.version)
      if (installedVersion && targetVersion) {
        for (let index = 0; index < targetVersion.length; index++) {
          if (targetVersion[index] !== installedVersion[index]) {
            return targetVersion[index].length === installedVersion[index].length
              ? targetVersion[index] > installedVersion[index]
              : targetVersion[index].length > installedVersion[index].length
          }
        }
      }
      return installedCommit !== null && installedCommit !== entry.commit
    }

    function desktopInspectionAdvice(inspection) {
      const reason = desktopSafeReasonText(inspection?.reason)
      return reason
        ? `DSH Desktop 预检提示：${reason}`
        : 'DSH Desktop 预检未接受该来源；安装请求仍已提交给官方安装器作最终判断。'
    }

    function desktopActionConfirmation(action, entry) {
      const verb = { install: 'INSTALL', update: 'UPDATE', remove: 'REMOVE', enable: 'START', disable: 'CLOSE' }[action]
      if (!verb) throw desktopFailure('DESKTOP_ACTION_INVALID')
      if (entry.installMode === 'github-default-branch' && action === 'install') {
        return `INSTALL GITHUB ${entry.repositoryUrl.slice('https://github.com/'.length)} DEFAULT`
      }
      return `${verb} ${entry.packageName} ${entry.commit}`
    }

    function desktopErrorCode(error) {
      const value = [error?.code, error?.problem, error?.error?.code, error?.message]
        .find(candidate => typeof candidate === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(candidate))
      return value || 'DESKTOP_OPERATION_FAILED'
    }

    function DesktopStorePanel() {
      const [loadState, setLoadState] = useState({ status: 'loading' })
      const [inventoryState, setInventoryState] = useState({ status: 'loading' })
      const [directoryState, setDirectoryState] = useState({ status: 'loading' })
      const [rankingState, setRankingState] = useState({ status: 'idle' })
      const [refreshing, setRefreshing] = useState(false)
      const [view, setView] = useState('directory')
      const [query, setQuery] = useState('')
      const [category, setCategory] = useState('')
      const [listFilter, setListFilter] = useState('all')
      const [directoryListingFilter, setDirectoryListingFilter] = useState('all')
      const [directoryReviewFilter, setDirectoryReviewFilter] = useState('all')
      const [directoryClientFilter, setDirectoryClientFilter] = useState('all')
      const [clientFilter, setClientFilter] = useState('all')
      const [sortBy, setSortBy] = useState('recommended')
      const [page, setPage] = useState(1)
      const [detailEntry, setDetailEntry] = useState(null)
      const [actionPlan, setActionPlan] = useState(null)
      const [confirmation, setConfirmation] = useState('')
      const [actionState, setActionState] = useState({ status: 'idle' })
      const actionInFlight = useRef(false)
      const directoryRequestId = useRef(0)
      const refreshRequestId = useRef(0)
      const rankingRequestId = useRef(0)
      const loadDirectory = useCallback(async catalog => {
        const requestId = ++directoryRequestId.current
        setDirectoryState({ status: 'loading' })
        try {
          const snapshot = await fetchDesktopDirectorySnapshot(catalog)
          if (requestId === directoryRequestId.current) setDirectoryState({ status: 'ready', snapshot })
        } catch (error) {
          if (requestId === directoryRequestId.current) setDirectoryState({ status: 'error', code: desktopErrorCode(error) })
        }
      }, [])
      const loadRankings = useCallback(async () => {
        const requestId = ++rankingRequestId.current
        setRankingState({ status: 'loading' })
        try {
          const result = await fetchDesktopRankingSnapshot()
          if (requestId === rankingRequestId.current) setRankingState({ status: 'ready', ...result })
        } catch (error) {
          if (requestId === rankingRequestId.current) setRankingState({ status: 'error', code: desktopErrorCode(error) })
        }
      }, [])
      const refresh = useCallback(async () => {
        const requestId = ++refreshRequestId.current
        setRefreshing(true)
        setInventoryState({ status: 'loading' })
        setLoadState(current => current.status === 'ready' ? current : { status: 'loading' })
        const catalogPromise = readDesktopCatalogSnapshot()
        const inventoryPromise = readDesktopInventorySnapshot()
        try {
          const catalog = await catalogPromise
          if (requestId !== refreshRequestId.current) return
          setLoadState(current => ({ status: 'ready', catalog,
            bundles: current.status === 'ready' ? current.bundles : [],
            runtimeVersion: current.status === 'ready' ? current.runtimeVersion : null }))
          void loadDirectory(catalog)
        } catch (error) {
          if (requestId === refreshRequestId.current) {
            setLoadState(current => current.status === 'ready' ? current : { status: 'error', code: desktopErrorCode(error) })
          }
        }
        try {
          const inventory = await inventoryPromise
          if (requestId !== refreshRequestId.current) return
          setLoadState(current => current.status === 'ready' ? { ...current, ...inventory } : current)
          setInventoryState({ status: 'ready' })
        } catch (error) {
          if (requestId === refreshRequestId.current) setInventoryState({ status: 'error', code: desktopErrorCode(error) })
        } finally {
          if (requestId === refreshRequestId.current) setRefreshing(false)
        }
      }, [loadDirectory])
      useEffect(() => {
        void refresh()
        return () => { refreshRequestId.current += 1; directoryRequestId.current += 1; rankingRequestId.current += 1 }
      }, [refresh])
      useEffect(() => {
        if (['recommended', 'essential'].includes(view) && rankingState.status === 'idle') void loadRankings()
      }, [view, rankingState.status, loadRankings])

      const entries = loadState.status === 'ready' ? loadState.catalog.entries : []
      const categoryLabels = loadState.status === 'ready' ? loadState.catalog.registry.categories || {} : {}
      const directoryRows = useMemo(() => {
        if (loadState.status !== 'ready') return []
        if (directoryState.status === 'ready') return createDesktopKnownDirectory(loadState.catalog, directoryState.snapshot)
        if (directoryState.status === 'error') return createDesktopKnownDirectory(loadState.catalog, { discovery: { entries: [] }, candidates: [] })
        return []
      }, [loadState.status, loadState.catalog, directoryState.status, directoryState.snapshot])
      const rankingRowsByType = useMemo(() => {
        if (rankingState.status !== 'ready') return { recommended: [], essential: [] }
        return {
          recommended: createDesktopRankingRows(directoryRows, rankingState.snapshot, 'recommended'),
          essential: createDesktopRankingRows(directoryRows, rankingState.snapshot, 'essential'),
        }
      }, [directoryRows, rankingState.status, rankingState.snapshot])
      const rankedDirectoryRows = ['recommended', 'essential'].includes(view) ? rankingRowsByType[view] : []
      const rankingTabCount = type => rankingState.status === 'ready' ? rankingRowsByType[type].length
        : rankingState.status === 'error' ? '不可用' : '…'
      const activeDirectoryRows = ['recommended', 'essential'].includes(view) ? rankedDirectoryRows : directoryRows
      const directoryCategoryIds = useMemo(() => [...new Set(activeDirectoryRows.flatMap(entry => entry.categories || []))].sort(), [activeDirectoryRows])
      const catalogCategoryIds = useMemo(() => [...new Set(entries.flatMap(entry => entry.categories || []))].sort(), [entries])
      const directoryViewActive = ['directory', 'recommended', 'essential'].includes(view)
      const categoryIds = directoryViewActive ? directoryCategoryIds : catalogCategoryIds
      const installedByName = new Map((loadState.status === 'ready' ? loadState.bundles : [])
        .filter(bundle => bundle && typeof bundle.name === 'string').map(bundle => [bundle.name, bundle]))
      const installedByRepository = new Map()
      for (const bundle of loadState.status === 'ready' ? loadState.bundles : []) {
        const repository = desktopSourceRepository(bundle?.source)
        if (bundle?.installed === true && repository && !installedByRepository.has(repository)) installedByRepository.set(repository, bundle)
      }
      const installedBundleForEntry = entry => installedByName.get(entry?.packageName)
        || (entry?.installMode === 'github-default-branch' ? installedByRepository.get(desktopEntryRepository(entry)) : null)
      const isOfficialDesktopBundle = bundle => bundle?.official === true || bundle?.optional === true
        || bundle?.name?.startsWith('@deepseek-ai/') === true
      const catalogPackageNames = new Set(entries.map(entry => entry.packageName))
      const normalizedQuery = query.trim().toLocaleLowerCase()
      const matching = entries.filter(entry => (!category || entry.categories?.includes(category))
        && (clientFilter === 'all' || (clientFilter === 'declared'
          ? entry.compatibility?.profiles?.includes('desktop') === true
          : entry.compatibility?.profiles?.includes('desktop') !== true))
        && (!normalizedQuery || [entry.id, entry.name, entry.packageName, entry.version, entry.description,
          entry.repositoryUrl, entry.commit, entry.statusReason, entry.details?.license,
          ...(entry.searchTerms || []), ...(entry.categories || []).map(id => categoryLabels[id]),
          entry.details?.permissions?.level, entry.details?.permissions?.files, entry.details?.permissions?.network,
          entry.details?.permissions?.commands, ...(entry.details?.permissions?.credentials || []),
          ...(entry.details?.externalDependencies || [])]
          .some(value => String(value || '').toLocaleLowerCase().includes(normalizedQuery))))
      const externalInstalledBundles = (loadState.status === 'ready' ? loadState.bundles : [])
        .filter(bundle => bundle?.installed === true && typeof bundle.name === 'string' && !catalogPackageNames.has(bundle.name))
        .filter(bundle => !isOfficialDesktopBundle(bundle))
        .filter(() => clientFilter !== 'declared')
        .filter(bundle => !category && (!normalizedQuery || [bundle.name, bundle.version, desktopSourceRepository(bundle.source)]
          .some(value => String(value || '').toLocaleLowerCase().includes(normalizedQuery))))
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      const officialBundles = inventoryState.status === 'ready' ? [...installedByName.values()]
        .filter(bundle => bundle?.installed === true && isOfficialDesktopBundle(bundle))
        .filter(bundle => !normalizedQuery || [bundle.name, bundle.version, desktopSourceRepository(bundle.source)]
          .some(value => String(value || '').toLocaleLowerCase().includes(normalizedQuery)))
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')) : []
      const installedCatalogEntries = matching.filter(entry => {
        const bundle = installedByName.get(entry.packageName)
        return bundle?.installed === true && !isOfficialDesktopBundle(bundle)
      })
      const statusCounts = {
        all: matching.length,
        approved: matching.filter(entry => entry.status === 'approved').length,
        blocked: matching.filter(entry => entry.status === 'blocked').length,
        installed: installedCatalogEntries.length + externalInstalledBundles.length,
      }
      const filteredCatalog = matching.filter(entry => {
        if (listFilter === 'approved') return entry.status === 'approved'
        if (listFilter === 'blocked') return entry.status === 'blocked'
        if (listFilter === 'installed') return installedByName.get(entry.packageName)?.installed === true
        return true
      })
      const rows = view === 'installed'
        ? [...installedCatalogEntries.map(entry => ({ kind: 'catalog', key: entry.id, entry })),
          ...externalInstalledBundles.map(bundle => ({ kind: 'external', key: bundle.name, bundle }))]
        : view === 'official'
          ? officialBundles.map(bundle => ({ kind: 'official', key: bundle.name, bundle }))
        : filteredCatalog.map(entry => ({ kind: 'catalog', key: entry.id, entry }))
      const filtered = rows.sort((left, right) => {
        const leftName = left.entry?.name || left.bundle?.name || ''
        const rightName = right.entry?.name || right.bundle?.name || ''
        if (sortBy === 'name') return leftName.localeCompare(rightName, 'zh-CN')
        if (sortBy === 'recent') return (Date.parse(right.entry?.source?.updatedAt) || 0) - (Date.parse(left.entry?.source?.updatedAt) || 0)
          || leftName.localeCompare(rightName, 'zh-CN')
        return Number(right.entry?.status === 'approved') - Number(left.entry?.status === 'approved')
          || Number(right.entry?.status === 'approved' && right.entry?.featured === true) - Number(left.entry?.status === 'approved' && left.entry?.featured === true)
          || (Date.parse(right.entry?.source?.updatedAt) || 0) - (Date.parse(left.entry?.source?.updatedAt) || 0)
          || leftName.localeCompare(rightName, 'zh-CN')
      })
      const pageCount = Math.max(1, Math.ceil(filtered.length / MARKET_PAGE_SIZE))
      const currentPage = Math.min(page, pageCount)
      const visible = filtered.slice((currentPage - 1) * MARKET_PAGE_SIZE, currentPage * MARKET_PAGE_SIZE)
      const installedInventoryUnavailable = ['installed', 'official'].includes(view) && inventoryState.status !== 'ready'
      const directoryCounts = useMemo(() => {
        const counts = { all: directoryRows.length, listed: 0, unlisted: 0, approved: 0, blocked: 0,
          withdrawn: 0, reviewing: 0, rejected: 0, discovered: 0, publicOnly: 0 }
        for (const row of directoryRows) {
          if (row.catalogIndexEntry) counts.listed += 1
          else counts.unlisted += 1
          if (row.catalogIndexEntry?.status === 'approved') counts.approved += 1
          if (row.catalogIndexEntry?.status === 'blocked') counts.blocked += 1
          if (row.catalogIndexEntry?.status === 'unlisted') counts.withdrawn += 1
          if (!row.catalogIndexEntry && row.candidateEntry?.status === 'reviewing') counts.reviewing += 1
          if (!row.catalogIndexEntry && row.candidateEntry?.status === 'rejected') counts.rejected += 1
          if (!row.catalogIndexEntry && row.candidateEntry?.status === 'discovered') counts.discovered += 1
          if (!row.catalogIndexEntry && !row.candidateEntry) counts.publicOnly += 1
        }
        return counts
      }, [directoryRows])
      const directoryCategoryCounts = useMemo(() => {
        const counts = new Map()
        for (const row of activeDirectoryRows) for (const id of row.categories || []) counts.set(id, (counts.get(id) || 0) + 1)
        return counts
      }, [activeDirectoryRows])
      const directoryClientCounts = useMemo(() => {
        const declared = activeDirectoryRows.filter(row => row.catalogEntry?.compatibility?.profiles?.includes('desktop') === true).length
        return { all: activeDirectoryRows.length, declared, undeclared: activeDirectoryRows.length - declared }
      }, [activeDirectoryRows])
      const directorySearchIndex = useMemo(() => {
        const normalizedFields = values => values.filter(value => value !== null && value !== undefined)
          .map(value => String(value).normalize('NFKC').toLocaleLowerCase())
        return activeDirectoryRows.map(row => ({
          row,
          identity: normalizedFields([
            row.id, row.sourceId, row.alias, row.packageName, row.name,
            row.catalogIndexEntry?.nameZh, row.catalogIndexEntry?.nameEn,
          ]),
          repository: normalizedFields([row.repositoryUrl]),
          keywords: normalizedFields([
            ...(row.catalogIndexEntry?.searchTerms || []), ...(row.catalogEntry?.searchTerms || []),
            ...(row.candidateEntry?.topics || []), ...(row.categories || []),
            ...(row.categories || []).map(id => categoryLabels[id]),
            ...(row.rankingEntry?.wins || []).flatMap(item => [item.zh, item.en]),
            row.rankingEntry?.categoryPick?.zh, row.rankingEntry?.categoryPick?.en,
          ]),
          description: normalizedFields([
            row.description, row.catalogEntry?.description, row.candidateEntry?.description,
            row.rankingEntry?.description,
          ]),
        }))
      }, [activeDirectoryRows, categoryLabels])
      const directoryOrderedSearchIndex = useMemo(() => {
        if (['recommended', 'essential'].includes(view)) return directorySearchIndex
        return [...directorySearchIndex].sort((left, right) => {
        const leftName = left.row.name || left.row.packageName || left.row.sourceId || ''
        const rightName = right.row.name || right.row.packageName || right.row.sourceId || ''
        if (sortBy === 'name') return leftName.localeCompare(rightName, 'zh-CN')
        if (sortBy === 'stars') return (right.row.stars || 0) - (left.row.stars || 0) || left.row.order - right.row.order
        return String(left.row.primaryCategory || 'uncategorized').localeCompare(String(right.row.primaryCategory || 'uncategorized'), 'en')
          || Number(Boolean(right.row.catalogIndexEntry)) - Number(Boolean(left.row.catalogIndexEntry))
          || (right.row.stars || 0) - (left.row.stars || 0)
          || leftName.localeCompare(rightName, 'zh-CN') || left.row.order - right.row.order
        })
      }, [directorySearchIndex, sortBy, view])
      const directoryFiltered = useMemo(() => {
        const terms = query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
        const groupScore = (fields, term, weight) => {
          let score = 0
          for (const field of fields) {
            if (field === term) score = Math.max(score, weight + 300)
            else if (field.startsWith(term)) score = Math.max(score, weight + 200)
            else if (field.includes(term)) score = Math.max(score, weight + 100)
          }
          return score
        }
        const matches = directoryOrderedSearchIndex.flatMap((item, order) => {
          const { row } = item
          if ((category && !row.categories.includes(category))
            || (directoryListingFilter !== 'all'
              && (directoryListingFilter === 'listed' ? !row.catalogIndexEntry : Boolean(row.catalogIndexEntry)))) return []
          const declaresDesktop = row.catalogEntry?.compatibility?.profiles?.includes('desktop') === true
          if ((directoryClientFilter === 'declared' && !declaresDesktop)
            || (directoryClientFilter === 'undeclared' && declaresDesktop)) return []
          if (directoryReviewFilter !== 'all'
            && !((directoryReviewFilter === 'approved' && row.catalogIndexEntry?.status === 'approved')
              || (directoryReviewFilter === 'blocked' && row.catalogIndexEntry?.status === 'blocked')
              || (directoryReviewFilter === 'unlisted-catalog' && row.catalogIndexEntry?.status === 'unlisted')
              || (directoryReviewFilter === 'reviewing' && !row.catalogIndexEntry && row.candidateEntry?.status === 'reviewing')
              || (directoryReviewFilter === 'rejected' && !row.catalogIndexEntry && row.candidateEntry?.status === 'rejected')
              || (directoryReviewFilter === 'discovered' && !row.catalogIndexEntry && row.candidateEntry?.status === 'discovered')
              || (directoryReviewFilter === 'public-only' && !row.catalogIndexEntry && !row.candidateEntry))) return []
          if (!terms.length) return [{ row, order, score: 0 }]
          let score = 0
          for (const term of terms) {
            const fields = term.length <= 2
              ? [groupScore(item.identity, term, 1_000), groupScore(item.repository, term, 700), groupScore(item.keywords, term, 400)]
              : [groupScore(item.identity, term, 1_000), groupScore(item.repository, term, 700),
                groupScore(item.keywords, term, 400), groupScore(item.description, term, 100)]
            const termScore = Math.max(...fields)
            if (!termScore) return []
            score += termScore
          }
          return [{ row, order, score }]
        })
        if (terms.length) matches.sort((left, right) => right.score - left.score || left.order - right.order)
        return matches.map(({ row }) => row)
      }, [directoryOrderedSearchIndex, query, category, directoryListingFilter, directoryReviewFilter, directoryClientFilter])
      const directoryPageSize = ['recommended', 'essential'].includes(view) ? DESKTOP_RANKING_PAGE_SIZE : MARKET_PAGE_SIZE
      const directoryPageCount = Math.max(1, Math.ceil(directoryFiltered.length / directoryPageSize))
      const directoryCurrentPage = Math.min(page, directoryPageCount)
      const directoryVisible = directoryFiltered.slice((directoryCurrentPage - 1) * directoryPageSize, directoryCurrentPage * directoryPageSize)
      const directoryHasFilters = Boolean(query || category || directoryListingFilter !== 'all'
        || directoryReviewFilter !== 'all' || directoryClientFilter !== 'all')

      const closeActionPlan = () => {
        if (actionState.status === 'running') return
        setActionPlan(null)
        setConfirmation('')
        setActionState({ status: 'idle' })
        actionInFlight.current = false
      }
      const permissionsOf = entry => {
        const permissions = entry.details.permissions
        return '权限 ' + permissions.level + ' · 文件 ' + detailLabel('files', permissions.files)
          + ' · 网络 ' + detailLabel('network', permissions.network)
          + ' · 命令 ' + detailLabel('commands', permissions.commands)
          + ' · 凭据 ' + (permissions.credentials || []).map(value => detailLabel('credentials', value)).join(' / ')
      }
      const canManageBundle = (entry, bundle) => bundle?.installed === true
        && bundle.official !== true && bundle.optional !== true
        && !entry.packageName.startsWith('@deepseek-ai/')
        && entry.packageName !== 'dsh-safe-plugin-manager'
        && DESKTOP_COMMIT.test(entry.commit || '')
        && !bundle.readOnlyReason && desktopBundleMatchesCatalogEntry(entry, bundle)
      const actionAvailable = (action, entry, bundle) => {
        if (action === 'install' && entry.installMode === 'github-default-branch') return desktopDirectoryGitHubInstallReady(entry)
          && !bundle?.installed
          && typeof desktopPluginManager?.installBundle === 'function'
        if (inventoryState.status !== 'ready') return false
        if (action === 'install') {
          return ['approved', 'blocked'].includes(entry.status) && !bundle?.installed
            && entry.packageName !== 'dsh-safe-plugin-manager' && !entry.packageName.startsWith('@deepseek-ai/')
            && !desktopHasProtectedEntryId(entry) && desktopBlockedInstallReady(entry)
        }
        if (action === 'update') return desktopBundleNeedsUpdate(entry, bundle)
        if (!canManageBundle(entry, bundle)) return false
        if (action === 'remove') return bundle.removable === true
        if (action === 'enable') return entry.status === 'approved' && bundle.enabled === false
        if (action === 'disable') return bundle.enabled === true
        return false
      }
      const managerSupports = (action, entry = null) => {
        if (action === 'install') return typeof desktopPluginManager?.installBundle === 'function'
        if (action === 'update' && entry?.packageName === 'dsh-safe-plugin-manager') {
          return typeof desktopPluginManager?.installBundle === 'function'
            && typeof desktopPluginManager?.listBundles === 'function'
        }
        if (action === 'update') return typeof desktopPluginManager?.installBundle === 'function'
          && typeof desktopPluginManager?.removeBundle === 'function'
          && typeof desktopPluginManager?.listBundles === 'function'
        if (action === 'remove') return typeof desktopPluginManager?.removeBundle === 'function'
        if (action === 'enable' || action === 'disable') return typeof desktopPluginManager?.setBundleEnabled === 'function'
        return false
      }
      const beginAction = (action, entry) => {
        const bundle = installedBundleForEntry(entry)
        if (!actionAvailable(action, entry, bundle) || !managerSupports(action, entry)) return
        setDetailEntry(null)
        setActionPlan({ action, entry, confirmation: desktopActionConfirmation(action, entry),
          installedState: action === 'update' ? { version: bundle.version ?? null, source: bundle.source ?? null,
            enabled: bundle.enabled === true } : null })
        setConfirmation('')
        setActionState({ status: 'idle' })
        actionInFlight.current = false
      }
      const confirmAction = async () => {
        if (!actionPlan || confirmation !== actionPlan.confirmation || actionInFlight.current || loadState.status !== 'ready') return
        const { action, entry: plannedEntry } = actionPlan
        actionInFlight.current = true
        setActionState({ status: 'running' })
        let requestId = null
        let mutationStarted = false
        let inspectionNotice = null
        const manager = desktopPluginManager
        const directGithubInstall = plannedEntry.installMode === 'github-default-branch'
        const readDesktopInstalledBundle = async () => {
          const current = unwrapDesktopRemote(await withDesktopTimeout(
            manager.listBundles(), 'DESKTOP_INVENTORY_TIMEOUT', DESKTOP_OPERATION_TIMEOUT_MS,
          ), 'DESKTOP_INVENTORY_FAILED')
          if (!Array.isArray(current)) throw desktopFailure('DESKTOP_INVENTORY_INVALID')
          return current.find(item => item?.name === plannedEntry.packageName)
            || (plannedEntry.installMode === 'github-default-branch'
              ? current.find(item => desktopBundleConfirmsInstall(plannedEntry, item)) : null) || null
        }
        const installThroughDesktop = async (spec, enabled) => {
          requestId = window.crypto?.randomUUID?.()
          if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) {
            throw desktopFailure('INSTALL_REQUEST_ID_UNAVAILABLE')
          }
          mutationStarted = true
          try {
            return unwrapDesktopRemote(await withDesktopTimeout(manager.installBundle(spec, { enabled, requestId }),
              'DESKTOP_INSTALL_TIMEOUT', DESKTOP_OPERATION_TIMEOUT_MS), 'DESKTOP_INSTALL_FAILED')
          } catch (error) {
            const code = desktopErrorCode(error)
            const uncertain = /(?:TIMEOUT|RESULT_UNKNOWN|REMOTE_FAILED|UNAVAILABLE)/.test(code)
            if (uncertain && typeof manager.waitForInstall === 'function') {
              try {
                const recovered = unwrapDesktopRemote(await withDesktopTimeout(
                  manager.waitForInstall(requestId), 'DESKTOP_INSTALL_RESULT_TIMEOUT', DESKTOP_OPERATION_TIMEOUT_MS,
                ), 'DESKTOP_INSTALL_RESULT_UNAVAILABLE')
                if (recovered) return recovered
              } catch { /* Reconcile this request once; never submit it again. */ }
            }
            if (uncertain) error.recovery = 'unknown'
            throw error
          }
        }
        try {
          let fresh
          if (directGithubInstall) {
            let inventory = null
            try { inventory = await readDesktopInventorySnapshot() }
            catch (error) { setInventoryState({ status: 'error', code: desktopErrorCode(error) }) }
            if (inventory) setInventoryState({ status: 'ready' })
            fresh = {
              catalog: loadState.catalog,
              bundles: inventory?.bundles || loadState.bundles || [],
              runtimeVersion: inventory?.runtimeVersion ?? loadState.runtimeVersion ?? null,
            }
          } else fresh = await readDesktopStoreSnapshot()
          setLoadState({ status: 'ready', ...fresh })
          const entry = directGithubInstall ? plannedEntry : fresh.catalog.entries.find(item => item.id === plannedEntry.id)
          const bundle = directGithubInstall
            ? fresh.bundles.find(item => desktopBundleConfirmsInstall(plannedEntry, item))
              || fresh.bundles.find(item => item?.name === plannedEntry.packageName)
            : entry ? fresh.bundles.find(item => item?.name === entry.packageName) : null
          const catalogAllowsAction = directGithubInstall
            ? action === 'install' && desktopDirectoryGitHubInstallReady(entry)
            : entry && (action === 'install'
              ? ['approved', 'blocked'].includes(entry.status) && desktopBlockedInstallReady(entry)
              : action === 'update' ? entry.status === 'approved'
                : action === 'enable' ? entry.status === 'approved' : ['approved', 'blocked'].includes(entry.status))
          const installedStateMatchesPlan = action !== 'update' || (bundle && actionPlan.installedState
            && (bundle.version ?? null) === actionPlan.installedState.version
            && (bundle.source ?? null) === actionPlan.installedState.source
            && (bundle.enabled === true) === actionPlan.installedState.enabled)
          const sourceMatchesPlan = directGithubInstall
            ? entry.repositoryUrl === plannedEntry.repositoryUrl
              && desktopInstallSpecifier(entry) === desktopInstallSpecifier(plannedEntry)
            : entry && entry.packageName === plannedEntry.packageName
              && entry.version === plannedEntry.version && entry.status === plannedEntry.status
              && entry.statusReason === plannedEntry.statusReason && entry.updatePolicy === plannedEntry.updatePolicy
              && desktopInstallSpecifier(entry) === desktopInstallSpecifier(plannedEntry)
          if (!catalogAllowsAction || !sourceMatchesPlan || !installedStateMatchesPlan
            || !actionAvailable(action, entry, bundle) || !managerSupports(action, entry)) {
            throw desktopFailure('CATALOG_OR_PROFILE_STATE_CHANGED')
          }
          let outcome
          if (action === 'install' || action === 'update') {
            const spec = desktopInstallSpecifier(entry)
            if (typeof manager.inspect === 'function') {
              try {
                const inspected = unwrapDesktopRemote(await withDesktopTimeout(
                  manager.inspect(spec), 'DESKTOP_SOURCE_INSPECTION_TIMEOUT', DESKTOP_CATALOG_TIMEOUT_MS,
                ), 'DESKTOP_SOURCE_INSPECTION_FAILED')
                if (!inspected || inspected.status !== 'accepted') inspectionNotice = desktopInspectionAdvice(inspected)
              } catch (error) {
                inspectionNotice = `DSH Desktop 预检未完成（${desktopErrorCode(error)}）；安装请求仍交由官方安装器最终判断。`
              }
            }
            if (action === 'install') {
              outcome = await installThroughDesktop(spec, true)
            } else {
              const previous = actionPlan.installedState
              const previousCommit = desktopSourceRevision(previous?.source)
              const isStoreSelfUpdate = entry.packageName === 'dsh-safe-plugin-manager'
              if (!previous || !desktopBundleMatchesCatalogEntry(entry, bundle)
                || (!isStoreSelfUpdate && previousCommit === null)) {
                throw desktopFailure('DESKTOP_UPDATE_PREVIOUS_SOURCE_UNVERIFIED')
              }
              const restorePreviousThroughDesktop = async () => {
                const restored = await installThroughDesktop(previous.source, previous.enabled === true)
                if (desktopOperationSucceeded(restored)) return restored
                if (restored?.application === 'already-installed') {
                  const current = await readDesktopInstalledBundle()
                  if (desktopBundleConfirmsPreviousInstall(entry, current, previous)) return restored
                }
                throw desktopOperationError(restored, 'DESKTOP_UPDATE_RESTORE_FAILED')
              }
              const markRestoreFailure = (targetError, restoreError) => {
                const code = desktopErrorCode(restoreError)
                if (restoreError?.recovery === 'unknown' || /(?:TIMEOUT|RESULT_UNKNOWN|REMOTE_FAILED|UNAVAILABLE)/.test(code)) {
                  targetError.recovery = 'unknown'
                  return
                }
                targetError.recovery = 'recovery-required'
                targetError.recoveryReason = desktopSafeReasonText(restoreError?.reason) || code
              }
              if (entry.packageName !== 'dsh-safe-plugin-manager') {
                let removal
                try {
                  mutationStarted = true
                  removal = unwrapDesktopRemote(await withDesktopTimeout(
                    manager.removeBundle(entry.packageName), 'DESKTOP_UPDATE_REMOVE_TIMEOUT', DESKTOP_OPERATION_TIMEOUT_MS,
                  ), 'DESKTOP_UPDATE_REMOVE_FAILED')
                  const stopProfile = removal?.error?.code === 'stop-profile' || removal?.code === 'stop-profile'
                  if (!desktopOperationSucceeded(removal) && !stopProfile) {
                    throw desktopOperationError(removal, 'DESKTOP_UPDATE_REMOVE_FAILED')
                  }
                } catch (error) {
                  if (desktopErrorCode(error) !== 'stop-profile') {
                    if (!error.recovery) {
                      const code = desktopErrorCode(error)
                      if (/(?:TIMEOUT|RESULT_UNKNOWN|REMOTE_FAILED|UNAVAILABLE)/.test(code)) {
                        error.recovery = 'unknown'
                      } else {
                        let current
                        try { current = await readDesktopInstalledBundle() }
                        catch {
                          error.recovery = 'unknown'
                        }
                        if (!error.recovery && desktopBundleConfirmsPreviousInstall(entry, current, previous)) {
                          error.recovery = 'old-version-preserved'
                        } else if (!error.recovery && current?.installed === true) {
                          error.recovery = 'recovery-required'
                          error.recoveryReason = 'DSH reports an installed source that does not match the previous Commit.'
                        } else if (!error.recovery) {
                          try {
                            const restored = await restorePreviousThroughDesktop()
                            error.recovery = 'old-version-restored'
                            error.recoveryApplication = restored.application
                          } catch (restoreError) { markRestoreFailure(error, restoreError) }
                        }
                      }
                    }
                    throw error
                  }
                }
              }
              try {
                outcome = await installThroughDesktop(spec, previous.enabled === true)
                if (!desktopOperationSucceeded(outcome)) throw desktopOperationError(outcome, 'DESKTOP_UPDATE_INSTALL_FAILED')
              } catch (error) {
                if (error.recovery === 'unknown') throw error
                const code = desktopErrorCode(error)
                if (/(?:TIMEOUT|RESULT_UNKNOWN|REMOTE_FAILED|UNAVAILABLE)/.test(code)) {
                  error.recovery = 'unknown'
                  throw error
                }
                let current
                try { current = await readDesktopInstalledBundle() }
                catch {
                  error.recovery = 'unknown'
                  throw error
                }
                if (desktopBundleConfirmsInstall(entry, current)) {
                  outcome = { application: 'already-installed' }
                } else if (desktopBundleConfirmsPreviousInstall(entry, current, previous)) {
                  error.recovery = 'old-version-preserved'
                  throw error
                } else if (current?.installed === true) {
                  error.recovery = 'recovery-required'
                  error.recoveryReason = 'DSH reports an installed source that matches neither the previous nor target Commit.'
                  throw error
                } else if (isStoreSelfUpdate) {
                  error.recovery = 'recovery-required'
                  error.recoveryReason = 'DSH reports the Store missing after its direct update request; no floating source was submitted for restoration.'
                  throw error
                } else {
                  try {
                    const restored = await restorePreviousThroughDesktop()
                    error.recovery = 'old-version-restored'
                    error.recoveryApplication = restored.application
                  } catch (restoreError) { markRestoreFailure(error, restoreError) }
                  throw error
                }
              }
            }
          } else if (action === 'remove') {
            mutationStarted = true
            outcome = unwrapDesktopRemote(await withDesktopTimeout(
              manager.removeBundle(entry.packageName), 'DESKTOP_REMOVE_TIMEOUT', DESKTOP_OPERATION_TIMEOUT_MS,
            ), 'DESKTOP_REMOVE_FAILED')
          } else {
            mutationStarted = true
            outcome = unwrapDesktopRemote(await withDesktopTimeout(
              manager.setBundleEnabled(entry.packageName, action === 'enable'), 'DESKTOP_TOGGLE_TIMEOUT', DESKTOP_OPERATION_TIMEOUT_MS,
            ), 'DESKTOP_TOGGLE_FAILED')
          }
          if (!desktopOperationSucceeded(outcome) && outcome?.application !== 'already-installed') {
            throw desktopOperationError(outcome, 'DESKTOP_OPERATION_FAILED')
          }
          setActionState({ status: 'success', application: outcome.application, inspectionNotice })
          await refresh()
        } catch (error) {
          const code = desktopErrorCode(error)
          const uncertain = mutationStarted && /(?:TIMEOUT|RESULT_UNKNOWN|REMOTE_FAILED|UNAVAILABLE)/.test(code)
          if (action === 'update' && error.recovery) {
            const reason = typeof error.reason === 'string' ? error.reason : null
            if (error.recovery === 'unknown'
              && await desktopInstallIsAlreadyPresent(manager, actionPlan.entry)) {
              setActionState({ status: 'success', application: 'already-installed', inspectionNotice })
              await refresh()
              return
            }
            const status = error.recovery === 'unknown' ? 'unknown' : 'error'
            setActionState({ status, code, reason, inspectionNotice,
              recovery: error.recovery, recoveryReason: error.recoveryReason || null,
              recoveryApplication: error.recoveryApplication || null })
            await refresh()
            return
          }
          if (uncertain && ['install', 'update'].includes(action) && requestId && typeof manager.waitForInstall === 'function') {
            try {
              const recovered = unwrapDesktopRemote(await withDesktopTimeout(
                manager.waitForInstall(requestId), 'DESKTOP_INSTALL_RESULT_TIMEOUT', DESKTOP_OPERATION_TIMEOUT_MS,
              ),
                'DESKTOP_INSTALL_RESULT_UNAVAILABLE')
              if (recovered) {
                if (['applied', 'restart-required'].includes(recovered.application)) {
                  setActionState({ status: 'success', application: recovered.application, inspectionNotice })
                } else {
                  const recoveredCode = desktopErrorCode(recovered.error || recovered)
                  const reason = desktopManagerReason(recovered)
                  if (await desktopInstallIsAlreadyPresent(manager, actionPlan.entry)) {
                    setActionState({ status: 'success', application: 'already-installed', inspectionNotice })
                  } else {
                    setActionState({ status: 'error', code: recoveredCode, reason, inspectionNotice })
                  }
                }
                await refresh()
                return
              }
            } catch { /* Refresh the one submitted request; never submit it again. */ }
          }
          if (mutationStarted && ['install', 'update'].includes(action) && await desktopInstallIsAlreadyPresent(manager, actionPlan.entry)) {
            setActionState({ status: 'success', application: 'already-installed', inspectionNotice })
            await refresh()
            return
          }
          if (uncertain) {
            setActionState({ status: 'unknown', code })
            await refresh()
            return
          }
          const reason = typeof error?.reason === 'string' ? error.reason
            : !code.startsWith('DESKTOP_') ? `DSH Desktop 官方校验返回：${code}` : null
          setActionState({ status: 'error', code, reason, inspectionNotice })
          if (mutationStarted) await refresh()
        } finally {
          actionInFlight.current = false
        }
      }

      const desktopInstallIsAlreadyPresent = async (manager, entry) => {
        if (!manager || typeof manager.listBundles !== 'function') return false
        try {
          const current = unwrapDesktopRemote(await withDesktopTimeout(
            manager.listBundles(), 'DESKTOP_INVENTORY_TIMEOUT',
          ), 'DESKTOP_INVENTORY_FAILED')
          return Array.isArray(current) && current.some(bundle => desktopBundleConfirmsInstall(entry, bundle))
        } catch {
          return false
        }
      }

      const actionLabel = action => ({ install: '安装', update: '更新', remove: '卸载', enable: '启动', disable: '关闭' }[action] || action)
      const actionBlockReason = (action, entry, bundle) => {
        if (entry.installMode === 'github-default-branch') {
          if (!desktopDirectoryGitHubInstallReady(entry)) return '缺少规范 GitHub DSH 插件来源，商城不会提交此条目。'
          if (!managerSupports('install', entry)) return '当前 DSH Desktop 未提供官方 installBundle 接口。'
          return '确认后会把 GitHub 默认分支交给 DSH Desktop；本机安装清单未知时也由 DSH 决定结果。'
        }
        if (inventoryState.status === 'loading') return '正在读取 DSH 安装清单；完整目录仍可浏览和搜索。'
        if (inventoryState.status === 'error') return `DSH 安装清单暂不可用（${inventoryState.code}）；完整目录仍可浏览和搜索，刷新后再执行安装管理。`
        if (entry.packageName === 'dsh-safe-plugin-manager') {
          if (action !== 'update') return '商城自身不提供商城自安装、启停或卸载；首次安装请用 DSH Desktop，之后可在此提交固定 Commit 更新。'
          if (!bundle?.installed) return '请先通过 DSH Desktop 安装商城；安装后可在此提交固定 Commit 更新。'
          if (bundle.official === true || bundle.optional === true || bundle.readOnlyReason
            || !desktopBundleMatchesCatalogEntry(entry, bundle)) return 'DSH 已安装来源受保护或与商城仓库不一致，商城不会更新。'
          if (!DESKTOP_COMMIT.test(entry.commit || '')) return 'Catalog 固定 Commit 无效，无法提交更新。'
          if (!managerSupports('update', entry)) return '当前 DSH Desktop 未提供官方 installBundle / listBundles 接口。'
          if (!desktopStoreNeedsUpdate(entry, bundle)) return '商城当前版本不低于 Catalog 固定版本，未提交降级更新。'
          return '商城更新条件未满足。'
        }
        if (entry.packageName.startsWith('@deepseek-ai/')) return 'DSH 官方组件不由商城管理。'
        if (action === 'install' && entry.status === 'blocked') {
          return desktopBlockedInstallReady(entry)
            ? 'Catalog 有审核建议；确认后可提交给 DSH Desktop 官方管理器检查，最终结果以 DSH 返回为准。'
            : '此条目缺少可交由 DSH 检查的固定来源或条目 ID。'
        }
        if (['install', 'update', 'enable'].includes(action) && entry.status !== 'approved') return '此条目尚未通过 DSH STORE 审核；仅 Catalog 已拦截条目可在确认后交由 DSH 检查安装。'
        if (!managerSupports(action, entry)) return '当前 DSH Desktop 未提供对应的官方插件管理器接口。'
        if (action === 'install') {
          if (bundle?.installed) return '当前 Profile 已安装此插件。'
          return '安装条件未满足。'
        }
        if (action === 'update') {
          if (!bundle?.installed) return '当前 Profile 尚未安装此插件。'
          if (bundle.official === true || bundle.optional === true || bundle.readOnlyReason
            || !desktopBundleMatchesCatalogEntry(entry, bundle)) return '已安装 Bundle 受 DSH 保护或来源与 Catalog 仓库不一致，商城不会更新。'
          if (!DESKTOP_COMMIT.test(entry.commit || '')) return 'Catalog 固定 Commit 无效，无法提交更新。'
          if (!desktopBundleNeedsUpdate(entry, bundle)) return 'DSH 已安装来源已经是 Catalog 当前固定 Commit。'
          if (!managerSupports('update', entry)) return '当前 DSH Desktop 未提供官方 installBundle 更新接口。'
          return '更新条件未满足。'
        }
        if (!bundle?.installed) return '当前 Profile 尚未安装此插件。'
        if (bundle.official === true || bundle.optional === true || bundle.readOnlyReason
          || !desktopBundleMatchesCatalogEntry(entry, bundle)) return '已安装 Bundle 受 DSH 保护或来源与 Catalog 仓库不一致，商城不会管理。'
        if (action === 'remove' && bundle.removable !== true) return 'DSH 官方插件管理器未允许卸载此 Bundle。'
        if (action === 'enable' && bundle.enabled !== false) return '此插件当前已启动。'
        if (action === 'disable' && bundle.enabled !== true) return '此插件当前未启动。'
        return '当前条件未满足，商城没有执行操作。'
      }
      const actionButtons = (entry, bundle, { includeUnavailable = false, allActions = false } = {}) => {
        const actions = []
        const add = action => {
          const available = actionAvailable(action, entry, bundle) && managerSupports(action, entry)
          if (!available && !includeUnavailable) return
          const reason = available ? null : actionBlockReason(action, entry, bundle)
          const label = action === 'install' && entry.status === 'blocked' ? '交由 DSH 检查安装' : actionLabel(action)
          actions.push(React.createElement(Button, {
            key: action, primary: ['install', 'update'].includes(action) && available, danger: action === 'remove',
            disabled: !available, onClick: available ? () => beginAction(action, entry) : undefined,
            ariaLabel: reason ? label + '（已禁用：' + reason + '）' : undefined,
            title: reason || undefined,
          }, label))
        }
        if (allActions) {
          for (const action of ['install', 'update', 'enable', 'disable', 'remove']) add(action)
        } else if (bundle?.installed) {
          add('update')
          add(bundle.enabled === true ? 'disable' : 'enable')
          add('remove')
        } else add('install')
        return actions
      }
      const directoryGitHubInstallButton = (row, bundle) => {
        if (bundle?.installed === true) return null
        const entry = desktopDirectoryGitHubInstallEntry(row)
        if (!entry) return null
        const available = actionAvailable('install', entry, bundle) && managerSupports('install', entry)
        const reason = available ? null : actionBlockReason('install', entry, bundle)
        return React.createElement(Button, {
          key: 'github-install', compact: true,
          primary: available && !['approved', 'blocked'].includes(row.catalogEntry?.status),
          disabled: !available,
          onClick: available ? () => beginAction('install', entry) : undefined,
          ariaLabel: reason ? 'GitHub 地址交由 DSH 安装（已禁用：' + reason + '）' : undefined,
          title: reason || undefined,
        }, 'GitHub 地址交由 DSH 安装')
      }
      const detailActionMessage = (entry, bundle) => {
        if (entry.packageName === 'dsh-safe-plugin-manager') {
          return actionAvailable('update', entry, bundle) && managerSupports('update', entry)
            ? null : actionBlockReason('update', entry, bundle)
        }
        const actions = bundle?.installed ? ['update', bundle.enabled === true ? 'disable' : 'enable', 'remove'] : ['install']
        const blocked = actions.filter(action => !actionAvailable(action, entry, bundle) || !managerSupports(action, entry))
          .map(action => actionLabel(action) + '已禁用：' + actionBlockReason(action, entry, bundle))
        return [...new Set(blocked)].join('；') || null
      }
      const detailFooter = detailEntry => {
        return React.createElement('div', { style: styles.actions },
          React.createElement(Button, { onClick: () => setDetailEntry(null) }, '关闭详情'))
      }
      const detailBundle = detailEntry ? installedByName.get(detailEntry.packageName) : null
      const detailCompatibility = detailEntry ? desktopCatalogCompatibility(detailEntry, loadState.runtimeVersion) : null
      const detailOperationsMessage = detailEntry ? detailActionMessage(detailEntry, detailBundle) : null
      const detailInstalledState = inventoryState.status !== 'ready'
        ? `DSH 安装状态暂不可核实（${inventoryState.code || '正在读取'}）`
        : detailBundle?.installed === true
        ? '本机已' + (detailBundle.enabled === true ? '启动' : detailBundle.enabled === false ? '关闭' : '安装')
          + ' · 版本 ' + (typeof detailBundle.version === 'string' && DESKTOP_VERSION.test(detailBundle.version) ? detailBundle.version : '未知')
          + ' · ' + (desktopBundleMatchesCatalogEntry(detailEntry, detailBundle) ? '安装来源与 Catalog 仓库匹配' : '安装来源未核验')
        : '本机未安装'
      const actionBundle = actionPlan ? installedBundleForEntry(actionPlan.entry) : null
      const actionInstalledSummary = actionPlan?.entry.installMode === 'github-default-branch' && inventoryState.status !== 'ready'
        ? 'DSH 安装清单当前不可用；本次请求仍会交给 DSH 官方安装器检查。'
        : actionBundle?.installed === true
          ? '当前 Desktop 安装版本：' + (typeof actionBundle.version === 'string' && DESKTOP_VERSION.test(actionBundle.version) ? actionBundle.version : '未知')
            + ' · ' + (actionBundle.enabled === true ? '已启动' : actionBundle.enabled === false ? '已关闭' : '状态未知')
          : '当前 Desktop 尚未安装'
      const selectActionConfirmCommand = event => {
        const element = event.currentTarget
        const selectionDocument = element.ownerDocument
        const range = selectionDocument.createRange()
        range.selectNodeContents(element)
        const selection = selectionDocument.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
      const operationFooter = actionPlan ? React.createElement('div', { style: styles.actions },
        actionState.status === 'success' ? React.createElement(Button, { primary: true, onClick: closeActionPlan }, '完成')
          : actionState.status === 'unknown' ? React.createElement(Button, { onClick: closeActionPlan }, '关闭并刷新核对')
            : React.createElement(Button, { disabled: actionState.status === 'running', onClick: closeActionPlan }, '取消'),
        !['success', 'unknown'].includes(actionState.status) ? React.createElement(Button, {
          primary: true, disabled: actionState.status === 'running' || confirmation !== actionPlan.confirmation,
          onClick: confirmAction,
        }, actionState.status === 'running' ? '正在由 DSH 处理…' : '确认并' + actionLabel(actionPlan.action)) : null) : null

      const userInstalledBundles = [...installedByName.values()].filter(bundle => bundle?.installed === true
        && !isOfficialDesktopBundle(bundle))
      const installedCount = userInstalledBundles.length
      const officialPluginCount = [...installedByName.values()].filter(bundle => bundle?.installed === true
        && isOfficialDesktopBundle(bundle)).length
      const enabledCount = userInstalledBundles.filter(bundle => bundle.enabled === true).length
      const disabledCount = userInstalledBundles.filter(bundle => bundle.enabled === false).length
      const hasFilters = Boolean(query || category || listFilter !== 'all' || clientFilter !== 'all' || sortBy !== 'recommended')
      const directoryReviewOptions = [
        ['all', '所有审核状态', directoryCounts.all], ['approved', 'Catalog 已审核', directoryCounts.approved],
        ['blocked', 'Catalog 已拦截', directoryCounts.blocked], ['unlisted-catalog', 'Catalog 未上架', directoryCounts.withdrawn],
        ['reviewing', '候选审核中', directoryCounts.reviewing], ['rejected', '候选审核未通过', directoryCounts.rejected],
        ['discovered', '候选待审核', directoryCounts.discovered], ['public-only', '官网发现未收录', directoryCounts.publicOnly],
      ]
      const directoryCategoryLabel = id => desktopDirectoryCategoryLabel(id, categoryLabels)
      const clearDirectoryFilters = () => {
        setQuery(''); setCategory(''); setDirectoryListingFilter('all'); setDirectoryReviewFilter('all')
        setDirectoryClientFilter('all'); setSortBy('recommended'); setPage(1)
      }
      const resetInventoryFilters = () => {
        setQuery(''); setCategory(''); setListFilter('all'); setClientFilter('all'); setDirectoryClientFilter('all')
        setSortBy('recommended'); setPage(1)
      }
      const directoryViewContent = React.createElement(React.Fragment, null,
        React.createElement('div', { style: styles.marketDirectoryControls, 'aria-label': '目录搜索和筛选' },
          React.createElement('div', { style: styles.marketToolbar },
            React.createElement('input', {
              type: 'search', value: query, onChange: event => { setQuery(event.target.value); setPage(1) },
              style: { ...styles.input, flex: '1 1 280px', minWidth: '180px', height: '36px', borderRadius: '8px' },
              placeholder: '搜索插件名称、用途或 GitHub 仓库', 'aria-label': '搜索全部已知插件', autoComplete: 'off', spellCheck: false,
            }),
            view === 'directory' ? React.createElement('select', {
              value: sortBy === 'recent' ? 'recommended' : sortBy, onChange: event => { setSortBy(event.target.value); setPage(1) },
              style: { ...styles.select, height: '36px', borderRadius: '8px' }, 'aria-label': '排序方式',
            }, React.createElement('option', { value: 'recommended' }, '分类、收录与 Stars'),
            React.createElement('option', { value: 'name' }, '名称 A-Z'), React.createElement('option', { value: 'stars' }, 'Stars 从高到低')) : null,
            directoryHasFilters ? React.createElement(Button, { compact: true, onClick: clearDirectoryFilters }, '清除筛选') : null),
          React.createElement('div', { style: styles.marketFilterRow },
            React.createElement('div', { style: styles.marketFilterTabs, role: 'group', 'aria-label': '按官网目录收录状态筛选' },
              [['all', '全部已知', directoryCounts.all], ['listed', 'Catalog 有记录', directoryCounts.listed], ['unlisted', 'Catalog 未收录', directoryCounts.unlisted]]
                .map(([id, label, count]) => React.createElement(Button, {
                  key: id, compact: true, primary: directoryListingFilter === id, ariaPressed: directoryListingFilter === id,
                  onClick: () => { setDirectoryListingFilter(id); setPage(1) },
                }, `${label} · ${count}`))),
            React.createElement('div', { style: styles.marketFacetGroup },
              React.createElement('select', {
                value: category, onChange: event => { setCategory(event.target.value); setPage(1) },
                style: { ...styles.select, height: '34px', borderRadius: '8px' }, 'aria-label': '按分类筛选',
              }, React.createElement('option', { value: '' }, `全部分类 · ${activeDirectoryRows.length}`),
              categoryIds.map(id => React.createElement('option', { key: id, value: id }, `${directoryCategoryLabel(id)} · ${directoryCategoryCounts.get(id) || 0}`))),
              React.createElement('select', {
                value: directoryClientFilter, onChange: event => { setDirectoryClientFilter(event.target.value); setPage(1) },
                style: { ...styles.select, minWidth: '190px', height: '34px', borderRadius: '8px' }, 'aria-label': '按 DSH Desktop 适配声明筛选',
                title: '只按 Catalog 是否声明 Desktop Profile 筛选；未声明不等于不兼容。',
              }, React.createElement('option', { value: 'all' }, `全部适配状态 · ${directoryClientCounts.all}`),
              React.createElement('option', { value: 'declared' }, `已声明适配 DSH Desktop · ${directoryClientCounts.declared}`),
              React.createElement('option', { value: 'undeclared' }, `未声明适配 DSH Desktop · ${directoryClientCounts.undeclared}`)),
              React.createElement('select', {
                value: directoryReviewFilter, onChange: event => { setDirectoryReviewFilter(event.target.value); setPage(1) },
                style: { ...styles.select, height: '34px', borderRadius: '8px' }, 'aria-label': '按 DSH STORE 审核状态筛选',
              }, directoryReviewOptions.map(([id, label, count]) => React.createElement('option', { key: id, value: id }, `${label} · ${count}`)))))),
        React.createElement('div', { style: styles.marketResults },
          React.createElement('span', { style: styles.muted, role: 'status' },
            `${directoryFiltered.length} 条结果 · 第 ${directoryCurrentPage} / ${directoryPageCount} 页 · ${view === 'recommended' ? '官网推荐榜' : view === 'essential' ? '官网必装榜' : `${directoryCounts.approved} 已审核 · ${directoryCounts.blocked} 已拦截 · ${directoryCounts.unlisted} 未收录`}`)),
        ['recommended', 'essential'].includes(view) && rankingState.status === 'loading'
          ? React.createElement('div', { style: styles.marketEmpty, role: 'status' }, '正在读取官网榜单并核验发布摘要…') : null,
        ['recommended', 'essential'].includes(view) && rankingState.status === 'error'
          ? React.createElement('div', { style: styles.notice, role: 'alert' },
            `官网榜单暂不可用（${rankingState.code}）；完整插件目录和 Catalog 审核记录仍可使用。`,
            React.createElement(Button, { compact: true, onClick: loadRankings }, '重试读取榜单')) : null,
        ['recommended', 'essential'].includes(view) && rankingState.status === 'ready'
          ? React.createElement('div', { style: styles.muted, role: 'note' },
            view === 'recommended'
              ? '推荐依据沿用官网榜单（公开互动、周度星标和标注的官方工具位）；推荐不代表安全审查或兼容验证。'
              : '必装榜沿用官网每周分类榜；“分类高星补位”表示当前能核对到的星标顺序。若有插件星标数未知，显示第 1 位也不代表已确认该分类冠军。榜单位置不代表所有用户都必须安装，也不代表安全审查。') : null,
        directoryState.status === 'loading' ? React.createElement('div', { style: styles.marketEmpty, role: 'status' },
          React.createElement('strong', { style: styles.name }, '正在读取官网完整目录'),
          React.createElement('span', { style: styles.muted }, '搜索框和分类筛选会在目录载入后覆盖全部记录。')) : null,
        directoryState.status === 'error' ? React.createElement('div', { style: styles.notice, role: 'alert' },
          `官网完整目录暂时不可用（${directoryState.code}）；下方仅显示 Catalog 回退记录，搜索结果不代表全部插件。可以刷新后重试。`) : null,
        directoryState.status === 'ready' && directoryState.snapshot.candidateError
          ? React.createElement('div', { style: styles.notice, role: 'status' }, '候选审核补充记录暂不可用；公开发现目录与 Catalog 记录仍可浏览。') : null,
        directoryFiltered.length === 0 && directoryState.status !== 'loading'
          && (!['recommended', 'essential'].includes(view) || rankingState.status === 'ready')
          ? React.createElement('div', { style: styles.marketEmpty },
            React.createElement('strong', { style: styles.name }, '没有匹配的插件'),
            React.createElement('span', { style: styles.muted }, '试试名称、用途、分类或 GitHub 仓库；也可以清除筛选。'),
            directoryHasFilters ? React.createElement(Button, { compact: true, onClick: clearDirectoryFilters }, '清除筛选') : null) : null,
        React.createElement('div', {
          style: styles.marketListViewport, 'aria-label': '全部已知插件结果',
        }, React.createElement('div', { style: styles.marketGrid, role: 'list', 'aria-label': '全部已知插件' }, directoryVisible.map(row => {
          const entry = row.catalogEntry
          const catalogIndexEntry = row.catalogIndexEntry
          const githubInstallButton = directoryGitHubInstallButton(row,
            (entry && installedByName.get(entry.packageName))
              || (row.repositoryUrl ? installedByRepository.get(row.repositoryUrl.toLowerCase()) : null))
          const packageName = entry?.packageName || catalogIndexEntry?.packageName || row.packageName || row.alias || row.sourceId
          const installedBundle = (entry && installedByName.get(entry.packageName))
            || (row.repositoryUrl ? installedByRepository.get(row.repositoryUrl.toLowerCase()) : null)
          const statusLabel = desktopDirectoryStatusLabel(row)
          const catalogStatus = catalogIndexEntry?.status || entry?.status
          const statusTone = catalogStatus === 'approved' ? 'var(--dsw-alias-state-success-primary)'
            : catalogStatus === 'blocked' || row.candidateEntry?.status === 'rejected'
              ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)'
          const installedLabel = installedBundle?.installed === true
            ? installedBundle.enabled === true ? 'DSH 已安装 · 已启动'
              : installedBundle.enabled === false ? 'DSH 已安装 · 已关闭' : 'DSH 已安装'
            : null
          const rankingEntry = row.rankingEntry
          const reason = desktopSafeReasonText(rankingEntry?.listingStatus === 'not-listed'
            ? rankingEntry.listingReason : entry?.statusReason || row.candidateEntry?.statusReason, 2_000)
          const unmanagedMessage = entry && installedBundle?.installed === true && !canManageBundle(entry, installedBundle)
            ? installedBundle.official === true ? '官方组件不由商城管理' : '已安装来源与商城记录不一致，商城不管理'
            : ''
          const kindLabel = row.kind === 'ecosystem-app' ? 'Ecosystem app'
            : row.kind === 'ecosystem-plugin' ? 'Ecosystem plugin'
              : row.source === 'catalog' ? 'Catalog-only record'
                : row.source === 'candidate' ? '候选记录' : '官网公开发现'
          const rankingLabel = rankingEntry?.officialToolPick ? 'DSH 官方工具展示位'
            : rankingEntry?.communityRecommendation ? '作者互动推荐'
              : rankingEntry?.recommendationKind === 'community-stars' ? '每周星标推荐'
                : rankingEntry?.wins?.length ? `分类星标第一 · ${rankingEntry.wins.map(item => item.zh).join(' / ')}`
                  : rankingEntry?.categoryPick
                    ? `${rankingEntry.categoryPick.zh || rankingEntry.categoryPick.id} · 分类补位 · 可查星标第 ${rankingEntry.categoryPick.observedRank} 位${rankingEntry.categoryPick.unknownStars ? ` · ${rankingEntry.categoryPick.unknownStars} 个插件星标未知，冠军未确认` : ''}`
                    : ''
          return React.createElement('article', { key: row.id, style: styles.marketCard, role: 'listitem',
            ...(rankingEntry ? { 'data-market-entry-id': rankingEntry.id } : {}) },
            React.createElement('div', { style: styles.cardHeader },
              React.createElement('div', { style: styles.marketCardTitle }, row.name || packageName),
              React.createElement('div', { style: styles.marketBadges },
                React.createElement(StatusPill, { label: statusLabel, tone: statusTone }),
                installedLabel ? React.createElement(StatusPill, { label: installedLabel, tone: 'var(--dsw-alias-state-success-primary)' }) : null)),
            React.createElement('div', { style: styles.code }, packageName),
            React.createElement('div', { style: styles.cardDescription }, row.description || '官网暂未提供插件说明。'),
            React.createElement('div', { style: styles.marketBadges },
              React.createElement('span', { style: styles.badge }, kindLabel),
              entry ? React.createElement('span', { style: styles.badge },
                'DSH Desktop 客户端：' + desktopClientAdaptationLabel(entry.compatibility.profiles)) : null,
              ...(row.categories || []).map(id => React.createElement('span', { key: id, style: styles.badge }, directoryCategoryLabel(id))),
              row.stars > 0 ? React.createElement('span', { style: styles.badge }, `★ ${new Intl.NumberFormat('zh-CN').format(row.stars)}`) : null,
              row.candidateEntry ? React.createElement('span', { style: styles.badge }, `候选：${row.candidateEntry.status}`) : null,
              rankingLabel ? React.createElement('span', { style: styles.badge }, rankingLabel) : null),
            reason ? React.createElement(ReviewAdvice, { reason, compact: true }) : null,
            React.createElement('div', { style: styles.cardFooter },
              React.createElement('div', { style: styles.marketCardActions },
                entry && ['approved', 'blocked'].includes(entry.status) ? React.createElement(React.Fragment, null,
                  ...actionButtons(entry, installedBundle, { includeUnavailable: true }),
                  githubInstallButton,
                  unmanagedMessage ? React.createElement('span', { key: 'unmanaged', style: styles.muted }, unmanagedMessage) : null,
                  React.createElement(Button, { compact: true, onClick: () => setDetailEntry(entry) }, '查看详情'))
                  : entry ? React.createElement(React.Fragment, null,
                    githubInstallButton,
                    React.createElement(Button, { compact: true, onClick: () => setDetailEntry(entry) }, '查看详情'))
                    : githubInstallButton || React.createElement('span', { style: styles.muted },
                      installedBundle?.installed ? '已由 DSH Desktop 安装' : '目录记录仅供浏览 · 无安装操作')),
              row.repositoryUrl ? React.createElement('a', { href: row.repositoryUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, 'GitHub 源码 ↗') : null,
              row.detailUrl ? React.createElement('a', { href: row.detailUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, '官网详情 ↗') : null,
              rankingEntry?.communityRecommendation ? React.createElement('a', {
                href: rankingEntry.communityRecommendation.evidenceUrl, target: '_blank', rel: 'noreferrer', style: styles.link,
              }, '推荐依据 ↗') : null))
        }))),
        React.createElement(Pagination, { pagination: {
          page: directoryCurrentPage, pageCount: directoryPageCount,
          hasPrevious: directoryCurrentPage > 1, hasNext: directoryCurrentPage < directoryPageCount,
        }, loading: directoryState.status === 'loading' || rankingState.status === 'loading', onPageChange: setPage }),
        directoryState.status === 'ready' ? React.createElement('div', { style: styles.muted },
          `公开索引生成于 ${directoryState.snapshot.discovery.source.generatedAt.slice(0, 10)} · 数据来源 dsh.so（CC BY 4.0，保留署名） · Catalog 收录状态不代表审核通过。`) : null)

      const catalogViewContent = React.createElement(React.Fragment, null,
        view === 'official' ? React.createElement('div', { style: styles.notice, role: 'note' },
          '这里只展示 Desktop 安装清单中标记为官方或随 DSH 提供的组件。商城只读显示本机状态，安装、启停和卸载由 DSH Desktop 管理。') : null,
        installedInventoryUnavailable ? React.createElement('div', { style: styles.notice, role: 'status' },
          `DSH 安装清单${inventoryState.status === 'loading' ? '正在读取' : `暂不可用（${inventoryState.code}）`}；当前无法确认已安装列表，请刷新后重试。`) : null,
        React.createElement('div', { style: styles.marketToolbar },
          React.createElement('input', {
            type: 'search', value: query, onChange: event => { setQuery(event.target.value); setPage(1) },
            style: { ...styles.input, flex: '1 1 280px', minWidth: '180px', height: '36px', borderRadius: '8px' },
            placeholder: view === 'official' ? '搜索官方插件包名、版本或来源' : '搜索名称、用途、别名、权限或 GitHub 仓库',
            'aria-label': view === 'official' ? '搜索官方插件' : '搜索插件',
          }),
          React.createElement('select', {
            value: sortBy, onChange: event => { setSortBy(event.target.value); setPage(1) },
            style: { ...styles.select, height: '36px', borderRadius: '8px' }, 'aria-label': '排序方式',
            }, React.createElement('option', { value: 'recommended' }, '默认排序'),
            React.createElement('option', { value: 'recent' }, '最近更新'),
            React.createElement('option', { value: 'name' }, '名称 A-Z')),
          hasFilters ? React.createElement(Button, { compact: true, onClick: resetInventoryFilters }, '清除筛选') : null),
        view === 'catalog' ? React.createElement('div', { style: styles.marketFilterRow },
          React.createElement('div', { style: styles.marketFilterTabs, role: 'group', 'aria-label': '按状态筛选' },
            [['all', '全部'], ['approved', 'Catalog 已审核'], ['blocked', 'Catalog 已拦截'], ['installed', '已安装']].map(([id, label]) =>
              React.createElement(Button, { key: id, compact: true, primary: listFilter === id, ariaPressed: listFilter === id,
                onClick: () => { setListFilter(id); setPage(1) } }, `${label} · ${statusCounts[id]}`))),
          React.createElement('div', { style: styles.marketFacetGroup },
            React.createElement('select', {
              value: category, onChange: event => { setCategory(event.target.value); setPage(1) },
              style: { ...styles.select, height: '34px', borderRadius: '8px' }, 'aria-label': '按分类筛选',
            }, React.createElement('option', { value: '' }, '全部分类'),
            categoryIds.map(id => React.createElement('option', { key: id, value: id }, categoryLabels[id] || id))),
            React.createElement('select', {
              value: clientFilter, onChange: event => { setClientFilter(event.target.value); setPage(1) },
              style: { ...styles.select, minWidth: '180px', height: '34px', borderRadius: '8px' }, 'aria-label': '按 Desktop 适配标识筛选',
            }, React.createElement('option', { value: 'all' }, '全部客户端适配状态'),
            React.createElement('option', { value: 'declared' }, '已声明适配 Desktop'),
            React.createElement('option', { value: 'undeclared' }, '未声明适配 Desktop'))))
          : React.createElement('div', { style: styles.marketStats, 'aria-label': '已安装插件状态' },
            (view === 'official'
              ? [[officialPluginCount, '已安装官方组件'],
                [officialBundles.filter(bundle => bundle.enabled === true).length, '已启动'],
                [officialBundles.filter(bundle => bundle.enabled === false).length, '已关闭']]
              : [[installedCount, '已安装插件'], [enabledCount, '已启动'], [disabledCount, '已关闭'],
                [externalInstalledBundles.length, '目录外只读']]).map(([value, label]) =>
              React.createElement('div', { key: label, style: styles.marketStat },
                React.createElement('span', { style: styles.marketStatValue }, String(value)),
                React.createElement('span', { style: styles.marketStatLabel }, label)))),
        React.createElement('div', { style: styles.marketResults },
          React.createElement('span', { style: styles.muted, role: 'status' },
            installedInventoryUnavailable ? '安装清单读取后才会显示结果。'
              : `${filtered.length} 条结果 · 第 ${currentPage} / ${pageCount} 页 · ${view === 'official'
                ? 'DSH 官方组件只读展示'
                : view === 'installed' ? `其中 ${installedCatalogEntries.length} 个与 Catalog 匹配`
                  : `Desktop Profile ${installedCount} 个已安装 bundle`}`)),
        filtered.length === 0 ? React.createElement('div', { style: styles.marketEmpty },
          React.createElement('strong', { style: styles.name }, installedInventoryUnavailable ? '无法读取已安装列表'
            : view === 'official' ? '当前没有匹配的官方插件'
              : view === 'installed' ? '当前没有匹配的已安装插件' : '没有匹配的插件'),
          React.createElement('span', { style: styles.muted }, installedInventoryUnavailable
            ? '这是 DSH 安装清单状态，不能据此判断为空。完整插件目录仍可浏览和搜索。'
            : view === 'official'
              ? '官方组件由 DSH Desktop 提供并管理；商城只显示 Desktop 返回的本机状态。'
              : view === 'installed'
                ? '已安装状态来自 DSH Desktop 官方插件管理器。清除筛选，或在插件目录中浏览可安装条目。'
            : '试试插件名、包名、用途、分类、权限或 GitHub 仓库。'),
          hasFilters ? React.createElement(Button, { compact: true, onClick: () => {
            setQuery(''); setCategory(''); setListFilter('all'); setClientFilter('all'); setSortBy('recommended'); setPage(1)
          } }, '清除筛选') : null) : null,
        React.createElement('div', {
          style: styles.marketListViewport,
          'aria-label': view === 'official' ? '官方插件结果' : view === 'installed' ? '已安装插件结果' : 'Catalog 审核记录结果',
        }, React.createElement('div', { style: styles.marketGrid, role: 'list',
          'aria-label': view === 'official' ? '官方插件目录' : view === 'installed' ? '已安装插件目录' : '插件商城目录' }, visible.map(row => {
          if (row.kind === 'external' || row.kind === 'official') {
            const bundle = row.bundle
            const sourceRepository = desktopSourceRepository(bundle.source)
            const bundleVersion = typeof bundle.version === 'string' && DESKTOP_VERSION.test(bundle.version) ? bundle.version : '未知版本'
            return React.createElement('article', { key: row.key, style: styles.marketExternalCard, role: 'listitem' },
              React.createElement('div', { style: styles.cardHeader },
                React.createElement('div', { style: styles.marketCardTitle }, bundle.name),
                React.createElement(StatusPill, { label: bundle.enabled === true ? '已启动' : bundle.enabled === false ? '已关闭' : '状态未知',
                  tone: bundle.enabled === true ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)' })),
              React.createElement('div', { style: styles.code }, bundle.name + ' · ' + bundleVersion),
                React.createElement('div', { style: styles.muted }, row.kind === 'official'
                  ? '这是 DSH 官方或随 DSH 提供的组件。商城仅展示官方插件管理器返回的本机状态，不提供商城管理操作。'
                  : '此插件没有可匹配的已审核 Catalog 固定来源记录；商城只显示 DSH Desktop 返回的状态。'),
              React.createElement('div', { style: styles.marketBadges },
                React.createElement('span', { style: styles.badge }, bundle.official === true || bundle.name.startsWith('@deepseek-ai/') ? 'DSH 官方组件' : bundle.optional === true ? 'DSH 可选组件' : '目录外插件'),
                bundle.optional === true ? React.createElement('span', { style: styles.badge }, '可选组件') : null,
                bundle.removable === true ? React.createElement('span', { style: styles.badge }, 'Desktop 允许卸载') : null),
              React.createElement('div', { style: styles.muted }, sourceRepository ? 'GitHub 来源：' + sourceRepository : '安装来源未公开显示'),
              React.createElement('div', { style: styles.marketCardActions },
                React.createElement(Button, { compact: true, disabled: true, title: row.kind === 'official'
                  ? 'DSH 官方组件由 DSH Desktop 管理，商城只展示本机状态。'
                  : '没有受审固定 Commit 和权限记录，商城不管理目录外 Bundle。' }, row.kind === 'official' ? 'DSH 官方管理' : '商城不管理')))
          }
          const entry = row.entry
          const installedBundle = installedByName.get(entry.packageName)
          const installed = installedBundle?.installed === true
          const official = installedBundle?.official === true || entry.packageName.startsWith('@deepseek-ai/')
          const unmanagedMessage = entry.packageName === 'dsh-safe-plugin-manager' ? '商城自身不由商城管理'
            : installed && !canManageBundle(entry, installedBundle)
              ? (official ? '官方组件不由商城管理' : '已安装来源与商城记录不一致，商城不管理')
              : ''
          const stateLabel = entry.status === 'blocked' ? (installed ? 'Catalog 已拦截 · 已安装' : 'Catalog 已拦截 · DSH 可检查')
            : !installed ? '安装由 DSH Desktop 校验'
              : (installedBundle.enabled === true ? '已启动' : installedBundle.enabled === false ? '已关闭' : '已安装')
          const stateTone = entry.status === 'blocked' ? 'var(--dsw-alias-state-error-primary)'
            : installed ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)'
          return React.createElement('article', { key: row.key, style: styles.marketCard, role: 'listitem' },
            React.createElement('div', { style: styles.cardHeader },
              React.createElement('div', { style: styles.marketCardTitle }, entry.name),
              React.createElement(StatusPill, { label: stateLabel, tone: stateTone })),
            React.createElement('div', { style: styles.code }, entry.packageName + ' · ' + entry.version),
            React.createElement('div', { style: styles.cardDescription }, entry.description),
            React.createElement('div', { style: styles.marketBadges },
              React.createElement('span', { style: styles.badge }, 'DSH Desktop 客户端：' + desktopClientAdaptationLabel(entry.compatibility.profiles)),
              ...entry.categories.map(id => React.createElement('span', { key: id, style: styles.badge }, categoryLabels[id] || id)),
              React.createElement('span', { style: styles.badge }, licenseLabel(entry.details.license))),
            React.createElement('div', { style: styles.muted }, entry.commit ? 'Commit ' + entry.commit.slice(0, 12) : '固定 Commit 未提供'),
            entry.status === 'blocked' ? React.createElement(ReviewAdvice, { reason: entry.statusReason, compact: true }) : null,
            React.createElement('div', { style: styles.cardFooter },
              React.createElement('div', { style: styles.marketCardActions },
                ...actionButtons(entry, installedBundle, { includeUnavailable: true }),
                unmanagedMessage ? React.createElement('span', { key: 'unmanaged', style: styles.muted }, unmanagedMessage) : null,
                React.createElement(Button, { compact: true, onClick: () => setDetailEntry(entry),
                  'aria-label': '查看 ' + entry.name + ' 详情' }, '查看详情')),
              entry.repositoryUrl ? React.createElement('a', { href: entry.repositoryUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, 'GitHub 源码 ↗') : null))
        }))),
        React.createElement(Pagination, { pagination: {
          page: currentPage, pageCount, hasPrevious: currentPage > 1, hasNext: currentPage < pageCount,
        }, loading: false, onPageChange: setPage }))

      return React.createElement('section', { style: styles.marketRoot, tabIndex: 0, 'aria-label': '插件商城（DSH-Store），可滚动浏览' },
        React.createElement('style', null, DETAIL_MODAL_CSS),
        React.createElement('div', { style: styles.marketHero },
          React.createElement('div', { style: styles.toolbar },
            React.createElement('div', { style: styles.headingCopy },
              React.createElement('h2', { style: styles.marketHeroTitle }, '插件商城（DSH-Store）'),
              React.createElement('p', { style: styles.subtitle }, '按官网目录浏览全部已知插件；收录状态与审核建议分开展示，已确认的操作由 DSH Desktop 官方插件管理器最终判断')),
            React.createElement('div', { style: styles.actions },
              loadState.status === 'ready' && loadState.runtimeVersion
                ? React.createElement('span', { style: styles.versionPill }, 'DSH ' + loadState.runtimeVersion) : null,
              React.createElement('a', { href: 'https://dsh.store/rankings/', target: '_blank', rel: 'noreferrer', style: styles.marketHeroLink }, '官网榜单 ↗'),
              React.createElement('a', { href: 'https://dsh.store/plugins/', target: '_blank', rel: 'noreferrer', style: styles.marketHeroLink }, '官网完整目录 ↗'),
              React.createElement(Button, { compact: true, disabled: refreshing, onClick: () => {
                void refresh()
                if (['recommended', 'essential'].includes(view)) void loadRankings()
              } },
                refreshing ? '正在刷新…' : '刷新目录'))),
          loadState.status === 'ready' ? React.createElement('div', { style: styles.marketStats, 'aria-label': '目录概况' },
            [[directoryState.status === 'ready' ? directoryRows.length : directoryState.status === 'loading' ? '—' : '暂不可用', '已知目录条目'],
              [directoryCounts.listed, '有 Catalog 记录'], [directoryCounts.approved, 'Catalog 已审核'],
              [directoryCounts.blocked, 'Catalog 已拦截'], [directoryCounts.withdrawn, 'Catalog 未上架'],
              [inventoryState.status === 'ready' ? installedCount : inventoryState.status === 'loading' ? '—' : '暂不可用', 'Desktop 已安装']].map(([value, label]) =>
              React.createElement('div', { key: label, style: styles.marketStat },
                React.createElement('span', { style: styles.marketStatValue }, String(value)),
                React.createElement('span', { style: styles.marketStatLabel }, label)))) : null),
        React.createElement('div', { style: styles.marketNotice, role: 'status' },
          '商城分开提供完整目录、Catalog 审核记录、官网推荐榜和必装榜。收录、审核、推荐和榜单位置是不同信息；完整目录中的 DSH 插件来源可在确认后交给 DSH Desktop 检查，候选与未上架状态仅作建议，最终安装结果只按 DSH 官方管理器返回判断。生态应用、官方受保护组件和格式无效的仓库不提供插件安装动作。',
          loadState.status === 'ready' && loadState.catalog.deliverySource === 'github-pages'
            ? React.createElement('div', { style: styles.muted }, 'GitHub Raw 暂不可用，当前由同仓库 GitHub Pages 目录镜像提供数据。') : null,
          loadState.status === 'ready' && !loadState.runtimeVersion
            ? React.createElement('div', { style: styles.muted }, '商城无法读取用于显示的 DSH 版本；安装仍会交由 Desktop 官方插件管理器按当前运行环境校验。') : null,
          inventoryState.status === 'error'
            ? React.createElement('div', { style: styles.muted }, `DSH 安装清单暂不可用（${inventoryState.code}）；完整目录和搜索仍可使用，刷新后再执行安装管理。`) : null),
        loadState.status === 'loading' ? React.createElement('p', { style: styles.muted }, '正在读取 DSH Store Catalog；完整目录与 DSH 安装清单分别加载。') : null,
        loadState.status === 'error' ? React.createElement('div', { style: styles.error, role: 'alert' }, '无法读取 Desktop 商城数据（' + loadState.code + '）。刷新后重试。') : null,
        loadState.status === 'ready' ? React.createElement(React.Fragment, null,
          React.createElement('div', { style: styles.marketViewBar, role: 'tablist', 'aria-label': '插件商城视图' },
            React.createElement(TabButton, { active: view === 'directory',
              style: styles.marketViewTab,
              onClick: () => { setView('directory'); setDirectoryListingFilter('all'); setDirectoryReviewFilter('all'); setSortBy('recommended'); setPage(1) } },
              `全部已知插件 · ${directoryState.status === 'ready' ? directoryRows.length : directoryState.status === 'error' ? '暂不可用' : '…'}`),
            React.createElement(TabButton, { active: view === 'recommended',
              style: styles.marketViewTab,
              onClick: () => { setView('recommended'); setDirectoryListingFilter('all'); setDirectoryReviewFilter('all'); setPage(1) } },
              `推荐榜单 · ${rankingTabCount('recommended')}`),
            React.createElement(TabButton, { active: view === 'essential',
              style: styles.marketViewTab,
              onClick: () => { setView('essential'); setDirectoryListingFilter('all'); setDirectoryReviewFilter('all'); setPage(1) } },
              `必装榜单 · ${rankingTabCount('essential')}`),
            React.createElement(TabButton, { active: view === 'catalog',
              style: styles.marketViewTab,
              onClick: () => { setView('catalog'); setListFilter('all'); setPage(1) } }, `Catalog 审核记录 · ${entries.length}`),
            React.createElement(TabButton, { active: ['official', 'installed'].includes(view),
              style: styles.marketViewTab,
              onClick: () => { setView('installed'); resetInventoryFilters() } }, '本机插件'),
            React.createElement('a', { href: 'https://dsh.store/plugins/', target: '_blank', rel: 'noreferrer',
              style: {
                ...styles.link, ...styles.marketViewTab,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: '1px dashed var(--dsw-alias-border-l2)',
                background: 'transparent', textDecoration: 'none',
              } }, '官网目录 ↗')),
          ['official', 'installed'].includes(view) ? React.createElement('div', {
            style: styles.marketPluginTabs, role: 'tablist', 'aria-label': '本机插件视图',
          },
          React.createElement(TabButton, { active: view === 'official',
            style: styles.marketViewTab,
            onClick: () => { setView('official'); resetInventoryFilters() } },
            `官方插件 · ${inventoryState.status === 'ready' ? officialPluginCount : inventoryState.status === 'loading' ? '读取中' : '暂不可用'}`),
          React.createElement(TabButton, { active: view === 'installed',
            style: styles.marketViewTab,
            onClick: () => { setView('installed'); resetInventoryFilters() } },
            `已安装插件 · ${inventoryState.status === 'ready' ? installedCount : inventoryState.status === 'loading' ? '读取中' : '暂不可用'}`)) : null,
          directoryViewActive ? directoryViewContent : catalogViewContent,
        detailEntry ? React.createElement(Modal, {
          open: true, onClose: () => setDetailEntry(null), title: detailEntry.name + ' · 插件详情',
          closeLabel: '关闭插件详情', footer: detailFooter(detailEntry),
          className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
        }, React.createElement('div', { style: styles.detailSection },
          React.createElement('div', { style: styles.cardDescription }, detailEntry.description),
          React.createElement('div', { style: styles.marketBadges },
            React.createElement('span', { style: styles.badge }, detailEntry.status === 'approved' ? 'Catalog 已审核'
              : detailEntry.status === 'blocked' ? 'Catalog 已拦截' : 'Catalog 未上架'),
            React.createElement('span', { style: styles.badge }, 'DSH Desktop 客户端：' + desktopClientAdaptationLabel(detailEntry.compatibility.profiles)),
            ...(detailEntry.categories || []).map(id => React.createElement('span', { key: id, style: styles.badge }, categoryLabels[id] || id))),
          React.createElement('div', { style: styles.actions, 'aria-label': '插件操作' },
            ...actionButtons(detailEntry, detailBundle, { includeUnavailable: true, allActions: true })),
          detailOperationsMessage ? React.createElement('div', { style: styles.notice, role: 'status' }, detailOperationsMessage) : null,
          ['blocked', 'unlisted'].includes(detailEntry.status) && detailEntry.statusReason
            ? React.createElement(ReviewAdvice, { reason: detailEntry.statusReason }) : null,
          React.createElement('div', { style: styles.code }, detailEntry.packageName + ' · ' + detailEntry.version),
          React.createElement('div', { style: styles.muted }, 'GitHub 仓库：' + detailEntry.repositoryUrl),
          React.createElement('div', { style: styles.code }, '固定 Commit：' + detailEntry.commit),
          React.createElement('div', { style: styles.muted },
            'Desktop 客户端：' + desktopClientAdaptationLabel(detailEntry.compatibility.profiles)
            + ' · Catalog 兼容性参考：DSH ' + (loadState.runtimeVersion || '未知') + ' / ' + detailCompatibility),
          React.createElement('div', { style: styles.muted }, detailInstalledState),
          React.createElement('div', { style: styles.muted },
            '分类：' + (detailEntry.categories.map(id => desktopDirectoryCategoryLabel(id, categoryLabels)).join(' / ') || '未分类')
            + ' · 许可证：' + licenseLabel(detailEntry.details.license)),
          React.createElement('div', { style: styles.muted }, permissionsOf(detailEntry)),
          detailEntry.details.externalDependencies.length ? React.createElement('div', { style: styles.muted },
            '外部依赖：' + detailEntry.details.externalDependencies.join('、')) : null,
          detailEntry.risk?.installScripts?.length ? React.createElement('div', { style: styles.error },
            '本包声明安装脚本：' + detailEntry.risk.installScripts.join('、') + '。商城不会代为批准构建脚本。') : null,
          React.createElement('a', { href: detailEntry.repositoryUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, '打开 GitHub 源码 ↗'))) : null,
        actionPlan ? React.createElement(Modal, {
          open: true, onClose: actionState.status === 'running' ? () => {} : closeActionPlan,
          title: actionState.status === 'success' ? actionLabel(actionPlan.action) + '已提交给 DSH'
            : 'Desktop ' + actionLabel(actionPlan.action) + '确认',
          closeLabel: '关闭 Desktop 插件操作', footer: operationFooter,
          className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
        }, React.createElement('div', { style: styles.detailSection },
          React.createElement('div', { style: styles.actionHeaderCard },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                React.createElement('span', { style: { fontSize: '15px', fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } }, actionPlan.entry.packageName),
                React.createElement('span', { style: styles.versionPill }, 'v' + actionPlan.entry.version)),
              actionInstalledSummary ? React.createElement('span', { style: styles.statusPill }, actionInstalledSummary) : null),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', fontSize: '12px' } },
              React.createElement('a', { href: actionPlan.entry.repositoryUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, 'GitHub：' + actionPlan.entry.repositoryUrl),
              actionPlan.entry.installMode === 'github-default-branch'
                ? React.createElement('span', { style: styles.badge }, '来源：GitHub 默认分支，由 DSH Desktop 解析并检查')
                : React.createElement('span', { style: styles.badge }, '固定 Commit：' + actionPlan.entry.commit)),
            ['install', 'update'].includes(actionPlan.action)
              ? React.createElement('div', { style: styles.specBox },
                (actionPlan.action === 'update' ? '更新' : '安装') + ' spec：' + desktopInstallSpecifier(actionPlan.entry)) : null),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' } },
            React.createElement('span', { style: styles.badge }, 'DSH 版本：' + (loadState.runtimeVersion || '未知') + ' · ' + licenseLabel(actionPlan.entry.details?.license)),
            React.createElement('span', { style: styles.badge }, permissionsOf(actionPlan.entry))),
          ['install', 'update'].includes(actionPlan.action) && actionPlan.entry.status === 'blocked'
            ? React.createElement(ReviewAdvice, { reason: actionPlan.entry.statusReason, compact: true }) : null,
          actionPlan.entry.installMode === 'github-default-branch' && actionPlan.entry.status !== 'approved'
            ? React.createElement('div', { style: styles.actionNoticeCard, role: 'status' },
              (actionPlan.entry.directorySource === 'candidate' ? 'Store 候选审核状态：' : 'Store Catalog 状态：')
              + (actionPlan.entry.directorySource === 'candidate' ? actionPlan.entry.candidateStatus : actionPlan.entry.status)
              + '。这是商城建议，不是 DSH 的安装结论；你确认后仍可提交给 DSH Desktop，由 DSH 判断是否接受。') : null,
          ['install', 'update'].includes(actionPlan.action) && actionPlan.entry.status !== 'approved'
            && actionPlan.entry.status !== 'blocked' && actionPlan.entry.statusReason
            ? React.createElement(ReviewAdvice, { reason: actionPlan.entry.statusReason, compact: true }) : null,
          ['install', 'update'].includes(actionPlan.action) && actionPlan.entry.updatePolicy === 'external-only'
            ? React.createElement('div', { style: styles.actionNoticeCard }, '更新策略：external-only。此次仅把当前 Catalog 固定 Commit 交由 DSH 检查；Store 不会自动跟随后续源码更新。') : null,
          actionPlan.entry.risk?.installScripts?.length ? React.createElement('div', { style: styles.error },
            '本包声明安装脚本：' + actionPlan.entry.risk.installScripts.join('、') + '。商城不会代为批准构建脚本。') : null,
          React.createElement('div', { style: styles.actionNoticeCard },
            actionPlan.entry.installMode === 'github-default-branch'
              ? '此来源不是 Catalog 固定 Commit；用户确认后，商城会把精确 GitHub 仓库默认分支交给 DSH Desktop 官方安装器。收录和审核状态仅作建议，预检提示不会拦截请求；最终状态以 DSH 返回及 Desktop 安装清单为准。商城不会自动授权安装脚本。'
              : 'DSH 官方安装器会检查固定来源并处理 Profile。预检提示不会阻止本次已确认的安装请求；最终状态以 DSH 官方安装器和 Desktop 已安装清单为准。商城不会自动授权安装脚本。'),
          actionState.status === 'running' ? React.createElement('div', { style: styles.muted, role: 'status' },
            '正在由 DSH 官方插件管理器处理；请等待结果，不要重复提交。') : null,
          actionState.inspectionNotice ? React.createElement('div', { style: styles.notice, role: 'status' }, actionState.inspectionNotice) : null,
          actionState.status === 'success' ? React.createElement('div', { style: styles.notice, role: 'status' },
            actionState.application === 'already-installed'
              ? actionPlan.action === 'update'
                ? 'DSH Desktop 已安装清单确认当前来源与目标固定 Commit 一致。'
                : actionPlan.entry.installMode === 'github-default-branch'
                  ? 'DSH Desktop 已安装清单确认此 GitHub 仓库来源当前已安装。'
                  : 'DSH Desktop 已安装清单确认目标包当前已安装。'
              : actionState.application === 'restart-required'
                ? '操作已写入 Desktop Profile；DSH 报告需要按其官方流程重新加载后生效。'
                : 'DSH 官方插件管理器已完成' + actionLabel(actionPlan.action) + '。') : null,
          actionState.status === 'error' ? React.createElement('div', { style: styles.error, role: 'alert' },
            '操作未完成（' + actionState.code + '）。' + (actionState.reason ? actionState.reason + '。' : '')
            + (actionPlan.action === 'update' && actionState.recovery === 'old-version-preserved'
              ? `DSH 已安装清单仍确认旧固定 Commit ${desktopSourceRevision(actionPlan.installedState?.source) || '未知'} 保留。`
              : actionPlan.action === 'update' && actionState.recovery === 'old-version-restored'
                ? actionState.recoveryApplication === 'restart-required'
                  ? `目标版本未完成，DSH 已接受恢复旧固定 Commit ${desktopSourceRevision(actionPlan.installedState?.source) || '未知'}，需按 DSH 流程重载后生效。`
                  : `目标版本未完成，DSH 已恢复旧固定 Commit ${desktopSourceRevision(actionPlan.installedState?.source) || '未知'}。`
                : actionPlan.action === 'update' && actionState.recovery === 'recovery-required'
                  ? 'DSH 当前安装源与旧 Commit 和目标 Commit 均不一致，请先在 DSH Desktop 核对当前包。'
                  : '')
            + '刷新目录核对状态；商城不会自动重试。') : null,
          actionState.status === 'unknown' ? React.createElement('div', { style: styles.error, role: 'alert' },
            '操作结果暂时无法确认。商城已刷新 Desktop Profile；请核对当前状态后再决定下一步，不会自动重试。') : null,
          !['success', 'error', 'unknown'].includes(actionState.status) ? React.createElement('div', { style: styles.actionConfirmCard },
            React.createElement('label', { style: styles.actionConfirmLabel },
              React.createElement('span', { style: { fontSize: '10px', lineHeight: '14px', color: 'var(--dsw-alias-label-secondary)' } },
                '确认在当前 Desktop Profile 执行'
                + (['install', 'update'].includes(actionPlan.action) && actionPlan.entry.status === 'blocked'
                  ? 'DSH 检查与' + actionLabel(actionPlan.action) : actionLabel(actionPlan.action)) + '；请复制上方命令并粘贴到下方。'),
              React.createElement('div', {
                style: styles.actionConfirmCode,
                role: 'textbox', 'aria-readonly': true, 'aria-label': '可复制的完整操作命令', tabIndex: 0,
                onFocus: selectActionConfirmCommand, onClick: selectActionConfirmCommand,
                title: '点击命令框后可全选复制',
              }, actionPlan.confirmation),
              React.createElement('input', {
                value: confirmation, onChange: event => { setConfirmation(event.target.value) },
                style: styles.actionConfirmInput, placeholder: '粘贴上方完整命令', disabled: actionState.status === 'running',
                autoComplete: 'off', spellCheck: false, 'aria-label': '操作确认短语',
                title: actionPlan.confirmation,
              }))) : null)) : null) : null)
    }

    const STORE_PANEL_ICON = 'data:image/png;base64,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'

    function StorePanelIcon({ size = 18 }) {
      return React.createElement('img', {
        src: STORE_PANEL_ICON, width: size, height: size, alt: '', 'aria-hidden': 'true',
        style: { display: 'block', width: size, height: size, objectFit: 'contain', borderRadius: '4px' },
      })
    }

    function ManagerPanel() {
      const [view, setView] = useState('market')
      const [query, setQuery] = useState('')
      const [debouncedQuery, setDebouncedQuery] = useState('')
      const [category, setCategory] = useState('')
      const [featuredOnly, setFeaturedOnly] = useState(false)
      const [page, setPage] = useState(1)
      const [state, setState] = useState({ status: OFFICIAL_DESKTOP_RENDERER ? 'desktop-readonly' : 'loading' })
      const [lastMarketSnapshot, setLastMarketSnapshot] = useState(null)
      const [activations, setActivations] = useState({})
      const [compatibleWith, setCompatibleWith] = useState('')
      const [marketLoading, setMarketLoading] = useState(false)
      const [marketError, setMarketError] = useState('')
      const marketRequestId = useRef(0)
      const sourceAutoScanned = useRef(new Set())
      const [confirmation, setConfirmation] = useState('')
      const [operation, setOperation] = useState({ status: 'idle' })
      useEffect(() => { let cancelled = false; if (state.status === 'ready') void post('/api2/dsh-safe-plugin-manager/activation').then(rows => { if (!cancelled) setActivations(Object.fromEntries(rows.map(row => [row.packageName, row]))) }).catch(() => {}); return () => { cancelled = true } }, [state.status, operation.status])
      const [sourceUpdates, setSourceUpdates] = useState({})
      const [detailEntry, setDetailEntry] = useState(null)
      const [permissionDecisions, setPermissionDecisions] = useState(() => readHealthPermissionDecisions())
      const [pendingRestart, setPendingRestart] = useState(() => readPendingRestart())
      const [restartConfirmation, setRestartConfirmation] = useState('')
      const [restartOperation, setRestartOperation] = useState({ status: 'idle' })
      const [guardianConfirmation, setGuardianConfirmation] = useState('')
      const [guardianOperation, setGuardianOperation] = useState({ status: 'idle' })
      const [versionChecking, setVersionChecking] = useState(false)
      const [versionFeedback, setVersionFeedback] = useState('')

      const refresh = useCallback(async (force = false, decisions = readHealthPermissionDecisions(), marketOptions = {}) => {
        setState({ status: 'loading' })
        setMarketError('')
        try {
          const marketBody = {
            refresh: force,
            view: marketOptions.view ?? 'market',
            page: marketOptions.page ?? 1,
            pageSize: MARKET_PAGE_SIZE,
            query: marketOptions.query ?? '',
            category: marketOptions.category ?? '',
            featuredOnly: marketOptions.featuredOnly === true,
            compatibleWith: marketOptions.compatibleWith || '',
          }
          const [inventory, market, health, runtime, guardian] = await Promise.all([
            post(ROUTES.inventory), post(ROUTES.market, marketBody),
            post(ROUTES.health, { refresh: force, permissionDecisions: decisions }),
            post(ROUTES.runtime).catch(error => ({
              supported: false, errorCode: error?.code || 'RUNTIME_STATUS_UNAVAILABLE', message: String(error?.message || error),
            })),
            post(ROUTES.guardian).catch(error => ({
              supported: false, available: false, errorCode: error?.code || 'GUARDIAN_UNAVAILABLE', message: String(error?.message || error),
            })),
          ])
          setLastMarketSnapshot(market)
          setState({ status: 'ready', inventory, market, health, runtime, guardian, dshVersion: { status: 'checking' } })
          void post(ROUTES.dshVersion, { refresh: force }).then(async dshVersion => {
            const updatedMarket = await post(ROUTES.market, { ...marketBody, refresh: false }).catch(() => market)
            setState(current => {
              if (current.status !== 'ready') return current
              const pagination = current.market.pagination
              const stillCurrent = pagination?.view === marketBody.view && pagination?.page === marketBody.page
                && pagination?.query === marketBody.query && pagination?.category === marketBody.category
                && pagination?.featuredOnly === marketBody.featuredOnly
              return { ...current, ...(stillCurrent ? { market: updatedMarket } : {}), dshVersion }
            })
          }).catch(error => {
            setState(current => current.status === 'ready' ? {
              ...current,
              dshVersion: { status: 'unavailable', errorCode: error?.code || 'DSH_VERSION_FAILED', message: String(error?.message || error) },
            } : current)
          })
        } catch (error) {
          setState({ status: 'error', message: String(error?.message || error) })
        }
      }, [])
      useEffect(() => { if (!OFFICIAL_DESKTOP_RENDERER) void refresh(false) }, [refresh])
      useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
        return () => window.clearTimeout(timer)
      }, [query])
      useEffect(() => {
        if (state.status !== 'ready' || view === 'health') return undefined
        const requestedCategory = view === 'candidates' ? '' : category
        const current = state.market.pagination
        if (current?.view === view && current.page === page && current.pageSize === MARKET_PAGE_SIZE
          && current.query === debouncedQuery && current.category === requestedCategory
          && (current.compatibleWith || '') === compatibleWith && current.featuredOnly === (view === 'market' && featuredOnly)) return undefined
        const requestId = ++marketRequestId.current
        let cancelled = false
        setMarketLoading(true)
        setMarketError('')
        void post(ROUTES.market, {
          view, page, pageSize: MARKET_PAGE_SIZE, query: debouncedQuery, category: requestedCategory,
          featuredOnly: view === 'market' && featuredOnly, compatibleWith,
        }).then(market => {
          if (cancelled || requestId !== marketRequestId.current) return
          setState(currentState => currentState.status === 'ready' ? { ...currentState, market } : currentState)
          if (market.pagination?.page !== page) setPage(market.pagination.page)
        }).catch(error => {
          if (!cancelled && requestId === marketRequestId.current) setMarketError(String(error?.message || error))
        }).finally(() => {
          if (!cancelled && requestId === marketRequestId.current) setMarketLoading(false)
        })
        return () => { cancelled = true }
      }, [category, debouncedQuery, featuredOnly, compatibleWith, page, state.status, view])

      const refreshDshVersion = useCallback(async () => {
        setVersionChecking(true); setVersionFeedback('')
        try {
          const dshVersion = await post(ROUTES.dshVersion, { refresh: true })
          const market = await post(ROUTES.market, {
            view, page, pageSize: MARKET_PAGE_SIZE, query: debouncedQuery, category: view === 'candidates' ? '' : category,
            featuredOnly: view === 'market' && featuredOnly, compatibleWith,
          }).catch(() => null)
          setState(current => {
            if (current.status !== 'ready') return current
            const pagination = current.market.pagination
            const requestedCategory = view === 'candidates' ? '' : category
            const stillCurrent = pagination?.view === view && pagination?.page === page
              && pagination?.query === debouncedQuery && pagination?.category === requestedCategory
              && pagination?.featuredOnly === (view === 'market' && featuredOnly)
            return { ...current, ...(market && stillCurrent ? { market } : {}), dshVersion }
          })
        } catch (error) {
          setState(current => current.status === 'ready' ? {
            ...current,
            dshVersion: { status: 'unavailable', errorCode: error?.code || 'DSH_VERSION_FAILED', message: String(error?.message || error) },
          } : current)
        } finally { setVersionChecking(false) }
      }, [category, debouncedQuery, featuredOnly, compatibleWith, page, view])

      const copyUpgradeCommand = useCallback(async () => {
        const command = state.status === 'ready' ? state.dshVersion?.upgrade?.commandText : ''
        if (!command) return
        try {
          await window.navigator.clipboard.writeText(command)
          setVersionFeedback('升级命令已复制')
        } catch { setVersionFeedback('复制失败，请打开官方 Release') }
      }, [state])

      const setPermissionDecision = useCallback((packageName, revision, field, choice) => {
        if (!validPermissionRevision(revision) || !HEALTH_PERMISSION_FIELDS.includes(field)) return
        setPermissionDecisions(current => {
          const previous = current[packageName]
          const decisions = previous?.schemaVersion === 1 && previous.revision === revision ? { ...previous.decisions } : {}
          if (choice === 'pending') delete decisions[field]
          else decisions[field] = choice === 'allow'
          const next = { ...current }
          if (Object.keys(decisions).length === 0) delete next[packageName]
          else next[packageName] = { schemaVersion: 1, revision, decisions }
          return storeHealthPermissionDecisions(next)
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
          .map(entry => normalizeMarketEntry(entry, state.market.dshReleaseContext))
          .map(entry => ({ ...entry, activation: activations[entry.packageName], sourceUpdate: sourceUpdates[entry.id] ?? null }))
      }, [sourceUpdates, state, activations])

      const candidateEntries = useMemo(() => {
        if (state.status !== 'ready' || state.market.pagination?.view !== 'candidates') return []
        return state.market.candidates || []
      }, [state])

      const checkSource = useCallback(async entry => {
        setSourceUpdates(current => ({ ...current, [entry.id]: { status: 'checking' } }))
        try {
          const value = await post(ROUTES.sourceUpdate, { pluginId: entry.id })
          setSourceUpdates(current => ({ ...current, [entry.id]: value }))
        } catch (error) {
          setSourceUpdates(current => ({ ...current, [entry.id]: {
            status: 'error', code: error?.code || 'SOURCE_UPDATE_FAILED', message: String(error?.message || error),
          } }))
        }
      }, [])

      useEffect(() => {
        if (view !== 'installed' || state.status !== 'ready') return undefined
        const queue = state.market.entries.filter(entry => entry.installed && entry.status === 'approved'
          && !sourceAutoScanned.current.has(entry.id))
        for (const entry of queue) sourceAutoScanned.current.add(entry.id)
        let cancelled = false
        const worker = async () => {
          while (!cancelled && queue.length > 0) {
            const entry = queue.shift()
            if (entry) await checkSource(entry)
          }
        }
        void Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()))
        return () => { cancelled = true }
      }, [checkSource, state, view])

      const pagination = state.status === 'ready' ? state.market.pagination : null
      const expectedCategory = view === 'candidates' ? '' : category
      const pageReady = (pagination?.compatibleWith || '') === compatibleWith && pagination?.view === view && pagination.page === page
        && pagination.query === debouncedQuery && pagination.category === expectedCategory
        && pagination.featuredOnly === (view === 'market' && featuredOnly)
      const entries = pageReady ? normalizedEntries : []
      const marketOptions = useMemo(() => ({
        view: view === 'health' ? 'market' : view,
        page,
        query: debouncedQuery,
        category: view === 'candidates' ? '' : category,
        featuredOnly: view === 'market' && featuredOnly, compatibleWith,
      }), [category, debouncedQuery, featuredOnly, compatibleWith, page, view])

      const beginPlan = useCallback(async (action, entry) => {
        setConfirmation('')
        setOperation({ status: 'planning' })
        try {
          const value = await post(ROUTES.plan, {
            action, pluginId: entry.id,
            ...(entry.sourceCommit ? { sourceCommit: entry.sourceCommit } : {}),
            ...(entry.sourceRiskAccepted ? { sourceRiskAccepted: true } : {}),
          }, 'plan')
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
          let record = await post(ROUTES.execute, { planId: plan.planId, confirmation }, 'execute')
          while (['queued', 'running'].includes(record.state)) {
            await new Promise(resolve => setTimeout(resolve, 1000))
            record = await readOperations(record.id)
          }
          const value = record.result ?? { transactionId: record.id, status: record.state, restartRequired: false }
          if (value.status === 'applied' && value.restartRequired) {
            const pending = storePendingRestart(value)
            setPendingRestart(pending)
          }
          setOperation({ status: 'result', value })
          await refresh(false, permissionDecisions, marketOptions)
        } catch (error) {
          setOperation({ status: 'error', code: error?.code, message: String(error?.message || error) })
        }
      }, [confirmation, marketOptions, operation, permissionDecisions, refresh])

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
          const previousBootId = state.status === 'ready' ? state.runtime?.bootId : null
          if (!previousBootId || value.handoff?.status !== 'scheduled') {
            setGuardianOperation({ status: 'result', value })
            return
          }
          setGuardianOperation({ status: 'handoff', value })
          await waitForStableSuccessorBoot(previousBootId)
        } catch (error) { setGuardianOperation({ status: 'error', code: error?.code, message: String(error?.message || error) }) }
      }, [guardianConfirmation, guardianOperation, state])
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
          setRestartOperation({ status: 'handoff', value: result })
          await waitForStableSuccessorBoot(result.previousBootId)
        } catch (error) {
          setRestartOperation({ status: 'error', code: error?.code, message: String(error?.message || error) })
        }
      }, [restartConfirmation, restartOperation])
      const closeDetails = useCallback(() => setDetailEntry(null), [])
      if (OFFICIAL_DESKTOP_RENDERER) return React.createElement(DesktopStorePanel)
      const dshVersion = state.status === 'ready' ? state.dshVersion : null
      const versionLabel = dshVersion?.currentVersion
        ? `DSH ${dshVersion.currentVersion}${dshVersion.updateAvailable ? ` → ${dshVersion.latestVersion}${dshVersion.releaseChannel === 'preview' ? '（预发布）' : ''}` : dshVersion.status === 'current' ? dshVersion.releaseChannel === 'preview' ? ' · 已是当前预发布' : ' · 稳定版已是最新' : ''}`
        : 'DSH 版本待检测'
      const heading = React.createElement('div', { style: styles.toolbar },
        React.createElement('div', { style: styles.headingCopy },
          React.createElement('h3', { style: styles.title }, '插件商城（DSH-Store）'),
          React.createElement('p', { style: styles.subtitle },
            'GitHub-only 目录 · 计划确认 · Profile 备份 · 健康检查 · 失败回滚 · ',
            React.createElement('a', {
              href: SUPPORT_URL, target: '_blank', rel: 'noreferrer', style: styles.link,
            }, '技术支持：DSH-Store'))),
        React.createElement('div', { style: styles.versionBox, 'aria-label': 'DSH 版本与升级' },
          React.createElement('span', {
            style: styles.versionPill,
            title: dshVersion?.upgrade?.reason || dshVersion?.message || '检测当前 DSH、官方 GitHub Release 与 npm 发行记录',
          }, versionLabel),
          React.createElement(Button, { compact: true, disabled: versionChecking, onClick: refreshDshVersion },
            versionChecking ? '检测中…' : '检测升级'),
          dshVersion?.updateAvailable && dshVersion?.upgrade?.commandText ? React.createElement(Button, {
            compact: true, primary: true, onClick: copyUpgradeCommand,
            title: dshVersion.upgrade.reason,
          }, '复制升级命令') : null,
          dshVersion?.npmAvailable === false ? React.createElement('span', { style: styles.muted }, '新版已发布，npm 包待发布') : null,
          dshVersion?.releaseUrl ? React.createElement('a', {
            href: dshVersion.releaseUrl, target: '_blank', rel: 'noreferrer', style: styles.link,
          }, '官方 Release') : null,
          versionFeedback ? React.createElement('span', { style: styles.muted }, versionFeedback) : null))

      const nav = React.createElement('div', { style: styles.nav },
        React.createElement('div', { style: styles.navTabs, role: 'tablist', 'aria-label': '插件商城视图' },
          [['market', '可信安装'], ['candidates', '候选发现'], ['installed', '已安装'], ['health', '健康检查']].map(([id, label]) =>
            React.createElement(TabButton, { key: id, active: view === id, onClick: () => {
              setView(id); setPage(1)
              if (id === 'candidates') setCategory('')
              if (id !== 'market') setFeaturedOnly(false)
            } }, label))),
        React.createElement(Button, {
          compact: true, disabled: marketLoading,
          onClick: () => refresh(true, permissionDecisions, marketOptions),
        }, marketLoading ? '正在刷新…' : '刷新 GitHub 目录'))

      const categoryIds = state.status === 'ready' ? state.market.filters?.categoryIds || [] : []
      const categoryLabels = state.status === 'ready' ? state.market.registry.categories || {} : {}
      const filters = React.createElement(CatalogFilters, {
        compatibleWith, currentVersion: state.dshVersion?.currentVersion, onCompatibilityChange: value => { setCompatibleWith(value); setPage(1) },
        query, category, categoryIds, categoryLabels, featuredOnly, showFeatured: view === 'market',
        onQueryChange: value => { setQuery(value); setPage(1) },
        onCategoryChange: value => { setCategory(value); setPage(1) },
        onFeaturedChange: value => { setFeaturedOnly(value); setPage(1) },
      })
      const catalogPackageNames = new Set(state.status === 'ready' ? state.market.catalogPackageNames || [] : [])
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
          React.createElement(Button, { onClick: () => { void refresh(false, permissionDecisions, marketOptions) } }, '我已重启，重新检查'))) : null,
      restartState.status === 'failed' ? React.createElement('div', { style: styles.muted },
        `目标 ${pendingRestart.packageName}${pendingRestart.targetVersion ? ` ${pendingRestart.targetVersion}` : ''} 未在新实例中确认加载，请查看健康检查详情。`) : null,
      restartState.status !== 'pending' ? React.createElement(Button, { onClick: dismissRestart }, '完成') : null)

      const desktopReadOnly = state.status === 'ready' && state.runtime?.desktopMode === true
      const guardianIsExternal = state.status === 'ready' && state.guardian.owner === 'external'
      const guardianHasPortConflict = state.status === 'ready' && state.guardian.errorCode === 'GUARDIAN_PORT_CONFLICT'
      const guardianNeedsUpgrade = state.status === 'ready' && state.guardian.upgradeRequired === true
      const guardianUnsupported = state.status === 'ready' && state.guardian.supported === false
      const guardianBanner = desktopReadOnly ? React.createElement('div', { style: styles.notice, role: 'status' },
        React.createElement('div', { style: styles.name }, '官方 Desktop · 当前 Profile 只读浏览'),
        React.createElement('div', { style: styles.muted }, '商城展示 Desktop 的插件目录、已安装状态和诊断；安装、更新、启停及重启请使用 DSH 官方“插件”页和应用更新入口。'))
        : state.status !== 'ready' ? null : React.createElement('div', {
        style: state.guardian.available || guardianUnsupported ? styles.notice : styles.error,
      }, React.createElement('div', { style: styles.name }, state.guardian.available
        ? `DSH Guardian：${state.guardian.state} · 唯一启动所有者`
        : guardianUnsupported ? '当前 DSH 不提供 Guardian 状态：商城已降级为只读诊断'
          : guardianNeedsUpgrade ? 'DSH Guardian 探针版本过旧：安全重启已禁用'
          : guardianIsExternal ? '检测到外部 DSH 实例：Guardian 未接管'
          : guardianHasPortConflict ? '3080 端口被未知进程占用：Guardian 已拒绝接管'
            : 'DSH Guardian 未运行：一键重启已被安全禁用'),
      React.createElement('div', { style: styles.muted }, state.guardian.available
        ? `DSH 已由 Guardian 管理；请勿再运行 pnpm dsh web 或 dsh web。心跳 ${state.guardian.heartbeatAgeMs}ms · 失败次数 ${state.guardian.failureCount || 0} · 熔断 ${state.guardian.circuit || '未知'} · 探针日志保留 24 小时`
        : guardianUnsupported
          ? `${state.guardian.errorCode || 'GUARDIAN_UNAVAILABLE'}：${state.guardian.message || '此版本不支持安全重启能力'}。插件浏览、兼容性与固定来源信息仍可使用。`
          : guardianNeedsUpgrade
          ? '当前守护文件与商城内置版本不一致。升级后会记录端口、首页、运行时身份、耗时和重启判断；不记录响应正文、Profile 内容或凭据，超过 24 小时自动清理。'
          : guardianIsExternal
          ? '当前 DSH 不是由 Guardian 启动。请先停止手工实例，再让 Guardian 启动；商城不会杀死或冒充接管该进程。'
          : guardianHasPortConflict
            ? '商城无法验证该进程属于 DSH，因此不会终止进程，也不会启动第二个实例。'
            : '安装商城自带的外部 Guardian 后，即使 DSH 冷启动失败也能继续诊断和恢复。'),
      !state.guardian.available && !guardianUnsupported && !guardianIsExternal && !guardianHasPortConflict
        ? React.createElement(Button, { primary: true, onClick: beginGuardianInstall }, guardianNeedsUpgrade ? '升级并重启 Guardian' : '安装并接管 DSH 守护') : null)

      const pageControls = pageReady
        ? React.createElement(Pagination, { pagination, loading: marketLoading, onPageChange: setPage })
        : React.createElement('div', { style: styles.pageStatus, role: 'status' }, '正在读取当前视图…')
      const pageError = marketError ? React.createElement('div', { style: styles.error, role: 'alert' }, `目录分页加载失败：${marketError}`) : null
      let content
      if (state.status === 'loading') content = lastMarketSnapshot && view === 'market'
        ? React.createElement(React.Fragment, null,
          React.createElement(CatalogFilters, {
            query, category, categoryIds, categoryLabels, featuredOnly, showFeatured: true,
            onQueryChange: value => { setQuery(value); setPage(1) }, onCategoryChange: value => { setCategory(value); setPage(1) },
            onFeaturedChange: value => { setFeaturedOnly(value); setPage(1) }, compatibleWith, currentVersion: null,
            onCompatibilityChange: setCompatibleWith,
          }),
          React.createElement('div', { style: styles.notice }, `正在更新目录；先显示上次加载的 ${lastMarketSnapshot.entries?.length || 0} 个条目${lastMarketSnapshot.source?.fetchedAt ? ` · ${new Date(lastMarketSnapshot.source.fetchedAt).toLocaleString()}` : ''}`),
          React.createElement('div', { style: styles.marketGrid, role: 'list', 'aria-label': '缓存的插件商城目录' }, lastMarketSnapshot.entries.map(rawEntry => {
            const entry = normalizeMarketEntry(rawEntry)
            return React.createElement(MarketCard, { key: entry.id, entry, health: null, beginPlan, checkSource, openDetails: setDetailEntry, categoryLabels: lastMarketSnapshot.registry?.categories || {}, readOnly: desktopReadOnly })
          })))
        : state.status === 'loading' ? React.createElement('p', { style: styles.muted }, '正在读取 Profile 与 GitHub 目录…') : null
      else if (state.status === 'error') content = React.createElement('p', { style: styles.error }, state.message)
      else if (view === 'health') content = React.createElement(HealthPanel, {
        health: state.health, permissionDecisions, setPermissionDecision, rerun: rerunHealth,
      })
      else if (view === 'candidates') {
        const candidateSummary = state.market.candidateSummary || {}
        content = React.createElement(React.Fragment, null,
          React.createElement('input', {
            type: 'search', value: query, onChange: event => { setQuery(event.target.value); setPage(1) },
            style: styles.input, placeholder: '搜索候选项目、Topic、来源或 GitHub 仓库',
          }),
          React.createElement('div', { style: styles.notice },
            `${state.market.candidateSource?.kind === 'github' ? 'GitHub 候选发现源' : '内置候选源回退'} · 当前页 ${candidateEntries.length} / ${pagination?.total || 0} 条候选记录 · ${candidateSummary.reviewable || 0} 条待审 · ${candidateSummary.rejected || 0} 条已拒绝/隔离。候选记录与可信 catalog 物理分离；曝光、推荐或赞助不能改变验证等级，也不会获得安装操作。`,
            state.market.candidateSource?.errorCode ? ` · ${state.market.candidateSource.errorCode}` : ''),
          pageError,
          React.createElement('div', { style: styles.grid, role: 'list', 'aria-label': '候选发现目录' },
            candidateEntries.map(entry => React.createElement(CandidateCard, { key: entry.id, entry }))),
          pageControls)
      }
      else if (view === 'installed') {
        content = React.createElement(React.Fragment, null,
          filters,
          React.createElement('div', { style: styles.notice },
            `当前页 ${entries.length} / ${pagination?.total || 0} 个目录内已安装插件`,
            uncataloguedInstalledAll.length > 0 ? ` · 另有 ${uncataloguedInstalledAll.length} 个目录外只读项` : ''),
          pageError,
          React.createElement('div', { style: styles.grid, role: 'list', 'aria-label': '已安装插件' }, entries.map(entry => React.createElement(MarketCard, {
            key: entry.id, entry, health: state.health, beginPlan, checkSource, openDetails: setDetailEntry, categoryLabels, readOnly: desktopReadOnly,
          }))), pageControls,
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
            featuredOnly ? `作者互动推荐 · 当前页 ${state.market.recommendations?.length || 0} / ${pagination?.total || 0} 项 · 推荐展示不改变审核、兼容性或安装资格`
              : `${state.market.source.kind === 'github' ? 'GitHub 可信安装目录' : state.market.source.kind === 'github-cache' || state.market.source.stale ? '本机缓存目录' : '内置可信目录回退'} · 当前页 ${entries.length} / ${pagination?.total || 0} 个在架条目 · 未知不等于已验证`,
            state.market.source.fetchedAt ? ` · 更新于 ${new Date(state.market.source.fetchedAt).toLocaleString()}` : '',
            state.market.source.stale ? ' · 离线缓存（当前无法连接目录）' : '',
            state.market.source.errorCode ? ` · ${state.market.source.errorCode}` : ''),
          pageError,
          React.createElement('div', { style: styles.grid, role: 'list', 'aria-label': '插件市场目录' }, featuredOnly && state.market.recommendations
            ? state.market.recommendations.map(row => row.kind === 'candidate'
              ? React.createElement(CandidateCard, { key: row.entry.id, entry: row.entry })
              : React.createElement(MarketCard, { key: row.entry.id, entry: row.entry, health: state.health, beginPlan, checkSource, openDetails: setDetailEntry, categoryLabels, readOnly: desktopReadOnly }))
            : entries.map(entry => React.createElement(MarketCard, {
            key: entry.id, entry, health: state.health, beginPlan, checkSource, openDetails: setDetailEntry,
            categoryLabels, readOnly: desktopReadOnly,
          }))), pageControls)
      }

      return React.createElement('section', { style: styles.root, 'aria-label': '插件商城（DSH-Store）' },
        React.createElement('style', null, DETAIL_MODAL_CSS),
        heading, nav,
        React.createElement('details', { style: styles.notice },
          React.createElement('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '插件源更新规则'),
          React.createElement('p', { style: { ...styles.muted, margin: '8px 0 0' } },
            '本机只检查已安装插件并固定完整 Commit：低风险生成计划，高风险展示变化后由用户决定；修改 DSH 原生代码、冒用官方命名空间或停用受保护组件时禁止商城安装/更新。不会直接安装浮动 main，也不依赖服务端巡检全部仓库。')),
        guardianBanner, restartBanner, content,
        React.createElement(OperationHistory, { revision: operation.status }),
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
          health: state.status === 'ready' ? state.health : null, beginPlan, close: closeDetails, readOnly: desktopReadOnly,
        }))
    }

    const name = 'dsh-safe-plugin-manager'
    const inject = ['slots', 'remote', 'remote.pluginManager']
    function apply(ctx) {
      if (!OFFICIAL_DESKTOP_RENDERER) {
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => installBootRecovery(ctx), 'dsh-safe-plugin-manager: boot recovery')
        } else installBootRecovery(ctx)
      }
      if (typeof ctx.inject === 'function') {
        ctx.inject(['remote', 'remote.pluginManager'], () => setDesktopPluginManager(ctx.remote.pluginManager))
      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'dsh-store', order: -10,
        label: () => '插件商城', inject: () => ({}),
      }, ManagerPanel))
      if (OFFICIAL_DESKTOP_RENDERER) {
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'dsh-store',
        }, ManagerPanel))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'dsh-store', order: 10, label: '插件商城',
        }, StorePanelIcon))
      }
    }

    module.exports = { name, inject, apply }
    return module.exports
  },
})
