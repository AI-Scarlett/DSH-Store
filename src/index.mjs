import { createCatalogService, DEFAULT_CATALOG_URL } from './catalog.mjs'
import { createDshRunner } from './dsh.mjs'
import { resolveDshHome, validateProfileName } from './inventory.mjs'
import { createOperationService } from './operations.mjs'
import { registerManagerRoutes } from './panel.mjs'
import { createRuntimeStatus } from './runtime.mjs'
import { createRestartService } from './restart.mjs'
import { createGuardianService } from './guardian.mjs'
import { createTelemetryClient } from './telemetry.mjs'
import { createSourceUpdateService } from './source-update.mjs'
import { createDshVersionService } from './dsh-version.mjs'

export const name = 'dsh-safe-plugin-manager'
export const inject = []

function normalizeConfig(config = {}) {
  return {
    defaultProfile: validateProfileName(config.defaultProfile ?? 'web'),
    dshHome: resolveDshHome(config.dshHome),
    catalogUrl: config.catalogUrl === null ? null : (config.catalogUrl ?? DEFAULT_CATALOG_URL),
    mutationsEnabled: config.mutationsEnabled === true,
    telemetryEnabled: config.telemetryEnabled === true,
    telemetryUrl: typeof config.telemetryUrl === 'string' ? config.telemetryUrl : null,
    installCountsUrl: typeof config.installCountsUrl === 'string' ? config.installCountsUrl : null,
    dshCliPath: typeof config.dshCliPath === 'string' && config.dshCliPath.trim() !== ''
      ? config.dshCliPath
      : process.argv[1],
  }
}

export function apply(ctx, config = {}) {
  const options = normalizeConfig(config)
  const catalogService = createCatalogService({ catalogUrl: options.catalogUrl, installCountsUrl: options.installCountsUrl })
  const runner = createDshRunner({ cliPath: options.dshCliPath })
  const launchSpec = runner.restartSpec(options.defaultProfile)
  const launchProfileArgs = options.defaultProfile === 'web' ? ['web'] : ['--profile', options.defaultProfile]
  const runtimeStatus = createRuntimeStatus({
    profile: options.defaultProfile,
    restartCommand: [launchSpec.nodePath, ...launchSpec.runtimeArgs, launchSpec.cliPath, ...launchProfileArgs],
    restartWorkingDirectory: launchSpec.cwd,
  })
  const guardianService = createGuardianService({
    dshHome: options.dshHome, restartSpec: profile => runner.restartSpec(profile),
  })
  const restartService = createRestartService({ runtimeStatus, guardianService })
  const telemetryClient = createTelemetryClient({ endpoint: options.telemetryUrl, enabled: options.telemetryEnabled })
  const sourceUpdateService = createSourceUpdateService()
  const dshVersionService = createDshVersionService({ cliPath: options.dshCliPath })
  const operationService = createOperationService({
    dshHome: options.dshHome,
    defaultProfile: options.defaultProfile,
    catalogService,
    runner,
    mutationsEnabled: options.mutationsEnabled,
    telemetryClient,
    sourceUpdateService,
    runtimeInstanceId: runtimeStatus.bootId,
  })
  ctx.inject(['webServer'], (webCtx) => {
    const dispose = registerManagerRoutes(webCtx.webServer, {
      ...options, catalogService, runner, operationService, sourceUpdateService, dshVersionService,
      runtimeStatus, restartService, guardianService,
    })
    if (typeof dispose === 'function' && typeof webCtx.effect === 'function') {
      webCtx.effect(() => dispose, 'dsh-safe-plugin-manager: inventory route')
    }
    webCtx.logger?.info?.(`dsh-safe-plugin-manager ready (${options.mutationsEnabled ? 'guarded-write' : 'read-only'})`)
  })
}
