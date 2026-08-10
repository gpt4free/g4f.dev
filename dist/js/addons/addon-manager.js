/* ------------------------------------------------------------------ *
 * Addon Manager Overlay — enable/disable/reload addons, discover      *
 * `.pa.js` workspace addons, review requested permissions.            *
 * ------------------------------------------------------------------ */

(function (global) {
    'use strict';

    const CSS_ID = 'chat-addon-manager-css';
    const OVERLAY_ID = 'chat-addon-manager';

    const css = `
#chat-addon-manager { position: fixed; inset: 0; z-index: 10000; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.55); font-family: inherit; }
#chat-addon-manager.open { display: flex; }
#chat-addon-manager .am-panel { width: min(760px, 94vw); max-height: 86vh; background: var(--background, #1e1e2e); color: var(--text, #e0e0e0); border: 1px solid var(--border, #333); border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.5); display: flex; flex-direction: column; overflow: hidden; }
#chat-addon-manager .am-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border, #333); }
#chat-addon-manager .am-head h2 { margin: 0; font-size: 18px; display: flex; align-items: center; gap: 10px; }
#chat-addon-manager .am-close { background: none; border: none; color: inherit; font-size: 20px; cursor: pointer; opacity: .7; }
#chat-addon-manager .am-close:hover { opacity: 1; }
#chat-addon-manager .am-body { overflow-y: auto; padding: 14px 20px 20px; }
#chat-addon-manager .am-section-title { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; opacity: .6; margin: 18px 0 8px; }
#chat-addon-manager .am-card { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; border: 1px solid var(--border, #333); border-radius: 10px; margin-bottom: 8px; background: rgba(255,255,255,.02); }
#chat-addon-manager .am-card .am-info { flex: 1; min-width: 0; }
#chat-addon-manager .am-card .am-name { font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
#chat-addon-manager .am-card .am-badge { font-size: 10px; padding: 2px 8px; border-radius: 20px; background: var(--accent, #4a9eff); color: #fff; text-transform: uppercase; letter-spacing: .04em; }
#chat-addon-manager .am-card .am-badge.workspace { background: #8b5cf6; }
#chat-addon-manager .am-card .am-desc { font-size: 13px; opacity: .75; margin: 4px 0 6px; }
#chat-addon-manager .am-card .am-meta { font-size: 11px; opacity: .5; }
#chat-addon-manager .am-card .am-perms { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
#chat-addon-manager .am-card .am-perm { font-size: 10px; padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,.06); border: 1px solid var(--border, #333); cursor: help; }
#chat-addon-manager .am-card .am-perm.denied { background: rgba(220,60,60,.15); border-color: rgba(220,60,60,.4); }
#chat-addon-manager .am-switch { position: relative; flex-shrink: 0; width: 42px; height: 24px; margin-top: 4px; }
#chat-addon-manager .am-switch input { opacity: 0; width: 0; height: 0; }
#chat-addon-manager .am-switch .slider { position: absolute; inset: 0; background: #555; border-radius: 24px; transition: .2s; cursor: pointer; }
#chat-addon-manager .am-switch .slider::before { content: ""; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: .2s; }
#chat-addon-manager .am-switch input:checked + .slider { background: var(--accent, #4a9eff); }
#chat-addon-manager .am-switch input:checked + .slider::before { transform: translateX(18px); }
#chat-addon-manager .am-actions { display: flex; gap: 8px; margin-top: 10px; }
#chat-addon-manager .am-btn { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border, #333); background: rgba(255,255,255,.05); color: inherit; cursor: pointer; font-size: 12px; }
#chat-addon-manager .am-btn:hover { background: rgba(255,255,255,.12); }
#chat-addon-manager .am-btn.danger { color: #ff6b6b; border-color: rgba(255,107,107,.4); }
#chat-addon-manager .am-empty { opacity: .55; font-size: 13px; padding: 12px 4px; }
#chat-addon-manager .am-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px; border-top: 1px solid var(--border, #333); }
#chat-addon-manager .am-error { color: #ff6b6b; font-size: 12px; margin-top: 8px; }
#chat-addon-manager .am-trust-panel { border: 1px solid rgba(139,92,246,.5); background: rgba(139,92,246,.08); border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; }
#chat-addon-manager .am-trust-panel .am-perm-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
`;

    // ------------------------------------------------------------------
    function ensureCss() {
        if (document.getElementById(CSS_ID)) return;
        const style = document.createElement('style');
        style.id = CSS_ID;
        style.textContent = css;
        document.head.appendChild(style);
    }

    function ensureButton() {
        if (document.getElementById('chat-addon-manager-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'chat-addon-manager-btn';
        btn.title = 'Addon Manager';
        btn.setAttribute('aria-label', 'Open Addon Manager');
        btn.innerHTML = '<i class="fa-solid fa-puzzle-piece" aria-hidden="true"></i>';
        btn.style.cssText = `
            position: fixed; bottom: 84px; right: 18px; z-index: 9000;
            width: 44px; height: 44px; border-radius: 50%;
            border: 1px solid var(--border, #333); cursor: pointer;
            background: var(--background, #1e1e2e); color: var(--text, #e0e0e0);
            display: flex; align-items: center; justify-content: center;
            font-size: 18px; box-shadow: 0 4px 16px rgba(0,0,0,.35);
            transition: transform .15s, opacity .15s;
        `;
        btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.08)'; });
        btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
        btn.addEventListener('click', () => openManager());
        document.body.appendChild(btn);
    }

    // ------------------------------------------------------------------
    function permLabel(key) {
        const perm = (global.ChatAddons?.PERMISSIONS || {})[key];
        return perm || key;
    }

    function renderCard(addon, requestedPerms) {
        const { ChatAddons } = global;
        const enabled = ChatAddons.isEnabled(addon.id);
        const trusted = ChatAddons.isTrusted(addon.id);
        const perms = requestedPerms && requestedPerms.length
            ? requestedPerms
            : (addon.permissions || []);

        const card = document.createElement('div');
        card.className = 'am-card';
        card.dataset.addonId = addon.id;

        const permsHtml = perms.length
            ? `<div class="am-perms">${perms.map(p =>
                `<span class="am-perm ${addon.builtin ? '' : 'denied'}" title="${permLabel(p).replace(/"/g, '&quot;')}">${p}</span>`
              ).join('')}</div>`
            : '';

        card.innerHTML = `
            <div class="am-info">
                <div class="am-name">
                    <span>${escapeHtml(addon.name)}</span>
                    <span class="am-badge ${addon.builtin ? '' : 'workspace'}">${addon.builtin ? 'built-in' : 'workspace'}</span>
                    ${addon.version ? `<span class="am-meta">v${escapeHtml(addon.version)}</span>` : ''}
                </div>
                <div class="am-desc">${escapeHtml(addon.description || '')}</div>
                <div class="am-meta">${escapeHtml(addon.author || 'unknown')}${addon.builtin ? '' : ' &middot; ' + escapeHtml(addon.id)}</div>
                ${permsHtml}
                <div class="am-actions">
                    ${addon.builtin ? '' : `
                        <button class="am-btn ${trusted ? '' : 'danger'}" data-act="trust">${trusted ? 'Revoke trust' : 'Trust & enable'}</button>
                        <button class="am-btn danger" data-act="uninstall">Uninstall</button>
                    `}
                </div>
                <div class="am-error" style="display:none"></div>
            </div>
            <label class="am-switch">
                <input type="checkbox" data-act="toggle" ${enabled ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        `;

        card.querySelector('[data-act="toggle"]').addEventListener('change', async (e) => {
            await handleToggle(addon, e.target.checked, card);
        });

        const trustBtn = card.querySelector('[data-act="trust"]');
        if (trustBtn) trustBtn.addEventListener('click', async () => {
            if (ChatAddons.isTrusted(addon.id)) {
                ChatAddons.setTrusted(addon.id, false);
                if (ChatAddons.isEnabled(addon.id)) {
                    await ChatAddons.disable(addon.id);
                }
                renderList();
                return;
            }
            const ok = await confirmTrust(addon);
            if (!ok) return;
            ChatAddons.setTrusted(addon.id, true);
            try {
                await ChatAddons.enable(addon.id);
            } catch (err) {
                showCardError(card, err);
            }
            renderList();
        });

        const uninstallBtn = card.querySelector('[data-act="uninstall"]');
        if (uninstallBtn) uninstallBtn.addEventListener('click', async () => {
            if (!confirm(`Uninstall addon "${addon.name}"?\n(It will be removed from the manager; the .pa.js file stays in your workspace.)`)) return;
            await ChatAddons.disable(addon.id).catch(() => {});
            ChatAddons.setTrusted(addon.id, false);
            removeWorkspaceRegistration(addon.id);
            renderList();
        });

        return card;
    }

    async function handleToggle(addon, enabled, card) {
        const { ChatAddons } = global;
        const errorEl = card.querySelector('.am-error');
        errorEl.style.display = 'none';
        try {
            if (enabled) {
                if (!addon.builtin && !ChatAddons.isTrusted(addon.id)) {
                    const ok = await confirmTrust(addon);
                    if (!ok) { renderList(); return; }
                    ChatAddons.setTrusted(addon.id, true);
                }
                await ChatAddons.enable(addon.id);
            } else {
                await ChatAddons.disable(addon.id);
            }
        } catch (err) {
            showCardError(card, err);
            renderList();
        }
    }

    function showCardError(card, err) {
        const errorEl = card.querySelector('.am-error');
        if (!errorEl) return;
        errorEl.style.display = 'block';
        errorEl.textContent = err?.message || String(err);
    }

    function confirmTrust(addon) {
        return new Promise((resolve) => {
            const perms = (addon.permissions || []).map(permLabel).join('<br>• ') || 'No permissions requested';
            const panel = document.createElement('div');
            panel.className = 'am-trust-panel';
            panel.innerHTML = `
                <div><strong>Trust "${escapeHtml(addon.name)}"?</strong></div>
                <div class="am-meta">${escapeHtml(addon.id)}</div>
                <div class="am-perm-list" style="margin-top:8px"><div>This addon requests:</div>
                    <span class="am-perm" style="display:block;margin-top:6px">• ${perms}</span>
                </div>
                <div class="am-actions">
                    <button class="am-btn" data-act="trust-yes">Trust</button>
                    <button class="am-btn danger" data-act="trust-no">Cancel</button>
                </div>
            `;
            panel.querySelector('[data-act="trust-yes"]').addEventListener('click', () => {
                panel.remove(); resolve(true);
            });
            panel.querySelector('[data-act="trust-no"]').addEventListener('click', () => {
                panel.remove(); resolve(false);
            });
            const body = document.getElementById('chat-addon-manager-body');
            body.prepend(panel);
        });
    }

    function removeWorkspaceRegistration(id) {
        // Drop from registry without deleting the file.
        const { ChatAddons } = global;
        const key = 'chat.addons.removed.v1';
        let removed = [];
        try { removed = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
        if (!removed.includes(id)) removed.push(id);
        localStorage.setItem(key, JSON.stringify(removed));
    }

    function isRemoved(id) {
        try {
            const removed = JSON.parse(localStorage.getItem('chat.addons.removed.v1') || '[]');
            return removed.includes(id);
        } catch (e) { return false; }
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function renderList() {
        const body = document.getElementById('chat-addon-manager-body');
        if (!body) return;
        body.innerHTML = '';

        const { ChatAddons } = global;
        const builtins = ChatAddons.list().filter(a => a.builtin);
        const workspace = ChatAddons.list().filter(a => !a.builtin && !isRemoved(a.id));

        const addSection = (title, addons) => {
            if (!addons.length) return;
            const h = document.createElement('div');
            h.className = 'am-section-title';
            h.textContent = title;
            body.appendChild(h);
            for (const a of addons) body.appendChild(renderCard(a));
        };

        addSection('Built-in addons', builtins);

        // Workspace section with refresh button
        const wsTitle = document.createElement('div');
        wsTitle.className = 'am-section-title';
        wsTitle.style.display = 'flex';
        wsTitle.style.alignItems = 'center';
        wsTitle.style.justifyContent = 'space-between';
        wsTitle.innerHTML = `<span>Workspace addons (.pa.js)</span>
            <button class="am-btn" id="am-refresh-ws" title="Scan MCP workspace for .pa.js addons"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Rescan</button>`;
        body.appendChild(wsTitle);

        const wsContainer = document.createElement('div');
        wsContainer.id = 'am-ws-container';
        body.appendChild(wsContainer);

        renderWorkspaceList(wsContainer);

        if (!builtins.length && !workspace.length) {
            const empty = document.createElement('div');
            empty.className = 'am-empty';
            empty.textContent = 'No addons found. Place .pa.js files in your MCP workspace (pa-providers/) and press Rescan.';
            body.appendChild(empty);
        }

        const refreshBtn = document.getElementById('am-refresh-ws');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Scanning...';
                await scanWorkspace();
                renderList();
            });
        }
    }

    async function scanWorkspace() {
        const { ChatAddons, ChatAddonHost } = global;
        if (!ChatAddonHost) return;
        await ChatAddons.discoverWorkspaceAddons();
    }

    async function renderWorkspaceList(container) {
        const { ChatAddons } = global;
        const workspace = ChatAddons.list().filter(a => !a.builtin && !isRemoved(a.id));
        if (workspace.length) {
            for (const a of workspace) container.appendChild(renderCard(a));
            return;
        }
        // Not yet discovered — try scan.
        container.innerHTML = '<div class="am-empty">Scanning workspace for .pa.js addons…</div>';
        await scanWorkspace();
        const again = ChatAddons.list().filter(a => !a.builtin && !isRemoved(a.id));
        container.innerHTML = '';
        if (again.length) {
            for (const a of again) container.appendChild(renderCard(a));
        } else {
            container.innerHTML = '<div class="am-empty">No .pa.js addons found in the MCP workspace (pa-providers/).<br>Drop a file there and press Rescan.</div>';
        }
    }

    // ------------------------------------------------------------------
    function openManager() {
        ensureCss();
        let overlay = document.getElementById(OVERLAY_ID);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = OVERLAY_ID;
            overlay.innerHTML = `
                <div class="am-panel" role="dialog" aria-modal="true" aria-label="Addon Manager">
                    <div class="am-head">
                        <h2><i class="fa-solid fa-puzzle-piece" aria-hidden="true"></i> Addon Manager</h2>
                        <button class="am-close" aria-label="Close addon manager"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                    </div>
                    <div class="am-body" id="chat-addon-manager-body"></div>
                    <div class="am-foot">
                        <span style="font-size:11px;opacity:.55;margin-right:auto">Addons run sandboxed. Workspace addons need your explicit trust before enabling.</span>
                        <button class="am-btn" id="am-close">Close</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.querySelector('.am-close').addEventListener('click', closeManager);
            overlay.querySelector('#am-close').addEventListener('click', closeManager);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) closeManager(); });
        }
        overlay.classList.add('open');
        renderList();
    }

    function closeManager() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) overlay.classList.remove('open');
    }

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------
    function init() {
        ensureCss();
        ensureButton();
        if (global.ChatAddons) {
            global.ChatAddons.boot().then(() => {
                scanWorkspace();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    global.ChatAddonManager = { open: openManager, close: closeManager, scan: scanWorkspace };
})(window);

export default window.ChatAddonManager;