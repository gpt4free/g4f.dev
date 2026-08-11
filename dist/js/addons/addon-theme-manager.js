/* ================================================================== *
 * Addon: Advanced Theme Manager
 *
 * Full theme management system with preset themes, custom theme
 * editor, live preview, import/export, auto day/night switching,
 * and per-element CSS variable overrides.
 *
 * Uses: dom:write, dom:read, storage:local, ui:notify
 * ================================================================== */

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // CSS variable definitions — the full surface we can manipulate
    // ------------------------------------------------------------------
    const THEME_VARS = {
        'background':       { label: 'Background',          group: 'base',   type: 'color' },
        'colour-1':         { label: 'Primary Surface',     group: 'base',   type: 'color' },
        'colour-2':         { label: 'Secondary Text',       group: 'base',   type: 'color' },
        'colour-3':         { label: 'Body Text',            group: 'base',   type: 'color' },
        'colour-4':         { label: 'Muted Text',           group: 'base',   type: 'color' },
        'colour-5':         { label: 'Surface Alt',          group: 'base',   type: 'color' },
        'colour-6':         { label: 'Surface Elevated',     group: 'base',   type: 'color' },
        'accent':           { label: 'Accent',              group: 'accent', type: 'color' },
        'accent-hover':     { label: 'Accent Hover',         group: 'accent', type: 'color' },
        'accent-glow':      { label: 'Accent Glow',          group: 'accent', type: 'color' },
        'blur-bg':          { label: 'Glass Background',     group: 'glass',  type: 'color' },
        'blur-border':      { label: 'Glass Border',          group: 'glass',  type: 'color' },
        'user-input':       { label: 'Input Text',            group: 'chat',   type: 'color' },
        'conversations':    { label: 'Sidebar Text',          group: 'chat',   type: 'color' },
        'conversations-hover': { label: 'Sidebar Hover',       group: 'chat',   type: 'color' },
        'input-bg':         { label: 'Input Background',      group: 'chat',   type: 'color' },
        'user-msg-bg':      { label: 'User Message BG',       group: 'chat',   type: 'color' },
        'user-msg-border':  { label: 'User Message Border',   group: 'chat',   type: 'color' },
        'scrollbar':        { label: 'Scrollbar Track',       group: 'misc',   type: 'color' },
        'scrollbar-thumb':  { label: 'Scrollbar Thumb',       group: 'misc',   type: 'color' },
        'button-hover':     { label: 'Button Hover BG',       group: 'misc',   type: 'color' },
        'font-1':           { label: 'Primary Font',           group: 'typo',   type: 'font'  },
        'border-radius-1':  { label: 'Radius Small',           group: 'shape',  type: 'text'  },
        'border-radius-2':  { label: 'Radius Large',           group: 'shape',  type: 'text'  },
        'transition-speed': { label: 'Transition Speed',       group: 'shape',  type: 'text'  },
    };

    // ------------------------------------------------------------------
    // Preset themes
    // ------------------------------------------------------------------
    const PRESETS = {
        'midnight-purple': {
            name: 'Midnight Purple',
            description: 'Default dark purple theme',
            vars: {
                'background': '#0f0b17',
                'colour-1': '#0d0d14',
                'colour-2': '#ccc',
                'colour-3': '#e8d8ff',
                'colour-4': '#f0f0f0',
                'colour-5': '#1a1525',
                'colour-6': '#242430',
                'accent': '#8b3dff',
                'accent-hover': '#9d56ff',
                'accent-glow': 'rgba(139, 61, 255, 0.25)',
                'blur-bg': '#16101b80',
                'blur-border': '#8471904d',
                'user-input': '#ac87bb',
                'conversations': '#c7a2ff',
                'conversations-hover': '#c7a2ff26',
                'input-bg': '#1a1525',
                'user-msg-bg': 'rgba(139, 61, 255, 0.15)',
                'user-msg-border': 'rgba(139, 61, 255, 0.3)',
            },
        },
        'ocean-blue': {
            name: 'Ocean Blue',
            description: 'Deep blue with cyan accents',
            vars: {
                'background': '#0a0f1a',
                'colour-1': '#0d1117',
                'colour-2': '#8ab4d8',
                'colour-3': '#c5e4f3',
                'colour-4': '#e0e0e0',
                'colour-5': '#101b30',
                'colour-6': '#152238',
                'accent': '#00b4d8',
                'accent-hover': '#48cae4',
                'accent-glow': 'rgba(0, 180, 216, 0.25)',
                'blur-bg': '#0a152580',
                'blur-border': '#3a60804d',
                'user-input': '#5eb3d8',
                'conversations': '#90cdf4',
                'conversations-hover': '#90cdf426',
                'input-bg': '#101b30',
                'user-msg-bg': 'rgba(0, 180, 216, 0.15)',
                'user-msg-border': 'rgba(0, 180, 216, 0.3)',
            },
        },
        'forest-green': {
            name: 'Forest Green',
            description: 'Earthy green with sage accents',
            vars: {
                'background': '#0a1410',
                'colour-1': '#0d1a14',
                'colour-2': '#8ab87a',
                'colour-3': '#c5e4c0',
                'colour-4': '#e0e0e0',
                'colour-5': '#102818',
                'colour-6': '#153020',
                'accent': '#4ade80',
                'accent-hover': '#86efac',
                'accent-glow': 'rgba(74, 222, 128, 0.25)',
                'blur-bg': '#0a201080',
                'blur-border': '#3a80404d',
                'user-input': '#5eb378',
                'conversations': '#90df90',
                'conversations-hover': '#90df9026',
                'input-bg': '#102818',
                'user-msg-bg': 'rgba(74, 222, 128, 0.15)',
                'user-msg-border': 'rgba(74, 222, 128, 0.3)',
            },
        },
        'rose-pink': {
            name: 'Rose Pink',
            description: 'Warm dark with rose accents',
            vars: {
                'background': '#140a10',
                'colour-1': '#1a0d14',
                'colour-2': '#d8a8c0',
                'colour-3': '#f3c5e4',
                'colour-4': '#e0e0e0',
                'colour-5': '#251020',
                'colour-6': '#302028',
                'accent': '#ec4899',
                'accent-hover': '#f472b6',
                'accent-glow': 'rgba(236, 72, 153, 0.25)',
                'blur-bg': '#1a0a1480',
                'blur-border': '#8040604d',
                'user-input': '#d87ab0',
                'conversations': '#f490c0',
                'conversations-hover': '#f490c026',
                'input-bg': '#251020',
                'user-msg-bg': 'rgba(236, 72, 153, 0.15)',
                'user-msg-border': 'rgba(236, 72, 153, 0.3)',
            },
        },
        'amber-dark': {
            name: 'Amber Dark',
            description: 'Dark with warm amber accents',
            vars: {
                'background': '#14100a',
                'colour-1': '#1a140d',
                'colour-2': '#d8c0a8',
                'colour-3': '#f3e0c5',
                'colour-4': '#e0e0e0',
                'colour-5': '#252010',
                'colour-6': '#302820',
                'accent': '#f59e0b',
                'accent-hover': '#fbbf24',
                'accent-glow': 'rgba(245, 158, 11, 0.25)',
                'blur-bg': '#1a140a80',
                'blur-border': '#8060404d',
                'user-input': '#d8a05e',
                'conversations': '#f4c090',
                'conversations-hover': '#f4c09026',
                'input-bg': '#252010',
                'user-msg-bg': 'rgba(245, 158, 11, 0.15)',
                'user-msg-border': 'rgba(245, 158, 11, 0.3)',
            },
        },
        'monochrome': {
            name: 'Monochrome',
            description: 'Pure grayscale minimal theme',
            vars: {
                'background': '#0a0a0a',
                'colour-1': '#111',
                'colour-2': '#999',
                'colour-3': '#ddd',
                'colour-4': '#e0e0e0',
                'colour-5': '#1a1a1a',
                'colour-6': '#222',
                'accent': '#888',
                'accent-hover': '#aaa',
                'accent-glow': 'rgba(136, 136, 136, 0.25)',
                'blur-bg': '#11111180',
                'blur-border': '#4444444d',
                'user-input': '#777',
                'conversations': '#bbb',
                'conversations-hover': '#bbbbbb26',
                'input-bg': '#1a1a1a',
                'user-msg-bg': 'rgba(136, 136, 136, 0.15)',
                'user-msg-border': 'rgba(136, 136, 136, 0.3)',
            },
        },
        'light-clean': {
            name: 'Light Clean',
            description: 'Bright light theme',
            vars: {
                'background': '#f5f5f5',
                'colour-1': '#ffffff',
                'colour-2': '#555',
                'colour-3': '#222',
                'colour-4': '#333',
                'colour-5': '#e8e8e8',
                'colour-6': '#dcdcdc',
                'accent': '#6d28d9',
                'accent-hover': '#7c3aed',
                'accent-glow': 'rgba(109, 40, 217, 0.15)',
                'blur-bg': '#ffffff80',
                'blur-border': '#0000001a',
                'user-input': '#444',
                'conversations': '#333',
                'conversations-hover': '#33333326',
                'input-bg': '#e8e8e8',
                'user-msg-bg': 'rgba(109, 40, 217, 0.08)',
                'user-msg-border': 'rgba(109, 40, 217, 0.2)',
            },
        },
        'solarized': {
            name: 'Solarized',
            description: 'Classic Solarized dark palette',
            vars: {
                'background': '#002b36',
                'colour-1': '#073642',
                'colour-2': '#839496',
                'colour-3': '#93a1a1',
                'colour-4': '#eee8d5',
                'colour-5': '#073642',
                'colour-6': '#0d3a48',
                'accent': '#268bd2',
                'accent-hover': '#3aa3e8',
                'accent-glow': 'rgba(38, 139, 210, 0.25)',
                'blur-bg': '#07364280',
                'blur-border': '#586e754d',
                'user-input': '#839496',
                'conversations': '#93a1a1',
                'conversations-hover': '#93a1a126',
                'input-bg': '#073642',
                'user-msg-bg': 'rgba(38, 139, 210, 0.15)',
                'user-msg-border': 'rgba(38, 139, 210, 0.3)',
            },
        },
        'dracula': {
            name: 'Dracula',
            description: 'Popular Dracula color scheme',
            vars: {
                'background': '#282a36',
                'colour-1': '#21222c',
                'colour-2': '#6272a4',
                'colour-3': '#f8f8f2',
                'colour-4': '#e0e0e0',
                'colour-5': '#343746',
                'colour-6': '#3a3d4d',
                'accent': '#bd93f9',
                'accent-hover': '#caa6ff',
                'accent-glow': 'rgba(189, 147, 249, 0.25)',
                'blur-bg': '#21222c80',
                'blur-border': '#6272a44d',
                'user-input': '#bd93f9',
                'conversations': '#f8f8f2',
                'conversations-hover': '#f8f8f226',
                'input-bg': '#343746',
                'user-msg-bg': 'rgba(189, 147, 249, 0.15)',
                'user-msg-border': 'rgba(189, 147, 249, 0.3)',
            },
        },
        'nordic': {
            name: 'Nordic',
            description: 'Nord color palette',
            vars: {
                'background': '#2e3440',
                'colour-1': '#242933',
                'colour-2': '#81a1c1',
                'colour-3': '#d8dee9',
                'colour-4': '#e5e9f0',
                'colour-5': '#2e3440',
                'colour-6': '#3b4252',
                'accent': '#88c0d0',
                'accent-hover': '#8fbcbb',
                'accent-glow': 'rgba(136, 192, 208, 0.25)',
                'blur-bg': '#2e344080',
                'blur-border': '#4c566a4d',
                'user-input': '#81a1c1',
                'conversations': '#d8dee9',
                'conversations-hover': '#d8dee926',
                'input-bg': '#3b4252',
                'user-msg-bg': 'rgba(136, 192, 208, 0.15)',
                'user-msg-border': 'rgba(136, 192, 208, 0.3)',
            },
        },
    };

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    const STORAGE_KEY = 'chat.theme-manager';
    const CSS_ID = 'theme-manager-custom-vars';
    const OVERLAY_ID = 'theme-manager-overlay';
    const FLOATING_BTN_ID = 'theme-manager-fab';

    let currentTheme = null;       // preset key or 'custom'
    let customVars = {};             // overrides on top of preset
    let autoDayNight = false;
    let autoDayTheme = 'light-clean';
    let autoNightTheme = 'midnight-purple';
    let liquidMode = false;
    let noAnimations = false;
    let previewVars = null;         // temp vars during live preview

    // ------------------------------------------------------------------
    // Persistence
    // ------------------------------------------------------------------
    function loadConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const cfg = JSON.parse(raw);
            currentTheme = cfg.currentTheme || null;
            customVars = cfg.customVars || {};
            autoDayNight = !!cfg.autoDayNight;
            autoDayTheme = cfg.autoDayTheme || 'light-clean';
            autoNightTheme = cfg.autoNightTheme || 'midnight-purple';
            liquidMode = !!cfg.liquidMode;
            noAnimations = !!cfg.noAnimations;
        } catch (e) {
            console.error('[theme-manager] loadConfig error', e);
        }
    }

    function saveConfig() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                currentTheme,
                customVars,
                autoDayNight,
                autoDayTheme,
                autoNightTheme,
                liquidMode,
                noAnimations,
            }));
        } catch (e) {
            console.error('[theme-manager] saveConfig error', e);
        }
    }

    // ------------------------------------------------------------------
    // Apply theme to DOM
    // ------------------------------------------------------------------
    function resolveVars() {
        let vars = {};
        if (currentTheme && PRESETS[currentTheme]) {
            vars = { ...PRESETS[currentTheme].vars };
        }
        // Apply custom overrides
        for (const [k, v] of Object.entries(customVars)) {
            if (v !== undefined && v !== null && v !== '') {
                vars[k] = v;
            }
        }
        // Apply preview overrides (temporary)
        if (previewVars) {
            for (const [k, v] of Object.entries(previewVars)) {
                if (v !== undefined && v !== null && v !== '') {
                    vars[k] = v;
                }
            }
        }
        return vars;
    }

    function applyTheme() {
        let style = document.getElementById(CSS_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = CSS_ID;
            document.head.appendChild(style);
        }
        const vars = resolveVars();
        let css = ':root {\n';
        for (const [k, v] of Object.entries(vars)) {
            css += `  --${k}: ${v};\n`;
        }
        css += '}\n';
        style.textContent = css;

        // Toggle body classes
        if (liquidMode) {
            document.body.classList.add('liquid');
        } else {
            document.body.classList.remove('liquid');
        }
        if (noAnimations) {
            document.body.classList.add('no-animations');
        } else {
            document.body.classList.remove('no-animations');
        }
        // Light theme detection for body.white
        const bg = vars['background'] || '';
        if (bg && isLightColor(bg)) {
            document.body.classList.add('white');
        } else {
            document.body.classList.remove('white');
        }
    }

    function isLightColor(color) {
        // Parse hex or rgb/rgba
        let r, g, b;
        if (color.startsWith('#')) {
            const hex = color.slice(1);
            if (hex.length === 3) {
                r = parseInt(hex[0] + hex[0], 16);
                g = parseInt(hex[1] + hex[1], 16);
                b = parseInt(hex[2] + hex[2], 16);
            } else {
                r = parseInt(hex.slice(0, 2), 16);
                g = parseInt(hex.slice(2, 4), 16);
                b = parseInt(hex.slice(4, 6), 16);
            }
        } else {
            const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (!m) return false;
            r = +m[1]; g = +m[2]; b = +m[3];
        }
        // Relative luminance
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return lum > 0.6;
    }

    // ------------------------------------------------------------------
    // Auto day/night
    // ------------------------------------------------------------------
    let autoCheckTimer = null;

    function checkAutoDayNight() {
        if (!autoDayNight) return;
        const hour = new Date().getHours();
        const isDay = hour >= 7 && hour < 19;
        const target = isDay ? autoDayTheme : autoNightTheme;
        if (target !== currentTheme) {
            currentTheme = target;
            customVars = {};
            applyTheme();
            saveConfig();
            if (window.ChatAddonHost) {
                window.ChatAddonHost.notify(`Theme switched to ${PRESETS[target]?.name || target}`, 'info', 2000);
            }
        }
    }

    function startAutoDayNight() {
        if (autoCheckTimer) clearInterval(autoCheckTimer);
        autoCheckTimer = setInterval(checkAutoDayNight, 60000); // every minute
        checkAutoDayNight();
    }

    function stopAutoDayNight() {
        if (autoCheckTimer) {
            clearInterval(autoCheckTimer);
            autoCheckTimer = null;
        }
    }

    // ------------------------------------------------------------------
    // Import / Export
    // ------------------------------------------------------------------
    function exportTheme() {
        const data = {
            currentTheme,
            customVars,
            autoDayNight,
            autoDayTheme,
            autoNightTheme,
            liquidMode,
            noAnimations,
            _exportedAt: new Date().toISOString(),
        };
        return JSON.stringify(data, null, 2);
    }

    function importTheme(jsonStr) {
        try {
            const data = JSON.parse(jsonStr);
            if (data.currentTheme) currentTheme = data.currentTheme;
            if (data.customVars) customVars = data.customVars;
            if (typeof data.autoDayNight === 'boolean') autoDayNight = data.autoDayNight;
            if (data.autoDayTheme) autoDayTheme = data.autoDayTheme;
            if (data.autoNightTheme) autoNightTheme = data.autoNightTheme;
            if (typeof data.liquidMode === 'boolean') liquidMode = data.liquidMode;
            if (typeof data.noAnimations === 'boolean') noAnimations = data.noAnimations;
            applyTheme();
            saveConfig();
            if (autoDayNight) startAutoDayNight(); else stopAutoDayNight();
            return true;
        } catch (e) {
            console.error('[theme-manager] import error', e);
            return false;
        }
    }

    // ------------------------------------------------------------------
    // UI — Overlay
    // ------------------------------------------------------------------
    const OVERLAY_CSS = `
#theme-manager-overlay { position: fixed; inset: 0; z-index: 10060; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.55); font-family: inherit; }
#theme-manager-overlay.open { display: flex; }
#theme-manager-overlay .tm-panel { width: min(820px, 94vw); max-height: 88vh; background: var(--colour-1, #1e1e2e); color: var(--colour-3, #e0e0e0); border: 1px solid var(--blur-border, #333); border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.5); display: flex; flex-direction: column; overflow: hidden; }
#theme-manager-overlay .tm-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--blur-border, #333); }
#theme-manager-overlay .tm-head h2 { margin: 0; font-size: 18px; display: flex; align-items: center; gap: 10px; }
#theme-manager-overlay .tm-close { background: none; border: none; color: inherit; font-size: 20px; cursor: pointer; opacity: .7; }
#theme-manager-overlay .tm-close:hover { opacity: 1; }
#theme-manager-overlay .tm-body { overflow-y: auto; padding: 14px 20px 20px; }
#theme-manager-overlay .tm-section-title { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; opacity: .6; margin: 18px 0 8px; }
#theme-manager-overlay .tm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
#theme-manager-overlay .tm-preset { cursor: pointer; border: 2px solid var(--blur-border, #333); border-radius: 10px; padding: 10px; transition: border-color .15s, transform .15s; overflow: hidden; }
#theme-manager-overlay .tm-preset:hover { transform: translateY(-2px); }
#theme-manager-overlay .tm-preset.active { border-color: var(--accent, #8b3dff); }
#theme-manager-overlay .tm-preset .tm-swatch { display: flex; gap: 3px; margin-bottom: 8px; }
#theme-manager-overlay .tm-preset .tm-swatch span { width: 100%; height: 24px; border-radius: 4px; }
#theme-manager-overlay .tm-preset .tm-name { font-weight: 600; font-size: 13px; }
#theme-manager-overlay .tm-preset .tm-desc { font-size: 11px; opacity: .6; margin-top: 2px; }
#theme-manager-overlay .tm-editor { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
#theme-manager-overlay .tm-field { display: flex; flex-direction: column; gap: 4px; }
#theme-manager-overlay .tm-field label { font-size: 12px; opacity: .8; }
#theme-manager-overlay .tm-field input[type="color"] { width: 100%; height: 36px; border: 1px solid var(--blur-border, #333); border-radius: 6px; background: transparent; cursor: pointer; }
#theme-manager-overlay .tm-field input[type="text"], #theme-manager-overlay .tm-field select { width: 100%; padding: 6px 8px; border: 1px solid var(--blur-border, #333); border-radius: 6px; background: var(--input-bg, #1a1525); color: var(--colour-3, #e0e0e0); font-size: 13px; }
#theme-manager-overlay .tm-group-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
#theme-manager-overlay .tm-group-tab { padding: 4px 12px; border-radius: 6px; border: 1px solid var(--blur-border, #333); background: transparent; color: inherit; cursor: pointer; font-size: 12px; }
#theme-manager-overlay .tm-group-tab.active { background: var(--accent, #8b3dff); color: #fff; border-color: transparent; }
#theme-manager-overlay .tm-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; }
#theme-manager-overlay .tm-row label { flex: 1; font-size: 13px; }
#theme-manager-overlay .tm-switch { position: relative; width: 42px; height: 24px; flex-shrink: 0; }
#theme-manager-overlay .tm-switch input { opacity: 0; width: 0; height: 0; }
#theme-manager-overlay .tm-switch .slider { position: absolute; inset: 0; background: #555; border-radius: 24px; transition: .2s; cursor: pointer; }
#theme-manager-overlay .tm-switch .slider::before { content: ""; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: .2s; }
#theme-manager-overlay .tm-switch input:checked + .slider { background: var(--accent, #8b3dff); }
#theme-manager-overlay .tm-switch input:checked + .slider::before { transform: translateX(18px); }
#theme-manager-overlay .tm-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
#theme-manager-overlay .tm-btn { padding: 8px 14px; border-radius: 8px; border: 1px solid var(--blur-border, #333); background: rgba(255,255,255,.05); color: inherit; cursor: pointer; font-size: 13px; display: flex; align-items: center; gap: 6px; }
#theme-manager-overlay .tm-btn:hover { background: rgba(255,255,255,.12); }
#theme-manager-overlay .tm-btn.primary { background: var(--accent, #8b3dff); color: #fff; border-color: transparent; }
#theme-manager-overlay .tm-btn.primary:hover { background: var(--accent-hover, #9d56ff); }
#theme-manager-overlay .tm-btn.danger { color: #ff6b6b; border-color: rgba(255,107,107,.4); }
#theme-manager-overlay .tm-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px; border-top: 1px solid var(--blur-border, #333); }
#theme-manager-overlay .tm-preview-bar { display: flex; gap: 8px; align-items: center; padding: 8px 12px; background: rgba(255,255,255,.04); border-radius: 8px; margin-top: 10px; font-size: 12px; }
#theme-manager-overlay .tm-preview-bar button { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--blur-border, #333); background: transparent; color: inherit; cursor: pointer; font-size: 11px; }
#theme-manager-overlay .tm-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 8px 16px; background: var(--accent, #8b3dff); color: #fff; border-radius: 8px; font-size: 13px; z-index: 10070; opacity: 0; transition: opacity .2s; pointer-events: none; }
#theme-manager-overlay .tm-toast.show { opacity: 1; }
#theme-manager-overlay .tm-font-list { display: flex; flex-wrap: wrap; gap: 6px; }
#theme-manager-overlay .tm-font-btn { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--blur-border, #333); background: transparent; color: inherit; cursor: pointer; font-size: 12px; }
#theme-manager-overlay .tm-font-btn.active { background: var(--accent, #8b3dff); color: #fff; border-color: transparent; }
`;

    const FONT_OPTIONS = [
        { label: 'Inter', value: '"Inter", sans-serif' },
        { label: 'System UI', value: 'system-ui, sans-serif' },
        { label: 'Roboto', value: '"Roboto", sans-serif' },
        { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
        { label: 'Fira Code', value: '"Fira Code", monospace' },
        { label: 'Georgia', value: 'Georgia, serif' },
        { label: 'Arial', value: 'Arial, sans-serif' },
        { label: 'Courier New', value: '"Courier New", monospace' },
    ];

    let activeGroup = 'base';
    let overlayEl = null;

    function ensureOverlayCss() {
        if (document.getElementById('theme-manager-css')) return;
        const style = document.createElement('style');
        style.id = 'theme-manager-css';
        style.textContent = OVERLAY_CSS;
        document.head.appendChild(style);
    }

    function ensureFloatingButton() {
        if (document.getElementById(FLOATING_BTN_ID)) return;
        const btn = document.createElement('button');
        btn.id = FLOATING_BTN_ID;
        btn.title = 'Theme Manager';
        btn.setAttribute('aria-label', 'Open Theme Manager');
        btn.innerHTML = '<i class="fa-solid fa-palette" aria-hidden="true"></i>';
        btn.style.cssText = `
            position: fixed; bottom: 132px; right: 18px; z-index: 10050;
            width: 44px; height: 44px; border-radius: 50%;
            border: 1px solid var(--blur-border, #333); cursor: pointer;
            background: var(--colour-1, #1e1e2e); color: var(--colour-3, #e0e0e0);
            display: flex; align-items: center; justify-content: center;
            font-size: 18px; box-shadow: 0 4px 16px rgba(0,0,0,.35);
            transition: transform .15s, opacity .15s;
        `;
        btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.08)'; });
        btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
        btn.addEventListener('click', () => openOverlay());
        document.body.appendChild(btn);
    }

    function openOverlay() {
        ensureOverlayCss();
        if (overlayEl) {
            overlayEl.classList.add('open');
            renderOverlayContent();
            return;
        }
        overlayEl = document.createElement('div');
        overlayEl.id = OVERLAY_ID;
        overlayEl.classList.add('open');
        overlayEl.innerHTML = `
            <div class="tm-panel">
                <div class="tm-head">
                    <h2><i class="fa-solid fa-palette"></i> Theme Manager</h2>
                    <button class="tm-close" aria-label="Close">&times;</button>
                </div>
                <div class="tm-body" id="tm-body-content"></div>
                <div class="tm-foot">
                    <button class="tm-btn" id="tm-import-btn"><i class="fa-solid fa-file-import"></i> Import</button>
                    <button class="tm-btn" id="tm-export-btn"><i class="fa-solid fa-file-export"></i> Export</button>
                    <button class="tm-btn danger" id="tm-reset-btn"><i class="fa-solid fa-rotate-left"></i> Reset</button>
                    <button class="tm-btn primary" id="tm-apply-btn"><i class="fa-solid fa-check"></i> Apply</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlayEl);

        overlayEl.querySelector('.tm-close').addEventListener('click', () => closeOverlay());
        overlayEl.addEventListener('click', (e) => {
            if (e.target === overlayEl) closeOverlay();
        });

        overlayEl.querySelector('#tm-export-btn').addEventListener('click', () => {
            const json = exportTheme();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `g4f-theme-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Theme exported');
        });

        overlayEl.querySelector('#tm-import-btn').addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.addEventListener('change', () => {
                const file = input.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    if (importTheme(reader.result)) {
                        showToast('Theme imported successfully');
                        renderOverlayContent();
                    } else {
                        showToast('Import failed — invalid file', 'error');
                    }
                };
                reader.readAsText(file);
            });
            input.click();
        });

        overlayEl.querySelector('#tm-reset-btn').addEventListener('click', () => {
            currentTheme = 'midnight-purple';
            customVars = {};
            autoDayNight = false;
            liquidMode = false;
            noAnimations = false;
            previewVars = null;
            stopAutoDayNight();
            applyTheme();
            saveConfig();
            renderOverlayContent();
            showToast('Theme reset to default');
        });

        overlayEl.querySelector('#tm-apply-btn').addEventListener('click', () => {
            previewVars = null;
            applyTheme();
            saveConfig();
            if (autoDayNight) startAutoDayNight(); else stopAutoDayNight();
            showToast('Theme applied');
            closeOverlay();
        });

        renderOverlayContent();
    }

    function closeOverlay() {
        if (overlayEl) {
            overlayEl.classList.remove('open');
            // Discard preview if not applied
            if (previewVars) {
                previewVars = null;
                applyTheme();
            }
        }
    }

    function showToast(msg, type) {
        const toast = document.createElement('div');
        toast.className = 'tm-toast';
        toast.textContent = msg;
        if (type === 'error') toast.style.background = '#ff6b6b';
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    function renderOverlayContent() {
        const body = overlayEl.querySelector('#tm-body-content');
        if (!body) return;

        // --- Preset grid ---
        let presetHtml = '<div class="tm-section-title">Preset Themes</div><div class="tm-grid">';
        for (const [key, preset] of Object.entries(PRESETS)) {
            const isActive = currentTheme === key && Object.keys(customVars).length === 0;
            const swatches = [
                preset.vars['background'] || '#000',
                preset.vars['accent'] || '#fff',
                preset.vars['colour-5'] || '#222',
                preset.vars['colour-3'] || '#ccc',
            ];
            presetHtml += `
                <div class="tm-preset ${isActive ? 'active' : ''}" data-preset="${key}">
                    <div class="tm-swatch">
                        ${swatches.map(c => `<span style="background:${c}"></span>`).join('')}
                    </div>
                    <div class="tm-name">${escapeHtml(preset.name)}</div>
                    <div class="tm-desc">${escapeHtml(preset.description)}</div>
                </div>
            `;
        }
        presetHtml += '</div>';

        // --- Group tabs ---
        const groups = {};
        for (const [varKey, meta] of Object.entries(THEME_VARS)) {
            if (!groups[meta.group]) groups[meta.group] = [];
            groups[meta.group].push(varKey);
        }
        const groupLabels = {
            base: 'Base Colors', accent: 'Accent', glass: 'Glass Effect',
            chat: 'Chat', misc: 'Misc', typo: 'Typography', shape: 'Shape & Motion',
        };
        let tabsHtml = '<div class="tm-section-title">Custom Overrides</div><div class="tm-group-tabs">';
        for (const groupKey of Object.keys(groups)) {
            tabsHtml += `<button class="tm-group-tab ${activeGroup === groupKey ? 'active' : ''}" data-group="${groupKey}">${groupLabels[groupKey] || groupKey}</button>`;
        }
        tabsHtml += '</div>';

        // --- Editor fields for active group ---
        let editorHtml = '<div class="tm-editor">';
        for (const varKey of groups[activeGroup] || []) {
            const meta = THEME_VARS[varKey];
            const currentVal = customVars[varKey] || getCurrentVarValue(varKey);
            if (meta.type === 'color') {
                const colorVal = normalizeColor(currentVal);
                editorHtml += `
                    <div class="tm-field">
                        <label>${meta.label}</label>
                        <input type="color" data-var="${varKey}" value="${colorVal}" />
                        <input type="text" data-var-text="${varKey}" value="${escapeHtml(currentVal)}" placeholder="or enter CSS value" />
                    </div>
                `;
            } else if (meta.type === 'font') {
                editorHtml += `
                    <div class="tm-field" style="grid-column: 1 / -1;">
                        <label>${meta.label}</label>
                        <div class="tm-font-list">
                            ${FONT_OPTIONS.map(f => `<button class="tm-font-btn ${currentVal === f.value ? 'active' : ''}" data-font="${varKey}" data-value="${escapeHtml(f.value)}">${f.label}</button>`).join('')}
                        </div>
                    </div>
                `;
            } else {
                editorHtml += `
                    <div class="tm-field">
                        <label>${meta.label}</label>
                        <input type="text" data-var="${varKey}" value="${escapeHtml(currentVal)}" placeholder="--${varKey}" />
                    </div>
                `;
            }
        }
        editorHtml += '</div>';

        // --- Options ---
        let optionsHtml = '<div class="tm-section-title">Options</div>';
        optionsHtml += `
            <div class="tm-row">
                <label>Liquid Glass Effect</label>
                <div class="tm-switch"><input type="checkbox" id="tm-liquid" ${liquidMode ? 'checked' : ''} /><span class="slider"></span></div>
            </div>
            <div class="tm-row">
                <label>Disable Animations</label>
                <div class="tm-switch"><input type="checkbox" id="tm-no-anim" ${noAnimations ? 'checked' : ''} /><span class="slider"></span></div>
            </div>
            <div class="tm-row">
                <label>Auto Day/Night Switch</label>
                <div class="tm-switch"><input type="checkbox" id="tm-auto-dn" ${autoDayNight ? 'checked' : ''} /><span class="slider"></span></div>
            </div>
            <div class="tm-row">
                <label>Day Theme (7:00–19:00)</label>
                <select id="tm-day-theme">
                    ${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${autoDayTheme === k ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </div>
            <div class="tm-row">
                <label>Night Theme (19:00–7:00)</label>
                <select id="tm-night-theme">
                    ${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${autoNightTheme === k ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </div>
        `;

        // --- Preview bar ---
        const previewHtml = `
            <div class="tm-preview-bar">
                <span>Live preview is active — click Apply to save or close to discard.</span>
                <button id="tm-clear-overrides">Clear Overrides</button>
            </div>
        `;

        body.innerHTML = presetHtml + tabsHtml + editorHtml + optionsHtml + previewHtml;

        // --- Wire events ---
        // Preset selection
        body.querySelectorAll('.tm-preset').forEach(el => {
            el.addEventListener('click', () => {
                const key = el.dataset.preset;
                currentTheme = key;
                customVars = {};
                previewVars = null;
                applyTheme();
                saveConfig();
                renderOverlayContent();
                showToast(`Theme: ${PRESETS[key].name}`);
            });
        });

        // Group tabs
        body.querySelectorAll('.tm-group-tab').forEach(el => {
            el.addEventListener('click', () => {
                activeGroup = el.dataset.group;
                renderOverlayContent();
            });
        });

        // Color inputs
        body.querySelectorAll('input[type="color"][data-var]').forEach(el => {
            el.addEventListener('input', () => {
                const varKey = el.dataset.var;
                const textInput = body.querySelector(`input[data-var-text="${varKey}"]`);
                if (textInput) textInput.value = el.value;
                setPreviewVar(varKey, el.value);
            });
        });

        // Color text inputs
        body.querySelectorAll('input[data-var-text]').forEach(el => {
            el.addEventListener('input', () => {
                const varKey = el.dataset.varText;
                const val = el.value.trim();
                if (val) {
                    setPreviewVar(varKey, val);
                    // Update color picker if valid hex
                    const colorVal = normalizeColor(val);
                    if (colorVal !== '#000000') {
                        const colorInput = body.querySelector(`input[type="color"][data-var="${varKey}"]`);
                        if (colorInput) colorInput.value = colorVal;
                    }
                }
            });
        });

        // Text inputs (non-color)
        body.querySelectorAll(`input[type="text"][data-var]:not([data-var-text])`).forEach(el => {
            el.addEventListener('input', () => {
                setPreviewVar(el.dataset.var, el.value.trim());
            });
        });

        // Font buttons
        body.querySelectorAll('.tm-font-btn').forEach(el => {
            el.addEventListener('click', () => {
                const varKey = el.dataset.font;
                const value = el.dataset.value;
                setPreviewVar(varKey, value);
                body.querySelectorAll(`.tm-font-btn[data-font="${varKey}"]`).forEach(b => b.classList.remove('active'));
                el.classList.add('active');
            });
        });

        // Options toggles
        const liquidCb = body.querySelector('#tm-liquid');
        if (liquidCb) {
            liquidCb.addEventListener('change', () => {
                liquidMode = liquidCb.checked;
                applyTheme();
                saveConfig();
            });
        }

        const noAnimCb = body.querySelector('#tm-no-anim');
        if (noAnimCb) {
            noAnimCb.addEventListener('change', () => {
                noAnimations = noAnimCb.checked;
                applyTheme();
                saveConfig();
            });
        }

        const autoDnCb = body.querySelector('#tm-auto-dn');
        if (autoDnCb) {
            autoDnCb.addEventListener('change', () => {
                autoDayNight = autoDnCb.checked;
                saveConfig();
                if (autoDayNight) {
                    startAutoDayNight();
                    showToast('Auto day/night enabled');
                } else {
                    stopAutoDayNight();
                }
            });
        }

        const daySelect = body.querySelector('#tm-day-theme');
        if (daySelect) {
            daySelect.addEventListener('change', () => {
                autoDayTheme = daySelect.value;
                saveConfig();
                checkAutoDayNight();
            });
        }

        const nightSelect = body.querySelector('#tm-night-theme');
        if (nightSelect) {
            nightSelect.addEventListener('change', () => {
                autoNightTheme = nightSelect.value;
                saveConfig();
                checkAutoDayNight();
            });
        }

        const clearBtn = body.querySelector('#tm-clear-overrides');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                customVars = {};
                previewVars = null;
                applyTheme();
                saveConfig();
                renderOverlayContent();
                showToast('Custom overrides cleared');
            });
        }
    }

    function setPreviewVar(varKey, value) {
        if (!previewVars) previewVars = {};
        previewVars[varKey] = value;
        // Also store into customVars so Apply persists
        customVars[varKey] = value;
        applyTheme();
    }

    function getCurrentVarValue(varKey) {
        // Read from computed style
        try {
            return getComputedStyle(document.documentElement).getPropertyValue(`--${varKey}`).trim();
        } catch (e) {
            return '';
        }
    }

    function normalizeColor(val) {
        if (!val) return '#000000';
        val = val.trim();
        if (val.startsWith('#') && (val.length === 7 || val.length === 4)) return val;
        // Try to parse rgb/rgba to hex
        const m = val.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
            const r = parseInt(m[1]).toString(16).padStart(2, '0');
            const g = parseInt(m[2]).toString(16).padStart(2, '0');
            const b = parseInt(m[3]).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`;
        }
        return '#000000';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ------------------------------------------------------------------
    // Register addon
    // ------------------------------------------------------------------
    ChatAddons.register({
        id: 'builtin:theme-manager',
        name: 'Advanced Theme Manager',
        version: '1.0.0',
        description: 'Preset themes, custom CSS variable editor, live preview, import/export, auto day/night switching.',
        author: 'g4f',
        builtin: true,
        permissions: ['dom:read', 'dom:write', 'storage:local', 'ui:notify'],

        load(opts = {}) {
            loadConfig();
            // If no theme selected, default to midnight-purple
            if (!currentTheme) currentTheme = 'midnight-purple';
            applyTheme();
            if (autoDayNight) startAutoDayNight();

            // Add floating button when DOM is ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => ensureFloatingButton());
            } else {
                ensureFloatingButton();
            }

            // Keyboard shortcut: Ctrl+Shift+T
            document.addEventListener('keydown', (e) => {
                if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
                    e.preventDefault();
                    openOverlay();
                }
            });

            // If enabled at runtime (e.g. via Addon Manager), show the UI right away
            if (opts && opts.showOnLoad) {
                setTimeout(() => openOverlay(), 250);
            }

            console.info('[theme-manager] loaded');
        },

        unload() {
            stopAutoDayNight();
            const fab = document.getElementById(FLOATING_BTN_ID);
            if (fab) fab.remove();
            const ov = document.getElementById(OVERLAY_ID);
            if (ov) ov.remove();
            const css = document.getElementById('theme-manager-css');
            if (css) css.remove();
            const customCss = document.getElementById(CSS_ID);
            if (customCss) customCss.remove();
            console.info('[theme-manager] unloaded');
        },
    });

    // ------------------------------------------------------------------
    // Expose for console access / other addons
    // ------------------------------------------------------------------
    window.ThemeManager = {
        getPresets: () => ({ ...PRESETS }),
        getCurrentTheme: () => currentTheme,
        setPreset: (key) => {
            if (!PRESETS[key]) { console.warn(`[theme-manager] unknown preset "${key}"`); return false; }
            currentTheme = key;
            customVars = {};
            applyTheme();
            saveConfig();
            return true;
        },
        setVar: (key, value) => {
            if (!THEME_VARS[key]) { console.warn(`[theme-manager] unknown variable "${key}"`); return false; }
            customVars[key] = value;
            applyTheme();
            saveConfig();
            return true;
        },
        getVar: (key) => getCurrentVarValue(key),
        reset: () => {
            currentTheme = 'midnight-purple';
            customVars = {};
            applyTheme();
            saveConfig();
        },
        export: exportTheme,
        import: importTheme,
        openUI: openOverlay,
        closeUI: closeOverlay,
    };

})();

export default { ThemeManager: window.ThemeManager };