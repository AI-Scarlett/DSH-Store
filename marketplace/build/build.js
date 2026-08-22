const translations = {
  zh: {
    'meta.title': '开发 DSH 插件｜DSH STORE Build Lab',
    'meta.description': '使用 build-dsh-plugin Agent Skill，把问题、期望结果和成功标准转换为标准、非破坏性的 DeepSeek Harness 插件工程与验证流程。',
    'a11y.skip': '跳到 Skill 安装',
    'nav.home': '首页', 'nav.store': '插件目录', 'nav.manager': 'DSH Store 插件', 'nav.build': '开发插件', 'nav.trust': '信任机制', 'nav.faq': '常见问题', 'nav.about': '关于我们', 'nav.guide': '使用说明', 'nav.submit': '提交插件',
    'hero.title1': '用三个答案，', 'hero.title2': '启动一个 DSH 插件。',
    'hero.lead': '把自然语言 Brief 转换为标准 Bundle、风险边界、源码、测试和证据门槛。开发从用户结果开始，不从内部 API 开始。',
    'action.install': '安装 Skill', 'action.copyBrief': '复制开发 Brief', 'action.github': '查看开源 Skill', 'action.copy': '复制模板', 'action.copyInstall': '复制安装指令', 'action.download': '下载已验证 ZIP', 'action.downloadAgent': '下载当前 Agent Skill ZIP', 'action.source': '查看源码', 'action.top': '回到顶部 ↑',
    'console.problem': '现在的问题是什么？', 'console.outcome': '希望发生什么改变？', 'console.success': '怎么观察到它成功？',
    'principle.one': '标准 DSH Bundle', 'principle.two': '默认只读与最小权限', 'principle.three': '一次性 Profile 测试', 'principle.four': '发行与真实安装分离',
    'install.title': '先把 Skill 装进你的 Agent。', 'install.lead': 'Codex 与通用 Agent 直接使用项目仓库地址；发行 ZIP 与未来的 DSH 安装命令继续通过最新 Release 和对应标签的 manifest.json 核验。',
    'install.targetCodex': '复制给 Codex 的安装指令', 'install.targetDsh': '安装兼容版到 DSH Profile', 'install.targetAgent': '下载 ZIP 到兼容的 Skills 目录',
    'install.loading': '正在核对固定发行…', 'install.ready': '固定发行已核验', 'install.unavailableStatus': '发行核验失败', 'install.loadingCommand': '正在读取并验证 GitHub Release…',
    'install.codexTitle': '复制仓库地址，让 Codex 安装 Skill', 'install.codexBody': '指令直接使用项目仓库，并明确安装其中的 build-dsh-plugin/ 目录。',
    'install.dshTitle': '通过 dsh plugin add 安装兼容版', 'install.dshBody': '只有发行清单声明标准 Bundle、固定 Git Commit 和明确安装规格后，复制按钮才会开放。',
    'install.agentTitle': '安装到支持 SKILL.md 的其他 Agent', 'install.agentBody': '把仓库地址交给目标 Agent，并明确使用 build-dsh-plugin/ 目录；也可以下载已验证 ZIP。',
    'install.boundaryLabel': '安装边界：', 'install.boundary': '不同宿主使用各自经过验证的安装入口；网页只复制命令，不会直接修改本机。',
    'install.codexBoundary': 'Codex 安装写入它自己的 Skills 目录，重新打开任务后生效。', 'install.dshBoundaryReady': '该命令会修改目标 DSH Profile；执行前确认 Profile 并备份，安装与运行验收仍是独立步骤。', 'install.dshBoundaryPending': '当前公开发行仍是 Agent Skill；DSH 兼容清单尚未通过验证，因此不会生成可执行的 plugin add 命令。', 'install.agentBoundary': '目标 Agent 必须支持 SKILL.md 或等价指令加载；Node.js 工具需要 18 或更高版本。',
    'install.proofTitle': '发行身份', 'install.version': '版本', 'install.files': '文件', 'install.license': '许可', 'install.checksum': '校验文件', 'install.releasePage': '发行页面 ↗', 'install.licensePage': 'MIT License ↗', 'install.unavailable': '当前无法完成发行核验，复制和下载已保持关闭；仍可前往 GitHub 查看源码。',
    'install.dshReady': '已兼容', 'install.dshPending': '准备中', 'install.dshPendingCommand': 'DSH 兼容版准备中。最新已验证发行尚未声明可执行的 dsh plugin add 安装规格。',
    'start.title': '先把意图写清楚，技术结构交给 Skill。', 'start.lead': '下面的模板可以直接复制到支持 Skill 的 Agent。缺省字段会采用安全默认值，并作为假设明确展示。', 'start.note': '不要在 Brief 中放入 Token、密码、Cookie 或私有文件内容。',
    'process.title': '每一步都有输出，也有停止条件。', 'process.lead': '通过当前证据再进入下一阶段；无法证明时保持 Partial 或 Blocked。',
    'process.step0': '归一化目标', 'process.body0': '把问题、结果和成功标准整理为可测试 Brief。',
    'process.step1': '核对 DSH 宿主', 'process.body1': '确认标准 Bundle、公开扩展面和适配器边界。',
    'process.step2': '判断风险', 'process.body2': '根据写入、网络、凭据与生命周期选择控制强度。',
    'process.step3': '选择最小架构', 'process.body3': '比较 Host、Client、Skill Adapter 与生命周期方案。',
    'process.step4': '生成源码与测试', 'process.body4': '输出标准结构、权限矩阵、失败行为和测试夹具。',
    'process.step5': '按证据验收', 'process.body5': '区分源码、测试、一次性 Profile、真实运行与外部验收。',
    'deliverables.title': '交付的不只是代码。', 'deliverables.lead': '每个插件都带着它为什么这样设计、能做什么、不能做什么以及如何证明。',
    'deliverables.one': '宿主与架构记录', 'deliverables.oneBody': '兼容、需适配或不兼容，并附当前 DSH 证据。',
    'deliverables.two': '权限与风险矩阵', 'deliverables.twoBody': '每项数据和动作都对应用户结果、边界与测试。',
    'deliverables.three': '标准源码工程', 'deliverables.threeBody': 'Bundle、Host、可选 Client、测试和安全说明。',
    'deliverables.four': '证据与下一道门', 'deliverables.fourBody': '当前 E0–E5 状态、缺失证据和允许的下一步。',
    'boundary.title': '扩展 DSH，不改造 DSH。', 'boundary.lead': 'Skill 构建标准插件，不修改 DSH 源码、不遮蔽官方清单，也不会把测试写入真实 Profile。',
    'boundary.one': '标准 Bundle 与公开扩展面', 'boundary.two': '一次性目录与 Profile 夹具', 'boundary.three': '真实变更单独计划与确认', 'boundary.four': '未知事实保持未知',
    'cta.title': '从一个真实问题开始。', 'cta.lead': '复制 Brief，或者前往 GitHub 查看完整 Skill、模板和验证方法。',
    'footer.lead': '面向 DeepSeek Harness 的第三方插件发现与开发入口。', 'footer.note': 'Skill 不是 DSH Profile 插件 · 真实变更需要单独确认',
    'toast.copied': '开发 Brief 已复制', 'toast.installCopied': '安装指令已复制', 'toast.denied': '浏览器未允许复制，请手动选择内容',
  },
  en: {
    'meta.title': 'Build DSH Plugins | DSH STORE Build Lab',
    'meta.description': 'Use the build-dsh-plugin Agent Skill to turn a problem, outcome, and success criterion into a standard, non-destructive DeepSeek Harness plugin project.',
    'a11y.skip': 'Skip to Skill installation',
    'nav.home': 'Home', 'nav.store': 'Plugin catalog', 'nav.manager': 'DSH Store plugin', 'nav.build': 'Build plugins', 'nav.trust': 'Trust protocol', 'nav.faq': 'FAQ', 'nav.about': 'About us', 'nav.guide': 'Usage guide', 'nav.submit': 'Submit plugin',
    'hero.title1': 'Three answers', 'hero.title2': 'start a DSH plugin.',
    'hero.lead': 'Turn a natural-language brief into a standard Bundle, risk boundary, source project, tests, and evidence gates. Start with the user outcome, not internal APIs.',
    'action.install': 'Install Skill', 'action.copyBrief': 'Copy starter brief', 'action.github': 'View open-source Skill', 'action.copy': 'Copy template', 'action.copyInstall': 'Copy install request', 'action.download': 'Download verified ZIP', 'action.downloadAgent': 'Download current Agent Skill ZIP', 'action.source': 'View source', 'action.top': 'Back to top ↑',
    'console.problem': 'What problem exists today?', 'console.outcome': 'What outcome should change?', 'console.success': 'How will success be observed?',
    'principle.one': 'Standard DSH Bundle', 'principle.two': 'Read-only and least privilege by default', 'principle.three': 'Disposable Profile testing', 'principle.four': 'Release and real install stay separate',
    'install.title': 'Install the Skill in your Agent first.', 'install.lead': 'Codex and compatible Agents use the project repository directly. Release ZIP downloads and future DSH install commands remain verified against the latest Release and its tagged manifest.',
    'install.targetCodex': 'Copy an install request for Codex', 'install.targetDsh': 'Install the compatible build in a DSH Profile', 'install.targetAgent': 'Download the ZIP to a compatible Skills directory',
    'install.loading': 'Verifying fixed release…', 'install.ready': 'Fixed release verified', 'install.unavailableStatus': 'Release verification failed', 'install.loadingCommand': 'Reading and validating the GitHub Release…',
    'install.codexTitle': 'Copy the repository URL and let Codex install it', 'install.codexBody': 'The request uses the project repository directly and names the build-dsh-plugin/ directory explicitly.',
    'install.dshTitle': 'Install the compatible build with dsh plugin add', 'install.dshBody': 'Copy is enabled only after the release manifest declares a standard Bundle, a pinned Git commit, and an explicit install specifier.',
    'install.agentTitle': 'Install in another Agent that supports SKILL.md', 'install.agentBody': 'Give the repository URL to the target Agent and name the build-dsh-plugin/ directory, or download the verified ZIP.',
    'install.boundaryLabel': 'Install boundary:', 'install.boundary': 'Each host uses its own verified path. This page only copies instructions and never changes your machine directly.',
    'install.codexBoundary': 'Codex installs into its own Skills directory; reopen the task before using the Skill.', 'install.dshBoundaryReady': 'This command changes the target DSH Profile. Confirm the Profile and back it up first; installation and runtime acceptance remain separate.', 'install.dshBoundaryPending': 'The current public release is still an Agent Skill. Its DSH compatibility contract is not yet verified, so no executable plugin add command is generated.', 'install.agentBoundary': 'The target Agent must support SKILL.md or equivalent instruction loading. Node-based tools require Node.js 18 or newer.',
    'install.proofTitle': 'Release identity', 'install.version': 'Version', 'install.files': 'Files', 'install.license': 'License', 'install.checksum': 'Checksum file', 'install.releasePage': 'Release page ↗', 'install.licensePage': 'MIT License ↗', 'install.unavailable': 'Release verification is unavailable, so copy and download remain disabled. The GitHub source link is still available.',
    'install.dshReady': 'Compatible', 'install.dshPending': 'In progress', 'install.dshPendingCommand': 'The DSH-compatible build is in progress. The latest verified release does not yet declare an executable dsh plugin add specifier.',
    'start.title': 'Write the intent. Let the Skill derive the technical structure.', 'start.lead': 'Copy this template into an Agent that supports the Skill. Missing optional fields receive disclosed safe defaults.', 'start.note': 'Never place tokens, passwords, cookies, or private file contents in the brief.',
    'process.title': 'Every stage has an output and a stop condition.', 'process.lead': 'Advance on current evidence. When proof is missing, the state remains Partial or Blocked.',
    'process.step0': 'Normalize the outcome', 'process.body0': 'Turn the problem, outcome, and success criteria into a testable brief.',
    'process.step1': 'Prove DSH host fit', 'process.body1': 'Check the standard Bundle contract, public seams, and adapter boundary.',
    'process.step2': 'Classify risk', 'process.body2': 'Scale controls to writes, networks, credentials, and lifecycle impact.',
    'process.step3': 'Choose the smallest architecture', 'process.body3': 'Compare Host, Client, Skill Adapter, and lifecycle patterns.',
    'process.step4': 'Generate source and tests', 'process.body4': 'Produce the standard structure, permission matrix, failures, and fixtures.',
    'process.step5': 'Accept by evidence', 'process.body5': 'Keep source, tests, disposable Profile, real runtime, and external proof distinct.',
    'deliverables.title': 'The handoff is more than code.', 'deliverables.lead': 'Each plugin carries the reasoning, capability boundary, prohibited actions, and proof needed to move forward.',
    'deliverables.one': 'Host and architecture record', 'deliverables.oneBody': 'Compatible, adapter-required, or incompatible, with current DSH evidence.',
    'deliverables.two': 'Permission and risk matrix', 'deliverables.twoBody': 'Every data source and action maps to an outcome, boundary, and test.',
    'deliverables.three': 'Standard source project', 'deliverables.threeBody': 'Bundle, Host, optional Client, tests, and security notes.',
    'deliverables.four': 'Evidence and next gate', 'deliverables.fourBody': 'Current E0–E5 status, missing proof, and the allowed next action.',
    'boundary.title': 'Extend DSH. Do not rewrite it.', 'boundary.lead': 'The Skill builds standard plugins without changing DSH source, hiding official inventory, or testing against a real Profile.',
    'boundary.one': 'Standard Bundle and public seams', 'boundary.two': 'Disposable homes and Profile fixtures', 'boundary.three': 'Separate plans for real mutations', 'boundary.four': 'Unknown facts stay unknown',
    'cta.title': 'Start with one real problem.', 'cta.lead': 'Copy the brief or open GitHub for the complete Skill, templates, and verification method.',
    'footer.lead': 'A third-party discovery and development gateway for DeepSeek Harness.', 'footer.note': 'The Skill is not a DSH Profile plugin · Real changes require separate confirmation',
    'toast.copied': 'Starter brief copied', 'toast.installCopied': 'Install request copied', 'toast.denied': 'Clipboard access was denied. Select the content manually.',
  },
}

