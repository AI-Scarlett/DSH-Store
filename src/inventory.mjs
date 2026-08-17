import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/

export function validateProfileName(value) {
  if (typeof value !== 'string' || !PROFILE_NAME.test(value) || value.includes('..')) {
    throw new TypeError('profile must be a simple name containing letters, numbers, dot, underscore, or hyphen')
  }
  return value
}

export function resolveDshHome(explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return resolve(explicit)
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return resolve(configured)
  return join(homedir(), '.dsh')
}

export function resolveProfileDirectory(dshHome, profile) {
  return join(resolve(dshHome), 'profiles', validateProfileName(profile))
}

export function classifySpecifier(specifier) {
  if (typeof specifier !== 'string' || specifier.trim() === '') return 'bundle'
  const value = specifier.trim()
  if (value.startsWith('link:')) return 'link'
  if (value.startsWith('file:')) return 'file'
  if (value.startsWith('workspace:')) return 'workspace'
  if (/^(?:git(?:\+[^:]+)?|github|gitlab|bitbucket):/i.test(value)) return 'git'
  if (/^(?:https?|ssh):/i.test(value) || /^git@/i.test(value)) return 'git'
  return 'npm'
}

function repositoryUrl(repository) {
  if (typeof repository === 'string') return repository
  if (repository && typeof repository.url === 'string') return repository.url
  return null
}

async function readJson(path, required = false) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (!required && error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null
    throw new Error(`cannot read JSON manifest ${path}: ${String(error?.message || error)}`)
  }
}

function localSpecifierPath(profileDir, specifier) {
  if (typeof specifier !== 'string') return null
  const match = /^(?:link|file):(.*)$/s.exec(specifier.trim())
  if (!match || match[1].trim() === '') return null
  const raw = match[1].trim()
  return isAbsolute(raw) ? raw : resolve(profileDir, raw)
}

function installedManifestCandidates(dshHome, profileDir, packageName, specifier) {
  if (!PACKAGE_NAME.test(packageName) || packageName.includes('..')) return []
  const local = localSpecifierPath(profileDir, specifier)
  return [
    ...(local ? [join(local, 'package.json')] : []),
    join(profileDir, 'node_modules', packageName, 'package.json'),
    join(dirname(profileDir), 'node_modules', packageName, 'package.json'),
    join(dshHome, 'profiles', 'node_modules', packageName, 'package.json'),
  ]
}

async function firstInstalledManifest(candidates) {
  for (const path of candidates) {
    const manifest = await readJson(path)
    if (manifest) return { manifest, path }
  }
  return null
}

function dependencySpecifiers(manifest) {
  const dependencies = manifest.dependencies && typeof manifest.dependencies === 'object'
    ? manifest.dependencies
    : {}
  const optional = manifest.optionalDependencies && typeof manifest.optionalDependencies === 'object'
    ? manifest.optionalDependencies
    : {}
  return { ...dependencies, ...optional }
}

export async function readProfileInventory(options = {}) {
  const profile = validateProfileName(options.profile ?? 'web')
  const dshHome = resolveDshHome(options.dshHome)
  const profileDir = resolveProfileDirectory(dshHome, profile)
  const profileManifest = await readJson(join(profileDir, 'package.json'), true)
  const specifiers = dependencySpecifiers(profileManifest)
  const bundleOrder = Array.isArray(profileManifest?.dsh?.profile?.bundles)
    ? profileManifest.dsh.profile.bundles.filter(name => typeof name === 'string')
    : []
  const names = [...new Set([...bundleOrder, ...Object.keys(specifiers)])]
  const plugins = []
  const diagnostics = []

  for (const packageName of names) {
    if (!PACKAGE_NAME.test(packageName) || packageName.includes('..')) {
      diagnostics.push({ code: 'INVALID_PACKAGE_NAME', packageName })
      continue
    }
    const specifier = typeof specifiers[packageName] === 'string' ? specifiers[packageName] : null
    let installed = null
    try {
      installed = await firstInstalledManifest(
        installedManifestCandidates(dshHome, profileDir, packageName, specifier),
      )
    } catch (error) {
      diagnostics.push({
        code: 'INVALID_INSTALLED_MANIFEST',
        packageName,
        message: String(error?.message || error),
      })
    }
    plugins.push({
      packageName,
      declaredAsBundle: bundleOrder.includes(packageName),
      declaredSpecifier: specifier,
      source: classifySpecifier(specifier),
      official: packageName.startsWith('@deepseek-ai/'),
      installed: installed !== null,
      version: typeof installed?.manifest?.version === 'string' ? installed.manifest.version : null,
      description: typeof installed?.manifest?.description === 'string' ? installed.manifest.description : null,
      repository: repositoryUrl(installed?.manifest?.repository),
      manifestPath: installed?.path ?? null,
      runtime: { status: 'unverified', phase: null },
    })
  }

  return {
    schemaVersion: 1,
    mode: 'read-only',
    generatedAt: new Date().toISOString(),
    profile,
    bundleOrder,
    plugins,
    diagnostics,
  }
}
