const MESSAGES = {
  ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED: '固定 Git 依赖的 prepare 未获允许，不一定来自当前目标插件；需要检查具体依赖，商城不会为整个 Profile 自动放宽构建权限。',
  ERR_PNPM_PREPARE_PACKAGE: '固定源的 prepare 构建失败。',
  ERR_PNPM_WORKSPACE_PKG_NOT_FOUND: '子目录依赖 workspace 包，当前固定源无法独立安装。',
  ERR_PNPM_MINIMUM_RELEASE_AGE: '依赖受 pnpm 发布等待期限制；保留等待期，稍后重新生成计划。',
  ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF: 'pnpm 版本或模块布局发生变化；需要单独制定修复计划。',
  ERR_PNPM_UNEXPECTED_STORE: 'pnpm store 与当前依赖布局不一致。',
  ERR_PNPM_FETCH_404: '依赖不存在或没有访问权限。',
}

// Failures that carry no pnpm error code still need a bounded, actionable label.
// These signatures are matched against a whitelist and produce only vetted text;
// the captured package name is length-bounded and stripped of separators so no
// path, secret, or arbitrary output can travel through the reason field.
const SIGNATURES = [
  {
    code: 'DSH_PROFILE_BUNDLE_UNRESOLVED',
    pattern: /cannot resolve profile bundle "([^"\n]{1,200})"/,
    message: '该 Profile 里已声明的 Bundle 无法解析，官方 CLI 在完成包操作后的校验阶段中止；本次变更已回滚，问题是既有 Bundle 声明，不是本次目标插件。',
  },
  {
    code: 'DSH_PLUGIN_PEER_INCOMPATIBLE',
    pattern: /is incompatible with dsh ([0-9][0-9A-Za-z.+-]{0,40}):/,
    message: '该 Profile 中已有插件与当前 DSH 版本 peer 不兼容，官方 CLI 在安装后校验阶段中止；需要为该插件加精确版本豁免、升级它，或停止把它声明为 Bundle。',
  },
  {
    code: 'DSH_CLI_PNPM_MISSING',
    pattern: /\bpnpm\b[^\n]{0,80}(?:not found|ENOENT|command not found)/i,
    message: '官方 CLI 找不到 pnpm；请检查全局 DSH CLI 运行环境里的 PATH。',
  },
  {
    code: 'DSH_CLI_OPTION_UNSUPPORTED',
    pattern: /unknown option[^\n]{0,120}/i,
    message: '当前官方 DSH CLI 不接受商城使用的参数组合；需要按该 DSH 版本的命令行契约修正后再生成计划。',
  },
  {
    code: 'DSH_PROFILE_JSON_INVALID',
    pattern: /Unexpected token[^\n]{0,120}/,
    message: 'Profile 中存在非法 JSON，官方 CLI 无法读取；请先修复该文件再重试。',
  },
]

function safeCapture(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  // Keep it label-shaped: no separators, no whitespace, no long tails.
  const normalized = trimmed.replace(/[\s/\\]/g, '')
  if (normalized === '' || normalized.length > 120) return null
  return normalized
}

export function classifyCommandFailure(result = {}) {
  const output = `${String(result.stderr ?? '').slice(-16384)}\n${String(result.stdout ?? '').slice(-16384)}`
  for (const signature of SIGNATURES) {
    const match = signature.pattern.exec(output)
    if (match) {
      const detail = safeCapture(match[1])
      return {
        code: signature.code,
        message: signature.message,
        reason: detail === null ? signature.message : `${signature.message}（对象：${detail}）`,
      }
    }
  }
  return null
}

export function diagnoseCommand(result = {}) {
  // Keep only error codes and controlled explanations. Arbitrary stderr can
  // contain credentials, source documents and private paths even after regex redaction.
  const output = `${String(result.stderr ?? '').slice(-16384)}\n${String(result.stdout ?? '').slice(-16384)}`
  const codes = [...new Set(output.match(/\bERR_PNPM_[A-Z0-9_]{1,80}\b/g) ?? [])].slice(0, 8)
  const locked = /\b(?:EPERM|EBUSY|EACCES)\b/.test(output) && /rename|unlink|locked|busy|access denied/i.test(output)
  const signature = codes.length === 0 && !locked && !result.timedOut
    ? classifyCommandFailure(result)
    : null
  const code = locked
    ? 'WINDOWS_FILE_LOCKED'
    : result.timedOut
      ? 'COMMAND_TIMEOUT'
      : codes[0] ?? signature?.code ?? 'COMMAND_FAILED'
  const message = locked
    ? '文件被占用；停止自动重试，保留备份并制定恢复计划。'
    : MESSAGES[code] ?? signature?.message ?? '官方 CLI 执行失败，请根据错误码检查依赖和运行环境。'
  return {
    schemaVersion: 1, code, pnpmCodes: codes,
    message,
    reason: codes.length === 0 && !locked && !result.timedOut ? signature?.reason ?? null : null,
    stderrTail: codes.map(value => `${value}: ${MESSAGES[value] ?? 'pnpm command failed'}`).join('\n').slice(0, 2048),
    outputPolicy: 'error-codes-only', retryAllowed: false,
  }
}
