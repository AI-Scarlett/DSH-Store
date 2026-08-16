import { resolveDshHome, validateProfileName } from './inventory.mjs'
import { registerInventoryRoute } from './panel.mjs'

export const name = 'dsh-safe-plugin-manager'
export const inject = []

function normalizeConfig(config = {}) {
  return {
    defaultProfile: validateProfileName(config.defaultProfile ?? 'web'),
    dshHome: resolveDshHome(config.dshHome),
  }
}

export function apply(ctx, config = {}) {
  const options = normalizeConfig(config)
  ctx.inject(['webServer'], (webCtx) => {
    const dispose = registerInventoryRoute(webCtx.webServer, options)
    if (typeof dispose === 'function' && typeof webCtx.effect === 'function') {
      webCtx.effect(() => dispose, 'dsh-safe-plugin-manager: inventory route')
    }
    webCtx.logger?.info?.('dsh-safe-plugin-manager read-only inventory ready')
  })
}

