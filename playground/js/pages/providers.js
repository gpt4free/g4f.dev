const ProvidersPage = (() => {
  let mcpClient = API.getMCPClient();
  function render(container) {
    Components.injectStyles();
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:16px;overflow-y:auto;-webkit-overflow-scrolling:touch;height:100%;max-width:800px;margin:0 auto;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;';
    header.innerHTML = `<h1 style="font-size:18px;flex:1;min-width:120px">Providers</h1>`;
    const btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'display:flex;gap:8px;';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn-secondary btn-sm';
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => Store.loadProviders());
    btnWrap.appendChild(resetBtn);
    const newBtn = document.createElement('button');
    newBtn.className = 'btn btn-primary btn-sm';
    newBtn.textContent = '+ Add';
    newBtn.addEventListener('click', () => openEditor(null));
    btnWrap.appendChild(newBtn);
    header.appendChild(btnWrap);

    const hint = document.createElement('p');
    hint.style.cssText = 'color:var(--text2);font-size:13px;margin-bottom:20px;line-height:1.5;';
    hint.textContent = 'Add any provider — OpenAI, Anthropic, Google, or compatible APIs. The endpoint type is auto-detected.';

    const list = document.createElement('div');
    list.id = 'providers-list';
    list.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

    const accountSection = buildAccountSection();
    const settingsSection = buildSettingsSection();
    const mcpSection = buildMCPSection();

    wrap.appendChild(accountSection);
    wrap.appendChild(header);
    wrap.appendChild(hint);
    wrap.appendChild(list);
    wrap.appendChild(settingsSection);
    wrap.appendChild(mcpSection);
    container.appendChild(wrap);

    renderList();
    updateBadge();
  }

  function buildAccountSection() {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:16px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px;';

    const auth = window.PlaygroundAuth;
    const user = auth?.getUser?.();
    const tier = user?.tier || 'guest';
    const accountName = user ? (user.name || user.username || 'Account') : 'Guest';

    section.innerHTML = `
      <h2 style="font-size:15px;margin-bottom:8px">Account</h2>
      <div class="notranslate" style="font-size:13px;color:var(--text2);margin-bottom:12px">
        ${user ? `${framework.translate('Signed in as')} <strong style="color:var(--text)">${Components.escHtml(accountName)}</strong> · ${framework.translate('Tier')}: <strong style="color:var(--text)">${Components.escHtml(tier)}</strong>` : `${framework.translate('Sign in to use your members access token and provider API keys.')}`}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${user ? `
          <button class="btn btn-secondary btn-sm" data-auth-action="refresh">${framework.translate('Refresh Tier')}</button>
          <button class="btn btn-danger btn-sm" data-auth-action="logout">${framework.translate('Logout')}</button>
        ` : `
          <button class="btn btn-secondary btn-sm" data-auth-provider="github">GitHub</button>
          <button class="btn btn-secondary btn-sm" data-auth-provider="discord">Discord</button>
          <button class="btn btn-secondary btn-sm" data-auth-provider="huggingface">HuggingFace</button>
          <button class="btn btn-secondary btn-sm" data-auth-provider="pollinations">Pollinations</button>
        `}
      </div>
    `;

    section.querySelectorAll('[data-auth-provider]').forEach(btn => {
      btn.addEventListener('click', () => auth?.login?.(btn.dataset.authProvider));
    });
    section.querySelector('[data-auth-action="logout"]')?.addEventListener('click', async () => {
      await auth?.logout?.();
      if (typeof Router !== 'undefined' && Router.navigate) {
        Router.navigate();
      }
    });
    const refreshBtn = section.querySelector('[data-auth-action="refresh"]');
    refreshBtn?.addEventListener('click', async (e) => {
      const backupText = refreshBtn.textContent;
      refreshBtn.innerHTML = framework.translate('Refreshing...');
      setTimeout(async() => {
        await auth?.refreshSession?.();
        if (typeof Router !== 'undefined' && Router.navigate) {
          Router.navigate();
        }
      }, 1000);
    });
    return section;
  }

  function endpointLabel(type) {
    const labels = {
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      responses: 'Responses API',
      google: 'Google AI',
    };
    return labels[type] || type || 'OpenAI';
  }

  function endpointColor(type) {
    const colors = {
      openai: '#4caf50',
      anthropic: '#d4a574',
      responses: '#2196f3',
      google: '#ff9800',
    };
    return colors[type] || 'var(--text2)';
  }

  function renderList() {
    const list = document.getElementById('providers-list');
    if (!list) return;
    list.innerHTML = '';
    const providers = Store.getProviders();
    const activeId = Store.getActiveProviderId();

    providers.forEach(provider => {
      const isActive = provider.id === activeId;
      const epType = provider.endpointType || provider.type || 'openai';
      const card = document.createElement('div');
      card.style.cssText = `background:var(--bg2);border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};border-radius:12px;padding:16px;`;
      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:600;font-size:15px" class="notranslate">${Components.escHtml(provider.name)}</span>
              ${isActive ? '<span style="font-size:11px;background:var(--accent);color:#fff;padding:2px 7px;border-radius:10px">Active</span>' : ''}
              <span style="font-size:11px;background:${endpointColor(epType)};color:#fff;padding:2px 7px;border-radius:10px">${endpointLabel(epType)}</span>
            </div>
            <div style="font-size:12px;color:var(--text2);margin-top:4px;word-break:break-all" class="notranslate">${Components.escHtml(provider.baseUrl)}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          ${!isActive ? `<button class="btn btn-secondary btn-sm" data-action="activate">Set Active</button>` : ''}
          <button class="btn btn-secondary btn-sm" data-action="fetch-models">Fetch Models</button>
          <button class="btn btn-secondary btn-sm" data-action="redetect">Re-detect</button>
          <button class="btn btn-secondary btn-sm" data-action="edit">Edit</button>
          ${provider.id !== 'airforce' ? `<button class="btn btn-danger btn-sm" data-action="delete">Delete</button>` : ''}
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--text2)">
          <span>Model: <strong class="notranslate" style="color:var(--text)">${Components.escHtml(provider.defaultModel || '—')}</strong></span>
          <span>Key: <strong class="notranslate" style="color:var(--text)">${provider.apiKey ? '••••' + provider.apiKey.slice(-4) : framework.translate('No')}</strong></span>
          <span>Cached: <strong style="color:var(--text)">${provider.fetchedModels?.length || 0}</strong></span>
        </div>
        ${provider.fetchedModels?.length ? `
        <div style="margin-top:12px">
          <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Default Model</label>
          <select class="model-select default-model-sel" style="width:100%">
            ${provider.fetchedModels.map(m => `<option value="${Components.escHtml(m.id || m)}" ${(m.id || m) === provider.defaultModel ? 'selected' : ''}>${Components.escHtml(m.label || m.id || m)}</option>`).join('')}
          </select>
        </div>` : ''}`;

      card.querySelector('[data-action="activate"]')?.addEventListener('click', () => {
        Store.setActiveProviderId(provider.id);
        renderList();
        updateBadge();
        Components.toast(`Switched to ${provider.name}`, 'success');
      });

      card.querySelector('[data-action="fetch-models"]')?.addEventListener('click', async () => {
        try {
          Components.toast('Fetching models...', 'info');
          const models = await API.fetchModels(provider);
          provider.fetchedModels = models;
          Store.upsertProvider(provider);
          renderList();
          Components.toast(`Fetched ${models.length} models`, 'success');
        } catch (err) {
          Components.toast(`Failed: ${err.message}`, 'error');
        }
      });

      card.querySelector('[data-action="redetect"]')?.addEventListener('click', async () => {
        try {
          Components.toast('Detecting endpoint type...', 'info');
          const detected = await API.detectEndpointType(provider.baseUrl, provider.apiKey, provider.defaultModel);
          provider.endpointType = detected;
          Store.upsertProvider(provider);
          renderList();
          Components.toast(`Detected: ${endpointLabel(detected)}`, 'success');
        } catch (err) {
          Components.toast(`Detection failed: ${err.message}`, 'error');
        }
      });

      card.querySelector('[data-action="edit"]')?.addEventListener('click', () => openEditor(provider));

      card.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        const ok = await Components.confirm(`Delete provider "${provider.name}"?`);
        if (!ok) return;
        Store.deleteProvider(provider.id);
        renderList();
        updateBadge();
      });

      card.querySelector('.default-model-sel')?.addEventListener('change', e => {
        provider.defaultModel = e.target.value;
        Store.upsertProvider(provider);
        updateBadge();
      });

      list.appendChild(card);
      framework.translateElements(card.querySelectorAll('*'));
    });
  }

  function openEditor(provider) {
    return new Promise(resolve => {
      const isNew = !provider;

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = `
        <h2>${isNew ? 'Add Provider' : 'Edit Provider'}</h2>
        <div class="form-group">
          <label>Name *</label>
          <input id="prov-name" type="text" placeholder="My Provider" value="${Components.escHtml(provider?.name || '')}">
        </div>
        <div class="form-group">
          <label>Base URL *</label>
          <input id="prov-url" type="text" placeholder="https://api.example.com/v1" value="${Components.escHtml(provider?.baseUrl || '')}">
        </div>
        <div class="form-group">
          <label>API Key</label>
          <input id="prov-key" type="password" placeholder="sk-..." value="${Components.escHtml(provider?.apiKey || '')}">
        </div>
        <div class="form-group">
          <label>Default Model</label>
          <input id="prov-model" type="text" placeholder="auto-detected or manual" value="${Components.escHtml(provider?.defaultModel || '')}">
        </div>
        <div id="prov-status" style="font-size:13px;color:var(--text2);min-height:20px;margin-top:4px;display:flex;align-items:center;gap:8px"></div>
        <div id="prov-error" style="color:var(--red);font-size:13px;min-height:18px;margin-top:4px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-secondary" id="prov-cancel">${framework.translate('Cancel')}</button>
          <button class="btn btn-primary" id="prov-save">${isNew ? framework.translate('Create') : framework.translate('Save')}</button>
        </div>`;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      function close() { overlay.remove(); resolve(); }

      modal.querySelector('#prov-cancel').addEventListener('click', close);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

      modal.querySelector('#prov-save').addEventListener('click', async () => {
        const name = modal.querySelector('#prov-name').value.trim();
        const baseUrl = modal.querySelector('#prov-url').value.trim().replace(/\/$/, '');
        const apiKey = modal.querySelector('#prov-key').value.trim();
        const defaultModel = modal.querySelector('#prov-model').value.trim() || provider?.defaultModel || ''
        const errEl = modal.querySelector('#prov-error');
        const statusEl = modal.querySelector('#prov-status');
        if (!name || !baseUrl) {
          errEl.textContent = 'Name and URL are required.';
          return;
        }
        errEl.textContent = '';

        const saveBtn = modal.querySelector('#prov-save');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Detecting...';

        let detectedType = provider?.endpointType || 'openai';

        if (isNew || baseUrl !== provider?.baseUrl || apiKey !== provider?.apiKey) {
          statusEl.innerHTML = '<span style="animation:thinkPulse 1s infinite;color:var(--accent)">⟳</span> Probing endpoint type...';
          try {
            detectedType = await API.detectEndpointType(baseUrl, apiKey, defaultModel);
            statusEl.innerHTML = `<span style="color:${endpointColor(detectedType)}">●</span> Detected: <strong style="color:var(--text)">${endpointLabel(detectedType)}</strong>`;
          } catch {
            statusEl.innerHTML = `<span style="color:var(--yellow)">⚠</span> ${framework.translate('Detection failed, defaulting to OpenAI')}`;
            detectedType = 'openai';
          }
        }

        const updated = {
          id: provider?.id || Store.newId(),
          name,
          baseUrl,
          apiKey,
          defaultModel,
          type: detectedType,
          endpointType: detectedType,
          fetchedModels: provider?.fetchedModels || [],
        };

        Store.upsertProvider(updated);
        if (isNew) Store.setActiveProviderId(updated.id);

        saveBtn.textContent = 'Fetching models...';
        try {
          const models = await API.fetchModels(updated);
          if (models.length > 0) {
            updated.fetchedModels = models;
            if (!updated.defaultModel) updated.defaultModel = models.length > 0 ? (models[0].id || models[0]) : '';
            Store.upsertProvider(updated);
          }
        } catch {}

        renderList();
        updateBadge();
        Components.toast(isNew ? `Provider added (${endpointLabel(detectedType)})` : 'Provider saved', 'success');
        close();
      });

      modal.querySelector('#prov-name').focus();
    });
  }

  function buildSettingsSection() {
    const section = document.createElement('div');
    section.style.cssText = 'margin-top:24px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px;';
    const settings = Store.getSettings();
    section.innerHTML = `
      <form>
      <h2 style="font-size:15px;margin-bottom:16px">Global Settings</h2>
      <div style="display:grid;grid-template-columns:1fr;gap:14px;">
        <div class="form-group" style="margin:0">
          <label>Temperature (0–2)</label>
          <input id="set-temp" name="temperature" type="range" min="-0.1" max="2" step="0.1" value="${settings.temperature === undefined ? -0.1 : settings.temperature}" style="width:100%;padding:10px 12px;"><output>${settings.temperature === undefined ? framework.translate('No value') : settings.temperature}</output>
        </div>
        <div class="form-group" style="margin:0">
          <label>Coding Temperature</label>
          <input id="set-coding-temp" name="codingTemperature" type="range" min="-0.1" max="2" step="0.1" value="${settings.codingTemperature === undefined ? -0.1 : settings.codingTemperature}" style="width:100%;padding:10px 12px;"><output>${settings.codingTemperature === undefined ? framework.translate('No value') : settings.codingTemperature}</output>
        </div>
        <div class="form-group" style="margin:0">
          <label>Max Tokens</label>
          <input id="set-maxtok" name="maxTokens" type="range" min="0" max="16384" step="32" value="${settings.maxTokens || 0}" style="width:100%;padding:10px 12px;"><output>${settings.maxTokens ? settings.maxTokens : framework.translate('Unlimited')}</output>
        </div>
        <div class="form-group" style="margin:0">
          <label>Max Retries</label>
          <input id="set-maxret" name="maxRetries" type="range" min="0" max="10" step="1" value="${settings.maxRetries}" style="width:100%;padding:10px 12px;"><output>${settings.maxRetries || 0}</output>
        </div>
        <div class="form-group" style="margin:0">
          <label>Reasoning Effort</label>
          <input id="set-reasoning-none" type="radio" name="reasoningEffort" value="" ${!settings.reasoningEffort ? 'checked' : ''}>
          <label for="set-reasoning-none" class="radio-label">Default</label>
          <input id="set-reasoning-low" type="radio" name="reasoningEffort" value="low" ${settings.reasoningEffort === 'low' ? 'checked' : ''}>
          <label for="set-reasoning-low" class="radio-label">Low</label>
          <input id="set-reasoning-medium" type="radio" name="reasoningEffort" value="medium" ${settings.reasoningEffort === 'medium' ? 'checked' : ''}>
          <label for="set-reasoning-medium" class="radio-label">Medium</label>
          <input id="set-reasoning-high" type="radio" name="reasoningEffort" value="high" ${settings.reasoningEffort === 'high' ? 'checked' : ''}>
          <label for="set-reasoning-high" class="radio-label">High</label>
        </div>
      </div>
      <div style="margin-top:14px;display: flex;flex-direction: row;">
        <button type="button" class="btn btn-secondary" id="reset-settings-btn" style="margin-right:8px">Reset</button>
        <button type="submit" class="btn btn-primary" id="save-settings-btn" style="width:100%">Save Settings</button>
      </div>
      </form>`;
    section.querySelectorAll('input[type="range"]').forEach(input => {
      const output = input.nextElementSibling;
      input.addEventListener('input', () => {
        if(['temperature', 'codingTemperature'].includes(input.name) && parseFloat(input.value) < 0) {
          output.value = framework.translate('No value');
        } else if (input.name === 'maxTokens' && parseInt(input.value) === 0) {
          output.value = framework.translate('Unlimited');
          return;
        } else {
          output.value = input.value; 
        }
      });
    });
    section.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const settings = Object.fromEntries(new FormData(form));
      settings.temperature = parseFloat(settings.temperature);
      if (settings.temperature < 0) delete settings.temperature;
      settings.codingTemperature = parseFloat(settings.codingTemperature);
      if (settings.codingTemperature < 0) delete settings.codingTemperature;
      settings.maxTokens = parseInt(settings.maxTokens);
      if (settings.maxTokens === 0) delete settings.maxTokens;
      settings.maxRetries = parseInt(settings.maxRetries);
      Store.updateSettings(settings);
      Components.toast('Settings saved', 'success');
    });
    section.querySelector('#reset-settings-btn').addEventListener('click', () => {
      Store.deleteSettings();
      const newSection = buildSettingsSection();
      section.replaceWith(newSection);
      framework.translateElements(newSection.querySelectorAll('*'));
      Components.toast('Settings reset', 'success');
    });
    return section;
  }

  function buildMCPSection() {
    const section = document.createElement('div');
    section.style.cssText = 'margin-top:24px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px;';
    section.innerHTML = `
      <h2 style="font-size:15px;margin-bottom:16px">MCP Servers</h2>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button type="button" class="btn btn-secondary btn-sm" id="add-mcp-server-btn">+ Add Server</button>
        <button type="button" class="btn btn-secondary btn-sm" id="refresh-mcp-tools-btn">Refresh Tools</button>
      </div>
      <div id="mcp-servers-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px"></div>
      <h3 style="font-size:13px;color:var(--text2);margin-bottom:8px">MCP Tools</h3>
      <div id="mcp-tools-list" style="display:flex;flex-direction:column;gap:10px"></div>`;

    section.querySelector('#add-mcp-server-btn')?.addEventListener('click', () => showAddMCPServerDialog(section));
    section.querySelector('#refresh-mcp-tools-btn')?.addEventListener('click', () => refreshMCPTools(section));

    renderMCPServers(section);
    renderMCPTools(section);
    refreshMCPTools(section);
    return section;
  }

  function renderMCPServers(section) {
    const container = section.querySelector('#mcp-servers-list');
    if (!container) return;

    if (!mcpClient) {
      container.innerHTML = '<div style="font-size:12px;color:var(--text2)">MCP client not available.</div>';
      return;
    }

    if (mcpClient.servers.length === 0) {
      container.innerHTML = '<div style="font-size:12px;color:var(--text2)">No MCP servers configured.</div>';
      return;
    }

    container.innerHTML = mcpClient.servers.map((server, index) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg3)">
        <input type="checkbox" class="tool-checkbox" id="mcp-server-${index}" data-server-id="${Components.escHtml(server.id)}" ${server.enabled ? 'checked' : ''}>
        <label for="mcp-server-${index}" style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600" class="notranslate">${Components.escHtml(server.name)}</div>
          <div style="font-size:11px;color:var(--text2);word-break:break-all" class="notranslate">${Components.escHtml(server.url)}</div>
        </label>
        <button type="button" class="btn btn-danger btn-sm" data-server-remove="${Components.escHtml(server.id)}">Remove</button>
      </div>
    `).join('');

    mcpClient.servers.forEach(server => {
      container.querySelector(`input[data-server-id="${server.id}"]`)?.addEventListener('change', () => {
        mcpClient.toggleServer(server.id);
        renderMCPServers(section);
        renderMCPTools(section);
      });
      container.querySelector(`[data-server-remove="${server.id}"]`)?.addEventListener('click', async () => {
        const ok = await Components.confirm(`Remove MCP server "${server.name}"?`);
        if (!ok) return;
        mcpClient.removeServer(server.id);
        renderMCPServers(section);
        renderMCPTools(section);
      });
    });
  }

  function renderMCPTools(section) {
    const container = section.querySelector('#mcp-tools-list');
    if (!container) return;

    if (!mcpClient) {
      container.innerHTML = '<div style="font-size:12px;color:var(--text2)">MCP client not available.</div>';
      return;
    }

    const tools = mcpClient.getAllTools();
    if (tools.length === 0) {
      container.innerHTML = '<div style="font-size:12px;color:var(--text2)">No tools available. Refresh after adding servers.</div>';
      return;
    }

    const toolsByServer = {};
    tools.forEach(tool => {
      if (!toolsByServer[tool.serverName]) toolsByServer[tool.serverName] = [];
      toolsByServer[tool.serverName].push(tool);
    });

    container.innerHTML = Object.entries(toolsByServer).map(([serverName, serverTools]) => `
      <div style="border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--bg3)">
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px" class="notranslate">${Components.escHtml(serverName)}</div>
        ${serverTools.map(tool => `
          <label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px">
            <input type="checkbox" class="tool-checkbox" data-tool-id="${Components.escHtml(tool.toolId)}" ${mcpClient.isToolSelected(tool.toolId) ? 'checked' : ''}>
            <span style="min-width:0">
              <span style="font-size:13px;display:block" class="notranslate">${Components.escHtml(tool.name)}</span>
              ${tool.description ? `<span style="font-size:11px;color:var(--text2);display:block" class="notranslate">${Components.escHtml(tool.description)}</span>` : ''}
            </span>
          </label>
        `).join('')}
      </div>
    `).join('');

    container.querySelectorAll('input[data-tool-id]').forEach(input => {
      input.addEventListener('change', () => {
        mcpClient.toggleToolSelection(input.dataset.toolId);
      });
    });
  }

  function showAddMCPServerDialog(section) {
    if (!mcpClient) {
      Components.toast('MCP client not available', 'error');
      return;
    }

    const name = window.prompt('Enter MCP server name:');
    if (!name) return;
    const url = window.prompt('Enter MCP server URL (e.g., https://mcp.g4f.space):');
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        Components.toast('Please enter a valid MCP server URL using http or https.', 'error');
        return;
      }
    } catch {
      Components.toast('Please enter a valid MCP server URL.', 'error');
      return;
    }

    try {
      mcpClient.addServer({ name, url });
      renderMCPServers(section);
      refreshMCPTools(section);
    } catch (err) {
      Components.toast(`Error adding server: ${err.message}`, 'error');
    }
  }

  async function refreshMCPTools(section) {
    if (!mcpClient) return;

    const button = section.querySelector('#refresh-mcp-tools-btn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Refreshing...';
    }

    try {
      await mcpClient.fetchAllTools();
      renderMCPTools(section);
    } catch (err) {
      Components.toast(`Error refreshing tools. Check your network/server configuration: ${err.message}`, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Refresh Tools';
      }
    }
  }

  function updateBadge() {
    const badge = document.getElementById('active-provider-badge');
    if (!badge) return;
    const p = Store.getActiveProvider();
    badge.textContent = p ? `${p.name} · ${p.defaultModel || '?'}` : 'No provider';
  }

  return { render, updateBadge, renderList };
})();
