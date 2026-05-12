const CodingPage = (() => {
  let currentChatId = null;
  let currentModel = null;
  let isStreaming = false;
  let abortController = null;

  const CODING_INSTRUCTION = [
    '[Instructions for this conversation: You are an expert coding assistant.',
    '',
    'When CREATING new files, use fenced code blocks with language and filename:',
    '```lang:filename.ext',
    'code here',
    '```',
    'For example: ```js:app.js or ```py:main.py',
    '',
    'When EDITING existing files, use SEARCH/REPLACE blocks. Write the filename on its own line, then the edit block:',
    'filename.ext',
    '<<<<<<< SEARCH',
    'exact lines to find',
    '=======',
    'replacement lines',
    '>>>>>>> REPLACE',
    '',
    'You may also use XML-style edits:',
    '<edit file="filename.ext">',
    '<search>',
    'exact lines to find',
    '</search>',
    '<replace>',
    'replacement lines',
    '</replace>',
    '</edit>',
    '',
    'You can make multiple edits to the same or different files. The SEARCH section must match the existing code exactly.',
    '',
    'Rules:',
    '- For new files, always use ```lang:filename.ext format',
    '- For edits to existing files, use SEARCH/REPLACE blocks or XML edit blocks',
    '- Explain changes briefly before or after the code',
    '- Point out potential issues or improvements',
    '- Prefer modern, idiomatic patterns',
    '- Be concise but thorough',
    '',
    'The current files in the project will be shown to you before each message.]',
    '',
    '',
  ].join('\n');

  function render(container) {
    Components.injectStyles();
    container.innerHTML = '';

    const outerLayout = document.createElement('div');
    outerLayout.className = 'split-layout';

    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    backdrop.id = 'code-sidebar-backdrop';
    backdrop.addEventListener('click', closeSidebar);

    outerLayout.appendChild(backdrop);
    outerLayout.appendChild(buildSidebar());

    const codingLayout = document.createElement('div');
    codingLayout.className = 'coding-layout';
    codingLayout.id = 'coding-layout';

    codingLayout.appendChild(buildChatPane());
    codingLayout.appendChild(buildEditorPane());

    outerLayout.appendChild(codingLayout);
    container.appendChild(outerLayout);

    EditorPanel.init(document.getElementById('coding-editor-pane'));

    Store.getChats().then(chats => {
      const codingChats = chats.filter(c => c.type === 'coding');
      if (codingChats.length > 0) loadChat(codingChats[0].id);
      else newChat();
    });
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('code-sidebar');
    const backdrop = document.getElementById('code-sidebar-backdrop');
    sidebar?.classList.toggle('open');
    backdrop?.classList.toggle('open');
  }

  function closeSidebar() {
    const sidebar = document.getElementById('code-sidebar');
    const backdrop = document.getElementById('code-sidebar-backdrop');
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('open');
  }

  function buildSidebar() {
    const sidebar = document.createElement('div');
    sidebar.className = 'sidebar';
    sidebar.id = 'code-sidebar';
    sidebar.innerHTML = `
      <div class="sidebar-header">
        <h3>Coding</h3>
        <button class="btn btn-primary btn-sm" id="code-new-btn">+ New</button>
      </div>
      <div class="sidebar-list" id="code-list"></div>`;
    sidebar.querySelector('#code-new-btn').addEventListener('click', newChat);
    refreshSidebar(sidebar);
    return sidebar;
  }

  function refreshSidebar(sidebar) {
    const list = (sidebar || document.getElementById('code-sidebar'))?.querySelector('#code-list');
    if (!list) return;
    list.innerHTML = '';
    Store.getChats().then(chats => {
      const codingChats = chats.filter(c => c.type === 'coding');
      if (codingChats.length === 0) {
        list.innerHTML = '<div style="padding:16px;color:var(--text2);font-size:13px">No coding sessions yet</div>';
        return;
      }
      codingChats.forEach(chat => {
        const item = document.createElement('div');
        item.className = 'sidebar-item' + (chat.id === currentChatId ? ' active' : '');
        item.innerHTML = `
          <div style="flex:1;min-width:0">
            <div class="item-title">${Components.escHtml(chat.title || 'Untitled')}</div>
            <div class="item-sub">${chat.items?.filter(m => m.role !== 'system').length || 0} messages</div>
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

  function buildChatPane() {
    const pane = document.createElement('div');
    pane.className = 'coding-chat-pane';
    pane.id = 'code-chat-pane';

    const toolbar = document.createElement('div');
    toolbar.className = 'chat-toolbar';
    toolbar.id = 'code-toolbar';

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

    const modelSel = Components.modelSelector(Store.getActiveProvider(), currentModel);
    modelSel.addEventListener('change', () => { currentModel = modelSel.value; });

    const quickBtns = document.createElement('div');
    quickBtns.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;width:100%;order:10;';
    [
      ['Explain', 'Explain this code:'],
      ['Review', 'Review this code for bugs and improvements:'],
      ['Refactor', 'Refactor this code to be cleaner:'],
      ['Test', 'Write tests for this code:'],
      ['Debug', 'Help me debug this:'],
    ].forEach(([label, prefix]) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary btn-sm';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        const input = document.querySelector('#code-input-bar textarea');
        if (input) {
          input.value = prefix + '\n\n';
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 160) + 'px';
        }
      });
      quickBtns.appendChild(btn);
    });

    toolbar.appendChild(sidebarBtn);
    toolbar.appendChild(titleInput);
    toolbar.appendChild(modelSel);
    toolbar.appendChild(quickBtns);

    const messagesWrap = document.createElement('div');
    messagesWrap.className = 'messages-wrap';
    messagesWrap.id = 'code-messages';

    const inputBar = Components.chatInputBar(sendMessage, {
      placeholder: 'Ask a coding question or paste code...',
    });
    inputBar.id = 'code-input-bar';

    pane.appendChild(toolbar);
    pane.appendChild(messagesWrap);
    pane.appendChild(inputBar);

    return pane;
  }

  function buildEditorPane() {
    const pane = document.createElement('div');
    pane.className = 'coding-editor-pane';
    pane.id = 'coding-editor-pane';

    pane.innerHTML = `
      <div class="editor-toolbar">
        <span class="editor-toolbar-title">Files</span>
        <button class="btn btn-secondary btn-sm" data-action="toggle-diff">Diff</button>
        <button class="btn btn-secondary btn-sm" data-action="download">↓ Save</button>
        <button class="btn btn-secondary btn-sm" data-action="download-all">↓ All</button>
      </div>
      <div class="editor-tabs"></div>
      <div class="editor-container">
        <div class="editor-empty">
          <div class="editor-empty-icon">📄</div>
          <div class="editor-empty-text">Code blocks from responses will appear here</div>
        </div>
      </div>`;

    return pane;
  }

  function newChat() {
    const id = Store.newId();
    const chat = {
      id, type: 'coding', title: framework.translate('New Session'),
      items: [],
      createdAt: Date.now(),
    };
    Store.upsertChat(chat);
    loadChat(id);
  }

  function loadChat(id) {
    currentChatId = id;
    Store.getChat(id).then(chat => {
      if (!chat) return;
      currentModel = chat.model || Store.getActiveProvider()?.defaultModel;

      const titleInput = document.querySelector('#code-toolbar .title-input');
      if (titleInput) titleInput.value = chat.title || '';

      const modelSel = document.querySelector('#code-toolbar .model-select');
      if (modelSel) modelSel.value = currentModel;

      EditorPanel.reset();

      chat.items.forEach(msg => {
        if (msg.role === 'assistant' && msg.content) {
          EditorPanel.applyEditsFromContent(msg.content);
          EditorPanel.addFilesFromContent(msg.content);
        }
      });

      renderMessages(chat.items);
    });
    refreshSidebar();
  }

  function stripInstruction(content) {
    if (content && content.startsWith(CODING_INSTRUCTION)) {
      return content.slice(CODING_INSTRUCTION.length);
    }
    return content;
  }

  function stripFileContext(content) {
    return content.replace(/<current_files>[\s\S]*?<\/current_files>\n*/g, '');
  }

  function cleanDisplayContent(content) {
    return stripFileContext(stripInstruction(content));
  }

  function replaceCodeBlocksWithBadges(content) {
    return content.replace(/```([^\n]*)\n[\s\S]*?```/g, (match, rawLang) => {
      const colonIdx = rawLang.indexOf(':');
      let lang = rawLang.trim();
      let filename = '';
      if (colonIdx > 0) {
        lang = rawLang.slice(0, colonIdx).trim();
        filename = rawLang.slice(colonIdx + 1).trim();
      }
      if (lang === 'sh' || lang === 'bash' || lang === 'zsh' || lang === 'shell') {
        return match;
      }
      const label = Components.escHtml(filename || (lang ? `${lang} file` : 'file'));
      return `BADGE_FILE:${label}:ENDBADGE`;
    });
  }

  function replaceSearchReplaceWithBadges(content) {
    let result = content;

    result = result.replace(/(?:^|\n)([^\n]+)\n<{3,}\s*SEARCH\s*\n[\s\S]*?\n>{3,}\s*REPLACE\s*/g, (match, filenameLine) => {
      const fname = Components.escHtml(filenameLine.trim());
      return `\nBADGE_EDIT:${fname}:ENDBADGE`;
    });

    result = result.replace(/<{3,}\s*SEARCH\s*\n[\s\S]*?\n>{3,}\s*REPLACE\s*/g, () => {
      return 'BADGE_EDIT:file:ENDBADGE';
    });

    result = result.replace(/<edit\s+(?:[^>]*?)file\s*=\s*["']([^"']+)["'][^>]*>\s*<search>[\s\S]*?<\/replace>\s*<\/edit>/gi, (match, fname) => {
      return `BADGE_EDIT:${Components.escHtml(fname.trim())}:ENDBADGE`;
    });

    result = result.replace(/<search>\s*\n?[\s\S]*?\n?\s*<\/search>\s*<replace>\s*\n?[\s\S]*?\n?\s*<\/replace>/gi, () => {
      return 'BADGE_EDIT:file:ENDBADGE';
    });

    return result;
  }

  function postProcessBadges(el) {
    const contentEl = el.querySelector('.msg-content');
    if (!contentEl) return;
    let html = contentEl.innerHTML;
    html = html.replace(/BADGE_FILE:([^:]*):ENDBADGE/g, (_, label) => {
      return `<span class="file-edit-badge" data-open-file="${label}"><span class="file-edit-badge-icon">📄</span><span class="file-edit-badge-name">${label}</span><span class="file-edit-badge-action">Open in Editor →</span></span>`;
    });
    html = html.replace(/BADGE_EDIT:([^:]*):ENDBADGE/g, (_, label) => {
      return `<span class="file-edit-badge edited" data-open-file="${label}"><span class="file-edit-badge-icon">✏️</span><span class="file-edit-badge-name">${label}</span><span class="file-edit-badge-action">Edited ✓</span></span>`;
    });
    contentEl.innerHTML = html;
    contentEl.querySelectorAll('.file-edit-badge').forEach(badge => {
      badge.addEventListener('click', () => {
        const fname = badge.dataset.openFile;
        const editorFiles = EditorPanel.getFiles();
        const idx = editorFiles.findIndex(f => f.name === fname);
        if (idx >= 0) {
          const isMobile = window.innerWidth < 768;
          if (isMobile) {
            document.getElementById('editor-fab')?.click();
          }
        }
      });
    });
  }

  function renderMessages(messages) {
    const wrap = document.getElementById('code-messages');
    if (!wrap) return;
    wrap.innerHTML = '';
    const visible = messages.filter(m => m.role !== 'system');
    if (visible.length === 0) {
      wrap.innerHTML = `<div class="empty-state">
        <div class="big">💻</div>
        <h2>Coding Assistant</h2>
        <p>Ask questions, paste code, get explanations, reviews, and fixes</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:8px">
          ${['Write a function', 'Explain this code', 'Find the bug', 'Optimize this'].map(s =>
            `<button class="btn btn-secondary btn-sm suggestion-btn">${s}</button>`
          ).join('')}
        </div>
      </div>`;
      wrap.querySelectorAll('.suggestion-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const input = document.querySelector('#code-input-bar textarea');
          if (input) { input.value = btn.textContent + ': '; input.focus(); }
        });
      });
      return;
    }
    visible.forEach(msg => {
      let displayContent = msg.content;
      if (msg.role === 'user') {
        displayContent = cleanDisplayContent(displayContent);
      }
      if (msg.role === 'assistant') {
        displayContent = replaceSearchReplaceWithBadges(displayContent);
        displayContent = replaceCodeBlocksWithBadges(displayContent);
      }
      const displayMsg = Object.assign({}, msg, { content: displayContent });
      const el = Components.renderMessage(displayMsg, { deletable: true });
      if (msg.role === 'assistant') postProcessBadges(el);
      el.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteMessage(msg.id));
      el.querySelector('[data-action="copy"]')?.addEventListener('click', () => Components.copyMessageContent(displayMsg));
      wrap.appendChild(el);
    });
    wrap.scrollTop = wrap.scrollHeight;
  }

  function buildMessagesForApi(chatMessages) {
    const filesContext = EditorPanel.getFilesContext();
    const apiMessages = [];

    chatMessages.forEach((msg, idx) => {
      if (msg.role === 'user') {
        apiMessages.push(msg);
      } else {
        apiMessages.push(msg);
      }
    });

    if (filesContext && apiMessages.length > 0) {
      const lastUserIdx = apiMessages.length - 1;
      for (let i = apiMessages.length - 1; i >= 0; i--) {
        if (apiMessages[i].role === 'user') {
          const original = apiMessages[i].content;
          apiMessages[i] = Object.assign({}, apiMessages[i], {
            content: filesContext + '\n\n' + original,
          });
          break;
        }
      }
    }

    return apiMessages;
  }

  async function sendMessage(text) {
    if (isStreaming || !currentChatId) return;
    const chat = await Store.getChat(currentChatId);
    if (!chat) return;

    const provider = Store.getActiveProvider();
    const settings = Store.getSettings();
    const model = currentModel || provider.defaultModel;

    const isFirstUserMessage = chat.items.filter(m => m.role === 'user').length === 0;
    const content = isFirstUserMessage ? CODING_INSTRUCTION + text : text;
    const userMsg = { id: Store.newId(), role: 'user', content, ts: Date.now() };
    chat.items.push(userMsg);
    Store.upsertChat(chat);

    const displayUserMsg = Object.assign({}, userMsg, { content: text });
    const wrap = document.getElementById('code-messages');
    if (wrap) {
      const emptyState = wrap.querySelector('.empty-state');
      if (emptyState) emptyState.remove();
      const userEl = Components.renderMessage(displayUserMsg, { deletable: true });
      userEl.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteMessage(userMsg.id));
      userEl.querySelector('[data-action="copy"]')?.addEventListener('click', () => Components.copyMessageContent(displayUserMsg));
      wrap.appendChild(userEl);
      wrap.scrollTop = wrap.scrollHeight;
    }

    const inputBar = document.getElementById('code-input-bar');
    abortController = new AbortController();
    isStreaming = true;
    inputBar?.setStreaming(true, () => { abortController?.abort(); });

    const assistantMsg = { id: Store.newId(), role: 'assistant', content: '', thinking: '', images: [], ts: Date.now() };
    const assistantEl = Components.renderMessage(assistantMsg, {});
    const contentEl = assistantEl.querySelector('.msg-content');
    Components.addTypingIndicator(assistantEl);
    if (wrap) { wrap.appendChild(assistantEl); wrap.scrollTop = wrap.scrollHeight; }

    let typingRemoved = false;

    const apiMessages = buildMessagesForApi(chat.items);

    try {
      let fullContent = '';
      let fullThinking = '';
      const images = [];
      for await (const chunk of API.streamChat(provider, apiMessages, model, {
        temperature: 0.3,
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

      EditorPanel.applyEditsFromContent(fullContent);
      EditorPanel.addFilesFromContent(fullContent);

      let badgeContent = replaceSearchReplaceWithBadges(fullContent);
      badgeContent = replaceCodeBlocksWithBadges(badgeContent);
      contentEl.innerHTML = Components.renderMarkdown(badgeContent);
      postProcessBadges(assistantEl);
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
      chat.title = text.slice(0, 40) + (text.length > 40 ? '…' : '');
      const titleInput = document.querySelector('#code-toolbar .title-input');
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

  async function deleteChat(id) {
    const ok = await Components.confirm('Delete this session?');
    if (!ok) return;
    Store.deleteChat(id);
    if (currentChatId === id) {
      Store.getChats().then(chats => {
        const remaining = chats.filter(c => c.type === 'coding');
        if (remaining.length > 0) loadChat(remaining[0].id);
        else newChat();
      });
    } else {
      refreshSidebar();
    }
  }

  return { render };
})();
