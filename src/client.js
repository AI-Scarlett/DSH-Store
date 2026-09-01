window.__ModuleLoader__.load({
  id: 'dsh-safe-plugin-manager',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { Modal } = require('@deepseek-ai/dsh-client-ui-primitives')
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const ROUTES = {
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
    const MARKET_PAGE_SIZE = 24
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

    const LEGACY_DSH_VERSIONS = { 'rc.7': '0.1.0-rc.7', 'rc.8': '0.1.0-rc.8', '0.1.1-rc.1': '0.1.1-rc.1', '0.1.1-rc.2': '0.1.1-rc.2', '0.1.2-alpha.2': '0.1.2-alpha.2', '0.1.2-alpha.3': '0.1.2-alpha.3', '0.1.2-alpha.4': '0.1.2-alpha.4' }
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

    function TabButton({ children, active, onClick }) {
      return React.createElement('button', {
        type: 'button', role: 'tab', 'aria-selected': active, onClick,
        style: { ...styles.tabButton, ...(active ? styles.activeTabButton : {}) },
      }, children)
    }

    function CatalogFilters({ query, category, categoryIds, categoryLabels, featuredOnly, showFeatured, onQueryChange, onCategoryChange, onFeaturedChange }) {
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
        categoryIds.map(id => React.createElement('option', { key: id, value: id }, categoryLabels[id] || id))),
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

    function PluginActions({ entry, health, beginPlan, checkSource }) {
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

    function CandidateCard({ entry }) {
      const titleId = `dsh-store-candidate-${String(entry.id).replaceAll(/[^A-Za-z0-9_-]/g, '-')}`
      const status = entry.status === 'rejected' ? '已拒绝 / 已隔离' : entry.status === 'reviewing' ? '审核中' : '已发现'
      return React.createElement('article', { style: styles.card, role: 'listitem', 'aria-labelledby': titleId },
        React.createElement('div', { style: styles.cardHeader },
          React.createElement('div', { id: titleId, style: styles.name }, entry.name),
          React.createElement(StatusPill, { label: `${status} · 不可安装`, tone: entry.status === 'rejected' ? 'var(--dsw-alias-state-error-primary)' : undefined })),
        React.createElement('div', { style: styles.cardDescription }, entry.description),
        React.createElement('div', { style: styles.cardTags },
          React.createElement('span', { style: styles.badge }, `发现来源 ${(entry.discoverySources || []).join(' / ') || '未知'}`),
          React.createElement('span', { style: styles.badge }, `审核路径 ${entry.route || '未知'}`)),
        React.createElement('div', { style: entry.status === 'rejected' ? styles.error : styles.notice }, entry.status === 'rejected'
          ? `拒绝原因：${entry.statusReason || '未提供'}；项目仍不可安装，可在源变更后重新审核。`
          : '该项目尚未晋升到可信安装目录，不提供安装、更新、启停或卸载操作。'),
        React.createElement('div', { style: styles.cardFooter },
          React.createElement('span', { style: styles.muted }, entry.sourceUpdatedAt ? `源更新 ${new Date(entry.sourceUpdatedAt).toLocaleDateString()}` : `发现于 ${new Date(entry.discoveredAt).toLocaleDateString()}`),
          React.createElement('a', { href: entry.repositoryUrl, target: '_blank', rel: 'noreferrer', style: styles.link }, '查看 GitHub 证据')))
    }

    function MarketCard({ entry, health, beginPlan, checkSource, openDetails, categoryLabels = {} }) {
      const state = entry.sourceUpdate?.status === 'update-ready' ? '源更新审核通过'
        : entry.sourceUpdate?.status === 'user-review-required' ? '发现高风险更新 · 用户决定'
          : entry.sourceUpdate?.status === 'external-only' ? '商城禁止更新 · 仅外部入口'
            : entry.sourceUpdate?.status === 'update-blocked' ? '源更新无法验证'
          : entry.status === 'blocked' ? '商城不可安装'
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
        entry.source.updatedAt ? React.createElement('div', { style: styles.muted },
          `固定提交时间 ${new Date(entry.source.updatedAt).toLocaleDateString()} · ${entry.source.provenance}`) : null,
        React.createElement('div', { style: styles.cardTags },
          React.createElement('span', { style: styles.badge }, `GitHub 发布者 ${githubPublisher(entry.repositoryUrl)}`),
          origin ? React.createElement('span', { style: styles.badge }, origin) : null,
          ...entry.categories.map(id => React.createElement('span', { key: id, style: styles.badge }, categoryLabels[id] || id)),
          Number.isInteger(entry.installCount) ? React.createElement('span', { style: styles.badge }, `累计安装 ${entry.installCount}`) : null),
        React.createElement(AssuranceMatrix, { entry }),
        React.createElement(CompatibilityMatrix, { entry }),
        entry.risk.installScripts.length > 0
          ? React.createElement('div', { style: styles.error }, `安装脚本：${entry.risk.installScripts.join(', ')}`)
          : null,
        ['user-review-required', 'external-only', 'update-blocked'].includes(entry.sourceUpdate?.status)
          ? React.createElement('div', { style: styles.error }, entry.sourceUpdate.reasons.join('；'))
          : entry.sourceUpdate?.status === 'current'
            ? React.createElement('div', { style: styles.notice }, entry.sourceUpdate.sameVersionSourceChange
              ? '源仓库有同版本提交；当前安装版本无需更新，商城不会把目录或文档提交当作插件升级。'
              : '已在本机按需检查 GitHub 源仓库，当前没有可用的新 Commit。')
            : entry.sourceUpdate?.status === 'error'
              ? React.createElement('div', { style: styles.error }, `${entry.sourceUpdate.code}：${entry.sourceUpdate.message}`)
              : null,
        React.createElement(SourceDiffSummary, { update: entry.sourceUpdate }),
        React.createElement('div', { style: styles.cardFooter },
          React.createElement('div', { style: styles.actions },
            React.createElement(PluginActions, { entry, health, beginPlan, checkSource }),
            entry.status === 'blocked' || entry.sourceUpdate?.status === 'external-only'
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
          result.error ? React.createElement(React.Fragment, null,
            React.createElement('div', { style: styles.error }, `${result.error.code}：${result.error.message}`),
            result.error.diagnostic ? React.createElement('div', { style: styles.notice },
              `${result.error.diagnostic.code}：${result.error.diagnostic.message}`) : null) : null,
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
      if (operation.status === 'planning' || operation.status === 'executing' || operation.status === 'handoff') return React.createElement(Modal, {
        open: true, onClose: operation.status === 'planning' ? cancel : () => {}, title: '安装 DSH Guardian',
        footer: null, className: 'dsh-safe-plugin-detail-modal', contentClassName: 'dsh-safe-plugin-detail-content',
      }, React.createElement('div', { style: styles.notice }, operation.status === 'planning'
        ? '正在核对 launchd 与守护文件预条件…'
        : operation.status === 'handoff'
          ? 'Guardian 已验证，DSH 正在交接，页面会自动重新连接。'
          : '正在原子安装并验证 Guardian 心跳…'))
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
      const [debouncedQuery, setDebouncedQuery] = useState('')
      const [category, setCategory] = useState('')
      const [featuredOnly, setFeaturedOnly] = useState(false)
      const [page, setPage] = useState(1)
      const [state, setState] = useState({ status: 'loading' })
      const [marketLoading, setMarketLoading] = useState(false)
      const [marketError, setMarketError] = useState('')
      const marketRequestId = useRef(0)
      const sourceAutoScanned = useRef(new Set())
      const [confirmation, setConfirmation] = useState('')
      const [operation, setOperation] = useState({ status: 'idle' })
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
      useEffect(() => { void refresh(false) }, [refresh])
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
          && current.featuredOnly === (view === 'market' && featuredOnly)) return undefined
        const requestId = ++marketRequestId.current
        let cancelled = false
        setMarketLoading(true)
        setMarketError('')
        void post(ROUTES.market, {
          view, page, pageSize: MARKET_PAGE_SIZE, query: debouncedQuery, category: requestedCategory,
          featuredOnly: view === 'market' && featuredOnly,
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
      }, [category, debouncedQuery, featuredOnly, page, state.status, view])

      const refreshDshVersion = useCallback(async () => {
        setVersionChecking(true); setVersionFeedback('')
        try {
          const dshVersion = await post(ROUTES.dshVersion, { refresh: true })
          const market = await post(ROUTES.market, {
            view, page, pageSize: MARKET_PAGE_SIZE, query: debouncedQuery, category: view === 'candidates' ? '' : category,
            featuredOnly: view === 'market' && featuredOnly,
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
      }, [category, debouncedQuery, featuredOnly, page, view])

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
          .map(entry => ({ ...entry, sourceUpdate: sourceUpdates[entry.id] ?? null }))
      }, [sourceUpdates, state])

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
      const pageReady = pagination?.view === view && pagination.page === page
        && pagination.query === debouncedQuery && pagination.category === expectedCategory
        && pagination.featuredOnly === (view === 'market' && featuredOnly)
      const entries = pageReady ? normalizedEntries : []
      const marketOptions = useMemo(() => ({
        view: view === 'health' ? 'market' : view,
        page,
        query: debouncedQuery,
        category: view === 'candidates' ? '' : category,
        featuredOnly: view === 'market' && featuredOnly,
      }), [category, debouncedQuery, featuredOnly, page, view])

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
          const value = await post(ROUTES.execute, { planId: plan.planId, confirmation }, 'execute')
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
      const dshVersion = state.status === 'ready' ? state.dshVersion : null
      const versionLabel = dshVersion?.currentVersion
        ? `DSH ${dshVersion.currentVersion}${dshVersion.updateAvailable ? ` → ${dshVersion.latestVersion}${dshVersion.releaseChannel === 'preview' ? '（预发布）' : ''}` : dshVersion.status === 'current' ? dshVersion.releaseChannel === 'preview' ? ' · 已是当前预发布' : ' · 稳定版已是最新' : ''}`
        : 'DSH 版本待检测'
      const heading = React.createElement('div', { style: styles.toolbar },
        React.createElement('div', { style: styles.headingCopy },
          React.createElement('h3', { style: styles.title }, 'DSH第三方插件商城'),
          React.createElement('p', { style: styles.subtitle },
            'GitHub-only 目录 · 计划确认 · Profile 备份 · 健康检查 · 失败回滚 · ',
            React.createElement('a', {
              href: SUPPORT_URL, target: '_blank', rel: 'noreferrer', style: styles.link,
            }, '技术支持：DSH-Store'))),
        React.createElement('div', { style: styles.versionBox, 'aria-label': 'DSH 版本与升级' },
          React.createElement('span', {
            style: styles.versionPill,
            title: dshVersion?.upgrade?.reason || dshVersion?.message || '检测当前 DSH 与 npm 官方稳定版和预发布通道',
          }, versionLabel),
          React.createElement(Button, { compact: true, disabled: versionChecking, onClick: refreshDshVersion },
            versionChecking ? '检测中…' : '检测升级'),
          dshVersion?.updateAvailable ? React.createElement(Button, {
            compact: true, primary: true, onClick: copyUpgradeCommand,
            title: dshVersion.upgrade.reason,
          }, '复制升级命令') : null,
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

      const guardianIsExternal = state.status === 'ready' && state.guardian.owner === 'external'
      const guardianHasPortConflict = state.status === 'ready' && state.guardian.errorCode === 'GUARDIAN_PORT_CONFLICT'
      const guardianNeedsUpgrade = state.status === 'ready' && state.guardian.upgradeRequired === true
      const guardianUnsupported = state.status === 'ready' && state.guardian.supported === false
      const guardianBanner = state.status !== 'ready' ? null : React.createElement('div', {
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
      if (state.status === 'loading') content = React.createElement('p', { style: styles.muted }, '正在读取 Profile 与 GitHub 目录…')
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
            key: entry.id, entry, health: state.health, beginPlan, checkSource, openDetails: setDetailEntry, categoryLabels,
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
            `${state.market.source.kind === 'github' ? 'GitHub 可信安装目录' : '内置可信目录回退'} · 当前页 ${entries.length} / ${pagination?.total || 0} 个在架条目 · 未知不等于已验证`,
            state.market.source.errorCode ? ` · ${state.market.source.errorCode}` : ''),
          pageError,
          React.createElement('div', { style: styles.grid, role: 'list', 'aria-label': '插件市场目录' }, entries.map(entry => React.createElement(MarketCard, {
            key: entry.id, entry, health: state.health, beginPlan, checkSource, openDetails: setDetailEntry,
            categoryLabels,
          }))), pageControls)
      }

      return React.createElement('section', { style: styles.root, 'aria-label': 'DSH-Store 插件商城' },
        React.createElement('style', null, DETAIL_MODAL_CSS),
        heading, nav,
        React.createElement('details', { style: styles.notice },
          React.createElement('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '插件源更新规则'),
          React.createElement('p', { style: { ...styles.muted, margin: '8px 0 0' } },
            '本机只检查已安装插件并固定完整 Commit：低风险生成计划，高风险展示变化后由用户决定；修改 DSH 原生代码、冒用官方命名空间或停用受保护组件时禁止商城安装/更新。不会直接安装浮动 main，也不依赖服务端巡检全部仓库。')),
        guardianBanner, restartBanner, content,
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
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => installBootRecovery(ctx), 'dsh-safe-plugin-manager: boot recovery')
      } else installBootRecovery(ctx)
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab', id: 'safe-plugin-manager', order: -10,
        label: () => '插件商城', inject: () => ({}),
      }, ManagerPanel))
    }

    module.exports = { name, inject, apply }
    return module.exports
  },
})
