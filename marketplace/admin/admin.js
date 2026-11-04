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

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          showDashboard();
          renderView(data.settings);
          return;
        }
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

      const data = await res.json();
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

      const data = await res.json();
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
        const data = await res.json();
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