const briefs = {
  zh: `使用 $build-dsh-plugin，直接生成一个标准 DSH 插件源码工程。

现在的问题：
希望达到的结果：
核心能力：（可选）
需要读取的数据：（可选；默认无）
需要执行的动作：（可选；默认只读）
需要界面：（可选；默认 Host-only）
明确不能做什么：（可选；默认不改 DSH 核心、官方插件和真实 Profile）
怎么才算成功：`,
  en: `Use $build-dsh-plugin to generate a standard DSH plugin source project.

Current problem:
Expected outcome:
Core capabilities: (optional)
Data to read: (optional; defaults to none)
Actions to perform: (optional; defaults to read-only)
UI needed: (optional; defaults to Host-only)
Must not do: (optional; defaults to no DSH core, official inventory, or real Profile changes)
Observable success criterion:`,
}

const RELEASE_API = 'https://api.github.com/repos/AI-Scarlett/build-dsh-plugin/releases/latest'
const REPOSITORY_URL = 'https://github.com/AI-Scarlett/build-dsh-plugin/'
const TAG_PATTERN = /^v\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/
const defaultLocale = document.body?.dataset.defaultLocale === 'en' ? 'en' : 'zh'
const localeStorageKey = `dsh-marketplace-locale-${defaultLocale}`
const storedLocale = (() => {
  try { return localStorage.getItem(localeStorageKey) } catch { return null }
})()
const state = {
  locale: storedLocale === 'en' || storedLocale === 'zh' ? storedLocale : defaultLocale,
  installTarget: 'codex',
  releaseStatus: 'loading',
  release: null,
  dsh: null,
}
const analyticsToken = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
const t = key => translations[state.locale]?.[key] || translations.zh[key] || key
const toast = document.querySelector('#toast')
const starterBrief = document.querySelector('#starter-brief')
const installEls = {
  targets: document.querySelector('.install-targets'),
  kicker: document.querySelector('#install-kicker'),
  status: document.querySelector('#release-status'),
  title: document.querySelector('#install-mode-title'),
  body: document.querySelector('#install-mode-body'),
  command: document.querySelector('#install-command'),
  copy: document.querySelector('#copy-install'),
  boundary: document.querySelector('#install-boundary'),
  download: document.querySelector('#skill-download'),
  downloadLabel: document.querySelector('#download-label'),
  checksum: document.querySelector('#skill-checksum'),
  releasePage: document.querySelector('#skill-release'),
  licensePage: document.querySelector('#skill-license'),
  version: document.querySelector('#release-version'),
  files: document.querySelector('#release-files'),
  license: document.querySelector('#release-license'),
  dsh: document.querySelector('#release-dsh'),
  hash: document.querySelector('#release-hash'),
  error: document.querySelector('#release-error'),
}

