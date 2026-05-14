const RoleplayPage = (() => {
  let currentChatId = null;
  let currentPersonaId = null;
  let currentModel = null;
  let isStreaming = false;
  let abortController = null;

  function render(container) {
    Components.injectStyles();
    container.innerHTML = '';

    const layout = document.createElement('div');
    layout.className = 'split-layout';

    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    backdrop.id = 'rp-sidebar-backdrop';
    backdrop.addEventListener('click', closeSidebar);

    layout.appendChild(backdrop);
    layout.appendChild(buildSidebar());
    layout.appendChild(buildMain());
    container.appendChild(layout);

    Store.getChats().then(chats => {
      const roleplayChats = chats.filter(c => c.type === 'roleplay');
      if (roleplayChats.length > 0) loadChat(roleplayChats[0].id);
      else newChat();
    });
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('rp-sidebar');
    const backdrop = document.getElementById('rp-sidebar-backdrop');
    sidebar?.classList.toggle('open');
    backdrop?.classList.toggle('open');
  }

  function closeSidebar() {
    const sidebar = document.getElementById('rp-sidebar');
    const backdrop = document.getElementById('rp-sidebar-backdrop');
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('open');
  }

  function buildSidebar() {
    const sidebar = document.createElement('div');
    sidebar.className = 'sidebar';
    sidebar.id = 'rp-sidebar';
    sidebar.innerHTML = `
      <div class="sidebar-header">
        <h3>Roleplay</h3>
        <button class="btn btn-primary btn-sm" id="rp-new-btn">+ New</button>
      </div>
      <div class="sidebar-list" id="rp-list"></div>`;
    sidebar.querySelector('#rp-new-btn').addEventListener('click', newChat);
    refreshSidebar(sidebar);
    return sidebar;
  }

  function refreshSidebar(sidebar) {
    const list = (sidebar || document.getElementById('rp-sidebar'))?.querySelector('#rp-list');
    if (!list) return;
    list.innerHTML = '';
    Store.getChats().then(chats => {
      const roleplayChats = chats.filter(c => c.type === 'roleplay');
      if (roleplayChats.length === 0) {
        list.innerHTML = '<div style="padding:16px;color:var(--text2);font-size:13px">No roleplay sessions yet</div>';
        return;
      }
      roleplayChats.forEach(chat => {
        const persona = chat.personaId ? Store.getPersonas().find(p => p.id === chat.personaId) : null;
        const item = document.createElement('div');
        item.className = 'sidebar-item' + (chat.id === currentChatId ? ' active' : '');
        item.innerHTML = `
          <div style="flex:1;min-width:0">
          <div class="item-title">${Components.escHtml(chat.title || framework.translate('Untitled'))}</div>
          <div class="item-sub">${persona ? Components.escHtml(persona.name) : framework.translate('No persona')} · ${chat.count} ${Components.escHtml(framework.translate('messages'))}</div>
        </div>
        <button class="item-del" title="Delete">✕</button>`;
        item.addEventListener('click', e => {
          if (e.target.classList.contains('item-del')) deleteChat(chat.id);
          else { loadChat(chat.id); closeSidebar(); }
        });
        list.appendChild(item);
      });
    });
  }

  function buildMain() {
    const main = document.createElement('div');
    main.className = 'split-main';
    main.id = 'rp-main';

    const toolbar = document.createElement('div');
    toolbar.className = 'chat-toolbar';
    toolbar.id = 'rp-toolbar';

    const sidebarBtn = document.createElement('button');
    sidebarBtn.className = 'sidebar-toggle';
    sidebarBtn.innerHTML = '☰';
    sidebarBtn.addEventListener('click', toggleSidebar);

    const titleInput = document.createElement('input');
    titleInput.className = 'title-input';
    titleInput.placeholder = 'Session title...';
    titleInput.addEventListener('change', () => {
      if (!currentChatId) return;
      Store.getChat(currentChatId).then(chat => {
        if (chat) { chat.title = titleInput.value; Store.upsertChat(chat); }
      });
    });

    const personaSel = document.createElement('select');
    personaSel.className = 'model-select';
    personaSel.id = 'rp-persona-sel';
    personaSel.addEventListener('change', () => {
      currentPersonaId = personaSel.value || null;
      applyPersonaToChat();
    });

    const modelSel = Components.modelSelector(Store.getActiveProvider(), currentModel);
    modelSel.addEventListener('change', () => { currentModel = modelSel.value; });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-secondary btn-sm';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', clearMessages);

    toolbar.appendChild(sidebarBtn);
    toolbar.appendChild(titleInput);
    toolbar.appendChild(personaSel);
    toolbar.appendChild(modelSel);
    toolbar.appendChild(clearBtn);

    const messagesWrap = document.createElement('div');
    messagesWrap.className = 'messages-wrap';
    messagesWrap.id = 'rp-messages';

    const inputBar = Components.chatInputBar(sendMessage, { placeholder: 'Say something in character...' });
    inputBar.id = 'rp-input-bar';

    main.appendChild(toolbar);
    main.appendChild(messagesWrap);
    main.appendChild(inputBar);

    refreshPersonaSelector();
    return main;
  }

  function refreshPersonaSelector() {
    const sel = document.getElementById('rp-persona-sel');
    if (!sel) return;
    sel.innerHTML = '<option value="">— No Persona —</option>';
    Store.getPersonas().forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.emoji || '🎭'} ${p.name}`;
      if (p.id === currentPersonaId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function newChat() {
    const id = Store.newId();
    const chat = { id, type: 'roleplay', title: framework.translate('New Session'), items: [], personaId: null, added: Date.now() };
    Store.upsertChat(chat);
    loadChat(id);
  }

  function loadChat(id) {
    currentChatId = id;
    Store.getChat(id).then(chat => {
      if (!chat) return;

      currentPersonaId = chat.personaId || null;
      currentModel = chat.model || Store.getActiveProvider()?.defaultModel;

      const titleInput = document.querySelector('#rp-toolbar .title-input');
      if (titleInput) titleInput.value = chat.title || '';

      refreshPersonaSelector();
      const personaSel = document.getElementById('rp-persona-sel');
      if (personaSel) personaSel.value = currentPersonaId || '';

      const modelSel = document.querySelector('#rp-toolbar .model-select');
      if (modelSel) modelSel.value = currentModel;

      renderMessages(chat.items);
    });
    refreshSidebar();
  }

  function applyPersonaToChat() {
    if (!currentChatId) return;
    Store.getChat(currentChatId).then(chat => {
      if (!chat) return;
      chat.personaId = currentPersonaId;
      chat.items = chat.items.filter(m => m.role !== 'system');
      if (currentPersonaId) {
        const persona = Store.getPersonas().find(p => p.id === currentPersonaId);
        if (persona?.systemPrompt) {
          chat.items.unshift({ id: Store.newId(), role: 'system', content: persona.systemPrompt, ts: Date.now() });
        }
      }
      Store.upsertChat(chat);
      renderMessages(chat.items);
    });
  }

  function renderMessages(messages) {
    const wrap = document.getElementById('rp-messages');
    if (!wrap) return;
    wrap.innerHTML = '';
    const persona = currentPersonaId ? Store.getPersonas().find(p => p.id === currentPersonaId) : null;
    const visible = messages.filter(m => m.role !== 'system');
    if (visible.length === 0) {
      const hint = persona
        ? `<div class="big">${persona.emoji || '🎭'}</div><h2>${Components.escHtml(persona.name)}</h2><p>${Components.escHtml(persona.description || 'Start the roleplay below')}</p>`
        : `<div class="big">🎭</div><h2>Roleplay</h2><p>Select a persona and start chatting</p>`;
      wrap.innerHTML = `<div class="empty-state">${hint}</div>`;
      return;
    }
    visible.forEach(msg => {
      const el = Components.renderMessage(msg, {
        personaName: persona?.name || framework.translate('Assistant'),
        personaEmoji: persona?.emoji || '🤖',
        deletable: true,
      });
      el.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteMessage(msg.id));
      el.querySelector('[data-action="copy"]')?.addEventListener('click', () => Components.copyMessageContent(msg));
      wrap.appendChild(el);
    });
    wrap.scrollTop = wrap.scrollHeight;
  }

  async function sendMessage(text) {
    if (isStreaming || !currentChatId) return;
    const chat = await Store.getChat(currentChatId);
    if (!chat) return;

    const provider = Store.getActiveProvider();
    const settings = Store.getSettings();
    const model = currentModel || provider.defaultModel;

    const persona = currentPersonaId ? Store.getPersonas().find(p => p.id === currentPersonaId) : null;

    if (chat.items.length === 0 && persona?.systemPrompt) {
      chat.items.push({ id: Store.newId(), role: 'system', content: persona.systemPrompt, ts: Date.now() });
    }

    const userMsg = { id: Store.newId(), role: 'user', content: text, ts: Date.now() };
    chat.items.push(userMsg);
    Store.upsertChat(chat);

    const wrap = document.getElementById('rp-messages');
    if (wrap) {
      const emptyState = wrap.querySelector('.empty-state');
      if (emptyState) emptyState.remove();
      const userEl = Components.renderMessage(userMsg, { deletable: true });
      userEl.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteMessage(userMsg.id));
      userEl.querySelector('[data-action="copy"]')?.addEventListener('click', () => Components.copyMessageContent(userMsg));
      wrap.appendChild(userEl);
      wrap.scrollTop = wrap.scrollHeight;
    }

    const inputBar = document.getElementById('rp-input-bar');
    abortController = new AbortController();
    isStreaming = true;
    inputBar?.setStreaming(true, () => { abortController?.abort(); });

    const assistantMsg = { id: Store.newId(), role: 'assistant', content: '', thinking: '', images: [], ts: Date.now() };
    const assistantEl = Components.renderMessage(assistantMsg, {
      personaName: persona?.name || framework.translate('Assistant'),
      personaEmoji: persona?.emoji || '🤖',
    });
    const contentEl = assistantEl.querySelector('.msg-content');
    Components.addTypingIndicator(assistantEl);
    if (wrap) { wrap.appendChild(assistantEl); wrap.scrollTop = wrap.scrollHeight; }

    let typingRemoved = false;

    try {
      let fullContent = '';
      let fullThinking = '';
      const images = [];
      for await (const chunk of API.streamChat(provider, chat.items, model, {
        ...settings,
        signal: abortController.signal,
      })) {
        if (chunk.type === 'thinking') {
          fullThinking += chunk.content;
          Components.updateThinkingBlock(assistantEl, fullThinking);
          if (!assistantEl.querySelector('.thinking-streaming')) {
            const tb = assistantEl.querySelector('.thinking-block');
            if (tb) tb.classList.add('thinking-streaming');
          }
          if (wrap) wrap.scrollTop = wrap.scrollHeight;
        }
        if (chunk.type === 'text') {
          if (!typingRemoved) {
            Components.removeTypingIndicator(assistantEl);
            typingRemoved = true;
          }
          fullContent += chunk.content;
          contentEl.innerHTML = Components.renderMarkdown(fullContent);
          if (wrap) wrap.scrollTop = wrap.scrollHeight;
        }
        if (chunk.type === 'image') {
          if (!typingRemoved) {
            Components.removeTypingIndicator(assistantEl);
            typingRemoved = true;
          }
          images.push({ url: chunk.url, b64: chunk.b64, revisedPrompt: chunk.revisedPrompt });
          const src = chunk.url || (chunk.b64 ? `data:image/png;base64,${chunk.b64}` : '');
          if (src) {
            let imagesContainer = assistantEl.querySelector('.msg-images');
            if (!imagesContainer) {
              imagesContainer = document.createElement('div');
              imagesContainer.className = 'msg-images';
              assistantEl.appendChild(imagesContainer);
            }
            const imgWrap = Components.createImageWithLoader(src, 'Generated image', chunk.revisedPrompt);
            imagesContainer.appendChild(imgWrap);
            if (wrap) wrap.scrollTop = wrap.scrollHeight;
          }
        }
      }

      const extracted = API.extractThinkingFromText(fullContent);
      if (extracted.thinking && !fullThinking) {
        fullThinking = extracted.thinking;
        fullContent = extracted.content;
        Components.updateThinkingBlock(assistantEl, fullThinking);
        contentEl.innerHTML = Components.renderMarkdown(fullContent);
      }

      assistantMsg.content = fullContent;
      assistantMsg.thinking = fullThinking;
      assistantMsg.images = images;
    } catch (err) {
      if (err.name !== 'AbortError') {
        assistantMsg.content = `Error: ${err.message}`;
        contentEl.innerHTML = Components.renderMarkdown(assistantMsg.content);
        Components.toast(err.message, 'error');
      }
    }

    if (!typingRemoved) {
      Components.removeTypingIndicator(assistantEl);
    }

    const streamingBlock = assistantEl.querySelector('.thinking-streaming');
    if (streamingBlock) streamingBlock.classList.remove('thinking-streaming');

    assistantEl.querySelector('[data-action="copy"]')?.addEventListener('click', () => Components.copyMessageContent(assistantMsg));

    chat.items.push(assistantMsg);
    if (chat.title === 'New Session' && chat.items.filter(m => m.role !== 'system').length === 2) {
      chat.title = (persona ? persona.name + ': ' : '') + text.slice(0, 32) + (text.length > 32 ? '…' : '');
      const titleInput = document.querySelector('#rp-toolbar .title-input');
      if (titleInput) titleInput.value = chat.title;
    }
    Store.upsertChat(chat);
    refreshSidebar();

    isStreaming = false;
    abortController = null;
    inputBar?.setStreaming(false);
  }

  function deleteMessage(msgId) {
    if (!currentChatId) return;
    Store.getChat(currentChatId).then(chat => {
      if (!chat) return;
      chat.items = chat.items.filter(m => m.id !== msgId);
      Store.upsertChat(chat);
      renderMessages(chat.items);
    });
  }

  function clearMessages() {
    if (!currentChatId) return;
    Store.getChat(currentChatId).then(chat => {
      if (!chat) return;
      chat.items = [];
      Store.upsertChat(chat);
      renderMessages([]);
    });
  }

  async function deleteChat(id) {
    const ok = await Components.confirm(framework.translate('Are you sure you want to delete this session?'));
    if (!ok) return;
    Store.deleteChat(id);
    if (currentChatId === id) {
      Store.getChats().then(chats => {
        const remaining = chats.filter(c => c.type === 'roleplay');
        if (remaining.length > 0) loadChat(remaining[0].id);
        else newChat();
      });
    } else {
      refreshSidebar();
    }
  }

  return { render };
})();
