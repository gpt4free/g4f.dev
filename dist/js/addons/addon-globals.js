/* ================================================================== *
 * Addon: Shared State (globals)
 *
 * Holds the shared DOM references and mutable state objects that were
 * previously owned by the legacy addon. Every other addon resolves
 * these identifiers through `window` at runtime (the loader spreads
 * the exports of this module onto `window`).
 * ================================================================== */

addonsLoaded.then(() => {
    ChatAddons.register({
        id: 'builtin:globals',
        name: 'Shared State',
        version: '1.0.0',
        description: 'Shared DOM references and mutable state for all addons.',
        author: 'g4f',
        builtin: true,
        permissions: ['dom:query'],

        load() {
            return (async () => {})
        }
    });
});

// ------------------------------------------------------------------
// DOM references
// ------------------------------------------------------------------
const chatBody          = document.getElementById(`chatBody`);
const userInput         = document.getElementById("userInput");
const codeButton        = document.querySelector(".code");
const box_conversations = document.querySelector(`#box_conversations, .top`);
const stop_generating   = document.querySelector(`.stop_generating`);
const regenerate_button = document.querySelector(`.regenerate`);
const sidebar           = document.querySelector(".sidebar");
const sidebar_buttons   = document.querySelectorAll(".mobile-sidebar-toggle");
const sendButton        = document.getElementById("sendButton");
const addButton         = document.getElementById("addButton");
const imageInput        = document.querySelector(".image-label");
const mediaSelect       = document.querySelector(".media-select");
const imageSelect       = document.getElementById("image");
const cameraInput       = document.getElementById("camera");
const audioButton       = document.querySelector(".capture-audio");
const linkButton        = document.querySelector(".add-link");
const fileInput         = document.getElementById("file");
const microLabel        = document.querySelector(".micro-label");
const inputCount        = document.getElementById("input-count").querySelector(".text");
const providerSelect    = document.getElementById("provider");
const modelSelect       = document.getElementById("model");
const chatPrompt        = document.getElementById("chatPrompt");
const settings          = document.querySelector(".settings");
const settingsContent   = settings.querySelector(".settings-content") || settings.querySelector(".paper");
const chat              = document.querySelector(".chat-container");
const album             = document.querySelector(".images");
const searchButton      = document.getElementById("search");
const paperclip         = document.querySelector(".user-input .fa-paperclip");
const userInputHeight   = document.getElementById("userInput-height");
const hide_systemPrompt = document.getElementById("hide-systemPrompt")
const slide_systemPrompt_icon = document.querySelector(".slide-header i");

const optionElementsSelector = ".settings input, .settings textarea, .chat-body input, #model, #provider";

// ------------------------------------------------------------------
// Provider defaults
// ------------------------------------------------------------------
let providers = [
    {"name": "Airforce", "label": "Api.Airforce", "login_url": "https://panel.api.airforce/dashboard", "active_by_default": true},
    {"name": "HuggingFace", "login_url": "https://huggingface.co/settings/tokens", "active_by_default": true},
    {"name": "HuggingFaceMedia", "parent": "HuggingFace", "active_by_default": true},
    {"name": "Pollinations", "label": "Pollinations AI", "login_url": "https://enter.pollinations.ai", "active_by_default": true},
    {"name": "Puter", "label": "Puter.js", "login_url": "https://discord.gg/qXA4Wf4Fsm", "active_by_default": true},
];

// ------------------------------------------------------------------
// Mutable shared state
// ------------------------------------------------------------------
let provider_storage = {};
let message_storage = {};
let content_alt_storage = {};
let content_data_storage = {};
let controller_storage = {};
let content_storage = {};
let error_storage = {};
let synthesize_storage = {};
let title_storage = {};
let parameters_storage = {};
let finish_storage = {};
let usage_storage = {};
let continue_storage = {};
let reasoning_storage = {};
let variant_storage = {};
let debug_response_counter = {}
let title_ids_storage = {};
let image_storage = {};
let headers_storage = {};
let tool_calls_storage = {};
let wakeLock = null;
let countTokensEnabled = true;
let suggestions = null;
let mediaRecorder = null;
let autoScrollEnabled = true;

// ------------------------------------------------------------------
// Storage fallback (previously owned by addon-init)
// ------------------------------------------------------------------
const appStorage = window.localStorage || {
    setItem: (key, value) => window[key] = value,
    getItem: (key) => window[key],
    removeItem: (key) => delete window[key],
    length: 0,
};

// ------------------------------------------------------------------
// Message iframe (used by worker / highlight / settings)
// ------------------------------------------------------------------
let iframe_container;
let iframe;
let iframe_close;

// ------------------------------------------------------------------
// Exports (spread onto `window` by the loader)
// ------------------------------------------------------------------
export default {
    // DOM references
    chatBody,
    userInput,
    codeButton,
    box_conversations,
    stop_generating,
    regenerate_button,
    sidebar,
    sidebar_buttons,
    sendButton,
    addButton,
    imageInput,
    mediaSelect,
    imageSelect,
    cameraInput,
    audioButton,
    linkButton,
    fileInput,
    microLabel,
    inputCount,
    providerSelect,
    modelSelect,
    chatPrompt,
    settings,
    settingsContent,
    chat,
    album,
    searchButton,
    paperclip,
    userInputHeight,
    hide_systemPrompt,
    slide_systemPrompt_icon,
    optionElementsSelector,
    // Provider defaults
    providers,
    // Mutable state
    provider_storage,
    message_storage,
    content_alt_storage,
    content_data_storage,
    controller_storage,
    content_storage,
    error_storage,
    synthesize_storage,
    title_storage,
    parameters_storage,
    finish_storage,
    usage_storage,
    continue_storage,
    reasoning_storage,
    variant_storage,
    debug_response_counter,
    title_ids_storage,
    image_storage,
    headers_storage,
    tool_calls_storage,
    wakeLock,
    countTokensEnabled,
    suggestions,
    mediaRecorder,
    autoScrollEnabled,
    // Storage fallback
    appStorage,
    // Message iframe
    iframe_container,
    iframe,
    iframe_close,
};
