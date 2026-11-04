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

  const DEFAULT_SYSTEM_PROMPT = "\u4f60\u662f\u4e00\u4e2a\u4e25\u8c28\u4e14\u5b9e\u7528\u7684 DeepSeek Harness (DSH) \u63d2\u4ef6\u9009\u578b\u4e13\u5bb6\u3002\u4f60\u7684\u4efb\u52a1\u662f\u6839\u636e\u7528\u6237\u7684\u9700\u6c42\uff0c\u4ece\u5df2\u5ba1\u6838\u7684 DSH \u63d2\u4ef6\u5217\u8868\u4e2d\u6311\u9009\u6700\u9002\u5408\u7684 1 \u5230 3 \u4e2a\u63d2\u4ef6\u63a8\u8350\u7ed9\u7528\u6237\u3002\n\n\u3010\u8f93\u51fa\u683c\u5f0f\u8981\u6c42\u3011\uff1a\n\u5fc5\u987b\u4e25\u683c\u53ea\u8f93\u51fa\u5408\u6cd5\u7684 JSON \u683c\u5f0f\uff0c\u4e0d\u8981\u5305\u542b\u4efb\u4f55 markdown \u4ee3\u7801\u5757\u6807\u8bb0\uff0c\u4e0d\u8981\u5305\u542b\u591a\u4f59\u5bd2\u6684\u3002\u683c\u5f0f\u5982\u4e0b\uff1a\n{\n  \"analysis\": \"\u7b80\u77ed\u8bf4\u660e\u7528\u6237\u9700\u6c42\u548c\u63a8\u8350\u903b\u8f91\uff08\u4e0d\u8d85\u8fc780\u5b57\uff09\",\n  \"plugins\": [\n    {\n      \"id\": \"\u63d2\u4ef6\u552f\u4e00ID\",\n      \"reason\": \"\u4e3a\u4f55\u8be5\u63d2\u4ef6\u80fd\u6ee1\u8db3\u9700\u6c42\u7684\u5177\u4f53\u89e3\u91ca\uff08\u4e0d\u8d85\u8fc760\u5b57\uff09\"\n    }\n  ],\n  \"suggestedQueries\": [\"\u53ef\u9009\u7684\u76f8\u5173\u5ef6\u4f38\u63d0\u95ee1\", \"\u63d0\u95ee2\"]\n}\n\n\u3010\u539f\u5219\u3011\uff1a\n1. \u53ea\u80fd\u63a8\u8350\u7ed9\u51fa\u7684\u5019\u9009\u63d2\u4ef6\uff0c\u4e25\u7981\u865a\u6784\u4e0d\u5b58\u5728\u7684\u63d2\u4ef6\u6216\u5305\u540d\u3002\n2. \u5982\u679c\u7528\u6237\u9700\u6c42\u65e0\u6cd5\u5339\u914d\u4efb\u4f55\u63d2\u4ef6\uff0cplugins \u6570\u7ec4\u8fd4\u56de\u7a7a\uff0c\u5e76\u5728 analysis \u4e2d\u5ba2\u89c2\u8bf4\u660e\u3002";

  const DEFAULT_PROMPT_PLACEHOLDER = '输入你想完成的任务需求或插件名称（例如：知网论文精读并写大纲、在微信/QQ中接入DSH、查看API余额、增强会话长期记忆…）';

  const DEFAULT_PROMPT_SUGGESTIONS = [
    { label: '知网论文精读', query: '知网论文研究精读并分步写作大纲' },
    { label: 'QQ 微信机器人', query: '把 DSH 接入 QQ 或微信群做智能客服' },
    { label: '模型 API 余额', query: '实时查看 DeepSeek API 余额' },
    { label: '长期记忆增强', query: '给大模型增加长期记忆和会话检索' },
    { label: '网页 PPT 排版', query: '制作网页PPT与卡片设计排版' }
  ];

  const VAULT_SALT = 'dsh-store-vault-salt-v1';
  const DEFAULT_ADMIN_USER = 'admin';
  const DEFAULT_ADMIN_PWD_HASH = 'a113fee5ebdb0d90c8307996a895b8980be704c81442adacc1fab2b4d8c0d252';

  let currentSettings = null;
  let isStaticVaultMode = false;
  let activeVaultKey = null;

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
        throw new Error('后台服务接口未就绪 (404)。请确保本地预览服务已启动：node scripts/serve-marketplace.mjs');
      }
      throw new Error('服务端返回了非 JSON 格式响应 (HTTP ' + res.status + ')');
    }
    try {
      return await res.json();
    } catch {
      throw new Error(defaultError + '：无法解析服务器 JSON 返回');
    }
  }

  // Cryptographic Helpers for Client-Side Vault Mode (WebCrypto)
  async function hashString(str) {
    const enc = new TextEncoder();
    const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(str));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function deriveVaultKey(password) {
    const enc = new TextEncoder();
    const passwordKey = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode(VAULT_SALT),
        iterations: 100000,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  async function exportKeyToBase64(key) {
    const raw = await window.crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
  }

  async function importKeyFromBase64(b64) {
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return window.crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptVaultPayload(payload, key) {
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const data = enc.encode(JSON.stringify(payload));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    const ivB64 = btoa(String.fromCharCode(...iv));
    const cipherB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
    return 'v1.' + ivB64 + '.' + cipherB64;
  }

  async function decryptVaultPayload(str, key) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const iv = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));
    const cipher = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0));
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipher
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  }

  function defaultVaultSettings() {
    return {
      revision: 1,
      enabled: true,
      mode: 'model-first',
      dailyLimit: 0,
      perVisitorHourlyLimit: 50,
      adminUsername: localStorage.getItem('dsh_vault_admin_user') || DEFAULT_ADMIN_USER,
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
        hasKey: false,
        apiKey: ''
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
        hasKey: false,
        apiKey: ''
      }
    };
  }

  function getStoredAdminToken() {
    return sessionStorage.getItem('dsh_admin_token') || '';
  }

  function setStoredAdminToken(token) {
    if (token) {
      sessionStorage.setItem('dsh_admin_token', token);
    } else {
      sessionStorage.removeItem('dsh_admin_token');
      sessionStorage.removeItem('dsh_vault_session_key');
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

  function updateVaultModeUI() {
    const badgeText = $('security-badge-text');
    if (badgeText && isStaticVaultMode) {
      badgeText.innerHTML = '<strong>纯静态端对端加密保险箱已激活 (Client-side AES-256-GCM)</strong>：当前运行于纯静态部署环境，大模型配置与 API Key 均采用 WebCrypto 硬件级加密保存在您的本地安全保险箱中，无需依赖外部后台进程。';
    }
    const authStatus = $('auth-status-badge');
    if (authStatus && isStaticVaultMode) {
      authStatus.textContent = '已激活客户端保险箱';
    }
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
    authStatus.textContent = isStaticVaultMode ? '已激活客户端保险箱' : '已通过身份鉴权';
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
    if (settings.primary?.hasKey || (settings.primary?.apiKey && settings.primary.apiKey.length > 0)) {
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
    if (settings.backup?.hasKey || (settings.backup?.apiKey && settings.backup.apiKey.length > 0)) {
      backupStatus.textContent = settings.backup.usePrimaryKey ? '共用主模型 Key' : '已加密保存 Key';
      backupStatus.className = 'key-status';
    } else {
      backupStatus.textContent = '未配置 Key';
      backupStatus.className = 'key-status none';
    }

    if (isStaticVaultMode) updateVaultModeUI();
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

    if (token === 'static_vault_session' || isStaticVaultMode) {
      isStaticVaultMode = true;
      if (!activeVaultKey) {
        const storedKeyB64 = sessionStorage.getItem('dsh_vault_session_key');
        if (storedKeyB64) {
          try {
            activeVaultKey = await importKeyFromBase64(storedKeyB64);
          } catch {}
        }
      }
      if (!activeVaultKey) {
        setStoredAdminToken('');
        showLogin('安全会话已结束，请重新输入密码解锁保险箱');
        return;
      }

      let settings = null;
      const encryptedStr = localStorage.getItem('dsh_vault_settings');
      if (encryptedStr) {
        try {
          settings = await decryptVaultPayload(encryptedStr, activeVaultKey);
        } catch (decErr) {
          console.warn('Failed to decrypt vault settings with current key:', decErr);
        }
      }
      if (!settings) {
        settings = defaultVaultSettings();
      }

      showDashboard();
      updateVaultModeUI();
      renderView(settings);
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
      if (res.status === 404) {
        isStaticVaultMode = true;
        setStoredAdminToken('static_vault_session');
        await loadSettings();
        return;
      }
      const data = await safeJson(res, '读取配置失败');
      if (res.ok && data.settings) {
        showDashboard();
        renderView(data.settings);
        return;
      }
    } catch (err) {
      console.warn('API fetch error, checking static fallback', err);
      isStaticVaultMode = true;
      await loadSettings();
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

    if (isStaticVaultMode || token === 'static_vault_session') {
      try {
        if (!activeVaultKey) {
          const storedKeyB64 = sessionStorage.getItem('dsh_vault_session_key');
          if (storedKeyB64) activeVaultKey = await importKeyFromBase64(storedKeyB64);
        }
        if (!activeVaultKey) throw new Error('加密会话已失效，请重新输入密码登录');

        // Handle username change
        if (payload.newUsername) {
          localStorage.setItem('dsh_vault_admin_user', payload.newUsername);
          setStoredAdminUsername(payload.newUsername);
        }

        // Handle password change
        if (payload.newPassword) {
          const newHash = await hashString(VAULT_SALT + ':' + payload.newPassword);
          localStorage.setItem('dsh_vault_admin_pwd_hash', newHash);
          activeVaultKey = await deriveVaultKey(payload.newPassword);
          const newRawKeyB64 = await exportKeyToBase64(activeVaultKey);
          sessionStorage.setItem('dsh_vault_session_key', newRawKeyB64);
        }

        const base = currentSettings || defaultVaultSettings();
        let primaryKey = base.primary?.apiKey || '';
        if (payload.primary.clearKey) primaryKey = '';
        else if (payload.primary.apiKey) primaryKey = payload.primary.apiKey;

        let backupKey = base.backup?.apiKey || '';
        if (payload.backup.clearKey) backupKey = '';
        else if (payload.backup.apiKey) backupKey = payload.backup.apiKey;

        const updatedSettings = {
          revision: (base.revision || 1) + 1,
          enabled: payload.enabled,
          mode: payload.mode,
          dailyLimit: payload.dailyLimit,
          perVisitorHourlyLimit: payload.perVisitorHourlyLimit,
          adminUsername: payload.newUsername || base.adminUsername || DEFAULT_ADMIN_USER,
          systemPrompt: payload.systemPrompt || DEFAULT_SYSTEM_PROMPT,
          promptPlaceholder: payload.promptPlaceholder || DEFAULT_PROMPT_PLACEHOLDER,
          promptSuggestions: payload.promptSuggestions,
          primary: {
            ...payload.primary,
            hasKey: Boolean(primaryKey),
            apiKey: primaryKey
          },
          backup: {
            ...payload.backup,
            hasKey: payload.backup.usePrimaryKey ? Boolean(primaryKey) : Boolean(backupKey),
            apiKey: backupKey
          }
        };

        const encryptedStr = await encryptVaultPayload(updatedSettings, activeVaultKey);
        localStorage.setItem('dsh_vault_settings', encryptedStr);

        // Store public suggestions & placeholder for home page
        localStorage.setItem('dsh_public_ai_config', JSON.stringify({
          promptPlaceholder: updatedSettings.promptPlaceholder,
          promptSuggestions: updatedSettings.promptSuggestions
        }));

        // Store active model config for client-side recommendations
        localStorage.setItem('dsh_client_active_model', JSON.stringify({
          enabled: updatedSettings.enabled,
          mode: updatedSettings.mode,
          systemPrompt: updatedSettings.systemPrompt,
          primary: {
            preset: updatedSettings.primary.preset,
            baseUrl: updatedSettings.primary.baseUrl,
            model: updatedSettings.primary.model,
            protocol: updatedSettings.primary.protocol,
            timeoutSeconds: updatedSettings.primary.timeoutSeconds,
            apiKey: primaryKey
          },
          backup: {
            enabled: updatedSettings.backup.enabled,
            preset: updatedSettings.backup.preset,
            baseUrl: updatedSettings.backup.baseUrl,
            model: updatedSettings.backup.model,
            protocol: updatedSettings.backup.protocol,
            timeoutSeconds: updatedSettings.backup.timeoutSeconds,
            apiKey: updatedSettings.backup.usePrimaryKey ? primaryKey : backupKey
          }
        }));

        currentSettings = updatedSettings;
        renderView(updatedSettings);
        showNotification('success', '✓ 全部配置已通过 WebCrypto AES-256-GCM 硬件加密并保存生效 (版本 v' + updatedSettings.revision + ')');
      } catch (err) {
        showNotification('error', '保存失败：' + (err.message || '未知错误'));
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 保存全部配置';
      }
      return;
    }

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

    let apiKey = $(slot + '-api-key').value.trim();
    const usePrimaryKey = slot === 'backup' && $('backup-use-primary-key').checked;
    const primaryApiKey = $('primary-api-key').value.trim() || currentSettings?.primary?.apiKey || '';

    if (slot === 'backup' && usePrimaryKey) {
      apiKey = primaryApiKey;
    } else if (!apiKey && currentSettings?.[slot]?.apiKey) {
      apiKey = currentSettings[slot].apiKey;
    }

    if (isStaticVaultMode || token === 'static_vault_session') {
      const start = Date.now();
      try {
        if (!apiKey) throw new Error('缺少 API Key，请先输入密钥');
        if (!endpoint.baseUrl) throw new Error('缺少 API 基础地址');
        if (!endpoint.model) throw new Error('缺少模型 ID');

        const controller = new AbortController();
        const timeoutMs = (endpoint.timeoutSeconds || 20) * 1000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const isAnthropic = endpoint.protocol === 'anthropic';
        const url = isAnthropic
          ? (endpoint.baseUrl.replace(/\/+$/, '') + '/messages')
          : (endpoint.baseUrl.replace(/\/+$/, '') + '/chat/completions');

        const headers = { 'Content-Type': 'application/json' };
        let body;
        if (isAnthropic) {
          headers['x-api-key'] = apiKey;
          headers['anthropic-version'] = '2023-06-01';
          headers['anthropic-dangerous-direct-browser-access'] = 'true';
          body = JSON.stringify({
            model: endpoint.model,
            max_tokens: 30,
            messages: [{ role: 'user', content: 'Ping' }]
          });
        } else {
          headers['Authorization'] = 'Bearer ' + apiKey;
          body = JSON.stringify({
            model: endpoint.model,
            max_tokens: 30,
            temperature: 0.1,
            messages: [{ role: 'user', content: 'Ping' }]
          });
        }

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal
        });
        clearTimeout(timer);
        const latencyMs = Date.now() - start;

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          let msg = 'HTTP ' + res.status;
          try {
            const parsed = JSON.parse(errText);
            msg += ': ' + (parsed.error?.message || parsed.message || errText.slice(0, 160));
          } catch {
            if (errText) msg += ': ' + errText.slice(0, 160);
          }
          throw new Error(msg);
        }

        const data = await res.json();
        let reply = '';
        if (isAnthropic) {
          reply = data.content?.[0]?.text || '';
        } else {
          reply = data.choices?.[0]?.message?.content || '';
        }

        resultBox.style.display = 'flex';
        resultBox.className = 'test-result-box success';
        resultBox.innerHTML = '<span><strong>✓ 终端直连成功</strong> (' + latencyMs + ' ms) · 模型回复: ' + escapeHtml(reply.trim().slice(0, 80) || 'PONG') + '</span>';
      } catch (err) {
        resultBox.style.display = 'flex';
        resultBox.className = 'test-result-box error';
        resultBox.innerHTML = '<span><strong>✗ 测试失败</strong>：' + escapeHtml(err.message || '网络或跨域异常') + '</span>';
      } finally {
        btn.disabled = false;
        btn.textContent = slot === 'primary' ? '🔌 测试主模型连接' : '🔌 测试备用模型连接';
      }
      return;
    }

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

      let backendStatus = null;
      let backendData = null;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        backendStatus = res.status;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          backendData = await res.json();
        }
      } catch (networkErr) {
        console.info('Backend login unreachable, falling back to static vault mode', networkErr);
      }

      try {
        if (backendStatus === 200 && backendData?.ok) {
          isStaticVaultMode = false;
          setStoredAdminToken(backendData.token);
          setStoredAdminUsername(backendData.username || username);
          $('login-password').value = '';

          showDashboard();
          showNotification('success', '✓ 登录成功，欢迎管理员 ' + (backendData.username || username));
          await loadSettings();
          return;
        }

        if (backendStatus === 401) {
          throw new Error(backendData?.error || '管理员账号或密码不正确');
        }

        // Static Vault Mode Fallback (when online backend is 404 or unreachable)
        const expectedUser = localStorage.getItem('dsh_vault_admin_user') || DEFAULT_ADMIN_USER;
        const expectedHash = localStorage.getItem('dsh_vault_admin_pwd_hash') || DEFAULT_ADMIN_PWD_HASH;
        const inputHash = await hashString(VAULT_SALT + ':' + password);

        if (username !== expectedUser || inputHash !== expectedHash) {
          throw new Error('管理员账号或密码不正确');
        }

        isStaticVaultMode = true;
        activeVaultKey = await deriveVaultKey(password);
        const rawKeyB64 = await exportKeyToBase64(activeVaultKey);
        sessionStorage.setItem('dsh_vault_session_key', rawKeyB64);
        setStoredAdminToken('static_vault_session');
        setStoredAdminUsername(username);
        $('login-password').value = '';

        showDashboard();
        updateVaultModeUI();
        showNotification('success', '✓ 登录成功！已进入静态保险箱模式 (AES-256-GCM 硬件加密保护)');
        await loadSettings();
      } catch (err) {
        $('login-error-banner').textContent = err.message || '登录失败，请检查账号与密码';
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
      activeVaultKey = null;
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
