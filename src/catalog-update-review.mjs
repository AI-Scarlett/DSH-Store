import { compareVersions } from './catalog.mjs'

const COMMIT_SHA = /^[0-9a-f]{40}$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function normalizedPath(value) {
  return value === undefined || value === null || value === '' ? null : String(value)
}

function sorted(values) {
  return [...(Array.isArray(values) ? values : [])].sort()
}

function unknownEvidence(summary) {
  return {
    status: 'unknown',
    method: null,
    checkedAt: null,
    evidenceUrl: null,
    dshRelease: null,
    systems: [],
    profiles: [],
    summary,
  }
}

function resetCompatibilityEvidence(entry, candidate) {
  const releaseKeys = new Set([
    ...Object.keys(entry.compatibility?.dshReleases ?? {}),
    ...Object.keys(entry.compatibility?.dshOperations ?? {}),
  ])
  const dshReleases = {}
  const dshOperations = {}
  for (const release of releaseKeys) {
    dshReleases[release] = 'unknown'
    dshOperations[release] = {
      install: 'unknown',
      start: 'unknown',
      uninstall: 'unknown',
      rollback: 'unknown',
    }
  }
  return {
    dsh: candidate.compatibility?.dsh ?? null,
    dshReleases,
    dshOperations,
    node: candidate.compatibility?.node ?? null,
    systems: sorted(candidate.compatibility?.systems),
    profiles: sorted(candidate.compatibility?.profiles),
  }
}

export function catalogUpdatePolicy(entry) {
  if (entry.updatePolicy === 'external-only') return 'external-only'
  if (entry.updatePolicy === 'user-reviewed') return 'user-reviewed'
  if (entry.updatePolicy === 'source-verified') return 'source-verified'
  const permissions = entry.details?.permissions ?? {}
  const credentials = permissions.credentials ?? ['unknown']
  const lowRisk = entry.status === 'approved'
    && (entry.risk?.installScripts?.length ?? 0) === 0
    && ['none', 'read-only'].includes(permissions.files)
    && permissions.network === 'none'
    && permissions.commands === 'none'
    && credentials.length === 1
    && credentials[0] === 'none'
  return lowRisk ? 'source-verified' : entry.status === 'approved' ? 'user-reviewed' : 'external-only'
}

export function assessUpstreamVersion(entry, source) {
  const commit = String(source?.commit ?? '').toLowerCase()
  if (!COMMIT_SHA.test(commit)) {
    return { status: 'update-blocked', reason: 'GitHub did not return a full immutable Commit' }
  }
  if (commit === entry.commit) {
    return { status: 'current', commit, catalogVersion: entry.version, upstreamVersion: entry.version }
  }
  const manifest = source?.manifest
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { status: 'update-blocked', commit, reason: 'the fixed-Commit manifest is not a JSON object' }
  }
  if (manifest.name !== entry.packageName) {
    return { status: 'update-blocked', commit, reason: 'the upstream package name no longer matches the Catalog identity' }
  }
  const upstreamVersion = typeof manifest.version === 'string' ? manifest.version : ''
  if (!SEMVER.test(upstreamVersion)) {
    return { status: 'update-blocked', commit, upstreamVersion, reason: 'the upstream manifest does not declare a valid semantic version' }
  }
  const comparison = compareVersions(upstreamVersion, entry.version)
  if (comparison === null) {
    return { status: 'update-blocked', commit, upstreamVersion, reason: 'the upstream manifest does not declare a valid semantic version' }
  }
  if (comparison === 0) {
    return { status: 'source-changed-without-version-bump', commit, catalogVersion: entry.version, upstreamVersion }
  }
  if (comparison < 0) {
    return { status: 'upstream-version-behind', commit, catalogVersion: entry.version, upstreamVersion }
  }
  return { status: 'newer-version', commit, catalogVersion: entry.version, upstreamVersion }
}

export function catalogUpdateIdentityMatches(entry, candidate) {
  return candidate?.packageName === entry.packageName
    && candidate?.repositoryUrl === entry.repositoryUrl
    && candidate?.manifestPath === entry.manifestPath
    && normalizedPath(candidate?.installPath) === normalizedPath(entry.installPath)
    && JSON.stringify(sorted(candidate?.entryIds)) === JSON.stringify(sorted(entry.entryIds))
}

export function buildCatalogVersionUpdate(entry, candidate, analysis, observedAt, policy = catalogUpdatePolicy(entry)) {
  const reason = policy === 'source-verified'
    ? 'The newer fixed Commit passed the complete automatic low-risk source policy.'
    : policy === 'user-reviewed'
      ? 'The newer fixed Commit passed Catalog identity and source-contract review; installation still requires a separate local risk review.'
      : 'The external-only or non-installable listing metadata was refreshed from a verified fixed Commit; no installability was inferred.'
  return {
    ...entry,
    defaultBranch: candidate.defaultBranch,
    commit: candidate.commit,
    version: candidate.version,
    compatibility: resetCompatibilityEvidence(entry, candidate),
    source: {
      updatedAt: analysis?.sourceUpdatedAt ?? observedAt,
      observedAt,
      provenance: 'github-commit',
    },
    assurance: {
      discovery: {
        status: 'verified',
        method: 'automated-fixed-source-update-v2',
        checkedAt: observedAt,
        evidenceUrl: `${entry.repositoryUrl}/commit/${candidate.commit}`,
        dshRelease: null,
        systems: [],
        profiles: [],
        summary: reason,
      },
      installability: unknownEvidence('The updated release was not installed or built by Catalog automation.'),
      runtime: unknownEvidence('No DSH runtime acceptance was carried forward from the previous plugin version.'),
      securityReview: unknownEvidence('Automated fixed-source review is not an independent security audit.'),
    },
    risk: {
      ...entry.risk,
      installScripts: sorted(candidate.risk?.installScripts),
    },
  }
}
