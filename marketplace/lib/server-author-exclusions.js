// Rankings are also served as browser ES modules. Keep this Node-only bridge
// out of the browser module graph while preserving the source policy in builds.
const policyModule = import.meta.url.startsWith('file:')
  ? await import('../../src/author-exclusions.mjs')
  : null

function requirePolicyFunction(name) {
  const fn = policyModule?.[name]
  if (typeof fn !== 'function') {
    throw new Error(`Author exclusion policy ${name} is unavailable in this runtime`)
  }
  return fn
}

export const isBlockedAuthor = (...args) => requirePolicyFunction('isBlockedAuthor')(...args)
export const isWithdrawnRepository = (...args) => requirePolicyFunction('isWithdrawnRepository')(...args)
