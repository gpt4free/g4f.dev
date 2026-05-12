const PersonasPage = (() => {

  function render(container) {
    Components.injectStyles();
    injectPersonaStyles();
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'padding:16px 16px 0;flex-shrink:0;';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <h1 style="font-size:18px;flex:1">Personas</h1>
        <button class="btn btn-primary" id="new-persona-btn">+ New Persona</button>
      </div>`;

    header.querySelector('#new-persona-btn').addEventListener('click', () => openEditor(null));

    const content = document.createElement('div');
    content.id = 'personas-content';
    content.style.cssText = 'flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;';

    wrap.appendChild(header);
    wrap.appendChild(content);
    container.appendChild(wrap);

    renderPersonas(content);
  }

  function renderPersonas(content) {
    const personas = Store.getPersonas();
    content.innerHTML = '';

    if (personas.length === 0) {
      content.innerHTML = `<div style="text-align:center;padding:48px 16px;color:var(--text2)">
        <div style="font-size:48px;margin-bottom:12px">🎭</div>
        <h2 style="color:var(--text);margin-bottom:8px">No personas yet</h2>
        <p>Create a persona to use in roleplay chats</p>
      </div>`;
      return;
    }

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr;gap:12px;';
    personas.forEach(persona => grid.appendChild(buildCard(persona)));
    content.appendChild(grid);
  }

  function buildCard(persona) {
    const card = document.createElement('div');
    card.className = 'persona-card';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <span style="font-size:32px">${persona.emoji || '🎭'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:15px">${Components.escHtml(persona.name)}</div>
          ${persona.tags?.length ? `<div style="font-size:12px;color:var(--text2)">${Components.escHtml(persona.tags.slice(0, 3).join(', '))}</div>` : ''}
        </div>
      </div>
      <p style="font-size:13px;color:var(--text2);line-height:1.5;flex:1;margin-bottom:12px">${Components.escHtml((persona.description || '').slice(0, 100))}${(persona.description || '').length > 100 ? '…' : ''}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" data-action="edit">Edit</button>
        <button class="btn btn-secondary btn-sm" data-action="use">Use in Roleplay</button>
        <button class="btn btn-danger btn-sm" data-action="delete" style="margin-left:auto">✕</button>
      </div>`;

    card.querySelector('[data-action="edit"]').addEventListener('click', () => openEditor(persona));
    card.querySelector('[data-action="use"]').addEventListener('click', () => {
      window.location.hash = '#/roleplay';
      setTimeout(() => {
        const sel = document.getElementById('rp-persona-sel');
        if (sel) { sel.value = persona.id; sel.dispatchEvent(new Event('change')); }
      }, 200);
    });
    card.querySelector('[data-action="delete"]').addEventListener('click', () => deletePersona(persona.id));

    return card;
  }

  function openEditor(persona) {
    return new Promise(resolve => {
      const isNew = !persona;

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = `
        <h2>${isNew ? 'New Persona' : 'Edit Persona'}</h2>
        <div class="modal-body">
          <div style="display:flex;gap:12px">
            <div class="form-group" style="width:80px;flex-shrink:0">
              <label>Emoji</label>
              <input id="pe-emoji" type="text" value="${Components.escHtml(persona?.emoji || '🎭')}" style="width:100%;padding:10px;text-align:center;font-size:20px">
            </div>
            <div class="form-group" style="flex:1">
              <label>Name *</label>
              <input id="pe-name" type="text" placeholder="e.g. Aria the Wizard" value="${Components.escHtml(persona?.name || '')}">
            </div>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea id="pe-desc" placeholder="Short description shown on the card">${Components.escHtml(persona?.description || '')}</textarea>
          </div>
          <div class="form-group">
            <label>System Prompt</label>
            <textarea id="pe-system" style="min-height:120px" placeholder="You are Aria, a wise and mysterious wizard...">${Components.escHtml(persona?.systemPrompt || '')}</textarea>
          </div>
          <div class="form-group">
            <label>Tags (comma separated)</label>
            <input id="pe-tags" type="text" placeholder="fantasy, wizard, helpful" value="${Components.escHtml(persona?.tags?.join(', ') || '')}">
          </div>
          <div id="pe-error" style="color:var(--red);font-size:13px;min-height:18px;margin-top:4px"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-secondary" id="pe-cancel">${framework.translate('Cancel')}</button>
          <button class="btn btn-primary" id="pe-save">${isNew ? framework.translate('Create') : framework.translate('Save')}</button>
        </div>`;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const beforeUnload = e => { e.preventDefault(); e.returnValue = ''; };
      window.addEventListener('beforeunload', beforeUnload);

      function close() {
        window.removeEventListener('beforeunload', beforeUnload);
        overlay.remove();
        resolve();
      }

      modal.querySelector('#pe-cancel').addEventListener('click', close);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

      modal.querySelector('#pe-save').addEventListener('click', () => {
        const nameEl = modal.querySelector('#pe-name');
        const name = nameEl?.value?.trim();
        const errEl = modal.querySelector('#pe-error');
        if (!name) {
          errEl.textContent = 'Name is required.';
          nameEl?.focus();
          return;
        }
        errEl.textContent = '';

        const updated = {
          id: persona?.id || Store.newId(),
          emoji: modal.querySelector('#pe-emoji')?.value?.trim() || '🎭',
          name,
          description: modal.querySelector('#pe-desc')?.value?.trim() || '',
          systemPrompt: modal.querySelector('#pe-system')?.value?.trim() || '',
          tags: modal.querySelector('#pe-tags')?.value?.split(',').map(t => t.trim()).filter(Boolean) || [],
          createdAt: persona?.createdAt || Date.now(),
        };

        Store.upsertPersona(updated);
        Components.toast(isNew ? framework.translate('Persona created') : framework.translate('Persona saved'), 'success');
        const content = document.getElementById('personas-content');
        if (content) renderPersonas(content);
        close();
      });

      modal.querySelector('#pe-name').focus();
    });
  }

  async function deletePersona(id) {
    const ok = await Components.confirm(framework.translate('Are you sure you want to delete this persona?'));
    if (!ok) return;
    Store.deletePersona(id);
    const content = document.getElementById('personas-content');
    if (content) renderPersonas(content);
  }

  function injectPersonaStyles() {
    if (document.getElementById('persona-css')) return;
    const style = document.createElement('style');
    style.id = 'persona-css';
    style.textContent = `
      .persona-card { background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px;display:flex;flex-direction:column;transition:border-color 0.15s; }
      .persona-card:active { border-color:var(--accent); }
      @media (min-width: 768px) {
        #personas-content > div { grid-template-columns:repeat(auto-fill,minmax(260px,1fr)) !important; }
        .persona-card:hover { border-color:var(--accent); }
      }
    `;
    document.head.appendChild(style);
  }

  return { render };
})();