function setLocale(locale) {
  state.locale = locale === 'en' ? 'en' : 'zh'
  localStorage.setItem(localeStorageKey, state.locale)
  document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN'
  document.title = t('meta.title')
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'))
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', t('meta.title'))
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', t('meta.description'))
  document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', t('meta.title'))
  document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', t('meta.description'))
  document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n) })
  document.querySelectorAll('[data-locale]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.locale === state.locale)))
  starterBrief.textContent = briefs[state.locale]
  renderInstall()
}

function setLinkState(link, url, enabled) {
  if (!link) return
  if (enabled && url) {
    link.href = url
    link.target = '_blank'
    link.rel = 'noreferrer'
    link.classList.remove('disabled')
    link.setAttribute('aria-disabled', 'false')
  } else {
    link.removeAttribute('href')
    link.classList.add('disabled')
    link.setAttribute('aria-disabled', 'true')
  }
}

function parseDshContract(manifest) {
  // Future hybrid releases opt in through manifest.dsh only after the package is a standard fixed-source DSH Bundle.
  const dsh = manifest?.dsh
  if (!dsh || dsh.compatible !== true) return null
  const installSpecifier = String(dsh.installSpecifier || '')
  const packageName = String(dsh.packageName || '')
  const bundlePatch = String(dsh.bundlePatch || '')
  const profile = String(dsh.profile || 'web')
  if (!/^git\+https:\/\/github\.com\/AI-Scarlett\/build-dsh-plugin\.git#[0-9a-f]{40}(?:&path:[A-Za-z0-9._/-]+)?$/.test(installSpecifier)) return null
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(packageName)) return null
  if (!/(?:^|\/)cordis\.patch\.yml$/.test(bundlePatch)) return null
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(profile)) return null
  return { installSpecifier, packageName, bundlePatch, profile }
}

