/**
 * G4F Qwen Worker
 *
 * Cloudflare Worker providing OpenAI-compatible chat completions using Qwen chat.qwen.ai.
 *
 * Endpoints:
 * - POST /v1/chat/completions
 * - GET /v1/models
 * - GET /health
 *
 * Environment Variables:
 * - QWEN_API_KEY: Optional Qwen bearer token
 */

const QWEN_BASE_URL = "https://chat.qwen.ai";
const QWEN_TOKEN_URL = "https://sg-wum.alibaba.com/w/wu.json";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  "Access-Control-Expose-Headers": "Content-Type, X-Provider, X-Model"
};

const DEFAULT_MODEL = "qwen3-235b-a22b";

const MODELS = [
  "qwen3.6-plus", "qwen3.6-max-preview", "qwen3.5-plus", "qwen3.5-omni-plus", "qwen3.6-35b-a3b", "qwen3.5-flash",
  "qwen3.5-max-2026-03-08", "qwen3.6-plus-preview", "qwen3.5-397b-a17b", "qwen3.5-122b-a10b", "qwen3.5-omni-flash",
  "qwen3.5-27b", "qwen3.5-35b-a3b", "qwen3-max-2026-01-23", "qwen-plus-2025-07-28", "qwen3-coder-plus",
  "qwen3-vl-plus", "qwen3-omni-flash-2025-12-01", "qwen-max-latest"
];

const DEFAULT_TEMPLATE = {
  deviceId: "84985177a19a010dea49",
  sdkVersion: "websdk-2.3.15d",
  initTimestamp: "1765348410850",
  field3: "91",
  field4: "1|15",
  language: "zh-CN",
  timezoneOffset: "-480",
  colorDepth: "16705151|12791",
  screenInfo: "1470|956|283|797|158|0|1470|956|1470|798|0|0",
  field9: "5",
  platform: "MacIntel",
  field11: "10",
  webglRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)|Google Inc. (Apple)",
  field13: "30|30",
  field14: "0",
  field15: "28",
  pluginCount: "5",
  vendor: "Google Inc.",
  field29: "8",
  touchInfo: "-1|0|0|0|0",
  field32: "11",
  field35: "0",
  mode: "P",
};

const HASH_FIELDS = {
  16: "split",
  17: "full",
  18: "full",
  31: "full",
  34: "full",
  36: "full"
};

const CUSTOM_BASE64_CHARS = "DGi0YA7BemWnQjCl4_bR3f8SKIF9tUz/xhr2oEOgPpac=61ZqwTudLkM5vHyNXsVJ";

let cachedMidtoken = null;
let cachedMidtokenUses = 0;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      if (pathname.endsWith("/models")) {
        return handleModels();
      }

      if (pathname.endsWith("/chat/completions")) {
        return handleChatCompletions(request, env);
      }

      if (pathname === "/health" || pathname === "/qwen/health") {
        return jsonResponse({ status: "ok", service: "qwen-worker" });
      }

      if (pathname === "/" || pathname === "/qwen" || pathname === "/qwen/") {
        return jsonResponse({
          service: "G4F Qwen Worker",
          version: "1.0.0",
          endpoints: {
            chat: "/v1/chat/completions",
            models: "/v1/models",
            health: "/health"
          }
        });
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Qwen worker error:", error);
      return jsonResponse({ error: { message: error.message || "Internal server error" } }, 500);
    }
  }
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

function getApiKey(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const tokens = authHeader.substring(7).split(/\s+/);
    const token = tokens.find(t => t && !t.startsWith("g4f_"));
    if (token) return token;
  }

  const xApiKey = request.headers.get("X-API-Key");
  if (xApiKey && !xApiKey.startsWith("g4f_")) {
    return xApiKey;
  }

  return env.QWEN_API_KEY || null;
}

function resolveModel(model) {
  if (!model) return DEFAULT_MODEL;
  if (MODELS.includes(model)) return model;
  const lower = model.toLowerCase();
  const match = MODELS.find(m => m.toLowerCase() === lower);
  return match || DEFAULT_MODEL;
}

function extractLastUserMessage(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "";
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    try {
      return JSON.stringify(msg.content);
    } catch (_e) {
      return String(msg.content ?? "");
    }
  }
  return "";
}

function generateRandomHash() {
  return Math.floor(Math.random() * 0x100000000);
}

