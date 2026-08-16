import { createCatalogService, DEFAULT_CATALOG_URL } from './catalog.mjs'
import { createDshRunner } from './dsh.mjs'
import { resolveDshHome, validateProfileName } from './inventory.mjs'
import { createOperationService } from './operations.mjs'
import { registerManagerRoutes } from './panel.mjs'

export const name = 'dsh-safe-plugin-manager'
export const inject = []

function normalizeConfig(config = {}) {
  return {
    defaultProfile: validateProfileName(config.defaultProfile ?? 'web'),
    dshHome: resolveDshHome(config.dshHome),
    catalogUrl: config.catalogUrl === null ? null : (config.catalogUrl ?? DEFAULT_CATALOG_URL),
    mutationsEnabled: config.mutationsEnabled === true,
    dshCliPath: typeof config.dshCliPath === 'string' && config.dshCliPath.trim() !== ''
      ? config.dshCliPath
      : process.argv[1],
  }
}

export function apply(ctx, config = {}) {
  const options = normalizeConfig(config)
  const catalogService = createCatalogService({ catalogUrl: options.catalogUrl })
  const runner = createDshRunner({ cliPath: options.dshCliPath })
  const operationService = createOperationService({
    dshHome: options.dshHome,
    defaultProfile: options.defaultProfile,
    catalogService,
    runner,
    mutationsEnabled: options.mutationsEnabled,
  })
  ctx.inject(['webServer'], (webCtx) => {
    const dispose = registerManagerRoutes(webCtx.webServer, {
      ...options, catalogService, runner, operationService,
    })
    if (typeof dispose === 'function' && typeof webCtx.effect === 'function') {
      webCtx.effect(() => dispose, 'dsh-safe-plugin-manager: inventory route')
    }
    webCtx.logger?.info?.(`dsh-safe-plugin-manager ready (${options.mutationsEnabled ? 'guarded-write' : 'read-only'})`)
  })
}