function validateRelease(release, manifest, manifestUrl) {
  if (!release || !TAG_PATTERN.test(release.tag_name || '')) throw new Error('invalid release tag')
  if (!manifest || manifest.schemaVersion !== 1 || manifest.name !== 'build-dsh-plugin') throw new Error('invalid manifest')
  if (`v${manifest.distributionVersion}` !== release.tag_name) throw new Error('version mismatch')
  if (manifest.release?.tag !== release.tag_name || manifest.release?.pageUrl !== release.html_url || manifest.release?.manifestUrl !== manifestUrl) throw new Error('release identity mismatch')
  if (manifest.license?.spdxId !== 'MIT' || !String(manifest.license.url || '').includes(`/${release.tag_name}/`)) throw new Error('license mismatch')
  if (!String(manifest.release?.sourceUrl || '').includes(`/${release.tag_name}`)) throw new Error('source is not pinned')
  if (!/^build-dsh-plugin\/[A-Za-z0-9._/-]*SKILL\.md$/.test(manifest.entrypoints?.skill || '')) throw new Error('invalid skill entrypoint')
  const artifact = manifest.artifact
  if (!artifact || artifact.archiveRoot !== 'build-dsh-plugin/' || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) throw new Error('invalid artifact')
  if (!Number.isInteger(artifact.bytes) || artifact.bytes <= 0 || !Number.isInteger(artifact.regularFileCount) || artifact.regularFileCount <= 0) throw new Error('invalid artifact facts')
  const assets = new Map((release.assets || []).map(asset => [asset.name, asset]))
  const zip = assets.get(artifact.file)
  const checksum = assets.get(artifact.sha256File)
  if (!zip || !checksum || zip.browser_download_url !== artifact.downloadUrl || checksum.browser_download_url !== artifact.sha256Url || zip.size !== artifact.bytes) throw new Error('release assets mismatch')
  return manifest
}