function generateDeviceId() {
  let result = "";
  const chars = "0123456789abcdef";
  for (let i = 0; i < 20; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function customEncode(data, urlSafe) {
  if (data == null) return "";

  const compressed = lzwCompress(data, 6, i => CUSTOM_BASE64_CHARS[i]);

  if (!urlSafe) {
    const mod = compressed.length % 4;
    if (mod === 1) return compressed + "===";
    if (mod === 2) return compressed + "==";
    if (mod === 3) return compressed + "=";
    return compressed;
  }

  return compressed;
}

function lzwCompress(data, bits, charFunc) {
  if (data == null) return "";

  const dictionary = {};
  const dictToCreate = {};
  let w = "";
  let value = 0;
  let position = 0;
  let enlargeIn = 2;
  let dictSize = 3;
  let numBits = 2;
  const result = [];

  const writeBits = (val, count) => {
    for (let i = 0; i < count; i++) {
      value = (value << 1) | ((val >> i) & 1);
      if (position === bits - 1) {
        result.push(charFunc(value));
        position = 0;
        value = 0;
      } else {
        position++;
      }
    }
  };

  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (!(c in dictionary)) {
      dictionary[c] = dictSize++;
      dictToCreate[c] = true;
    }

    const wc = w + c;
    if (wc in dictionary) {
      w = wc;
    } else {
      if (Object.prototype.hasOwnProperty.call(dictToCreate, w)) {
        const w0 = w.charCodeAt(0);
        if (w0 < 256) {
          writeBits(0, numBits);
          writeBits(w0, 8);
        } else {
          writeBits(1, numBits);
          writeBits(w0, 16);
        }
        delete dictToCreate[w];
      } else {
        writeBits(dictionary[w], numBits);
      }

      enlargeIn -= 1;
      if (enlargeIn === 0) {
        enlargeIn = 1 << numBits;
        numBits += 1;
      }

      dictionary[wc] = dictSize++;
      w = c;
    }
  }

  if (w !== "") {
    if (Object.prototype.hasOwnProperty.call(dictToCreate, w)) {
      const w0 = w.charCodeAt(0);
      if (w0 < 256) {
        writeBits(0, numBits);
        writeBits(w0, 8);
      } else {
        writeBits(1, numBits);
        writeBits(w0, 16);
      }
      delete dictToCreate[w];
    } else {
      writeBits(dictionary[w], numBits);
    }

    enlargeIn -= 1;
    if (enlargeIn === 0) {
      enlargeIn = 1 << numBits;
      numBits += 1;
    }
  }

  writeBits(2, numBits);
  while (true) {
    value <<= 1;
    if (position === bits - 1) {
      result.push(charFunc(value));
      break;
    }
    position++;
  }

  return result.join("");
}

function parseRealData(realData) {
  return realData.split("^");
}

function processFields(fields) {
  const processed = fields.slice();
  const currentTimestamp = Date.now();

  for (const idxString in HASH_FIELDS) {
    const idx = Number(idxString);
    const typ = HASH_FIELDS[idx];
    if (idx >= processed.length) continue;

    if (typ === "split") {
      const val = String(processed[idx]);
      const parts = val.split("|");
      if (parts.length === 2) {
        processed[idx] = `${parts[0]}|${generateRandomHash()}`;
      }
    } else if (typ === "full") {
      if (idx === 36) {
        processed[idx] = Math.floor(Math.random() * 91) + 10;
      } else {
        processed[idx] = generateRandomHash();
      }
    }
  }

  if (33 < processed.length) {
    processed[33] = currentTimestamp;
  }

  return processed;
}

function generateFingerprint(options = {}) {
  const config = { ...DEFAULT_TEMPLATE };
  if (options.platform) {
    const platforms = {
      macIntel: {
        platform: "MacIntel",
        webglRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)|Google Inc. (Apple)",
        vendor: "Google Inc."
      },
      macM1: {
        platform: "MacIntel",
        webglRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)|Google Inc. (Apple)",
        vendor: "Google Inc."
      },
      win64: {
        platform: "Win32",
        webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)|Google Inc. (NVIDIA)",
        vendor: "Google Inc."
      },
      linux: {
        platform: "Linux x86_64",
        webglRenderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630, OpenGL 4.6)|Google Inc. (Intel)",
        vendor: "Google Inc."
      }
    };
    if (platforms[options.platform]) {
      Object.assign(config, platforms[options.platform]);
    }
  }

  if (options.screen) {
    const screens = {
      "1920x1080": "1920|1080|283|1080|158|0|1920|1080|1920|922|0|0",
      "2560x1440": "2560|1440|283|1440|158|0|2560|1440|2560|1282|0|0",
      "1470x956": "1470|956|283|797|158|0|1470|956|1470|798|0|0",
      "1440x900": "1440|900|283|900|158|0|1440|900|1440|742|0|0",
      "1536x864": "1536|864|283|864|158|0|1536|864|1536|706|0|0"
    };
    if (screens[options.screen]) {
      config.screenInfo = screens[options.screen];
    }
  }

  if (options.locale) {
    const languages = {
      "zh-CN": { language: "zh-CN", timezoneOffset: "-480" },
      "zh-TW": { language: "zh-TW", timezoneOffset: "-480" },
      "en-US": { language: "en-US", timezoneOffset: "480" },
      "ja-JP": { language: "ja-JP", timezoneOffset: "-540" },
      "ko-KR": { language: "ko-KR", timezoneOffset: "-540" }
    };
    if (languages[options.locale]) {
      Object.assign(config, languages[options.locale]);
    }
  }

  if (options.custom && typeof options.custom === "object") {
    Object.assign(config, options.custom);
  }

  const deviceId = options.deviceId || generateDeviceId();
  const currentTimestamp = Date.now();

  const pluginHash = generateRandomHash();
  const canvasHash = generateRandomHash();
  const uaHash1 = generateRandomHash();
  const uaHash2 = generateRandomHash();
  const urlHash = generateRandomHash();
  const docHash = Math.floor(Math.random() * 91) + 10;

  const fields = [
    deviceId,
    config.sdkVersion,
    config.initTimestamp,
    config.field3,
    config.field4,
    config.language,
    config.timezoneOffset,
    config.colorDepth,
    config.screenInfo,
    config.field9,
    config.platform,
    config.field11,
    config.webglRenderer,
    config.field13,
    config.field14,
    config.field15,
    `${config.pluginCount}|${pluginHash}`,
    canvasHash,
    uaHash1,
    "1",
    "0",
    "1",
    "0",
    config.mode,
    "0",
    "0",
    "0",
    "416",
    config.vendor,
    config.field29,
    config.touchInfo,
    uaHash2,
    config.field32,
    currentTimestamp,
    urlHash,
    config.field35,
    docHash
  ];

  return fields.join("^");
}

