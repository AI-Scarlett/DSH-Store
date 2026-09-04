const moduleImport = names => new RegExp(
  `(?:\\bfrom\\s*|\\bimport\\s*(?:\\(\\s*)?|\\brequire\\s*\\(\\s*)["'](?:node:)?(?:${names})["']`,
  'i',
)

const FILE_MODULE = moduleImport('fs|fs/promises')
const NETWORK_MODULE = moduleImport('http|https|net|tls|dgram|axios|got|undici')
const COMMAND_MODULE = moduleImport('child_process')

export function permissionSignals(source) {
  return {
    files: FILE_MODULE.test(source)
      || /\b(?:readFile|writeFile|appendFile|rename|unlink|mkdir|rmdir|rm)\s*\(/i.test(source)
      || /\$DSH_HOME|\.dsh\/profiles/i.test(source),
    network: NETWORK_MODULE.test(source)
      || /\b(?:fetch|WebSocket|EventSource)\s*\(/i.test(source)
      || /\b(?:axios|got|undici)\s*(?:\.|\()/i.test(source),
    commands: COMMAND_MODULE.test(source)
      || /\b(?:exec|execFile|spawn|fork)\s*\(|shell\s*:\s*true|Bun\.spawn|new\s+Deno\.Command/i.test(source),
    credentials: /process\.env/i.test(source)
      || /\b(?:keychain|credentials?|oauth)\b\s*(?:\.|\[|\()/i.test(source)
      || /\b(?:api[_-]?key|apiKey|access[_-]?token|accessToken|client[_-]?secret|clientSecret|password)\b/i.test(source),
    protectedDsh: /(?:__ModuleLoader__[^\n]{0,120}(?:unload|remove)|\bFiber\b[^\n]{0,120}(?:remove|disable|replace)|@deepseek-ai\/[^\n]{0,160}disabled\s*:\s*true)/i.test(source),
  }
}
