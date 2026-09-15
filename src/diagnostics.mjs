const MESSAGES = {
  ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED: '固定 Git 依赖的 prepare 未获允许，不一定来自当前目标插件；需要检查具体依赖，商城不会为整个 Profile 自动放宽构建权限。',
  ERR_PNPM_PREPARE_PACKAGE: '固定源的 prepare 构建失败。',
  ERR_PNPM_WORKSPACE_PKG_NOT_FOUND: '子目录依赖 workspace 包，当前固定源无法独立安装。',
  ERR_PNPM_MINIMUM_RELEASE_AGE: '依赖受 pnpm 发布等待期限制；保留等待期，稍后重新生成计划。',
  ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF: 'pnpm 版本或模块布局发生变化；需要单独制定修复计划。',
  ERR_PNPM_UNEXPECTED_STORE: 'pnpm store 与当前依赖布局不一致。',
  ERR_PNPM_FETCH_404: '依赖不存在或没有访问权限。',
}
export function diagnoseCommand(result = {}) {
  // Keep only error codes and controlled explanations. Arbitrary stderr can
  // contain credentials, source documents and private paths even after regex redaction.
  const output = `${String(result.stderr ?? '').slice(-16384)}\n${String(result.stdout ?? '').slice(-16384)}`
  const codes = [...new Set(output.match(/\bERR_PNPM_[A-Z0-9_]{1,80}\b/g) ?? [])].slice(0, 8)
  const locked = /\b(?:EPERM|EBUSY|EACCES)\b/.test(output) && /rename|unlink|locked|busy|access denied/i.test(output)
  const code = locked ? 'WINDOWS_FILE_LOCKED' : result.timedOut ? 'COMMAND_TIMEOUT' : codes[0] ?? 'COMMAND_FAILED'
  return {
    schemaVersion: 1, code, pnpmCodes: codes,
    message: locked ? '文件被占用；停止自动重试，保留备份并制定恢复计划。' : MESSAGES[code] ?? '官方 CLI 执行失败，请根据错误码检查依赖和运行环境。',
    stderrTail: codes.map(value => `${value}: ${MESSAGES[value] ?? 'pnpm command failed'}`).join('\n').slice(0, 2048),
    outputPolicy: 'error-codes-only', retryAllowed: false,
  }
}