function generateCookies() {
  const fingerprint = generateFingerprint();
  const fields = parseRealData(fingerprint);
  const processed = processFields(fields);

  const ssxmodItnaData = processed.join("^");
  const ssxmodItna = "1-" + customEncode(ssxmodItnaData, true);

  const ssxmodItna2Data = [
    processed[0],
    processed[1],
    processed[23],
    0,
    "",
    0,
    "",
    "",
    "",
    0,
    0,
    processed[32],
    processed[33],
    0,
    0,
    0,
    0,
    0
  ].join("^");
  const ssxmodItna2 = "1-" + customEncode(ssxmodItna2Data, true);

  return {
    ssxmod_itna: ssxmodItna,
    ssxmod_itna2: ssxmodItna2,
    timestamp: processed[33],
    rawData: ssxmodItnaData,
    rawData2: ssxmodItna2Data
  };
}

function buildDefaultHeaders(token) {
  const cookies = generateCookies();
  const headers = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.5",
    Origin: QWEN_BASE_URL,
    Referer: `${QWEN_BASE_URL}/`,
    "Content-Type": "application/json",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Connection: "keep-alive",
    "X-Requested-With": "XMLHttpRequest",
    "Cookie": `ssxmod_itna=${cookies.ssxmod_itna}; ssxmod_itna2=${cookies.ssxmod_itna2}`,
    "X-Source": "web"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchMidtoken() {
  if (!cachedMidtoken || cachedMidtokenUses >= 5) {
    const response = await fetch(QWEN_TOKEN_URL, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Failed to fetch Qwen midtoken: ${response.status}`);
    }
    const text = await response.text();
    const match = text.match(/(?:umx\.wu|__fycb)\('([^']+)'\)/);
    if (!match) {
      throw new Error("Failed to parse Qwen midtoken.");
    }
    cachedMidtoken = match[1];
    cachedMidtokenUses = 1;
  } else {
    cachedMidtokenUses += 1;
  }
  return cachedMidtoken;
}

async function buildQwenHeaders(token) {
  const headers = buildDefaultHeaders(token);
  const midtoken = await fetchMidtoken();
  headers["bx-umidtoken"] = midtoken;
  headers["bx-v"] = "2.5.31";
  return headers;
}

function parseSetCookieHeaders(raw) {
  if (!raw) return "";
  const cookies = [];
  const parts = raw.split(/,(?=[^;]*=)/);
  for (const part of parts) {
    const pair = part.split(";")[0].trim();
    if (pair) cookies.push(pair);
  }
  return cookies.join("; ");
}

async function handleModels() {
  const modelList = MODELS.map(id => ({
    id,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "qwen",
    permission: [],
    root: id,
    parent: null
  }));
  return jsonResponse({ object: "list", data: modelList });
}

async function handleChatCompletions(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: { message: "Method not allowed" } }, 405);
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return jsonResponse({ error: { message: "Invalid JSON body" } }, 400);
  }

  const model = resolveModel(body.model);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const prompt = extractLastUserMessage(messages);
  const stream = Boolean(body.stream);
  const chat_type = body.chat_type || "t2t";
  const aspect_ratio = body.aspect_ratio;
  const token = getApiKey(request, env);

  const headers = await buildQwenHeaders(token);
  const chatPayload = {
    title: "New Chat",
    models: [model],
    chat_mode: "normal",
    chat_type,
    timestamp: Date.now()
  };

  const createResponse = await fetch(`${QWEN_BASE_URL}/api/v2/chats/new`, {
    method: "POST",
    headers,
    body: JSON.stringify(chatPayload)
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    return jsonResponse({ error: { message: `Qwen chat.new failed: ${createResponse.status}`, details: errorText } }, 502);
  }

  const createData = await createResponse.json().catch(() => null);
  if (!createData || !createData.success || !createData.data?.id) {
    return jsonResponse({ error: { message: "Failed to initialize Qwen chat", details: createData } }, 502);
  }

  const conversationId = createData.data.id;
  const sessionCookies = parseSetCookieHeaders(createResponse.headers.get("set-cookie"));
  let conversationCookies = headers["Cookie"];
  if (sessionCookies) {
    conversationCookies = `${conversationCookies}; ${sessionCookies}`;
  }

  const msgPayload = {
    stream,
    incremental_output: stream,
    chat_id: conversationId,
    chat_mode: "normal",
    model,
    parent_id: null,
    messages: [
      {
        fid: crypto.randomUUID(),
        parentId: null,
        childrenIds: [],
        role: "user",
        content: prompt,
        user_action: "chat",
        files: [],
        models: [model],
        chat_type,
        feature_config: {
          thinking_enabled: false,
          output_schema: "phase",
          thinking_budget: 81920
        },
        sub_chat_type: chat_type
      }
    ]
  };

  if (aspect_ratio) {
    msgPayload.size = aspect_ratio;
  }

  const completionHeaders = { ...headers, Cookie: conversationCookies };
  const completionResponse = await fetch(`${QWEN_BASE_URL}/api/v2/chat/completions?chat_id=${conversationId}`, {
    method: "POST",
    headers: completionHeaders,
    body: JSON.stringify(msgPayload)
  });

  if (!completionResponse.ok) {
    const errorText = await completionResponse.text();
    return jsonResponse({ error: { message: `Qwen completions failed: ${completionResponse.status}`, details: errorText } }, 502);
  }

  if (stream) {
    const responseHeaders = {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Provider": "qwen",
      "X-Model": model
    };
    return new Response(completionResponse.body, { headers: responseHeaders });
  }

  const fullText = await collectQwenResponseText(completionResponse.body);
  return jsonResponse({
    id: conversationId,
    object: "chat.completion",
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: fullText
        },
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  });
}

async function collectQwenResponseText(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const text = line.slice(5).trim();
      if (!text || text === "[DONE]") continue;
      try {
        const jsonData = JSON.parse(text);
        const choices = jsonData.choices || [];
        if (choices.length === 0) continue;
        const delta = choices[0].delta || {};
        const content = delta.content;
        if (typeof content === "string") {
          fullText += content;
        }
      } catch (_e) {
        continue;
      }
    }
  }

  return fullText;
}
