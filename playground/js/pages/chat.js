const ChatPage = (() => {
  let currentChatId = null;
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
    backdrop.id = 'chat-sidebar-backdrop';
    backdrop.addEventListener('click', closeSidebar);

    const sidebar = buildSidebar();
    const main = buildMain();

    layout.appendChild(backdrop);
    layout.appendChild(sidebar);
    layout.appendChild(main);
    container.appendChild(layout);

    Store.getLastChat().then(lastChat => {
      if (lastChat) {
        loadChat(lastChat.id);
      } else {
        newChat();
      }
    });
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('chat-sidebar');
    const backdrop = document.getElementById('chat-sidebar-backdrop');
    sidebar?.classList.toggle('open');
    backdrop?.classList.toggle('open');
  }

  function closeSidebar() {
    const sidebar = document.getElementById('chat-sidebar');
    const backdrop = document.getElementById('chat-sidebar-backdrop');
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('open');
  }

  function buildSidebar() {
    const sidebar = document.createElement('div');
    sidebar.className = 'sidebar';
    sidebar.id = 'chat-sidebar';
    sidebar.innerHTML = `
      <div class="sidebar-header">
        <h3>Chats</h3>
        <button class="btn btn-primary btn-sm" id="new-chat-btn">+ New</button>
      </div>
      <div class="sidebar-list" id="chat-list"></div>`;
    sidebar.querySelector('#new-chat-btn').addEventListener('click', newChat);
    refreshSidebar(sidebar);
    return sidebar;
  }

  function refreshSidebar(sidebar) {
    const list = (sidebar || document.getElementById('chat-sidebar'))?.querySelector('#chat-list');
    if (!list) return;
    list.innerHTML = '';
    Store.getChats().then(chats => {
      const chatList = chats.filter(c => c.type === 'chat');
      if (chatList.length === 0) {
        list.innerHTML = '<div style="padding:16px;color:var(--text2);font-size:13px">No chats yet</div>';
        return;
      }
      chatList.forEach(chat => {
        const item = document.createElement('div');
        item.className = 'sidebar-item' + (chat.id === currentChatId ? ' active' : '');
        item.dataset.id = chat.id;
        item.innerHTML = `
          <div style="flex:1;min-width:0">
            <div class="item-title">${Components.escHtml(chat.title || 'Untitled')}</div>
            <div class="item-sub">${chat.count} ${Components.escHtml(framework.translate('messages'))}</div>
          </div>
          <button class="item-del" title="Delete">✕</button>`;
        item.addEventListener('click', e => {
          if (e.target.classList.contains('item-del')) {
            deleteChat(chat.id);
          } else {
            loadChat(chat.id);
            closeSidebar();
          }
        });
        list.appendChild(item);
      });
    });
  }

  function buildMain() {
    const main = document.createElement('div');
    main.className = 'split-main';
    main.id = 'chat-main';

    const toolbar = document.createElement('div');
    toolbar.className = 'chat-toolbar';
    toolbar.id = 'chat-toolbar';

    const sidebarBtn = document.createElement('button');
    sidebarBtn.className = 'sidebar-toggle';
    sidebarBtn.innerHTML = '☰';
    sidebarBtn.addEventListener('click', toggleSidebar);

    const titleInput = document.createElement('input');
    titleInput.className = 'title-input';
    titleInput.placeholder = 'Chat title...';
    titleInput.addEventListener('change', () => {
      if (!currentChatId) return;
      Store.getChat(currentChatId).then(chat => {
        if (chat) { chat.title = titleInput.value; Store.upsertChat(chat); }
      });
    });

    const modelSel = Components.modelSelector(Store.getActiveProvider(), currentModel);
    modelSel.addEventListener('change', () => {
      currentModel = modelSel.value;
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-secondary btn-sm';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', clearMessages);

    toolbar.appendChild(sidebarBtn);
    toolbar.appendChild(titleInput);
    toolbar.appendChild(modelSel);
    toolbar.appendChild(clearBtn);

    const messagesWrap = document.createElement('div');
    messagesWrap.className = 'messages-wrap';
    messagesWrap.id = 'chat-messages';

    const inputBar = Components.chatInputBar(sendMessage);
    inputBar.id = 'chat-input-bar';

    main.appendChild(toolbar);
    main.appendChild(messagesWrap);
    main.appendChild(inputBar);

    return main;
  }

  function newChat() {
    const id = Store.newId();
    const chat = { id, type: 'chat', title: framework.translate('New Chat'), items: [], createdAt: Date.now() };
    Store.upsertChat(chat);
    loadChat(id);
  }

  function loadChat(id) {
    currentChatId = id;
    Store.getChat(id).then(chat => {
      console.log('Loaded chat:', chat);
      if (!chat) return;
      const sendBtn = document.querySelector('.input-bar .send-btn');
      if (sendBtn) {
        if (chat.items.some(m => m.role === 'user')) {
          sendBtn.textContent = sendBtn.dataset.label;
          sendBtn.disabled = true;
        } else {
          sendBtn.textContent = framework.translate('Regenerate');
          sendBtn.disabled = false;
        }
      }

      const modelSel = document.querySelector('#chat-toolbar .model-select');
      if (modelSel) {
        currentModel = chat.model || Store.getActiveProvider()?.defaultModel;
        modelSel.value = currentModel;
      }

      const titleInput = document.querySelector('#chat-toolbar .title-input');
      if (titleInput) titleInput.value = chat.title || '';
      renderMessages(chat.items || chat.items || []);
    });
    refreshSidebar();
  }

  function renderMessages(messages) {
    const wrap = document.getElementById('chat-messages');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!messages || messages.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">💬</div><h2>Start a conversation</h2><p>Type a message below to begin</p></div>`;
      framework.translateElements(wrap.querySelectorAll('*'));
      return;
    }
    messages.forEach(msg => {
      if (msg.role === 'system') return;
      const el = Components.renderMessage(msg, { editable: false, deletable: true });
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

    let userMsg = null;
    if (text) {
      userMsg = { id: Store.newId(), role: 'user', content: text, ts: Date.now() };
      chat.items.push(userMsg);
      Store.upsertChat(chat);
    }

    const wrap = document.getElementById('chat-messages');
    if (wrap && userMsg) {
      const emptyState = wrap.querySelector('.empty-state');
      if (emptyState) emptyState.remove();
      const userEl = Components.renderMessage(userMsg, { deletable: true });
      userEl.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteMessage(userMsg.id));
      userEl.querySelector('[data-action="copy"]')?.addEventListener('click', () => Components.copyMessageContent(userMsg));
      wrap.appendChild(userEl);
      wrap.scrollTop = wrap.scrollHeight;
    }

    const inputBar = document.getElementById('chat-input-bar');
    abortController = null;
    isStreaming = true;
    inputBar?.setStreaming(true, () => { abortController?.abort(); });

    const assistantMsg = { id: Store.newId(), role: 'assistant', content: '', thinking: '', images: [], ts: Date.now() };
    const assistantEl = Components.renderMessage(assistantMsg, {});
    const contentEl = assistantEl.querySelector('.msg-content');
    const thinkingBlock = assistantEl.querySelector('.thinking-block');
    if (thinkingBlock) thinkingBlock.classList.add('thinking-streaming');
    Components.addTypingIndicator(assistantEl);
    if (wrap) { wrap.appendChild(assistantEl); wrap.scrollTop = wrap.scrollHeight; }

    let typingRemoved = false;
    let collectedToolCalls = {};

    try {
      let fullContent = '';
      let fullThinking = '';
      const images = [];
      let messages = [...chat.items];
      let doStreamChat = true;
      const selectedTools = API.getSelectedMCPToolsForAPI();
      while (doStreamChat) {
        doStreamChat = false;
        abortController = new AbortController();
        for await (const chunk of API.streamChat(provider, messages, model, {
          ...settings,
          tools: selectedTools,
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
          if (chunk.type === 'tool_calls') {
            API.mergeToolCalls(collectedToolCalls, chunk.tool_calls);
            continue;
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

        const toolCalls = Object.values(collectedToolCalls);
        if (toolCalls.length > 0) {
          collectedToolCalls = {};
          fullContent += Components.formatToolCalls(toolCalls);
          try {
            const toolResults = await API.executeToolCalls(toolCalls);
            const resultsText = toolResults.map(result => `\n\n✅ **Tool Result:** \`${result.name}\`\n\`\`\`json\n${JSON.stringify(JSON.parse(result.content), null, 2)}\n\`\`\``).join('\n\n');
            fullContent += resultsText;
            messages = [...messages, {
                role: 'assistant',
                content: '',
                tool_calls: toolCalls
            }, ...toolResults];
            doStreamChat = true;
          } catch (err) {
            fullContent += `\n\n❌ **Tool Execution Error:** ${err?.message || String(err)}`;
          }
          contentEl.innerHTML = Components.renderMarkdown(fullContent);
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
      console.error('Streaming error:', err);
      if (err.name !== 'AbortError') {
        assistantMsg.error = true;
        assistantMsg.content = `*${framework.translate('Error')}*: ${err.message}`;
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
    if (chat.title === framework.translate('New Chat') && chat.items.length <= 2) {
      chat.title = text.slice(0, 40) + (text.length > 40 ? '…' : '');
      const titleInput = document.querySelector('#chat-toolbar .title-input');
      if (titleInput) titleInput.value = chat.title;
    }
    chat.items.push(assistantMsg);
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
        const remaining = chats.filter(c => c.type === 'chat');
        if (remaining.length > 0) loadChat(remaining[0].id);
        else newChat();
      });
    } else {
      refreshSidebar();
    }
  }

  return { render };
})();