function installContent() {
  const manifest = state.release
  if (!manifest) return null
  if (state.installTarget === 'codex') {
    return {
      kicker: 'CODEX / SKILL INSTALLER',
      title: t('install.codexTitle'),
      body: t('install.codexBody'),
      boundary: t('install.codexBoundary'),
      command: state.locale === 'en'
        ? `Use $skill-installer to install the build-dsh-plugin/ Skill from this repository:\n${REPOSITORY_URL}\n\nAfter installation, tell me it will be available in the next task turn.`
        : `使用 $skill-installer，从这个仓库安装 build-dsh-plugin/ 目录中的 Skill：\n${REPOSITORY_URL}\n\n安装完成后，请告诉我它会在下一轮任务中生效。`,
      enabled: true,
    }
  }
  if (state.installTarget === 'dsh') {
    return state.dsh ? {
      kicker: 'DSH / OFFICIAL CLI',
      title: t('install.dshTitle'),
      body: t('install.dshBody'),
      boundary: t('install.dshBoundaryReady'),
      command: `dsh plugin --profile ${state.dsh.profile} add '${state.dsh.installSpecifier}'`,
      enabled: true,
    } : {
      kicker: 'DSH / COMPATIBILITY GATE',
      title: t('install.dshTitle'),
      body: t('install.dshBody'),
      boundary: t('install.dshBoundaryPending'),
      command: t('install.dshPendingCommand'),
      enabled: false,
    }
  }
  return {
    kicker: 'AGENT SKILLS / PORTABLE ZIP',
    title: t('install.agentTitle'),
    body: t('install.agentBody'),
    boundary: t('install.agentBoundary'),
    command: state.locale === 'en'
      ? `Install the build-dsh-plugin/ Skill from this repository and preserve its internal layout:\n${REPOSITORY_URL}\nEntry point: ${manifest.entrypoints.skill}\nVerified ZIP: ${manifest.artifact.downloadUrl}`
      : `从这个仓库安装 build-dsh-plugin/ 目录中的 Skill，并保持内部结构不变：\n${REPOSITORY_URL}\n入口：${manifest.entrypoints.skill}\n已验证 ZIP：${manifest.artifact.downloadUrl}`,
    enabled: true,
  }
}

