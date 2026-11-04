(function() {
  'use strict';

  function $(id) { return document.getElementById(id); }

  let cachedCatalog = null;

  async function fetchLocalCatalog() {
    if (cachedCatalog) return cachedCatalog;
    try {
      const res = await fetch('./registry/catalog-index.json');
      if (res.ok) {
        const data = await res.json();
        cachedCatalog = Array.isArray(data.entries) ? data.entries : [];
        return cachedCatalog;
      }
    } catch {}

    try {
      const res = await fetch('../registry/catalog-index.json');
      if (res.ok) {
        const data = await res.json();
        cachedCatalog = Array.isArray(data.entries) ? data.entries : [];
        return cachedCatalog;
      }
    } catch {}

    return [];
  }

  function localSearchCandidates(query, catalog, limit = 4) {
    if (!catalog || !catalog.length) return [];
    const q = query.toLowerCase().trim();
    const tokens = q.replace(/[^\w\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
    // Add 2-character ngrams for Chinese
    const tokenSet = new Set(tokens);
    for (const token of tokens) {
      if (/[\u4e00-\u9fa5]/.test(token) && token.length >= 2) {
        for (let i = 0; i <= token.length - 2; i++) {
          tokenSet.add(token.slice(i, i + 2));
        }
      }
    }

    const scored = catalog.map(entry => {
      let score = 0;
      const pkg = (entry.packageName || entry.name || entry.id || '').toLowerCase();
      const name = (entry.name || entry.nameZh || pkg).toLowerCase();
      const alias = (entry.alias || entry.nameEn || '').toLowerCase();
      const terms = (entry.searchTerms || []).join(' ').toLowerCase();
      const desc = (entry.description || terms).toLowerCase();
      const cats = (entry.categories || []).join(' ').toLowerCase();

      if (desc.includes(q)) score += 35;
      if (name.includes(q) || alias.includes(q) || pkg.includes(q)) score += 40;
      if (terms.includes(q)) score += 30;

      for (const t of tokenSet) {
        if (pkg.includes(t)) score += 15;
        if (name.includes(t)) score += 16;
        if (alias.includes(t)) score += 12;
        if (desc.includes(t)) score += 10;
        if (terms.includes(t)) score += 12;
        if (cats.includes(t)) score += 8;
      }

      if (score > 0) {
        if (entry.stars > 0) score += Math.min(10, Math.log2(entry.stars + 1));
        if (entry.clientAdaptation) score += 2;
        if (entry.status === 'approved') score += 5;
      }
      return { entry, score };
    });

    return scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => {
        const pkgName = item.entry.packageName || item.entry.name || item.entry.id;
        const displayName = item.entry.name || item.entry.nameZh || pkgName;
        const desc = item.entry.description || (Array.isArray(item.entry.searchTerms) ? item.entry.searchTerms.slice(0, 6).join(' · ') : '');
        return {
          name: pkgName,
          displayName: displayName,
          alias: item.entry.alias || displayName,
          description: desc,
          reason: '功能匹配：' + (desc ? desc.slice(0, 80) + '...' : '与关键词相符'),
          installCommand: 'dsh plugin add ' + pkgName,
          categories: item.entry.categories || [],
          stars: item.entry.stars || 0,
          version: item.entry.version || '',
          commit: item.entry.commit || '',
          repositoryUrl: item.entry.repositoryUrl || null,
          clientAdaptation: Boolean(item.entry.clientAdaptation)
        };
      });
  }

  async function queryRecommendation(query) {
    try {
      const res = await fetch('/api/ai/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) return data;
      }
    } catch {}

    // Fallback to local catalog
    const catalog = await fetchLocalCatalog();
    const plugins = localSearchCandidates(query, catalog, 4);
    return {
      ok: true,
      source: 'rules',
      modelName: null,
      summary: plugins.length
        ? '已通过 DSH 插件目录规则引擎为你匹配到 ' + plugins.length + ' 个相关插件。DSH Store 所有条目均经过固定 Commit 审核，请在终端中执行命令安装：'
        : '未在当前目录中检索到与「' + query.slice(0, 30) + '」完全匹配的插件，建议在完整插件目录中按分类浏览。',
      plugins,
      suggestions: [
        '知网论文精读',
        '微信 / QQ 接入 DSH',
        '大模型 API 余额监控',
        '会话长期记忆与检索'
      ]
    };
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderPluginCardHtml(plugin) {
    const starsBadge = plugin.stars > 0
      ? '<span class="ai-card-badge stars">★ ' + plugin.stars + '</span>'
      : '';
    const adaptBadge = plugin.clientAdaptation
      ? '<span class="ai-card-badge" style="color: #38bdf8; background: rgba(56, 189, 248, 0.12);">Desktop 适配</span>'
      : '';

    const categoriesHtml = (plugin.categories || [])
      .map(c => '<span class="ai-card-badge">' + escapeHtml(c) + '</span>')
      .join(' ');

    const detailHref = './plugins/#q=' + encodeURIComponent(plugin.name);

    return [
      '<article class="ai-plugin-card">',
      '  <div>',
      '    <div class="ai-card-top">',
      '      <h3 class="ai-card-title">' + escapeHtml(plugin.displayName || plugin.name) + '</h3>',
      '      <div class="ai-card-badges">' + starsBadge + adaptBadge + '</div>',
      '    </div>',
      '    <div class="ai-card-reason" style="margin-top: 8px;">' + escapeHtml(plugin.reason) + '</div>',
      '    <p class="ai-card-desc" style="margin-top: 8px;">' + escapeHtml(plugin.description) + '</p>',
      '  </div>',
      '  <div>',
      '    <div class="ai-command-box" style="margin-top: 10px;">',
      '      <code class="ai-command-text">' + escapeHtml(plugin.installCommand) + '</code>',
      '      <button type="button" class="ai-copy-btn" data-copy="' + escapeHtml(plugin.installCommand) + '">复制安装命令</button>',
      '    </div>',
      '    <div class="ai-card-footer" style="margin-top: 10px;">',
      '      <div>' + categoriesHtml + '</div>',
      '      <a class="ai-card-detail-link" href="' + detailHref + '" target="_blank">查看插件详情 ↗</a>',
      '    </div>',
      '  </div>',
      '</article>'
    ].join('\n');
  }

  function setupCopyButtons(container) {
    container.querySelectorAll('.ai-copy-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const cmd = btn.getAttribute('data-copy');
        if (!cmd) return;
        try {
          await navigator.clipboard.writeText(cmd);
          const original = btn.textContent;
          btn.textContent = '✓ 已复制';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove('copied');
          }, 2500);
        } catch {
          prompt('请复制以下命令：', cmd);
        }
      });
    });
  }

  // --- Hero Section Task Dialogue & Unified Search ---
  function initHeroTaskDialogue() {
    const form = $('hero-ai-task-form');
    const textarea = $('hero-ai-textarea');
    const submitBtn = $('hero-ai-submit');
    const catalogJumpBtn = $('hero-catalog-jump');
    const resultsContainer = $('hero-ai-results');
    const searchInput = $('home-plugin-search');
    if (!form || !textarea) return;

    function syncHiddenSearch() {
      if (searchInput) {
        searchInput.value = textarea.value.trim().slice(0, 80);
      }
    }

    textarea.addEventListener('input', syncHiddenSearch);

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    if (catalogJumpBtn) {
      catalogJumpBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const query = textarea.value.trim().slice(0, 80);
        const destination = new URL('./plugins/', window.location.href);
        if (query) destination.hash = 'q=' + encodeURIComponent(query);
        window.location.assign(destination.href);
      });
    }

    function bindChips(container) {
      container.querySelectorAll('.ai-chip-btn').forEach(chip => {
        chip.addEventListener('click', () => {
          const text = chip.getAttribute('data-query') || chip.textContent.trim();
          textarea.value = text;
          syncHiddenSearch();
          form.requestSubmit();
        });
      });
    }
    bindChips(document);

    // Intercept submit in capture phase so app.js does not trigger premature navigation
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();

      const query = textarea.value.trim();
      if (!query) return;
      syncHiddenSearch();

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>⏳ 正在分析推荐...</span>';
      resultsContainer.style.display = 'block';
      resultsContainer.innerHTML = [
        '<div class="ai-results-summary">',
        '  <span>🤖 插件助手正在解析你的需求并比对 DSH 插件目录...</span>',
        '</div>'
      ].join('');

      try {
        const data = await queryRecommendation(query);
        const modelBadge = data.source === 'model'
          ? '<span class="ai-model-tag">AI 驱动 · ' + escapeHtml(data.modelName || '大模型') + '</span>'
          : '<span class="ai-model-tag" style="background: rgba(94, 137, 246, 0.18); color: #93c5fd; border-color: rgba(94, 137, 246, 0.35);">智能规则引擎</span>';

        const summaryHtml = [
          '<div class="ai-results-summary">',
          modelBadge,
          '  <span>' + escapeHtml(data.summary) + '</span>',
          '</div>'
        ].join('');

        let cardsHtml = '';
        if (data.plugins && data.plugins.length > 0) {
          cardsHtml = '<div class="ai-recommend-grid">' +
            data.plugins.map(p => renderPluginCardHtml(p)).join('') +
            '</div>';
        }

        let suggestionsHtml = '';
        if (data.suggestions && data.suggestions.length > 0) {
          suggestionsHtml = '<div class="ai-task-chips" style="margin-top: 12px;"><span class="ai-chips-label">你可以继续了解：</span>' +
            data.suggestions.map(s => '<button type="button" class="ai-chip-btn ai-followup-chip" data-query="' + escapeHtml(s) + '">' + escapeHtml(s) + ' ↗</button>').join('') +
            '</div>';
        }

        resultsContainer.innerHTML = summaryHtml + cardsHtml + suggestionsHtml;
        setupCopyButtons(resultsContainer);

        resultsContainer.querySelectorAll('.ai-followup-chip').forEach(btn => {
          btn.addEventListener('click', () => {
            textarea.value = btn.getAttribute('data-query');
            syncHiddenSearch();
            form.requestSubmit();
            resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        });

      } catch (err) {
        resultsContainer.innerHTML = '<div class="ai-results-summary" style="color: #f87171;">插件推荐失败：' + escapeHtml(err.message) + '</div>';
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>智能推荐 ↗</span>';
      }
    }, true);

    // Dynamic config hydrate
    async function hydratePublicSettings() {
      try {
        const res = await fetch('/api/admin/model-settings');
        if (!res.ok) return;
        const data = await res.json();
        if (!data.ok || !data.settings) return;
        const s = data.settings;
        if (s.promptPlaceholder) {
          textarea.placeholder = s.promptPlaceholder;
        }
        if (Array.isArray(s.promptSuggestions) && s.promptSuggestions.length > 0) {
          const chipsEl = $('hero-ai-chips');
          if (chipsEl) {
            chipsEl.innerHTML = '<span class="ai-chips-label">试试这样问：</span>' +
              s.promptSuggestions.map(item => {
                const lbl = escapeHtml(item.label || item.query || '');
                const q = escapeHtml(item.query || item.label || '');
                return '<button type="button" class="ai-chip-btn" data-query="' + q + '">' + lbl + ' ↗</button>';
              }).join('');
            bindChips(chipsEl);
          }
        }
      } catch {}
    }
    hydratePublicSettings();
  }

  // --- Floating Assistant Drawer ---
  function initFloatingAssistant() {
    const launcher = $('floating-assistant-launcher');
    const modal = $('floating-assistant-modal');
    const closeBtn = $('floating-assistant-close');
    const sendBtn = $('floating-assistant-send');
    const input = $('floating-assistant-input');
    const body = $('floating-assistant-body');
    if (!launcher || !modal) return;

    launcher.addEventListener('click', () => {
      modal.classList.toggle('open');
      if (modal.classList.contains('open')) {
        input.focus();
      }
    });

    closeBtn.addEventListener('click', () => {
      modal.classList.remove('open');
    });

    function appendMessage(role, text, pluginsHtml = '') {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble ' + role;
      bubble.innerHTML = '<p>' + escapeHtml(text) + '</p>' + pluginsHtml;
      body.appendChild(bubble);
      body.scrollTop = body.scrollHeight;
      setupCopyButtons(bubble);
    }

    async function handleSend() {
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      appendMessage('user', q);

      sendBtn.disabled = true;
      const loadingBubble = document.createElement('div');
      loadingBubble.className = 'chat-bubble assistant';
      loadingBubble.textContent = '思考中...';
      body.appendChild(loadingBubble);
      body.scrollTop = body.scrollHeight;

      try {
        const data = await queryRecommendation(q);
        body.removeChild(loadingBubble);

        let cards = '';
        if (data.plugins && data.plugins.length) {
          cards = '<div style="margin-top: 10px; display: flex; flex-direction: column; gap: 10px;">' +
            data.plugins.map(p => renderPluginCardHtml(p)).join('') +
            '</div>';
        }
        appendMessage('assistant', data.summary, cards);
      } catch (err) {
        body.removeChild(loadingBubble);
        appendMessage('assistant', '插件推荐出错：' + err.message);
      } finally {
        sendBtn.disabled = false;
        input.focus();
      }
    }

    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    });
  }

  // Init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initHeroTaskDialogue();
      initFloatingAssistant();
    });
  } else {
    initHeroTaskDialogue();
    initFloatingAssistant();
  }
})();
