const ProvidersPage = (() => {
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
    resetBtn.textContent = framework.translate('Reset');
    resetBtn.addEventListener('click', () => Store.loadProviders());
    btnWrap.appendChild(resetBtn);
    const newBtn = document.createElement('button');
    newBtn.className = 'btn btn-primary btn-sm';
    newBtn.textContent = framework.translate('+ Add');
    newBtn.addEventListener('click', () => openEditor(null));
    btnWrap.appendChild(newBtn);
    header.appendChild(btnWrap);

    const hint = document.createElement('p');
    hint.style.cssText = 'color:var(--text2);font-size:13px;margin-bottom:20px;line-height:1.5;';
    hint.textContent = framework.translate('Add any provider — OpenAI, Anthropic, Google, or compatible APIs. The endpoint type is auto-detected.');

    const list = document.createElement('div');
    list.id = 'providers-list';
    list.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

    const settingsSection = buildSettingsSection();

    wrap.appendChild(header);
    wrap.appendChild(hint);
    wrap.appendChild(list);
    wrap.appendChild(settingsSection);
    container.appendChild(wrap);

    renderList();
    updateBadge();
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
            ${provider.fetchedModels.map(m => `<option value="${Components.escHtml(m)}" ${m === provider.defaultModel ? 'selected' : ''}>${Components.escHtml(m)}</option>`).join('')}
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
            if (!updated.defaultModel) updated.defaultModel = models[0];
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
          <input id="set-temp" name="temperature" type="range" min="0" max="2" step="0.1" value="${settings.temperature}" style="width:100%;padding:10px 12px;"><output>${settings.temperature}</output>
        </div>
        <div class="form-group" style="margin:0">
          <label>Max Tokens</label>
          <input id="set-maxtok" name="maxTokens" type="range" min="64" max="32000" step="64" value="${settings.maxTokens}" style="width:100%;padding:10px 12px;"><output>${settings.maxTokens}</output>
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
      <div style="margin-top:14px">
        <button type="submit" class="btn btn-primary" id="save-settings-btn" style="width:100%">Save Settings</button>
      </div>
      </form>`;
    section.querySelectorAll('input[type="range"]').forEach(input => {
      const output = input.nextElementSibling;
      input.addEventListener('input', () => {
        output.value = input.value;
      });
    });
    section.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const settings = Object.fromEntries(new FormData(form));
      settings.temperature = parseFloat(settings.temperature);
      settings.maxTokens = parseInt(settings.maxTokens);
      settings.maxRetries = parseInt(settings.maxRetries);
      Store.updateSettings(settings);
      Components.toast('Settings saved', 'success');
    });
    return section;
  }

  function updateBadge() {
    const badge = document.getElementById('active-provider-badge');
    if (!badge) return;
    const p = Store.getActiveProvider();
    badge.textContent = p ? `${p.name} · ${p.defaultModel || '?'}` : 'No provider';
  }

  return { render, updateBadge, renderList };
})();