function renderInstall() {
  installEls.targets?.querySelectorAll('[data-install-target]').forEach(button => {
    const selected = button.dataset.installTarget === state.installTarget
    button.setAttribute('aria-selected', String(selected))
    button.classList.toggle('active', selected)
  })
  installEls.error.hidden = state.releaseStatus !== 'error'
  if (state.releaseStatus !== 'ready' || !state.release) {
    const failed = state.releaseStatus === 'error'
    installEls.status.textContent = t(failed ? 'install.unavailableStatus' : 'install.loading')
    installEls.status.dataset.status = failed ? 'error' : 'loading'
    installEls.command.textContent = t(failed ? 'install.unavailable' : 'install.loadingCommand')
    installEls.copy.disabled = true
    installEls.version.textContent = '—'
    installEls.files.textContent = '—'
    installEls.dsh.textContent = '—'
    installEls.hash.textContent = '—'
    setLinkState(installEls.download, '', false)
    setLinkState(installEls.checksum, '', false)
    return
  }
  const manifest = state.release
  const content = installContent()
  installEls.status.textContent = t('install.ready')
  installEls.status.dataset.status = 'ready'
  installEls.kicker.textContent = content.kicker
  installEls.title.textContent = content.title
  installEls.body.textContent = content.body
  installEls.command.textContent = content.command
  installEls.boundary.textContent = content.boundary
  installEls.copy.disabled = !content.enabled
  installEls.copy.dataset.analyticsItem = state.installTarget
  installEls.version.textContent = manifest.distributionVersion
  installEls.files.textContent = state.locale === 'en' ? `${manifest.artifact.regularFileCount} files` : `${manifest.artifact.regularFileCount} 个文件`
  installEls.license.textContent = manifest.license.spdxId
  installEls.dsh.textContent = t(state.dsh ? 'install.dshReady' : 'install.dshPending')
  installEls.hash.textContent = manifest.artifact.sha256
  installEls.downloadLabel.textContent = t(state.installTarget === 'dsh' ? 'action.downloadAgent' : 'action.download')
  setLinkState(installEls.download, manifest.artifact.downloadUrl, true)
  setLinkState(installEls.checksum, manifest.artifact.sha256Url, true)
  setLinkState(installEls.releasePage, manifest.release.pageUrl, true)
  setLinkState(installEls.licensePage, manifest.license.url, true)
}

