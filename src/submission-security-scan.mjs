export const SUBMISSION_SCAN_BOUNDS = Object.freeze({
  maxFiles: 150,
  maxFileBytes: 400_000,
  maxFindings: 50,
})

const REVIEW_ONLY_PATH = /(?:^|\/)(?:docs?|examples?|fixtures?|tests?|__tests__)(?:\/|$)|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/i

const RULES = Object.freeze([
  {
    id: 'private-key', category: 'secrets', severity: 'critical',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
    message: '发现硬编码私钥。',
  },
  {
    id: 'github-token', category: 'secrets', severity: 'critical',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
    message: '发现疑似硬编码 GitHub 访问令牌。',
  },
  {
    id: 'aws-access-key', category: 'secrets', severity: 'critical',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    message: '发现疑似硬编码 AWS 访问密钥。',
  },
  {
    id: 'service-secret', category: 'secrets', severity: 'critical',
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/,
    message: '发现疑似硬编码服务密钥。',
  },
  {
    id: 'assigned-secret', category: 'secrets', severity: 'critical',
    pattern: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*['"][A-Za-z0-9_./+=-]{20,}['"]/i,
    message: '发现赋值给敏感字段的长凭据字面量。',
  },
  {
    id: 'transient-exfiltration-endpoint', category: 'network', severity: 'critical',
    pattern: /(?:webhook\.site|requestbin\.(?:com|net)|pipedream\.net|beeceptor\.com|transfer\.sh|file\.io|0x0\.st|discord(?:app)?\.com\/api\/webhooks|api\.telegram\.org\/bot\d+:[A-Za-z0-9_-]+)/i,
    message: '发现常见临时外传或 Webhook 端点。',
  },
  {
    id: 'destructive-root-delete', category: 'destructive', severity: 'critical',
    pattern: /\brm\s+(?:-[A-Za-z]*r[A-Za-z]*f|-[A-Za-z]*f[A-Za-z]*r)\s+(?:--\s+)?(?:\/(?:\s|$)|~(?:\/|\s|$)|\$(?:HOME|USERPROFILE)\b)/i,
    message: '发现针对根目录或用户目录的递归强制删除命令。',
  },
  {
    id: 'destructive-powershell-delete', category: 'destructive', severity: 'critical',
    pattern: /\bRemove-Item\b[^\r\n]{0,160}\b-Recurse\b[^\r\n]{0,160}\b-Force\b[^\r\n]{0,160}(?:[A-Z]:\\|\$(?:HOME|env:USERPROFILE))/i,
    message: '发现针对系统盘或用户目录的 PowerShell 递归强制删除命令。',
  },
  {
    id: 'ssh-key-material', category: 'destructive', severity: 'critical',
    pattern: /\.ssh[\\/](?:authorized_keys|id_rsa|id_ed25519)\b/i,
    message: '发现对 SSH 授权或私钥文件的直接引用。',
  },
  {
    id: 'crypto-miner', category: 'mining', severity: 'critical',
    pattern: /\b(?:xmrig|nicehash|cryptonight|ethminer|minerd|stratum\+tcp|supportxmr|pool\.minexmr)\b/i,
    message: '发现加密货币挖矿特征。',
  },
  {
    id: 'dynamic-code', category: 'code-exec', severity: 'warning',
    pattern: /\b(?:eval\s*\(|new\s+Function\s*\()/i,
    message: '发现动态代码执行能力。',
  },
  {
    id: 'child-process', category: 'shell', severity: 'warning',
    pattern: /\b(?:child_process|execSync\s*\(|execFileSync\s*\(|spawnSync\s*\()/i,
    message: '发现子进程或命令执行能力；CLI 插件可能合理使用，但需要复核参数边界。',
  },
  {
    id: 'shell-mode', category: 'shell', severity: 'warning',
    pattern: /\bspawn(?:Sync)?\s*\([^\r\n]{0,300}\bshell\s*:\s*true/i,
    message: '发现 shell:true，可能扩大命令注入面。',
  },
  {
    id: 'download-and-execute', category: 'shell', severity: 'warning',
    pattern: /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\r\n|]{0,300}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\b(?:iwr|Invoke-WebRequest)\b[^\r\n]{0,300}\|\s*(?:iex|Invoke-Expression)\b/i,
    message: '发现下载后直接交给 Shell 或 PowerShell 执行的链路。',
  },
  {
    id: 'remote-install-hook', category: 'install', severity: 'warning',
    pattern: /"(?:preinstall|install|postinstall|prepare)"\s*:\s*"[^"]{0,500}(?:curl|wget|iwr|https?:\/\/)/i,
    message: '安装生命周期脚本包含远程下载行为。',
  },
  {
    id: 'encoded-payload', category: 'obfuscation', severity: 'warning',
    pattern: /['"`][A-Za-z0-9+/]{240,}={0,2}['"`]/,
    message: '发现较长编码载荷，可能属于混淆。',
  },
  {
    id: 'character-code-payload', category: 'obfuscation', severity: 'warning',
    pattern: /\bString\.fromCharCode\s*\(\s*\d+(?:\s*,\s*\d+){8}/,
    message: '发现批量字符码构造，可能属于混淆。',
  },
])

function safePath(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '').slice(0, 500)
}

function boundedInteger(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

export function scanSubmissionSources(files, options = {}) {
  if (!Array.isArray(files)) throw new TypeError('submission scan files must be an array')
  const findings = []
  const seen = new Set()
  const sortedFiles = files
    .map(file => ({ path: safePath(file?.path), source: String(file?.source ?? '') }))
    .filter(file => file.path !== '')
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))

  for (const file of sortedFiles) {
    const reviewOnly = REVIEW_ONLY_PATH.test(file.path)
    const lines = file.source.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].slice(0, SUBMISSION_SCAN_BOUNDS.maxFileBytes)
      for (const rule of RULES) {
        const key = `${file.path}\0${rule.id}`
        if (seen.has(key) || !rule.pattern.test(line)) continue
        seen.add(key)
        findings.push({
          rule: rule.id,
          category: rule.category,
          severity: reviewOnly && rule.severity === 'warning' ? 'info' : rule.severity,
          message: rule.message,
          file: file.path,
          line: index + 1,
        })
      }
    }
  }

  const eligibleFiles = boundedInteger(options.eligibleFiles, sortedFiles.length)
  const skippedOversize = boundedInteger(options.skippedOversize, 0)
  const skippedUnsupported = boundedInteger(options.skippedUnsupported, 0)
  const capped = options.capped === true || eligibleFiles > sortedFiles.length
  const complete = !capped && skippedOversize === 0 && skippedUnsupported === 0
  const counts = findings.reduce((summary, finding) => {
    summary[finding.severity] += 1
    return summary
  }, { critical: 0, warning: 0, info: 0 })
  const highRisk = findings.some(finding => finding.severity === 'critical'
    && ['secrets', 'network', 'destructive', 'mining'].includes(finding.category))
  const verdict = highRisk ? 'fail'
    : findings.some(finding => finding.severity !== 'info') || !complete ? 'warn'
      : 'pass'

  return {
    engine: 'dsh-store-submission-static-v1',
    policy: 'high-risk-block-cli-capability-warn-v1',
    verdict,
    complete,
    filesScanned: sortedFiles.length,
    eligibleFiles,
    skippedOversize,
    skippedUnsupported,
    capped,
    counts,
    findings: findings.slice(0, SUBMISSION_SCAN_BOUNDS.maxFindings),
    findingsTruncated: findings.length > SUBMISSION_SCAN_BOUNDS.maxFindings,
  }
}
