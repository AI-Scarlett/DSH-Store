(function() {
  'use strict';

  const PRESETS = [
    { id: 'deepseek', name: 'DeepSeek 官方', protocol: 'openai-chat', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', maxTokens: 2048, timeoutSeconds: 30, temperature: 0.3 },
    { id: 'minimax', name: 'MiniMax 国内', protocol: 'openai-chat', baseUrl: 'https://api.minimax.cn/v1', model: 'MiniMax-M3', maxTokens: 2048, timeoutSeconds: 30, temperature: 0.3 },
    { id: 'qwen', name: '通义千问 (Qwen)', protocol: 'openai-chat', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', maxTokens: 2048, timeoutSeconds: 30, temperature: 0.3 },
    { id: 'openai', name: 'OpenAI 官方', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', maxTokens: 2048, timeoutSeconds: 30, temperature: 0.3 },
    { id: 'claude', name: 'Anthropic Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20241022', maxTokens: 2048, timeoutSeconds: 30, temperature: 0.3 },
    { id: 'custom', name: '自定义兼容接口', protocol: 'openai-chat', baseUrl: '', model: '', maxTokens: 2048, timeoutSeconds: 30, temperature: 0.3 }
  ];

  const DEFAULT_SYSTEM_PROMPT = '你是一名精通 DeepSeek Harness (DSH) 插件生态的官方架构师与选型专家。\n你的职责是深入理解用户的实际业务、任务与工作流需求，结合 DSH Store 已收录并严格审查的插件目录，为用户推荐最适合的插件组合。\n\n对于每个推荐的插件，你需要明确提供：\n1. 插件名称与用途简述\n2. 匹配理由（它如何解决用户的需求）\n3. 精准的官方固定 Commit 安装命令（格式为 dsh plugin add @author/name 或包名）\n4. 权限与安全声明（网络、文件系统、自动化脚本等）\n\n请保持回答严谨、专业、实用。禁止捏造不存在的插件名称或未收录的虚假命令。';

  const DEFAULT_PROMPT_PLACEHOLDER = '输入你想完成的任务需求或插件名称（例如：知网论文精读并写大纲、在微信/QQ中接入DSH、查看API余额、增强会话长期记忆…）';

  const DEFAULT_PROMPT_SUGGESTIONS = [
    { label: '知网论文精读', query: '知网论文精读并写大纲' },
    { label: '微信 / QQ 接入', query: '在微信和QQ中接入DSH会话' },
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
    return sessionStorage.getItem('dsh_admin_token') || localStorage.getItem('dsh_admin_token') || '';
  }

  function setStoredAdminToken(token) {
    if (token) {
      sessionStorage.setItem('dsh_admin_token', token);
    } else {
      sessionStorage.removeItem('dsh_admin_token');
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
    const list = Array.isArray(items) && items.length > 0 ? items : DEFAULT_PROMPT_SUGGESTIONS;
    list.forEach(item => {
      const lbl = typeof item === 'string' ? item : (item.label || item.query || '');
      const q = typeof item === 'string' ? item : (item.query || item.label || '');
      container.appendChild(createSuggestionRow(lbl, q));
    });
  }

  function collectSuggestions() {
    const rows = document.querySelectorAll('.suggestion-row');
    const result = [];
    rows.forEach(r => {
      const lbl = r.querySelector('.suggestion-label-input')?.value.trim() || '';
      const q = r.querySelector('.suggestion-query-input')?.value.trim() || '';
      if (lbl || q) {
        result.push({
          label: lbl || q,
          query: q || lbl
        });
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

    // Auth Status
    const authStatus = $('auth-status-badge');
    if (settings.hasPassword) {
      authStatus.textContent = '已设口令保护';
      authStatus.className = 'key-status';
    } else {
      authStatus.textContent = '未设口令';
      authStatus.className = 'key-status none';
    }

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
    if (token) $('admin-token-input').value = token;

    try {
      const res = await fetch('/api/admin/model-settings', {
        headers: token ? { 'x-admin-token': token } : {}
      });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          renderView(data.settings);
          return;
        }
      }
    } catch (err) {
      console.warn('API server unreachable, fallback to local settings', err);
    }

    // Static fallback
    const local = localStorage.getItem('dsh_local_model_settings');
    if (local) {
      try {
        renderView(JSON.parse(local));
        return;
      } catch {}
    }

    // Default view
    renderView({
      revision: 1,
      enabled: true,
      mode: 'model-first',
      dailyLimit: 0,
      perVisitorHourlyLimit: 50,
      hasPassword: false,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      promptPlaceholder: DEFAULT_PROMPT_PLACEHOLDER,
      promptSuggestions: DEFAULT_PROMPT_SUGGESTIONS,
      primary: {
        preset: 'deepseek',
        label: 'DeepSeek 主模型',
        protocol: 'openai-chat',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        timeoutSeconds: 30,
        maxTokens: 2048,
        temperature: 0.3,
        hasKey: false
      },
      backup: {
        enabled: false,
        preset: 'qwen',
        label: '通义千问 备用模型',
        protocol: 'openai-chat',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-plus',
        timeoutSeconds: 30,
        maxTokens: 2048,
        temperature: 0.3,
        usePrimaryKey: false,
        hasKey: false
      }
    });
  }

  async function saveSettings() {
    const token = $('admin-token-input').value.trim();
    if (token) setStoredAdminToken(token);

    const placeholderVal = $('prompt-placeholder-input').value.trim();
    const suggestionsVal = collectSuggestions();

    const payload = {
      enabled: $('model-enabled-toggle').checked,
      mode: $('model-mode-select').value,
      dailyLimit: Number($('daily-limit-input').value) || 0,
      perVisitorHourlyLimit: Number($('hourly-limit-input').value) || 50,
      newPassword: $('admin-new-password').value.trim(),
      systemPrompt: $('system-prompt-input').value.trim(),
      promptPlaceholder: placeholderVal || DEFAULT_PROMPT_PLACEHOLDER,
      promptSuggestions: suggestionsVal.length > 0 ? suggestionsVal : DEFAULT_PROMPT_SUGGESTIONS,
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
        throw new Error(data.error || '保存失败');
      }

      showNotification('success', '✓ 配置已完成 AES-256-GCM 硬件加密并保存生效 (版本 v' + (data.settings?.revision || '1') + ')');
      if (data.settings) renderView(data.settings);
      $('admin-new-password').value = '';
    } catch (err) {
      // Fallback: save to localStorage if purely static
      try {
        const fallbackObj = {
          ...payload,
          revision: ((currentSettings?.revision || 1) + 1),
          promptPlaceholder: payload.promptPlaceholder,
          promptSuggestions: payload.promptSuggestions,
          primary: { ...payload.primary, hasKey: Boolean(payload.primary.apiKey || currentSettings?.primary?.hasKey) },
          backup: { ...payload.backup, hasKey: Boolean(payload.backup.usePrimaryKey || payload.backup.apiKey || currentSettings?.backup?.hasKey) }
        };
        localStorage.setItem('dsh_local_model_settings', JSON.stringify(fallbackObj));
        showNotification('success', '✓ 配置已在本地客户端加密保存');
        renderView(fallbackObj);
      } catch (localErr) {
        showNotification('error', '保存失败：' + err.message);
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 保存全部配置';
    }
  }

  async function testConnection(slot) {
    const token = $('admin-token-input').value.trim();
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

  // Init
  loadSettings();
})();