async function loadSkillRelease() {
  state.releaseStatus = 'loading'
  renderInstall()
  try {
    const releaseResponse = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', credentials: 'omit' })
    if (!releaseResponse.ok) throw new Error(`release HTTP ${releaseResponse.status}`)
    const release = await releaseResponse.json()
    if (!TAG_PATTERN.test(release.tag_name || '')) throw new Error('invalid release tag')
    const manifestUrl = `https://raw.githubusercontent.com/AI-Scarlett/build-dsh-plugin/${release.tag_name}/dist/manifest.json`
    const manifestResponse = await fetch(manifestUrl, { cache: 'no-store', credentials: 'omit' })
    if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`)
    const manifest = validateRelease(release, await manifestResponse.json(), manifestUrl)
    state.release = manifest
    state.dsh = parseDshContract(manifest)
    state.releaseStatus = 'ready'
    renderInstall()
    sendDshEvent('skill_release_verified', { item: manifest.release.tag, value: state.dsh ? 'dsh_ready' : 'agent_skill' })
  } catch {
    state.release = null
    state.dsh = null
    state.releaseStatus = 'error'
    renderInstall()
    console.warn('build-dsh-plugin release verification failed closed')
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  const copied = document.execCommand('copy')
  area.remove()
  if (!copied) throw new Error('clipboard unavailable')
}

function showToast(message) {
  toast.textContent = message
  toast.classList.add('show')
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200)
}

function sendDshEvent(event, details = {}) {
  if (!/^https?:$/.test(location.protocol)) return
  const eventName = analyticsToken(event)
  if (!eventName) return
  const url = new URL('/_events/dsh', location.origin)
  url.searchParams.set('event', eventName)
  url.searchParams.set('locale', state.locale)
  url.searchParams.set('site', analyticsToken(location.host))
  for (const field of ['item', 'value']) {
    const token = analyticsToken(details[field])
    if (token) url.searchParams.set(field, token)
  }
  try {
    if (navigator.sendBeacon?.(url, new Blob([], { type: 'text/plain' }))) return
    fetch(url, { method: 'POST', keepalive: true, cache: 'no-store', credentials: 'omit' }).catch(() => {})
  } catch {}
}

function observeReveals() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.reveal').forEach(element => element.classList.add('visible'))
    return
  }
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible')
      observer.unobserve(entry.target)
    }
  }), { threshold: .12 })
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element))
}

document.querySelector('.locale-switch').addEventListener('click', event => {
  const button = event.target.closest('[data-locale]')
  if (!button || button.dataset.locale === state.locale) return
  setLocale(button.dataset.locale)
  sendDshEvent('locale_switch', { item: state.locale, value: 'build' })
})

installEls.targets?.addEventListener('click', event => {
  const button = event.target.closest('[data-install-target]')
  if (!button || button.dataset.installTarget === state.installTarget) return
  state.installTarget = button.dataset.installTarget
  renderInstall()
  sendDshEvent('skill_install_target', { item: state.installTarget })
})

document.addEventListener('click', async event => {
  const copyButton = event.target.closest('[data-copy-target]')
  if (copyButton) {
    const target = document.getElementById(copyButton.dataset.copyTarget)
    if (!target) return
    try {
      await copyText(target.textContent.trim())
      showToast(t(copyButton.dataset.copyKind === 'install' ? 'toast.installCopied' : 'toast.copied'))
      sendDshEvent(copyButton.dataset.analyticsEvent || 'skill_brief_copy', { item: copyButton.dataset.analyticsItem || 'unknown' })
    } catch {
      showToast(t('toast.denied'))
    }
    return
  }
  const tracked = event.target.closest('[data-analytics-event]')
  if (tracked) sendDshEvent(tracked.dataset.analyticsEvent, { item: tracked.dataset.analyticsItem })
})

setLocale(state.locale)
observeReveals()
loadSkillRelease()
sendDshEvent('build_skill_view', { item: 'build_dsh_plugin' })
