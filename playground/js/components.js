const Components = (() => {
  function toast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function modal(title, bodyHTML, buttons = []) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <h2>${title}</h2>
          <div class="modal-body">${bodyHTML}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
            ${buttons.map((b, i) => `<button class="btn ${b.cls || 'btn-secondary'}" data-idx="${i}">${b.label}</button>`).join('')}
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelectorAll('button[data-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          overlay.remove();
          resolve(parseInt(btn.dataset.idx));
        });
      });
      overlay.addEventListener('click', e => {
        if (e.target === overlay) { overlay.remove(); resolve(-1); }
      });
    });
  }

  function confirm(message) {
    return modal(framework.translate('Confirm'), `<p style="color:var(--text2)">${message}</p>`, [
      { label: framework.translate('Cancel'), cls: 'btn-secondary' },
      { label: framework.translate('Confirm'), cls: 'btn-primary' },
    ]).then(i => i === 1);
  }

  function renderMessage(msg, opts = {}) {
    const el = document.createElement('div');
    el.className = `msg msg-${msg.role}`;
    el.dataset.id = msg.id || '';

    const avatar = msg.role === 'user' ? '👤' : msg.role === 'system' ? '⚙️' : (opts.personaEmoji || '🤖');
    const name = msg.role === 'user' ? framework.translate('You') : msg.role === 'system' ? framework.translate('System') : (opts.personaName || framework.translate('Assistant'));

    let thinkingHtml = '';
    if (msg.thinking || msg.reasoning?.text) {
      thinkingHtml = renderThinkingBlock(msg.thinking || msg.reasoning.text);
    }

    let imagesHtml = '';
    if (msg.images && msg.images.length > 0) {
      imagesHtml = `<div class="msg-images">${msg.images.map(img => {
        const src = img.url || (img.b64 ? `data:image/png;base64,${img.b64}` : '');
        return `<div class="msg-image-wrap">
          <div class="img-loading-skeleton"><div class="img-loading-spinner"></div></div>
          <img src="${src}" alt="Generated image" class="msg-image" loading="lazy" />
          ${img.revisedPrompt ? `<div class="msg-image-caption">${escHtml(img.revisedPrompt)}</div>` : ''}
        </div>`;
      }).join('')}</div>`;
    }

    el.innerHTML = `
      <div class="msg-header">
        <span class="msg-avatar">${avatar}</span>
        <span class="msg-name">${escHtml(name)}</span>
        <span class="msg-time">${formatTime(msg.ts)}</span>
        <div class="msg-actions">
          <button class="msg-btn" data-action="copy" title="Copy">⎘</button>
          ${opts.editable ? `<button class="msg-btn" data-action="edit" title="Edit">✎</button>` : ''}
          ${opts.deletable ? `<button class="msg-btn" data-action="delete" title="Delete">✕</button>` : ''}
        </div>
      </div>
      <div class="msg-thinking" id="thinking-${msg.id || ''}">${thinkingHtml}</div>
      <div class="msg-content">${renderMarkdown(msg.content)}</div>
      ${imagesHtml}`;

    el.querySelectorAll('.thinking-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const block = toggle.closest('.thinking-block');
        block?.classList.toggle('collapsed');
      });
    });

    el.querySelectorAll('.msg-image').forEach(img => {
      img.addEventListener('load', () => {
        const skeleton = img.parentElement.querySelector('.img-loading-skeleton');
        if (skeleton) skeleton.remove();
        img.classList.add('img-loaded');
      });
      img.addEventListener('error', () => {
        const skeleton = img.parentElement.querySelector('.img-loading-skeleton');
        if (skeleton) skeleton.remove();
      });
    });

    return el;
  }

  function renderThinkingBlock(text) {
    if (!text) return '';
    const preview = text.slice(0, 80).replace(/\n/g, ' ') + (text.length > 80 ? '…' : '');
    return `
      <div class="thinking-block collapsed">
        <div class="thinking-toggle">
          <span class="thinking-icon">💭</span>
          <span class="thinking-label">${framework.translate('Thinking')}</span>
          <span class="thinking-preview">${escHtml(preview)}</span>
          <span class="thinking-chevron">▸</span>
        </div>
        <div class="thinking-content">${renderMarkdown(text)}</div>
      </div>`;
  }

  function updateThinkingBlock(el, thinkingText) {
    const thinkingContainer = el.querySelector('.msg-thinking');
    if (!thinkingContainer) return;
    if (!thinkingText) return;

    let block = thinkingContainer.querySelector('.thinking-block');
    if (!block) {
      thinkingContainer.innerHTML = renderThinkingBlock(thinkingText);
      thinkingContainer.querySelectorAll('.thinking-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
          const b = toggle.closest('.thinking-block');
          b?.classList.toggle('collapsed');
        });
      });
      return;
    }

    const contentEl = block.querySelector('.thinking-content');
    if (contentEl) contentEl.innerHTML = renderMarkdown(thinkingText);

    const preview = thinkingText.slice(0, 80).replace(/\n/g, ' ') + (thinkingText.length > 80 ? '…' : '');
    const previewEl = block.querySelector('.thinking-preview');
    if (previewEl) previewEl.textContent = preview;
  }

  function addTypingIndicator(el) {
    const contentEl = el.querySelector('.msg-content');
    if (!contentEl) return;
    contentEl.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
  }

  function removeTypingIndicator(el) {
    const indicator = el.querySelector('.typing-indicator');
    if (indicator) indicator.remove();
  }

  function createImageWithLoader(src, alt, revisedPrompt) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'msg-image-wrap';

    const skeleton = document.createElement('div');
    skeleton.className = 'img-loading-skeleton';
    skeleton.innerHTML = '<div class="img-loading-spinner"></div>';

    const img = document.createElement('img');
    img.src = src;
    img.alt = alt || 'Generated image';
    img.className = 'msg-image';
    img.loading = 'lazy';

    img.addEventListener('load', () => {
      skeleton.remove();
      img.classList.add('img-loaded');
    });

    img.addEventListener('error', () => {
      skeleton.remove();
    });

    imgWrap.appendChild(skeleton);
    imgWrap.appendChild(img);

    if (revisedPrompt) {
      const caption = document.createElement('div');
      caption.className = 'msg-image-caption';
      caption.textContent = revisedPrompt;
      imgWrap.appendChild(caption);
    }

    return imgWrap;
  }

  async function copyMessageContent(msg) {
    if (msg.images && msg.images.length > 0) {
      const imgData = msg.images[0];
      const src = imgData.url || (imgData.b64 ? `data:image/png;base64,${imgData.b64}` : '');
      if (src) {
        try {
          const response = await fetch(src);
          const blob = await response.blob();
          const pngBlob = await convertToPngBlob(blob);
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': pngBlob })
          ]);
          toast('Image copied to clipboard', 'success');
          return;
        } catch (e) {
          try {
            await navigator.clipboard.writeText(src);
            toast('Image URL copied to clipboard', 'info');
            return;
          } catch (e2) {
            toast('Failed to copy image', 'error');
            return;
          }
        }
      }
    }
    await navigator.clipboard.writeText(msg.content);
    toast('Copied to clipboard', 'success');
  }

  function convertToPngBlob(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(pngBlob => {
          if (pngBlob) resolve(pngBlob);
          else reject(new Error('Failed to convert to PNG'));
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.crossOrigin = 'anonymous';
      img.src = URL.createObjectURL(blob);
    });
  }

  const sanitizedConfig = () => {
      return {
          allowedTags: window?.sanitizeHtml?.defaults.allowedTags.concat(['img', 'iframe', 'audio', 'video', 'details', 'summary', 'div']),
          allowedAttributes: {
              a: [ 'href', 'title', 'target', 'rel', 'data-width', 'data-height', 'data-src' ],
              i: [ 'class' ],
              span: [ 'class' ],
              code: [ 'class' ],
              img: [ 'src', 'alt', 'width', 'height' ],
              iframe: [ 'src', 'type', 'frameborder', 'allow', 'height', 'width' ],
              audio: [ 'src', 'controls' ],
              video: [ 'src', 'controls', 'loop', 'autoplay', 'muted' ],
              div: [ 'class' ],
              table: [ 'class' ],
              blockquote: [ 'class' ]
          },
          allowedIframeHostnames: ['www.youtube.com'],
          allowedSchemes: [ 'http', 'https', 'data' ]
      }
  };

  function renderMarkdown(content) {
    if (!content) return '';
    if (Array.isArray(content)) {
        content = content.map((item) => {
            if (!item.name) {
                if (item.text) {
                    return item.text;
                }
                size = parseInt(appStorage.getItem(`bucket:${item.bucket_id}`), 10);
                return `**Bucket:** [[${item.bucket_id}]](${item.url})${size ? ` (${formatFileSize(size)})` : ""}`
            }
            if (item.name.endsWith(".wav") || item.name.endsWith(".mp3")) {
                return `<audio controls src="${item.url}"></audio>` + (item.text ? `\n${item.text}` : "");
            }
            if (item.name.endsWith(".mp4") || item.name.endsWith(".webm")) {
                return `<video controls src="${item.url}"></video>` + (item.text ? `\n${item.text}` : "");
            }
            if (item.width && item.height) {
                return `<a href="${item.url}" data-width="${item.width}" data-height="${item.height}"><img src="${item.url.replaceAll("/media/", "/thumbnail/") || item.image_url?.url}" alt="${framework.escape(item.name)}"></a>`;
            }
            return `[![${item.name}](${item.url.replaceAll("/media/", "/thumbnail/") || item.image_url?.url})](${item.url || item.image_url?.url})`;
        }).join("\n");
    }
    let html = window.sanitizeHtml ? content : escHtml(content);
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="code-block"><div class="code-lang">${lang || 'code'}</div><code>${code.trim()}</code><button class="copy-code-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">Copy</button></pre>`
    );
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\[!\[([^\]]*)\]\(([^)]*)\)\]\(([^)]*)\)/g, '<a href="$3"><img src="$2" alt="$1"></a>');
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\n---\n+/g, '<hr>\n');
    html = html.replace(/^##### (.+)\n*/gm, '<h5>$1</h5>\n');
    html = html.replace(/^#### (.+)\n*/gm, '<h4>$1</h4>\n');
    html = html.replace(/^### (.+)\n*/gm, '<h3>$1</h3>\n');
    html = html.replace(/^## (.+)\n*/gm, '<h2>$1</h2>\n');
    html = html.replace(/^# (.+)\n*/gm, '<h1>$1</h1>\n');
    html = html.replace(/^[-*] (.+)?$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
    html = html.replaceAll('</ul>\n', '</ul>');
    html = html.replaceAll('</li>\n', '</li>');
    html = html.replace(/^((?:\|.+\|\n?)+)/gm, tableBlock => {
      const rows = tableBlock.trim().split('\n');
      if (rows.length < 2) return tableBlock;
      const isSeparator = r => /^\|[\s\-:|]+\|$/.test(r.trim());
      const parseRow = (r, tag) => '<tr>' + r.trim().replace(/^\||\|$/g, '').split('|').map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
      let thead = '', tbody = '', sepIdx = rows.findIndex(isSeparator);
      if (sepIdx === 1) {
        thead = `<thead>${parseRow(rows[0], 'th')}</thead>`;
        tbody = `<tbody>${rows.slice(2).filter(r => !isSeparator(r)).map(r => parseRow(r, 'td')).join('')}</tbody>`;
      } else {
        tbody = `<tbody>${rows.filter(r => !isSeparator(r)).map(r => parseRow(r, 'td')).join('')}</tbody>`;
      }
      return `<table class="md-table">${thead}${tbody}</table>`;
    });
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/>\n/g, '>');
    html = html.replace(/\n/g, '<br>');
    html = html
        .replaceAll("<a href=", '<a target="_blank" href=')
        .replaceAll('<code>', '<code class="language-plaintext">')
        .replaceAll('<iframe src="', '<iframe frameborder="0" height="224" width="400" src="')
        .replaceAll('<iframe type="text/html" src="', '<iframe type="text/html" frameborder="0" allow="fullscreen" height="224" width="400" src="')
        .replaceAll('"></iframe>', `?enablejsapi=1"></iframe>`)
        .replaceAll('src="/media/', `src="${framework.backendUrl}/media/`)
        .replaceAll('src="/thumbnail/', `src="${framework.backendUrl}/thumbnail/`)
        .replaceAll('href="/media/', `href="${framework.backendUrl}/media/`);
    if (window.sanitizeHtml) {
        html = window.sanitizeHtml(html, sanitizedConfig());
    }
    return `<p>${html}</p>`;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function modelSelector(provider, currentModel) {
    const models = provider?.fetchedModels?.length
      ? provider.fetchedModels
      : (provider?.models?.length ? provider.models : [provider?.defaultModel || 'llama-4-scout']);
    const sel = document.createElement('select');
    sel.className = 'model-select';
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      if (m === (currentModel || provider?.defaultModel)) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  }

  function chatInputBar(onSend, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'input-bar';
    wrap.innerHTML = `
      <textarea class="chat-input" placeholder="${opts.placeholder || 'Type a message...'}" rows="1"></textarea>
      <button class="btn btn-primary send-btn">${opts.sendLabel || 'Send'}</button>
      <button class="btn btn-danger stop-btn" style="display:none">Stop</button>`;
    const ta = wrap.querySelector('textarea');
    const btn = wrap.querySelector('.send-btn');
    const stopBtn = wrap.querySelector('.stop-btn');
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    btn.addEventListener('click', send);
    function send() {
      const val = ta.value.trim();
      if (!val) return;
      ta.value = '';
      ta.style.height = 'auto';
      onSend(val);
    }
    wrap.getInput = () => ta;
    wrap.setDisabled = (v) => { ta.disabled = v; btn.disabled = v; btn.textContent = v ? '...' : (opts.sendLabel || 'Send'); };
    wrap.setStreaming = (streaming, onStop) => {
      if (streaming) {
        btn.style.display = 'none';
        stopBtn.style.display = '';
        ta.disabled = true;
        stopBtn.onclick = () => { if (onStop) onStop(); };
      } else {
        btn.style.display = '';
        stopBtn.style.display = 'none';
        ta.disabled = false;
        btn.disabled = false;
        btn.textContent = opts.sendLabel || 'Send';
        stopBtn.onclick = null;
      }
    };
    return wrap;
  }

  function injectStyles() {
    if (document.getElementById('components-css')) return;
    const style = document.createElement('style');
    style.id = 'components-css';
    style.textContent = `
      .msg { padding: 14px 16px; border-bottom: 1px solid var(--border); }
      .msg:last-child { border-bottom: none; }
      .msg-user { background: var(--bg); }
      .msg-assistant { background: var(--bg2); }
      .msg-system { background: var(--bg3); opacity: 0.8; }
      .msg-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .msg-avatar { font-size: 18px; }
      .msg-name { font-weight: 600; font-size: 14px; }
      .msg-time { font-size: 11px; color: var(--text2); margin-left: 4px; }
      .msg-actions { margin-left: auto; display: flex; gap: 2px; }
      .msg-btn { background: none; border: none; color: var(--text2); cursor: pointer; padding: 6px 8px; border-radius: 6px; font-size: 15px; min-width: 36px; min-height: 36px; display: flex; align-items: center; justify-content: center; }
      .msg-btn:active { background: var(--bg3); color: var(--text); }
      .msg-content { line-height: 1.65; word-break: break-word; }
      .msg-content p { margin: 0 0 8px; }
      .msg-content p:last-child { margin-bottom: 0; }
      .msg-content h1,.msg-content h2,.msg-content h3 { margin: 8px 0 4px; }
      .msg-content ul { padding-left: 20px; margin: 4px 0; }
      .msg-content li { margin: 2px 0; }
      .msg-thinking:empty { display: none; }
      .thinking-block { border: 1px solid #3a3560; border-radius: 10px; margin-bottom: 10px; overflow: hidden; background: rgba(124, 106, 247, 0.05); }
      .thinking-toggle { display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent; }
      .thinking-toggle:active { background: rgba(124, 106, 247, 0.1); }
      .thinking-icon { font-size: 16px; flex-shrink: 0; }
      .thinking-label { font-size: 13px; font-weight: 600; color: var(--accent); flex-shrink: 0; }
      .thinking-preview { font-size: 12px; color: var(--text2); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .thinking-chevron { font-size: 12px; color: var(--text2); flex-shrink: 0; transition: transform 0.2s; }
      .thinking-block:not(.collapsed) .thinking-chevron { transform: rotate(90deg); }
      .thinking-block.collapsed .thinking-content { display: none; }
      .thinking-block:not(.collapsed) .thinking-preview { display: none; }
      .thinking-content { padding: 0 14px 12px; font-size: 13px; color: var(--text2); line-height: 1.6; border-top: 1px solid #3a3560; }
      .thinking-content p { margin: 8px 0; }
      .thinking-content p:first-child { margin-top: 10px; }
      .thinking-content p:last-child { margin-bottom: 0; }
      .thinking-streaming { animation: thinkPulse 1.5s ease-in-out infinite; }
      @keyframes thinkPulse { 0%,100% { border-color: #3a3560; } 50% { border-color: var(--accent); } }
      .code-block { background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin: 8px 0; overflow-x: auto; position: relative; -webkit-overflow-scrolling: touch; }
      .code-lang { font-size: 11px; color: var(--text2); margin-bottom: 6px; text-transform: uppercase; }
      .code-block code { font-family: 'Cascadia Code','Fira Code',monospace; font-size: 13px; white-space: pre; }
      .copy-code-btn { position: absolute; top: 8px; right: 8px; background: var(--bg3); border: 1px solid var(--border); color: var(--text2); padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer; min-height: 32px; }
      .copy-code-btn:active { color: var(--text); }
      .inline-code { background: var(--code-bg); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; font-family: monospace; font-size: 13px; }
      .md-blockquote { border-left: 3px solid var(--accent); margin: 8px 0; padding: 6px 12px; background: var(--bg3); color: var(--text2); border-radius: 0 6px 6px 0; }
      .md-table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px; }
      .md-table th, .md-table td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
      .md-table thead th { background: var(--bg3); font-weight: 600; }
      .md-table tbody tr:nth-child(even) { background: var(--bg2); }
      .input-bar { display: flex; gap: 8px; padding: 10px 12px; padding-bottom: calc(10px + var(--safe-bottom)); border-top: 1px solid var(--border); background: var(--bg2); align-items: flex-end; }
      .chat-input { flex: 1; padding: 10px 12px; resize: none; line-height: 1.5; max-height: 160px; overflow-y: auto; font-size: 16px; border-radius: 10px; }
      .send-btn { flex-shrink: 0; height: 44px; padding: 0 18px; border-radius: 10px; }
      .stop-btn { flex-shrink: 0; height: 44px; padding: 0 18px; border-radius: 10px; }
      .model-select { padding: 8px 10px; font-size: 14px; border-radius: 8px; min-height: 40px; }
      .chat-toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); background: var(--bg2); flex-wrap: wrap; }
      .chat-toolbar .title-input { background: none; border: none; font-size: 15px; font-weight: 600; color: var(--text); flex: 1; min-width: 100px; padding: 6px; }
      .chat-toolbar .title-input:focus { background: var(--bg3); border-radius: 6px; }
      .messages-wrap { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
      .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text2); gap: 8px; padding: 24px; text-align: center; }
      .empty-state .big { font-size: 48px; }
      .empty-state h2 { font-size: 18px; color: var(--text); }
      .msg-images { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .msg-image-wrap { border-radius: 10px; overflow: hidden; border: 1px solid var(--border); max-width: 100%; position: relative; min-height: 120px; }
      .msg-image { display: block; max-width: 100%; height: auto; border-radius: 10px; cursor: pointer; opacity: 0; transition: opacity 0.3s ease; }
      .msg-image.img-loaded { opacity: 1; }
      .msg-image-caption { font-size: 12px; color: var(--text2); padding: 6px 10px; background: var(--bg3); }
      .img-loading-skeleton { position: absolute; inset: 0; background: var(--bg3); display: flex; align-items: center; justify-content: center; min-height: 120px; border-radius: 10px; }
      .img-loading-spinner { width: 36px; height: 36px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: imgSpin 0.8s linear infinite; }
      @keyframes imgSpin { to { transform: rotate(360deg); } }
      .typing-indicator { display: flex; align-items: center; gap: 5px; padding: 8px 4px; }
      .typing-indicator span { width: 8px; height: 8px; background: var(--text2); border-radius: 50%; animation: typingBounce 1.4s ease-in-out infinite; }
      .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
      .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-8px); opacity: 1; } }
      .sidebar {
        position: fixed;
        top: var(--nav-height);
        left: 0;
        bottom: 0;
        width: 85%;
        max-width: 320px;
        background: var(--bg2);
        display: flex;
        flex-direction: column;
        z-index: 90;
        transform: translateX(-100%);
        transition: transform 0.25s ease;
        border-right: 1px solid var(--border);
      }
      .sidebar.open { transform: translateX(0); }
      .sidebar-backdrop {
        display: none;
        position: fixed;
        inset: 0;
        top: var(--nav-height);
        background: rgba(0,0,0,0.5);
        z-index: 89;
      }
      .sidebar-backdrop.open { display: block; }
      .sidebar-header { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
      .sidebar-header h3 { flex: 1; font-size: 15px; }
      .sidebar-list { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
      .sidebar-item { padding: 14px 16px; cursor: pointer; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
      .sidebar-item:active { background: var(--bg3); }
      .sidebar-item.active { background: var(--bg3); border-left: 3px solid var(--accent); }
      .sidebar-item .item-title { flex: 1; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sidebar-item .item-sub { font-size: 12px; color: var(--text2); }
      .sidebar-item .item-del { color: var(--text2); background: none; border: none; cursor: pointer; padding: 6px 8px; border-radius: 6px; min-width: 36px; min-height: 36px; display: flex; align-items: center; justify-content: center; }
      .sidebar-item .item-del:active { color: var(--red); background: var(--bg3); }
      .sidebar-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        background: none;
        border: 1px solid var(--border);
        border-radius: 8px;
        color: var(--text);
        font-size: 18px;
        cursor: pointer;
        flex-shrink: 0;
      }
      .sidebar-toggle:active { background: var(--bg3); }
      .split-layout { display: flex; flex: 1; overflow: hidden; position: relative; }
      .split-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; width: 100%; }

      @media (min-width: 768px) {
        .msg { padding: 12px 16px; }
        .msg-avatar { font-size: 16px; }
        .msg-name { font-size: 13px; }
        .msg-actions { opacity: 0; transition: opacity 0.15s; }
        .msg:hover .msg-actions { opacity: 1; }
        .msg-btn { padding: 2px 5px; font-size: 13px; min-width: auto; min-height: auto; }
        .thinking-toggle { padding: 8px 12px; }
        .thinking-toggle:hover { background: rgba(124, 106, 247, 0.1); }
        .thinking-content { padding: 0 12px 10px; }
        .code-block { border-radius: 8px; }
        .copy-code-btn { min-height: auto; }
        .input-bar { padding: 12px 16px; padding-bottom: 12px; }
        .chat-input { font-size: 13px; border-radius: 6px; padding: 9px 12px; max-height: 200px; }
        .send-btn { height: 38px; border-radius: 6px; }
        .model-select { padding: 5px 8px; font-size: 12px; min-height: auto; border-radius: 6px; }
        .chat-toolbar { padding: 8px 16px; }
        .chat-toolbar .title-input { font-size: 14px; }
        .sidebar {
          position: static;
          width: 240px;
          max-width: none;
          transform: none;
          transition: none;
          flex-shrink: 0;
          z-index: auto;
        }
        .sidebar-backdrop { display: none !important; }
        .sidebar-header { padding: 12px; }
        .sidebar-header h3 { font-size: 13px; }
        .sidebar-item { padding: 10px 12px; gap: 8px; }
        .sidebar-item .item-title { font-size: 13px; }
        .sidebar-item .item-sub { font-size: 11px; }
        .sidebar-item .item-del { opacity: 0; padding: 2px 5px; min-width: auto; min-height: auto; }
        .sidebar-item:hover .item-del { opacity: 1; }
        .sidebar-item:hover { background: var(--bg3); }
        .sidebar-toggle { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  return { toast, modal, confirm, renderMessage, renderMarkdown, escHtml, modelSelector, chatInputBar, injectStyles, renderThinkingBlock, updateThinkingBlock, addTypingIndicator, removeTypingIndicator, createImageWithLoader, copyMessageContent };
})();
