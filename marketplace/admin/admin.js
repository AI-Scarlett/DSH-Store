(() => {
  'use strict';

  const PRESETS = [
    {
      id: 'deepseek',
      name: 'DeepSeek 官方',
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      maxTokens: 2048,
      timeoutSeconds: 30,
      temperature: 0.3
    },
    {
      id: 'minimax',
      name: 'MiniMax 国内',
      protocol: 'openai-chat',
      baseUrl: 'https://api.minimax.cn/v1',
      model: 'MiniMax-M3',
      maxTokens: 2048,
      timeoutSeconds: 30,
      temperature: 0.3
    },
    {
      id: 'qwen',
      name: '通义千问 (Qwen)',
      protocol: 'openai-chat',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      maxTokens: 2048,
      timeoutSeconds: 30,
      temperature: 0.3
    }
  ];

  const DEFAULT_SYSTEM_PROMPT = '你是一个严谨且实用的 DeepSeek Harness (DSH) 插件选型专家。你的任务是根据用户的需求，从已审核的 DSH 插件列表中挑选最适合的 1 到 3 个插件推荐给用户。\n\n【输出格式要求】：\n必须严格只输出合法的 JSON 格式，不要包含任何 markdown 代码块标记，不要包含多余寒暄。格式如下：\n{\n  "analysis": "简短说明用户需求和推荐逻辑（不超过80字）",\n  "plugins": [\n    {\n      "id": "插件唯一ID",\n      "reason": "为何该插件能满足需求的具体解释（不超过60字）"\n    }\n  ],\n  "suggestedQueries": ["可选的相关延伸提问1", "提问2"]\n}\n\n【原则】：\n1. 只能推荐给出的候选插件，严禁虚构不存在的插件或包名。\n2. 如果用户需求无法匹配任何插件，plugins 数组返回空，并在 analysis 中客观说明。';

  const DEFAULT_PROMPT_PLACEHOLDER = '输入你想完成的任务需求或插件名称（例如：知网论文精读并写大纲、在微信/QQ中接入DSH、查看API余额、增强会话长期记忆…）';

  const DEFAULT_PROMPT_SUGGESTIONS = [
    { label: '知网论文精读', query: '知网论文研究精读并分步写作大纲' },
    { label: 'QQ 微信机器人', query: '把 DSH 接入 QQ 或微信群做智能客服' },
    { label: '模型 API 余额', query: '实时查看 DeepSeek API 余额' },
    { label: '长期记忆增强', query: '给大模型增加长期记忆和会话检索' },
    { label: '网页 PPT 排版', query: '制作网页PPT与卡片设计排版' }
  ];

  let currentSettings = null;
  let currentRankingCuration = null;

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function safeJson(res, defaultError = '请求失败') {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (res.status === 404) {
        throw new Error('服务端 API 接口未就绪 (404 Not Found)。若在线上服务器运行，请确保 Node.js 后端守护进程已启动且 Nginx 已配置 /api/ 反向代理；若在本地预览，请先启动：node scripts/serve-marketplace.mjs');
      }
      if (res.status === 502 || res.status === 504) {
        throw new Error('服务端 API 无响应 (HTTP ' + res.status + ')。请检查服务器上的 Node.js 后端守护进程是否正常运行。');
      }
      throw new Error('服务端返回了非 JSON 格式响应 (HTTP ' + res.status + ')');
    }
    try {
      return await res.json();
    } catch {
      throw new Error(defaultError + '：无法解析服务器 JSON 返回');
    }
  }

  function getStoredAdminToken() {
    return sessionStorage.getItem('dsh_admin_token') || '';
  }

  function setStoredAdminToken(token) {
    if (token) {
      sessionStorage.setItem('dsh_admin_token', token);
    } else {
      sessionStorage.removeItem('dsh_admin_token');
    }
  }

  function getStoredAdminUsername() {
    return sessionStorage.getItem('dsh_admin_username') || 'admin';
  }

  function setStoredAdminUsername(username) {
    if (username) {
      sessionStorage.setItem('dsh_admin_username', username);
    } else {
      sessionStorage.removeItem('dsh_admin_username');
    }
  }

  function showNotification(type, message) {
    const el = $('notification-banner');
    el.className = 'notification-banner ' + type + ' show';
    el.textContent = message;
    setTimeout(() => {
      el.className = 'notification-banner';
    }, 6000);
  }

  function showLogin(errMsg) {
    $('admin-login-view').style.display = 'block';
    $('admin-dashboard-view').style.display = 'none';
    $('admin-user-bar').style.display = 'none';
    const banner = $('login-error-banner');
    if (errMsg) {
      banner.textContent = errMsg;
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }
  }

  function showDashboard() {
    $('admin-login-view').style.display = 'none';
    $('admin-dashboard-view').style.display = 'block';
    $('admin-user-bar').style.display = 'flex';
    const username = getStoredAdminUsername();
    $('current-username-display').textContent = username;
    $('admin-current-user-hint').textContent = username;
  }

  function populatePresetSelect(selectEl, selectedId) {
    selectEl.innerHTML = '';
    PRESETS.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === selectedId) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  function applyPreset(slot, presetId) {
    const preset = PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    if (preset.baseUrl) $(slot + '-base-url').value = preset.baseUrl;
    if (preset.model) $(slot + '-model-id').value = preset.model;
    if (preset.protocol) $(slot + '-protocol').value = preset.protocol;
    if (preset.timeoutSeconds) $(slot + '-timeout').value = preset.timeoutSeconds;
    if (preset.maxTokens) $(slot + '-max-tokens').value = preset.maxTokens;
    if (typeof preset.temperature === 'number') $(slot + '-temperature').value = preset.temperature;
  }

  function createSuggestionRow(label, query) {
    label = label || '';
    query = query || '';
    const row = document.createElement('div');
    row.className = 'suggestion-row';
    row.innerHTML = [
      '<input class="form-input suggestion-label-input" type="text" placeholder="按钮名称 (例如: 知网论文精读)" value="' + escapeHtml(label) + '">',
      '<input class="form-input suggestion-query-input" type="text" placeholder="填入需求 (例如: 知网论文精读并写大纲)" value="' + escapeHtml(query) + '">',
      '<button type="button" class="btn-del-suggestion" title="删除此条">✕ 删除</button>'
    ].join('');

    row.querySelector('.btn-del-suggestion').addEventListener('click', () => {
      row.remove();
    });
    return row;
  }

  function renderSuggestionsList(items) {
    const container = $('suggestions-list-container');
    if (!container) return;
    container.innerHTML = '';
    if (Array.isArray(items) && items.length > 0) {
      items.forEach(item => {
        const lbl = item.label || item.query || '';
        const q = item.query || item.label || '';
        container.appendChild(createSuggestionRow(lbl, q));
      });
    }
  }

  function collectSuggestions() {
    const container = $('suggestions-list-container');
    if (!container) return DEFAULT_PROMPT_SUGGESTIONS;
    const rows = container.querySelectorAll('.suggestion-row');
    const result = [];
    rows.forEach(r => {
      const lblInput = r.querySelector('.suggestion-label-input');
      const qInput = r.querySelector('.suggestion-query-input');
      const label = (lblInput?.value || '').trim();
      const query = (qInput?.value || '').trim();
      if (label && query) {
        result.push({ label, query });
      } else if (query) {
        result.push({ label: query, query });
      } else if (label) {
        result.push({ label, query: label });
      }
    });
    return result;
  }

  function renderView(settings) {
    currentSettings = settings;

    // Strategy
    $('model-enabled-toggle').checked = settings.enabled !== false;
    $('model-mode-select').value = settings.mode || 'model-first';
    $('daily-limit-input').value = settings.dailyLimit || 0;
    $('hourly-limit-input').value = settings.perVisitorHourlyLimit || 50;
    $('system-prompt-input').value = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;

    // Prompt & Suggestions
    $('prompt-placeholder-input').value = settings.promptPlaceholder || DEFAULT_PROMPT_PLACEHOLDER;
    renderSuggestionsList(settings.promptSuggestions || DEFAULT_PROMPT_SUGGESTIONS);

    // Auth Status & User Hints
    const authStatus = $('auth-status-badge');
    authStatus.textContent = '已通过身份鉴权';
    authStatus.className = 'key-status';

    const currentUsername = settings.adminUsername || getStoredAdminUsername() || 'admin';
    $('admin-current-user-hint').textContent = currentUsername;
    $('current-username-display').textContent = currentUsername;
    $('admin-username-input').value = '';
    $('admin-new-password').value = '';

    // Primary
    populatePresetSelect($('primary-preset-select'), settings.primary?.preset || 'deepseek');
    $('primary-label-input').value = settings.primary?.label || 'DeepSeek 主模型';
    $('primary-base-url').value = settings.primary?.baseUrl || 'https://api.deepseek.com/v1';
    $('primary-model-id').value = settings.primary?.model || 'deepseek-chat';
    $('primary-protocol').value = settings.primary?.protocol || 'openai-chat';
    $('primary-timeout').value = settings.primary?.timeoutSeconds || 30;
    $('primary-max-tokens').value = settings.primary?.maxTokens || 2048;
    $('primary-temperature').value = settings.primary?.temperature ?? 0.3;
    $('primary-api-key').value = '';
    $('primary-clear-key').checked = false;

    const primaryStatus = $('primary-key-status');
    if (settings.primary?.hasKey) {
      primaryStatus.textContent = '已加密保存 Key';
      primaryStatus.className = 'key-status';
    } else {
      primaryStatus.textContent = '未配置 Key';
      primaryStatus.className = 'key-status none';
    }

    // Backup
    $('backup-enabled-toggle').checked = Boolean(settings.backup?.enabled);
    populatePresetSelect($('backup-preset-select'), settings.backup?.preset || 'qwen');
    $('backup-label-input').value = settings.backup?.label || '通义千问 备用模型';
    $('backup-base-url').value = settings.backup?.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    $('backup-model-id').value = settings.backup?.model || 'qwen-plus';
    $('backup-protocol').value = settings.backup?.protocol || 'openai-chat';
    $('backup-timeout').value = settings.backup?.timeoutSeconds || 30;
    $('backup-max-tokens').value = settings.backup?.maxTokens || 2048;
    $('backup-temperature').value = settings.backup?.temperature ?? 0.3;
    $('backup-use-primary-key').checked = Boolean(settings.backup?.usePrimaryKey);
    $('backup-api-key').value = '';
    $('backup-clear-key').checked = false;

    updateBackupKeyVisibility();

    const backupStatus = $('backup-key-status');
    if (settings.backup?.hasKey) {
      backupStatus.textContent = settings.backup.usePrimaryKey ? '共用主模型 Key' : '已加密保存 Key';
      backupStatus.className = 'key-status';
    } else {
      backupStatus.textContent = '未配置 Key';
      backupStatus.className = 'key-status none';
    }
  }

  function createRankingEntryDetails(entry) {
    const copy = document.createElement('div');
    copy.className = 'ranking-entry-copy';

    const name = document.createElement('strong');
    name.className = 'ranking-entry-name';
    name.textContent = entry.nameZh || entry.nameEn || entry.id;
    copy.appendChild(name);

    if (entry.nameEn && entry.nameEn !== entry.nameZh) {
      const englishName = document.createElement('small');
      englishName.className = 'ranking-entry-secondary-name';
      englishName.textContent = entry.nameEn;
      copy.appendChild(englishName);
    }

    const packageName = document.createElement('code');
    packageName.className = 'ranking-entry-package';
    packageName.textContent = entry.packageName ? `包名：${entry.packageName}` : '包名：目录未提供';
    copy.appendChild(packageName);

    const catalogId = document.createElement('small');
    catalogId.className = 'ranking-entry-id';
    catalogId.textContent = `目录 ID：${entry.id}`;
    copy.appendChild(catalogId);

    if (entry.repositoryUrl) {
      let repositoryUrl;
      try { repositoryUrl = new URL(entry.repositoryUrl); } catch {}
      if (repositoryUrl?.protocol === 'https:' && repositoryUrl.hostname === 'github.com') {
        const repository = document.createElement('a');
        repository.className = 'ranking-entry-repository';
        repository.href = repositoryUrl.href;
        repository.target = '_blank';
        repository.rel = 'noopener noreferrer';
        repository.textContent = `GitHub：${repositoryUrl.pathname.replace(/^\//, '')}`;
        copy.appendChild(repository);
      }
    }

    if (entry.description) {
      const description = document.createElement('small');
      description.className = 'ranking-entry-description';
      description.textContent = entry.description;
      copy.appendChild(description);
    }

    const state = document.createElement('small');
    state.className = 'ranking-entry-state';
    const listing = entry.listingStatus === 'listed' ? '已收录' : '未收录';
    const source = entry.source === 'candidate' ? '发现候选' : 'Catalog 插件';
    const stars = Number.isSafeInteger(entry.stars) ? ` · GitHub ${entry.stars.toLocaleString()} 星` : '';
    state.textContent = `${listing} · ${source} · ${entry.reviewStatus || '状态未知'}${stars}`;
    copy.appendChild(state);
    return copy;
  }

  function createRankingEntryRow(type, entry, options = {}) {
    const board = currentRankingCuration.boards[type];
    const row = document.createElement('li');
    row.className = 'ranking-curation-entry' + (options.selected ? ' is-selected' : '')
      + (options.official ? ' is-official' : '');

    const position = document.createElement('span');
    position.className = 'ranking-entry-position';
    position.textContent = options.rank ? String(options.rank).padStart(2, '0') : '＋';
    row.append(position, createRankingEntryDetails(entry));

    const controls = document.createElement('div');
    controls.className = 'ranking-curation-entry-controls';
    if (options.official) {
      const badge = document.createElement('span');
      badge.className = 'ranking-fixed-badge';
      badge.textContent = '官方固定位';
      controls.appendChild(badge);
    } else if (options.searchResult) {
      const selected = board.ids.includes(entry.id);
      const add = document.createElement('button');
      add.type = 'button';
      add.className = selected ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm ranking-add-button';
      add.textContent = selected ? '已加入' : board.ids.length >= 30 ? '已达上限' : '加入榜单';
      add.disabled = board.mode !== 'manual' || selected || board.ids.length >= 30;
      add.addEventListener('click', () => {
        if (board.mode !== 'manual' || board.ids.includes(entry.id) || board.ids.length >= 30) return;
        board.ids.push(entry.id);
        renderRankingCurationBoard(type);
      });
      controls.appendChild(add);
    } else if (board.mode === 'manual') {
      const index = options.boardIndex;
      for (const [direction, delta, label] of [['up', -1, '上移'], ['down', 1, '下移']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary btn-sm ranking-move-button';
        button.textContent = direction === 'up' ? '↑' : '↓';
        button.setAttribute('aria-label', `${label} ${entry.nameZh || entry.id}`);
        button.disabled = index + delta < 0 || index + delta >= board.ids.length;
        button.addEventListener('click', () => {
          const next = index + delta;
          [board.ids[index], board.ids[next]] = [board.ids[next], board.ids[index]];
          renderRankingCurationBoard(type);
        });
        controls.appendChild(button);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-secondary btn-sm ranking-remove-button';
      remove.textContent = '移除';
      remove.disabled = board.ids.length <= currentRankingCuration.choices[type].minimumManualEntries;
      remove.setAttribute('aria-label', `从榜单移除 ${entry.nameZh || entry.id}`);
      remove.addEventListener('click', () => {
        board.ids = board.ids.filter(id => id !== entry.id);
        renderRankingCurationBoard(type);
      });
      controls.appendChild(remove);
    }
    row.appendChild(controls);
    return row;
  }

  function getRankingBoardRows(type) {
    const board = currentRankingCuration.boards[type];
    const choices = currentRankingCuration.choices[type];
    const byId = new Map(choices.entries.map(entry => [entry.id, entry]));
    if (board.mode === 'auto') {
      return choices.automaticIds.map((id, index) => ({
        entry: byId.get(id), rank: index + 1, official: choices.officialSlots.some(slot => slot.id === id),
      })).filter(row => row.entry);
    }

    const officialByIndex = new Map(choices.officialSlots.map(slot => [slot.index, byId.get(slot.id)]));
    const highestOfficialIndex = Math.max(-1, ...officialByIndex.keys());
    const outputLength = Math.max(board.ids.length + officialByIndex.size, highestOfficialIndex + 1);
    const rows = [];
    let boardIndex = 0;
    for (let index = 0; index < outputLength; index++) {
      if (officialByIndex.has(index)) {
        const entry = officialByIndex.get(index);
        if (entry) rows.push({ entry, rank: index + 1, official: true });
        continue;
      }
      const id = board.ids[boardIndex];
      const entry = byId.get(id);
      if (entry) rows.push({ entry, rank: index + 1, official: false, boardIndex });
      boardIndex++;
    }
    return rows;
  }

  function renderRankingSearchResults(type) {
    const choices = currentRankingCuration.choices[type];
    const board = currentRankingCuration.boards[type];
    const input = $(type + '-board-search');
    const status = $(type + '-search-status');
    const results = $(type + '-search-results');
    if (!choices || !board || !input || !status || !results) return;
    input.disabled = board.mode !== 'manual';
    results.replaceChildren();
    if (board.mode !== 'manual') {
      status.textContent = '切换为“手动管理”后，可以搜索并添加插件。';
      return;
    }

    const query = input.value.trim().toLocaleLowerCase();
    const entries = choices.entries.filter(entry => !entry.officialToolPick);
    if (!query) {
      status.textContent = `可搜索 ${entries.length} 个合格条目。输入包名、目录 ID、名称或 GitHub 仓库开始查找。`;
      return;
    }

    const matches = entries.filter(entry => [entry.packageName, entry.id, entry.nameZh, entry.nameEn,
      entry.repositoryUrl, entry.description].some(value => String(value || '').toLocaleLowerCase().includes(query)));
    const exactMatch = entry => [entry.packageName, entry.id, entry.repositoryUrl, entry.nameZh, entry.nameEn]
      .some(value => String(value || '').toLocaleLowerCase() === query);
    matches.sort((a, b) => Number(exactMatch(b)) - Number(exactMatch(a))
      || (a.packageName || a.id).localeCompare(b.packageName || b.id));
    status.textContent = matches.length
      ? `找到 ${matches.length} 个条目${matches.length > 30 ? '，先显示前 30 个' : ''}。点击“加入榜单”后再保存生效。`
      : '没有找到匹配插件。可尝试包名、目录 ID 或 GitHub 仓库名。';
    matches.slice(0, 30).forEach(entry => {
      results.appendChild(createRankingEntryRow(type, entry, { searchResult: true }));
    });
  }

  function renderRankingCurationBoard(type) {
    if (!currentRankingCuration) return;
    const board = currentRankingCuration.boards[type];
    const choices = currentRankingCuration.choices[type];
    const modeSelect = document.querySelector(`[data-board-mode="${type}"]`);
    const container = $(type + '-board-list');
    const status = $(type + '-board-status');
    if (!board || !choices || !modeSelect || !container || !status) return;
    modeSelect.value = board.mode;
    const selectableIds = new Set(choices.entries.filter(entry => !entry.officialToolPick).map(entry => entry.id));
    board.ids = board.ids.filter(id => selectableIds.has(id));
    container.replaceChildren();
    getRankingBoardRows(type).forEach(item => {
      container.appendChild(createRankingEntryRow(type, item.entry, {
        rank: item.rank, official: item.official, selected: board.mode === 'manual' && !item.official,
        boardIndex: item.boardIndex,
      }));
    });

    const official = choices.officialSlots.map(slot => {
      const entry = choices.entries.find(item => item.id === slot.id);
      return `${entry?.nameZh || slot.id}（第 ${slot.index + 1} 位固定）`;
    });
    if (board.mode === 'auto') {
      status.textContent = `自动规则 · 当前展示 ${choices.automaticIds.length} 项 · 可手动搜索 ${selectableIds.size} 项${official.length ? ` · ${official.join('、')}` : ''}`;
    } else {
      const tooFew = board.ids.length < choices.minimumManualEntries;
      status.textContent = `手动模式 · 已选 ${board.ids.length} 项 · 至少保留 ${choices.minimumManualEntries} 项${tooFew ? ' · 请继续添加' : ''}${official.length ? ` · ${official.join('、')}` : ''}`;
    }
    renderRankingSearchResults(type);
    const invalid = ['recommended', 'essential'].some(boardType => {
      const current = currentRankingCuration.boards[boardType];
      return current.mode === 'manual' && (current.ids.length < currentRankingCuration.choices[boardType].minimumManualEntries || current.ids.length > 30);
    });
    $('ranking-curation-save-btn').disabled = invalid;
  }

  function renderRankingCuration(data) {
    currentRankingCuration = data;
    $('ranking-curation-save-btn').disabled = false;
    $('ranking-curation-reset-btn').disabled = false;
    $('ranking-curation-error').hidden = true;
    $('ranking-curation-revision').textContent = data.stale ? '榜单快照已更新' : `配置版本 ${data.revision}`;
    $('ranking-curation-revision').className = data.stale ? 'key-status none' : 'key-status';
    if (data.stale) {
      $('ranking-curation-save-status').textContent = '榜单来源已更新，旧的手动名单暂停生效；请选择当前榜单条目后保存。';
    } else {
      $('ranking-curation-save-status').textContent = data.updatedAt ? `上次保存：${new Date(data.updatedAt).toLocaleString()}` : '当前使用自动规则';
    }
    for (const type of ['recommended', 'essential']) renderRankingCurationBoard(type);
  }

  async function loadRankingCuration() {
    const token = getStoredAdminToken();
    if (!token) return;
    try {
      const res = await fetch('/api/admin/rankings', { headers: { 'x-admin-token': token } });
      if (res.status === 401) {
        setStoredAdminToken('');
        showLogin('登录已失效或凭证过期，请重新登录');
        return;
      }
      const data = await safeJson(res, '读取榜单配置失败');
      if (!res.ok || !data.ok) throw new Error(data.error || '读取榜单配置失败');
      if (data.stale) {
        data.boards = { recommended: { mode: 'auto', ids: [] }, essential: { mode: 'auto', ids: [] } };
      }
      renderRankingCuration(data);
    } catch (err) {
      $('ranking-curation-error').textContent = '榜单管理暂时不可用：' + (err.message || '服务器未提供已校验的榜单快照');
      $('ranking-curation-error').hidden = false;
      $('ranking-curation-revision').textContent = '暂不可用';
      $('ranking-curation-revision').className = 'key-status none';
      $('ranking-curation-save-btn').disabled = true;
      $('ranking-curation-reset-btn').disabled = true;
    }
  }

  async function saveRankingCuration() {
    const token = getStoredAdminToken();
    if (!token || !currentRankingCuration) {
      showNotification('error', '请先登录并读取榜单候选');
      return;
    }
    const payload = {
      revision: currentRankingCuration.revision,
      sourceCommit: currentRankingCuration.sourceCommit,
      boards: Object.fromEntries(['recommended', 'essential'].map(type => {
        const board = currentRankingCuration.boards[type];
        return [type, { mode: board.mode, ids: board.mode === 'manual' ? [...board.ids] : [] }];
      })),
    };
    const saveButton = $('ranking-curation-save-btn');
    saveButton.disabled = true;
    $('ranking-curation-reset-btn').disabled = true;
    $('ranking-curation-save-status').textContent = '正在安全保存…';
    try {
      const res = await fetch('/api/admin/rankings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify(payload),
      });
      const data = await safeJson(res, '保存榜单设置失败');
      if (!res.ok || !data.ok) {
        if (res.status === 401) {
          setStoredAdminToken('');
          showLogin('登录已失效，请重新登录');
          return;
        }
        if (res.status === 409) await loadRankingCuration();
        throw new Error(data.error || '保存榜单设置失败');
      }
      renderRankingCuration(data);
      $('ranking-curation-save-status').textContent = `已保存 · 配置版本 ${data.revision}`;
      showNotification('success', '推荐榜与必装榜设置已保存并生效');
    } catch (err) {
      $('ranking-curation-save-status').textContent = '保存失败：' + (err.message || '服务器或网络异常');
      showNotification('error', $('ranking-curation-save-status').textContent);
    } finally {
      saveButton.disabled = false;
      $('ranking-curation-reset-btn').disabled = false;
    }
  }

  function updateBackupKeyVisibility() {
    const usePrimary = $('backup-use-primary-key').checked;
    const container = $('backup-api-key-container');
    if (usePrimary) {
      container.style.opacity = '0.5';
      $('backup-api-key').disabled = true;
      $('backup-api-key').placeholder = '使用主模型 API Key';
    } else {
      container.style.opacity = '1';
      $('backup-api-key').disabled = false;
      $('backup-api-key').placeholder = 'sk-••••••••••••••••';
    }
  }

  async function loadSettings() {
    const token = getStoredAdminToken();
    if (!token) {
      showLogin();
      return;
    }

    try {
      const res = await fetch('/api/admin/model-settings', {
        headers: { 'x-admin-token': token }
      });
      if (res.status === 401) {
        setStoredAdminToken('');
        showLogin('登录已失效或凭证过期，请重新登录');
        return;
      }
      const data = await safeJson(res, '读取配置失败');
      if (res.ok && data.settings) {
        showDashboard();
        renderView(data.settings);
        await loadRankingCuration();
        return;
      }
    } catch (err) {
      console.warn('API fetch error', err);
    }
  }

  async function saveSettings() {
    const token = getStoredAdminToken();
    if (!token) {
      showLogin('请先登录管理员账号');
      return;
    }

    const payload = {
      enabled: $('model-enabled-toggle').checked,
      mode: $('model-mode-select').value,
      dailyLimit: Number($('daily-limit-input').value) || 0,
      perVisitorHourlyLimit: Number($('hourly-limit-input').value) || 50,
      systemPrompt: $('system-prompt-input').value.trim(),
      promptPlaceholder: $('prompt-placeholder-input').value.trim(),
      promptSuggestions: collectSuggestions(),
      newUsername: $('admin-username-input').value.trim(),
      newPassword: $('admin-new-password').value.trim(),
      primary: {
        preset: $('primary-preset-select').value,
        label: $('primary-label-input').value.trim(),
        baseUrl: $('primary-base-url').value.trim(),
        model: $('primary-model-id').value.trim(),
        protocol: $('primary-protocol').value,
        apiKey: $('primary-api-key').value.trim(),
        clearKey: $('primary-clear-key').checked,
        timeoutSeconds: Number($('primary-timeout').value) || 30,
        maxTokens: Number($('primary-max-tokens').value) || 2048,
        temperature: Number($('primary-temperature').value) || 0.3
      },
      backup: {
        enabled: $('backup-enabled-toggle').checked,
        preset: $('backup-preset-select').value,
        label: $('backup-label-input').value.trim(),
        baseUrl: $('backup-base-url').value.trim(),
        model: $('backup-model-id').value.trim(),
        protocol: $('backup-protocol').value,
        usePrimaryKey: $('backup-use-primary-key').checked,
        apiKey: $('backup-api-key').value.trim(),
        clearKey: $('backup-clear-key').checked,
        timeoutSeconds: Number($('backup-timeout').value) || 30,
        maxTokens: Number($('backup-max-tokens').value) || 2048,
        temperature: Number($('backup-temperature').value) || 0.3
      }
    };

    const saveBtn = $('save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ 正在加密保存...';

    try {
      const res = await fetch('/api/admin/model-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token
        },
        body: JSON.stringify(payload)
      });

      const data = await safeJson(res, '保存失败');
      if (!res.ok) {
        if (res.status === 401) {
          setStoredAdminToken('');
          showLogin('登录已失效，请重新登录');
          return;
        }
        throw new Error(data.error || '保存失败');
      }

      if (data.token) {
        setStoredAdminToken(data.token);
      }
      if (data.settings?.adminUsername) {
        setStoredAdminUsername(data.settings.adminUsername);
      }

      showNotification('success', '✓ 配置已完成 AES-256-GCM 硬件加密并保存生效 (版本 v' + (data.settings?.revision || '1') + ')');
      if (data.settings) renderView(data.settings);
    } catch (err) {
      showNotification('error', '保存失败：' + (err.message || '网络或服务端异常'));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 保存全部配置';
    }
  }

  async function testConnection(slot) {
    const token = getStoredAdminToken();
    if (!token) {
      showLogin('请先登录管理员账号以测试连接');
      return;
    }

    const btn = $(slot + '-test-btn');
    const resultBox = $(slot + '-test-result');
    btn.disabled = true;
    btn.textContent = '⏳ 测试中...';
    resultBox.style.display = 'none';

    const endpoint = {
      preset: $(slot + '-preset-select').value,
      baseUrl: $(slot + '-base-url').value.trim(),
      model: $(slot + '-model-id').value.trim(),
      protocol: $(slot + '-protocol').value,
      timeoutSeconds: Number($(slot + '-timeout').value) || 30,
      maxTokens: 50,
      temperature: 0.1
    };

    const apiKey = $(slot + '-api-key').value.trim();
    const usePrimaryKey = slot === 'backup' && $('backup-use-primary-key').checked;
    const primaryApiKey = $('primary-api-key').value.trim();

    try {
      const res = await fetch('/api/admin/model-settings/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token
        },
        body: JSON.stringify({
          slot,
          endpoint,
          apiKey,
          usePrimaryKey,
          primaryApiKey
        })
      });

      const data = await safeJson(res, '测试连接失败');
      resultBox.style.display = 'flex';
      if (data.ok) {
        resultBox.className = 'test-result-box success';
        resultBox.innerHTML = '<span><strong>✓ 连接成功</strong> (' + data.latencyMs + ' ms) · 模型回复: ' + (data.replySnippet || 'PONG') + '</span>';
      } else {
        resultBox.className = 'test-result-box error';
        resultBox.innerHTML = '<span><strong>✗ 测试失败</strong>：' + (data.error || '未响应') + '</span>';
      }
    } catch (err) {
      resultBox.style.display = 'flex';
      resultBox.className = 'test-result-box error';
      resultBox.innerHTML = '<span><strong>✗ 请求失败</strong>：' + err.message + '</span>';
    } finally {
      btn.disabled = false;
      btn.textContent = slot === 'primary' ? '🔌 测试主模型连接' : '🔌 测试备用模型连接';
    }
  }

  // Event Listeners
  $('primary-preset-select').addEventListener('change', (e) => applyPreset('primary', e.target.value));
  $('backup-preset-select').addEventListener('change', (e) => applyPreset('backup', e.target.value));
  $('backup-use-primary-key').addEventListener('change', updateBackupKeyVisibility);
  $('primary-test-btn').addEventListener('click', () => testConnection('primary'));
  $('backup-test-btn').addEventListener('click', () => testConnection('backup'));
  $('save-btn').addEventListener('click', saveSettings);
  $('reload-btn').addEventListener('click', loadSettings);
  $('reset-prompt-btn').addEventListener('click', () => {
    $('system-prompt-input').value = DEFAULT_SYSTEM_PROMPT;
  });
  $('add-suggestion-btn').addEventListener('click', () => {
    $('suggestions-list-container').appendChild(createSuggestionRow('', ''));
  });
  $('reset-suggestions-btn').addEventListener('click', () => {
    renderSuggestionsList(DEFAULT_PROMPT_SUGGESTIONS);
  });
  document.querySelectorAll('[data-board-mode]').forEach(select => {
    select.addEventListener('change', () => {
      if (!currentRankingCuration) return;
      const type = select.dataset.boardMode;
      const board = currentRankingCuration.boards[type];
      if (select.value === 'auto') {
        board.mode = 'auto';
        board.ids = [];
      } else if (board.mode !== 'manual') {
        board.mode = 'manual';
        const choices = currentRankingCuration.choices[type];
        const officialIds = new Set(choices.officialSlots.map(slot => slot.id));
        board.ids = choices.automaticIds.filter(id => !officialIds.has(id));
      }
      renderRankingCurationBoard(type);
    });
  });
  ['recommended', 'essential'].forEach(type => {
    $(type + '-board-search').addEventListener('input', () => renderRankingSearchResults(type));
  });
  $('ranking-curation-save-btn').addEventListener('click', saveRankingCuration);
  $('ranking-curation-reset-btn').addEventListener('click', () => {
    if (!currentRankingCuration) return;
    for (const type of ['recommended', 'essential']) currentRankingCuration.boards[type] = { mode: 'auto', ids: [] };
    for (const type of ['recommended', 'essential']) renderRankingCurationBoard(type);
    saveRankingCuration();
  });

  // Login Form Submission
  const loginForm = $('admin-login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = $('login-submit-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ 正在验证登录...';
      $('login-error-banner').style.display = 'none';

      const username = $('login-username').value.trim();
      const password = $('login-password').value.trim();

      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await safeJson(res, '登录失败');
        if (!res.ok) {
          throw new Error(data.error || '登录失败，请检查账号与密码');
        }

        setStoredAdminToken(data.token);
        setStoredAdminUsername(data.username || username);
        $('login-password').value = '';

        showDashboard();
        showNotification('success', '✓ 登录成功，欢迎管理员 ' + (data.username || username));
        await loadSettings();
      } catch (err) {
        $('login-error-banner').textContent = err.message;
        $('login-error-banner').style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '登 录 控 制 台 ➔';
      }
    });
  }

  // Logout Button
  const logoutBtn = $('admin-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      setStoredAdminToken('');
      setStoredAdminUsername('');
      showLogin();
      showNotification('info', '已安全退出登录');
    });
  }

  // Init auth and dashboard
  const initialToken = getStoredAdminToken();
  if (initialToken) {
    loadSettings();
  } else {
    showLogin();
  }
})();

