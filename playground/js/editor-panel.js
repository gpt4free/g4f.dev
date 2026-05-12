const EditorPanel = (() => {
  let files = [];
  let activeFileIndex = -1;
  let monacoEditor = null;
  let diffEditor = null;
  let isDiffMode = false;
  let editorContainer = null;
  let tabsContainer = null;
  let desktopPane = null;
  let mobileModal = null;
  let mobileTabsContainer = null;
  let mobileEditorContainer = null;
  let fab = null;
  let onFilesChanged = null;

  const LANG_MAP = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    php: 'php',
    swift: 'swift',
    r: 'r',
    lua: 'lua',
    dart: 'dart',
    vue: 'html',
    svelte: 'html',
    toml: 'ini',
    ini: 'ini',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    graphql: 'graphql',
    gql: 'graphql',
    proto: 'protobuf',
  };

  function langToMonaco(lang) {
    if (!lang) return 'plaintext';
    const lower = lang.toLowerCase();
    if (LANG_MAP[lower]) return LANG_MAP[lower];
    return lower;
  }

  function guessLangFromFilename(filename) {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return ext;
  }

  function guessFilename(lang, index) {
    const extMap = {
      javascript: 'js', typescript: 'ts', python: 'py', ruby: 'rb',
      rust: 'rs', java: 'java', kotlin: 'kt', csharp: 'cs',
      cpp: 'cpp', c: 'c', html: 'html', css: 'css', scss: 'scss',
      json: 'json', xml: 'xml', yaml: 'yml', markdown: 'md',
      sql: 'sql', shell: 'sh', php: 'php', swift: 'swift',
      go: 'go', dart: 'dart', lua: 'lua', r: 'r',
    };
    const monacoLang = langToMonaco(lang);
    const ext = extMap[monacoLang] || lang || 'txt';
    return `file${index + 1}.${ext}`;
  }

  function parseLangAndFilename(raw) {
    if (!raw) return { lang: '', filename: '' };
    const colonIdx = raw.indexOf(':');
    if (colonIdx > 0) {
      const lang = raw.slice(0, colonIdx).trim();
      const filename = raw.slice(colonIdx + 1).trim();
      if (filename && filename.length > 0) {
        return { lang, filename };
      }
    }
    return { lang: raw.trim(), filename: '' };
  }

  function init(desktopEl, options = {}) {
    desktopPane = desktopEl;
    onFilesChanged = options.onFilesChanged || null;

    const toolbar = desktopPane.querySelector('.editor-toolbar');
    tabsContainer = desktopPane.querySelector('.editor-tabs');
    editorContainer = desktopPane.querySelector('.editor-container');

    const downloadBtn = toolbar.querySelector('[data-action="download"]');
    if (downloadBtn) downloadBtn.addEventListener('click', downloadActiveFile);

    const downloadAllBtn = toolbar.querySelector('[data-action="download-all"]');
    if (downloadAllBtn) downloadAllBtn.addEventListener('click', downloadAllFiles);

    const diffToggle = toolbar.querySelector('[data-action="toggle-diff"]');
    if (diffToggle) diffToggle.addEventListener('click', toggleDiffView);

    buildMobileUI();
    updateFab();
  }

  function buildMobileUI() {
    fab = document.createElement('button');
    fab.className = 'editor-toggle-fab';
    fab.id = 'editor-fab';
    fab.innerHTML = '{ }';
    fab.addEventListener('click', openMobileEditor);
    document.body.appendChild(fab);

    mobileModal = document.createElement('div');
    mobileModal.className = 'editor-modal-overlay';
    mobileModal.id = 'editor-modal';
    mobileModal.innerHTML = `
      <div class="editor-modal">
        <div class="editor-modal-header">
          <span class="editor-modal-header-title">Code Files</span>
          <button class="btn btn-secondary btn-sm" data-action="diff">Diff</button>
          <button class="btn btn-secondary btn-sm" data-action="download">↓ Save</button>
          <button class="editor-modal-close" data-action="close">✕</button>
        </div>
        <div class="editor-tabs" id="mobile-editor-tabs"></div>
        <div class="editor-container" id="mobile-editor-container">
          <div class="editor-empty">
            <div class="editor-empty-icon">📄</div>
            <div class="editor-empty-text">No code files yet</div>
          </div>
        </div>
      </div>`;

    mobileModal.querySelector('[data-action="close"]').addEventListener('click', closeMobileEditor);
    mobileModal.querySelector('[data-action="download"]').addEventListener('click', downloadActiveFile);
    mobileModal.querySelector('[data-action="diff"]').addEventListener('click', toggleDiffView);
    mobileTabsContainer = mobileModal.querySelector('#mobile-editor-tabs');
    mobileEditorContainer = mobileModal.querySelector('#mobile-editor-container');

    document.body.appendChild(mobileModal);
  }

  function openMobileEditor() {
    mobileModal.classList.add('open');
    renderTabs(mobileTabsContainer);
    if (files.length > 0 && activeFileIndex >= 0) {
      if (isDiffMode && files[activeFileIndex].previousCode !== undefined) {
        initDiffIn(mobileEditorContainer, files[activeFileIndex]);
      } else {
        initMonacoIn(mobileEditorContainer, files[activeFileIndex]);
      }
    }
  }

  function closeMobileEditor() {
    syncEditorToFile();
    mobileModal.classList.remove('open');
    disposeEditors();
    if (files.length > 0 && activeFileIndex >= 0) {
      if (isDiffMode && files[activeFileIndex].previousCode !== undefined) {
        initDiffIn(editorContainer, files[activeFileIndex]);
      } else {
        initMonacoIn(editorContainer, files[activeFileIndex]);
      }
    }
  }

  function isMobileModalOpen() {
    return mobileModal && mobileModal.classList.contains('open');
  }

  function getActiveContainer() {
    if (isMobileModalOpen()) return mobileEditorContainer;
    return editorContainer;
  }

  function getActiveTabsContainer() {
    if (isMobileModalOpen()) return mobileTabsContainer;
    return tabsContainer;
  }

  function extractCodeBlocks(text) {
    const blocks = [];
    const regex = /```([^\n]*)\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const rawLang = match[1] || '';
      const code = match[2] || '';
      if (code.trim()) {
        const parsed = parseLangAndFilename(rawLang);
        blocks.push({
          lang: parsed.lang,
          filename: parsed.filename,
          code: code.trimEnd(),
        });
      }
    }
    return blocks;
  }

  function isLikelyFilename(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 120) return false;
    if (/^[`#*\-=<>|]/.test(trimmed)) return false;
    if (/\.\w{1,10}$/.test(trimmed) && !trimmed.includes(' ')) return true;
    if (/^[\w\-./\\]+\.\w{1,10}$/.test(trimmed)) return true;
    if (/^(file|path|filename):\s*.+/i.test(trimmed)) return true;
    return false;
  }

  function cleanFilenameLine(line) {
    let f = line.trim();
    f = f.replace(/^(file|path|filename):\s*/i, '');
    f = f.replace(/^[`*]+|[`*]+$/g, '');
    f = f.replace(/^\*\*|\*\*$/g, '');
    return f.trim();
  }

  function parseAllEdits(text) {
    const results = [];

    const srPatterns = [
      /(?:^|\n)([^\n]*)\n<{3,}\s*SEARCH\s*\n([\s\S]*?)\n={3,}\n([\s\S]*?)\n>{3,}\s*REPLACE\s*/g,
      /(?:^|\n)([^\n]*)\n<<<+\s*SEARCH\s*\n([\s\S]*?)\n---+\n([\s\S]*?)\n>>>+\s*REPLACE\s*/g,
    ];

    let found = false;
    for (const pattern of srPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const candidateLine = match[1].trim();
        let filename = '';
        if (isLikelyFilename(candidateLine)) {
          filename = cleanFilenameLine(candidateLine);
        }
        results.push({
          filename,
          search: match[2],
          replace: match[3],
          raw: match[0],
          index: match.index,
        });
        found = true;
      }
    }

    if (!found) {
      const simpleRegex = /<{3,}\s*SEARCH\s*\n([\s\S]*?)\n={3,}\n([\s\S]*?)\n>{3,}\s*REPLACE\s*/g;
      let match;
      while ((match = simpleRegex.exec(text)) !== null) {
        let filename = '';
        const before = text.slice(0, match.index);
        const lastNewline = before.lastIndexOf('\n');
        if (lastNewline >= 0) {
          const prevLine = before.slice(lastNewline + 1).trim();
          if (isLikelyFilename(prevLine)) {
            filename = cleanFilenameLine(prevLine);
          }
        }
        results.push({
          filename,
          search: match[1],
          replace: match[2],
          raw: match[0],
          index: match.index,
        });
        found = true;
      }
    }

    const xmlRegex = /<edit\s+(?:[^>]*?)file\s*=\s*["']([^"']+)["'][^>]*>\s*<search>\s*\n?([\s\S]*?)\n?\s*<\/search>\s*<replace>\s*\n?([\s\S]*?)\n?\s*<\/replace>\s*<\/edit>/gi;
    let xmlMatch;
    while ((xmlMatch = xmlRegex.exec(text)) !== null) {
      results.push({
        filename: xmlMatch[1].trim(),
        search: xmlMatch[2],
        replace: xmlMatch[3],
        raw: xmlMatch[0],
        index: xmlMatch.index,
      });
    }

    const xmlNoFileRegex = /<search>\s*\n?([\s\S]*?)\n?\s*<\/search>\s*<replace>\s*\n?([\s\S]*?)\n?\s*<\/replace>/gi;
    let xmlNfMatch;
    while ((xmlNfMatch = xmlNoFileRegex.exec(text)) !== null) {
      const alreadyCaptured = results.some(r =>
        r.index <= xmlNfMatch.index && (r.index + r.raw.length) >= (xmlNfMatch.index + xmlNfMatch[0].length)
      );
      if (!alreadyCaptured) {
        results.push({
          filename: '',
          search: xmlNfMatch[1],
          replace: xmlNfMatch[2],
          raw: xmlNfMatch[0],
          index: xmlNfMatch.index,
        });
      }
    }

    return results;
  }

  function parseFileEdits(text) {
    return parseAllEdits(text);
  }

  function normalizeWhitespace(str) {
    return str.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
  }

  function fuzzyMatch(haystack, needle) {
    if (haystack.includes(needle)) return { exact: true, index: haystack.indexOf(needle) };

    const normHay = normalizeWhitespace(haystack);
    const normNeedle = normalizeWhitespace(needle);
    if (normHay.includes(normNeedle)) return { exact: false, index: normHay.indexOf(normNeedle), normalized: true };

    const trimmedHay = haystack.split('\n').map(l => l.trimEnd()).join('\n');
    const trimmedNeedle = needle.split('\n').map(l => l.trimEnd()).join('\n');
    if (trimmedHay.includes(trimmedNeedle)) return { exact: false, index: trimmedHay.indexOf(trimmedNeedle), trimmed: true };

    return null;
  }

  function applyEditsFromContent(content) {
    const edits = parseFileEdits(content);
    if (edits.length === 0) return false;

    let applied = false;

    edits.forEach(edit => {
      let targetFile = null;
      let targetIdx = -1;

      if (edit.filename) {
        targetIdx = files.findIndex(f => f.name === edit.filename);
        if (targetIdx >= 0) targetFile = files[targetIdx];

        if (!targetFile) {
          targetIdx = files.findIndex(f =>
            f.name.endsWith('/' + edit.filename) || f.name.endsWith('\\' + edit.filename)
          );
          if (targetIdx >= 0) targetFile = files[targetIdx];
        }
      }

      if (!targetFile && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          if (fuzzyMatch(files[i].code, edit.search)) {
            targetFile = files[i];
            targetIdx = i;
            break;
          }
        }
      }

      if (targetFile) {
        const match = fuzzyMatch(targetFile.code, edit.search);
        if (match) {
          const previousCode = targetFile.code;
          if (match.exact) {
            targetFile.code = targetFile.code.replace(edit.search, edit.replace);
          } else if (match.normalized || match.trimmed) {
            const normCode = match.normalized
              ? normalizeWhitespace(targetFile.code)
              : targetFile.code.split('\n').map(l => l.trimEnd()).join('\n');
            const normSearch = match.normalized
              ? normalizeWhitespace(edit.search)
              : edit.search.split('\n').map(l => l.trimEnd()).join('\n');
            const idx = normCode.indexOf(normSearch);
            if (idx >= 0) {
              const before = targetFile.code.substring(0, idx);
              const after = targetFile.code.substring(idx + normSearch.length);
              targetFile.code = before + edit.replace + after;
            }
          }
          targetFile.previousCode = previousCode;
          targetFile.hasChanges = true;
          applied = true;
        }
      }
    });

    if (applied) {
      renderTabs(getActiveTabsContainer());
      if (!isMobileModalOpen()) renderTabs(tabsContainer);
      if (activeFileIndex >= 0) {
        showFile(activeFileIndex);
      }
      updateFab();
      updateDesktopVisibility();
      if (onFilesChanged) onFilesChanged(files);
    }

    return applied;
  }

  const SHELL_LANGS = ['sh', 'bash', 'zsh', 'shell', 'bat', 'cmd', 'powershell', 'ps1'];

  function isShellLang(lang) {
    return SHELL_LANGS.includes((lang || '').toLowerCase());
  }

  function addFilesFromContent(content) {
    const blocks = extractCodeBlocks(content);
    if (blocks.length === 0) return;

    let changed = false;
    blocks.forEach(block => {
      if (isShellLang(block.lang)) return;

      const filename = block.filename || '';

      if (filename) {
        const existingIdx = files.findIndex(f => f.name === filename);
        if (existingIdx >= 0) {
          const existing = files[existingIdx];
          if (existing.code !== block.code) {
            existing.previousCode = existing.code;
            existing.code = block.code;
            existing.lang = block.lang || existing.lang;
            existing.monacoLang = langToMonaco(existing.lang);
            existing.hasChanges = true;
            changed = true;
          }
          return;
        }
      }

      const dedupMatch = files.find(f =>
        f.lang === block.lang && f.code === block.code && !block.filename
      );
      if (dedupMatch) return;

      const name = filename || guessFilename(block.lang, files.length);
      const lang = block.lang || guessLangFromFilename(name);
      files.push({
        name,
        lang,
        monacoLang: langToMonaco(lang),
        code: block.code,
        previousCode: undefined,
        hasChanges: false,
      });
      changed = true;
    });

    if (changed) {
      if (activeFileIndex < 0) activeFileIndex = 0;
      renderTabs(getActiveTabsContainer());
      if (!isMobileModalOpen()) renderTabs(tabsContainer);
      showFile(files.length - 1);
      updateFab();
      updateDesktopVisibility();
      if (onFilesChanged) onFilesChanged(files);
    }
  }

  function renderTabs(container) {
    if (!container) return;
    container.innerHTML = '';
    files.forEach((file, i) => {
      const tab = document.createElement('button');
      tab.className = 'editor-tab' + (i === activeFileIndex ? ' active' : '');
      const changeIndicator = file.hasChanges ? '<span class="editor-tab-changed">●</span>' : '';
      tab.innerHTML = `
        <span>${Components.escHtml(file.name)}</span>
        ${changeIndicator}
        <span class="editor-tab-lang">${Components.escHtml(file.lang || 'txt')}</span>
        <span class="editor-tab-close" data-close="${i}">✕</span>`;
      tab.addEventListener('click', (e) => {
        if (e.target.dataset.close !== undefined) {
          removeFile(parseInt(e.target.dataset.close));
          return;
        }
        showFile(i);
      });
      container.appendChild(tab);
    });
  }

  function showFile(index) {
    if (index < 0 || index >= files.length) return;
    syncEditorToFile();
    activeFileIndex = index;
    renderTabs(getActiveTabsContainer());
    if (!isMobileModalOpen()) renderTabs(tabsContainer);
    const file = files[index];
    if (isDiffMode && file.previousCode !== undefined) {
      initDiffIn(getActiveContainer(), file);
    } else {
      initMonacoIn(getActiveContainer(), file);
    }
  }

  function syncEditorToFile() {
  }

  function disposeEditors() {
    if (monacoEditor) {
      monacoEditor.dispose();
      monacoEditor = null;
    }
    if (diffEditor) {
      diffEditor.dispose();
      diffEditor = null;
    }
  }

  function toggleDiffView() {
    isDiffMode = !isDiffMode;
    const file = activeFileIndex >= 0 ? files[activeFileIndex] : null;
    if (!file) return;

    if (isDiffMode && file.previousCode !== undefined) {
      initDiffIn(getActiveContainer(), file);
    } else {
      isDiffMode = false;
      initMonacoIn(getActiveContainer(), file);
    }

    updateDiffButtons();
  }

  function updateDiffButtons() {
    const desktopBtn = desktopPane?.querySelector('[data-action="toggle-diff"]');
    if (desktopBtn) {
      desktopBtn.textContent = isDiffMode ? 'Editor' : 'Diff';
    }
    const mobileBtn = mobileModal?.querySelector('[data-action="diff"]');
    if (mobileBtn) {
      mobileBtn.textContent = isDiffMode ? 'Editor' : 'Diff';
    }
  }

  function removeFile(index) {
    if (index < 0 || index >= files.length) return;
    files.splice(index, 1);
    if (files.length === 0) {
      activeFileIndex = -1;
      disposeEditors();
      showEmptyState(getActiveContainer());
      if (!isMobileModalOpen()) showEmptyState(editorContainer);
    } else {
      if (activeFileIndex >= files.length) activeFileIndex = files.length - 1;
      showFile(activeFileIndex);
    }
    renderTabs(getActiveTabsContainer());
    if (!isMobileModalOpen()) renderTabs(tabsContainer);
    updateFab();
    updateDesktopVisibility();
    if (onFilesChanged) onFilesChanged(files);
  }

  function showEmptyState(container) {
    if (!container) return;
    container.innerHTML = `
      <div class="editor-empty">
        <div class="editor-empty-icon">📄</div>
        <div class="editor-empty-text">No code files yet</div>
      </div>`;
  }

  async function initMonacoIn(container, file) {
    if (!container || !file) return;

    await window.MonacoReady;

    disposeEditors();
    container.innerHTML = '';

    monacoEditor = monaco.editor.create(container, {
      value: file.code,
      language: file.monacoLang,
      theme: 'llmplayground',
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      lineNumbers: 'on',
      renderLineHighlight: 'line',
      automaticLayout: true,
      readOnly: true,
      padding: { top: 8, bottom: 8 },
      scrollbar: {
        verticalScrollbarSize: 6,
        horizontalScrollbarSize: 6,
      },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      contextmenu: true,
      tabSize: 2,
    });
  }

  async function initDiffIn(container, file) {
    if (!container || !file) return;

    await window.MonacoReady;

    disposeEditors();
    container.innerHTML = '';

    const originalModel = monaco.editor.createModel(
      file.previousCode || '',
      file.monacoLang
    );
    const modifiedModel = monaco.editor.createModel(
      file.code,
      file.monacoLang
    );

    diffEditor = monaco.editor.createDiffEditor(container, {
      theme: 'llmplayground',
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      automaticLayout: true,
      readOnly: true,
      padding: { top: 8, bottom: 8 },
      scrollbar: {
        verticalScrollbarSize: 6,
        horizontalScrollbarSize: 6,
      },
      renderSideBySide: window.innerWidth >= 768,
      enableSplitViewResizing: true,
      originalEditable: false,
    });

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });
  }

  function downloadActiveFile() {
    syncEditorToFile();
    if (activeFileIndex < 0 || activeFileIndex >= files.length) {
      Components.toast('No file selected', 'info');
      return;
    }
    const file = files[activeFileIndex];
    const blob = new Blob([file.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    Components.toast(`Downloaded ${file.name}`, 'success');
  }

  function downloadAllFiles() {
    syncEditorToFile();
    if (files.length === 0) {
      Components.toast('No files to download', 'info');
      return;
    }
    files.forEach(file => {
      const blob = new Blob([file.code], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    });
    Components.toast(`Downloaded ${files.length} file(s)`, 'success');
  }

  function updateFab() {
    if (!fab) return;
    const badge = fab.querySelector('.fab-badge');
    if (files.length > 0) {
      if (badge) {
        badge.textContent = files.length;
      } else {
        const b = document.createElement('span');
        b.className = 'fab-badge';
        b.textContent = files.length;
        fab.appendChild(b);
      }
      fab.style.display = '';
    } else {
      fab.style.display = 'none';
    }
  }

  function updateDesktopVisibility() {
    if (!desktopPane) return;
    if (files.length > 0) {
      desktopPane.classList.add('visible');
    } else {
      desktopPane.classList.remove('visible');
    }
  }

  function getFilesContext() {
    syncEditorToFile();
    if (files.length === 0) return '';
    let ctx = '<current_files>\n';
    files.forEach(file => {
      ctx += `<file name="${file.name}" lang="${file.lang}">\n${file.code}\n</file>\n`;
    });
    ctx += '</current_files>';
    return ctx;
  }

  function reset() {
    files = [];
    activeFileIndex = -1;
    isDiffMode = false;
    disposeEditors();
    if (tabsContainer) tabsContainer.innerHTML = '';
    if (editorContainer) showEmptyState(editorContainer);
    if (mobileTabsContainer) mobileTabsContainer.innerHTML = '';
    if (mobileEditorContainer) showEmptyState(mobileEditorContainer);
    updateFab();
    updateDesktopVisibility();
    updateDiffButtons();
  }

  function destroy() {
    disposeEditors();
    if (fab) {
      fab.remove();
      fab = null;
    }
    if (mobileModal) {
      mobileModal.remove();
      mobileModal = null;
    }
    files = [];
    activeFileIndex = -1;
    isDiffMode = false;
  }

  function getFiles() {
    syncEditorToFile();
    return files.slice();
  }

  return {
    init,
    addFilesFromContent,
    applyEditsFromContent,
    getFilesContext,
    reset,
    destroy,
    getFiles,
    extractCodeBlocks,
  };
})();
