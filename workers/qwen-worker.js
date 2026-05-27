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

let cachedModels = null;
let cachedModelsTimestamp = 0;
const MODELS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
        return handleModels(request, env);
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

async function fetchModels(token) {
  const now = Date.now();
  if (cachedModels && (now - cachedModelsTimestamp) < MODELS_CACHE_TTL) {
    return cachedModels;
  }

  try {
    const headers = buildDefaultHeaders(token);
    const response = await fetch(`${QWEN_BASE_URL}/api/models`, { headers });
    if (response.ok) {
      const data = await response.json();
      const models = data?.data || [];
      cachedModels = models.map(m => {
        m.vision = m.info?.meta?.capabilities?.vision || null;
        return m;
      });
      cachedModelsTimestamp = now;
      return cachedModels;
    }
  } catch (e) {
    console.error("Failed to fetch models:", e);
  }

  // Fallback to default model if fetch fails
  return cachedModels || [{id: DEFAULT_MODEL}];
}

function resolveModel(model) {
  return model || DEFAULT_MODEL;
}

function extractLastUserMessage(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "";
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string") {
          return part.text;
        }
      }
    }
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

// --- Image upload helpers ---

const IMAGE_MIME_TYPES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff"
};

function detectImageType(base64Data) {
  if (!base64Data) return { extension: ".png", mimeType: "image/png" };
  // Check magic bytes from the first few chars decoded
  const head = base64Data.substring(0, 20);
  // Common base64 prefixes for image types
  if (head.startsWith("/9j/")) return { extension: ".jpg", mimeType: "image/jpeg" };
  if (head.startsWith("iVBORw0KGgo")) return { extension: ".png", mimeType: "image/png" };
  if (head.startsWith("R0lGOD")) return { extension: ".gif", mimeType: "image/gif" };
  if (head.startsWith("UklGR")) return { extension: ".webp", mimeType: "image/webp" };
  if (head.startsWith("Qk")) return { extension: ".bmp", mimeType: "image/bmp" };
  if (head.startsWith("PHN2Zy")) return { extension: ".svg", mimeType: "image/svg+xml" };
  return { extension: ".png", mimeType: "image/png" };
}

async function hmacSha256(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", typeof key === "string" ? new TextEncoder().encode(key) : key,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey,
    typeof data === "string" ? new TextEncoder().encode(data) : data);
  return new Uint8Array(sig);
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getOssHeaders(method, dateStr, stsData, contentType) {
  const bucketName = stsData.bucketname || "qwen-webui-prod";
  const filePath = stsData.file_path || "";
  const accessKeyId = stsData.access_key_id;
  const accessKeySecret = stsData.access_key_secret;
  const securityToken = stsData.security_token;

  const headers = {
    "Content-Type": contentType,
    "x-oss-content-sha256": "UNSIGNED-PAYLOAD",
    "x-oss-date": dateStr,
    "x-oss-security-token": securityToken,
    "x-oss-user-agent": "aliyun-sdk-js/6.23.0 Chrome 132.0.0.0 on Windows 10 64-bit"
  };

  const requiredHeaders = ["content-md5", "content-type", "x-oss-content-sha256", "x-oss-date", "x-oss-security-token", "x-oss-user-agent"];
  const canonicalHeadersList = [];
  for (const h of requiredHeaders.sort()) {
    const val = headers[h] || headers[h.toLowerCase()] || "";
    canonicalHeadersList.push(`${h}:${val}`);
  }
  const canonicalHeaders = canonicalHeadersList.join("\n") + "\n";
  const canonicalUri = `/${bucketName}/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`;
  const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n\nUNSIGNED-PAYLOAD`;

  const dateParts = dateStr.split("T");
  const dateScope = `${dateParts[0]}/ap-southeast-1/oss/aliyun_v4_request`;
  const stringToSign = `OSS4-HMAC-SHA256\n${dateStr}\n${dateScope}\n${await sha256Hex(canonicalRequest)}`;

  const dateKey = await hmacSha256(new TextEncoder().encode(`aliyun_v4${accessKeySecret}`), dateParts[0]);
  const regionKey = await hmacSha256(dateKey, "ap-southeast-1");
  const serviceKey = await hmacSha256(regionKey, "oss");
  const signingKey = await hmacSha256(serviceKey, "aliyun_v4_request");
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  headers["authorization"] = `OSS4-HMAC-SHA256 Credential=${accessKeyId}/${dateScope},Signature=${signature}`;
  return headers;
}

async function sha256Hex(data) {
  const hash = await crypto.subtle.digest("SHA-256",
    typeof data === "string" ? new TextEncoder().encode(data) : data);
  return toHex(hash);
}

async function uploadFileToOss(fileUrl, dataBytes, stsData, contentType) {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const ossHeaders = await getOssHeaders("PUT", dateStr, stsData, contentType);
  const uploadUrl = fileUrl.split("?")[0];

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: ossHeaders,
    body: dataBytes
  });

  if (!response.ok) {
    throw new Error(`OSS upload failed: ${response.status}`);
  }
}

function extractImagesFromMessages(messages) {
  let images = [];
  if (!Array.isArray(messages)) return images;

  for (const msg of messages) {
    if (!msg || msg.role !== "user") {
      images = [];
      continue;
    }

    // OpenAI vision format: array of content parts
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "image_url" && part.image_url?.url) {
          images.push(part.image_url.url);
        }
      }
    }
  }
  return images;
}

function parseDataUrl(dataUrl) {
  // data:[<mediatype>][;base64],<data>
  const match = dataUrl.match(/^data:([^;]*);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1] || "image/png", base64: match[2] };
}

async function prepareFiles(messages, headers) {
  const imageUrls = extractImagesFromMessages(messages);
  if (imageUrls.length === 0) return [];

  const files = [];
  for (const imageUrl of imageUrls) {
    let dataBytes;
    let mimeType = "image/png";
    let extension = ".png";

    // Handle data URLs
    const parsed = parseDataUrl(imageUrl);
    if (parsed) {
      mimeType = parsed.mimeType;
      dataBytes = Uint8Array.from(atob(parsed.base64), c => c.charCodeAt(0)).buffer;
      const detected = detectImageType(parsed.base64);
      extension = detected.extension;
    } else if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
      // Fetch remote image
      const response = await fetch(imageUrl);
      if (!response.ok) {
        console.error(`Failed to fetch image: ${imageUrl} (${response.status})`);
        continue;
      }
      dataBytes = await response.arrayBuffer();
      mimeType = response.headers.get("content-type") || "image/png";
      // Detect extension from mime type
      extension = IMAGE_MIME_TYPES[mimeType] || ".png";
    } else {
      console.error(`Unsupported image URL format: ${imageUrl.substring(0, 50)}`);
      continue;
    }

    const fileSize = dataBytes.byteLength;
    const fileName = `file-${fileSize}${extension}`;

    // Step 1: Get STS token
    const stsResponse = await fetch(`${QWEN_BASE_URL}/api/v2/files/getstsToken`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        filename: fileName,
        filesize: fileSize,
        filetype: mimeType
      })
    });

    if (!stsResponse.ok) {
      console.error(`STS token request failed: ${stsResponse.status}`);
      continue;
    }

    const stsData = await stsResponse.json();
    if (!stsData.success) {
      console.error(`STS token error: ${stsData.data?.code}:${stsData.data?.details}`);
      continue;
    }

    const fileUrl = stsData.data.file_url;
    const fileId = stsData.data.file_id;

    // Step 2: Upload to OSS
    try {
      await uploadFileToOss(fileUrl, dataBytes, stsData.data, mimeType);
    } catch (e) {
      console.error(`OSS upload failed: ${e.message}`);
      continue;
    }

    // Determine file class and show type
    let fileClass = "vision";
    let showType = "image";
    let type = "image";
    if (mimeType.startsWith("video/")) {
      fileClass = "video";
      showType = "video";
      type = "video";
    } else if (mimeType.startsWith("audio/")) {
      fileClass = "audio";
      showType = "audio";
      type = "audio";
    }

    const now = Date.now();
    const fileObj = {
      type,
      file: {
        created_at: now,
        data: {},
        filename: fileName,
        hash: null,
        id: fileId,
        meta: {
          name: fileName,
          size: fileSize,
          content_type: mimeType
        },
        update_at: now
      },
      id: fileId,
      url: fileUrl,
      name: fileName,
      collection_name: "",
      progress: 0,
      status: "uploaded",
      greenNet: "success",
      size: fileSize,
      error: "",
      itemId: crypto.randomUUID(),
      file_type: mimeType,
      showType: showType,
      file_class: fileClass,
      uploadTaskId: crypto.randomUUID()
    };

    files.push(fileObj);
  }

  return files;
}

async function handleModels(request, env) {
  const token = getApiKey(request, env);
  const models = await fetchModels(token);
  return jsonResponse({ object: "list", data: models });
}

async function handleChatCompletions(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: { message: "Method not allowed" } }, 405);
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return jsonResponse({ error: { message: "Invalid JSON body" } }, 400);
  }

  const token = getApiKey(request, env);
  const model = resolveModel(body.model);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const prompt = extractLastUserMessage(messages);
  const stream = Boolean(body.stream);
  const chat_type = body.chat_type || "t2t";
  const aspect_ratio = body.aspect_ratio;
  const reasoningEffort = normalizeReasoningEffort(body.reasoning_effort);
  const conversation = body.conversation || {};
  const headers = await buildQwenHeaders(token);

  // Upload images from messages
  const files = await prepareFiles(messages, headers);

  if (!conversation.chat_id) {
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

    conversation.chat_id = createData.data.id;
    const sessionCookies = parseSetCookieHeaders(createResponse.headers.get("set-cookie"));
    conversation.cookies = headers["Cookie"];
    if (sessionCookies) {
      conversation.cookies = `${conversation.cookies}; ${sessionCookies}`;
    }
  }

  const msgPayload = {
    stream: true,
    incremental_output: true,
    chat_id: conversation.chat_id,
    chat_mode: "normal",
    model,
    parent_id: conversation.parent_id,
    messages: [
      {
        fid: crypto.randomUUID(),
        parentId: null,
        childrenIds: [],
        role: "user",
        content: prompt,
        user_action: "chat",
        files: files,
        models: [model],
        chat_type,
        feature_config: buildFeatureConfig(reasoningEffort, body.thinking_mode),
        sub_chat_type: chat_type
      }
    ]
  };

  if (aspect_ratio) {
    msgPayload.size = aspect_ratio;
  }

  const completionHeaders = { ...headers, Cookie: conversation.cookies };
  const completionResponse = await fetch(`${QWEN_BASE_URL}/api/v2/chat/completions?chat_id=${conversation.chat_id}`, {
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
      "Cache-Control": "no-cache"
    };
    return handleStreamingResponse(completionResponse, responseHeaders, model, conversation);
  }

  const result = await collectQwenResponse(completionResponse.body, conversation);
  return jsonResponse({
    id: `chatcmpl-${conversation.chat_id}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: result.content,
          ...(result.reasoning ? { reasoning: result.reasoning } : {})
        },
        finish_reason: result.finishReason
      }
    ],
    usage: result.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    },
    conversation
  });
}

function normalizeReasoningEffort(reasoningEffort) {
  if (reasoningEffort === "low" || reasoningEffort === "medium" || reasoningEffort === "high") {
    return reasoningEffort;
  }
  return "medium";
}

function buildFeatureConfig(reasoningEffort, thinkingMode) {
  const resolvedThinkingMode = thinkingMode || (
    reasoningEffort === "high" ? "Thinking" :
    reasoningEffort === "medium" ? "Auto" :
    "Fast"
  );
  const thinkingEnabled = reasoningEffort !== "low";

  if (thinkingEnabled) {
    return {
      auto_thinking: resolvedThinkingMode === "Auto",
      thinking_mode: resolvedThinkingMode,
      thinking_enabled: true,
      output_schema: "phase",
      research_mode: "normal",
      auto_search: true
    };
  }

  return {
    thinking_enabled: false,
    output_schema: "phase",
    thinking_budget: 81920
  };
}

function normalizeQwenUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const prompt_tokens = usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? 0;
  const completion_tokens = usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? 0;
  const total_tokens = usage.total_tokens ?? usage.totalTokenCount ?? (prompt_tokens + completion_tokens);
  const prompt_tokens_details = usage.prompt_tokens_details ?? usage.input_tokens_details;
  const completion_tokens_details = usage.completion_tokens_details ?? usage.output_tokens_details;

  return {
    prompt_tokens,
    completion_tokens,
    total_tokens,
    ...(prompt_tokens_details ? { prompt_tokens_details } : {}),
    ...(completion_tokens_details ? { completion_tokens_details } : {})
  };
}

function parseQwenDelta(data) {
  const choice = data?.choices?.[0];
  const delta = choice?.delta || {};
  const rawContent = typeof delta.content === "string" ? delta.content : "";
  const phase = delta.phase;

  let content = "";
  let reasoning = "";

  if (phase === "think") {
    reasoning = rawContent || delta.reasoning_content || delta.reasoning || "";
  } else if (phase === "answer") {
    content = rawContent;
  } else {
    reasoning = delta.reasoning_content || delta.reasoning || "";
    if (!reasoning) {
      content = rawContent;
    }
  }

  let finishReason = choice?.finish_reason;
  if (finishReason === undefined && phase === "image_gen" && delta.status === "finished") {
    finishReason = "stop";
  }

  return {
    index: choice?.index ?? 0,
    content,
    reasoning,
    finishReason: finishReason ?? null,
    usage: normalizeQwenUsage(data?.usage)
  };
}

function parseQwenStreamLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const text = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!text || text === "[DONE]") {
    return null;
  }

  return JSON.parse(text);
}

function createStreamChunk(data, model, streamId, includeRole = false) {
  const parsed = parseQwenDelta(data);
  const delta = {};

  if (includeRole) {
    delta.role = "assistant";
  }
  if (parsed.reasoning) {
    delta.reasoning_content = parsed.reasoning;
    delta.reasoning = parsed.reasoning;
  }
  if (parsed.content) {
    delta.content = parsed.content;
  }

  if (!Object.keys(delta).length && parsed.finishReason === null) {
    return null;
  }

  return {
    id: streamId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: parsed.index,
        delta,
        finish_reason: parsed.finishReason
      }
    ]
  };
}

async function handleStreamingResponse(response, responseHeaders, model, conversation) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const streamId = `chatcmpl-${crypto.randomUUID()}`;

  (async () => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage = null;
    let sentRole = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = parseQwenStreamLine(line);
            if (!data) continue;

            if (data["response.created"]) {
              const { chat_id, parent_id } = data["response.created"];
              conversation["chat_id"] = chat_id;
              conversation["parent_id"] = parent_id;
            }

            const parsed = parseQwenDelta(data);

            if (parsed.usage) {
              usage = parsed.usage;
            }

            const chunk = createStreamChunk(data, model, streamId, !sentRole && Boolean(parsed.content || parsed.reasoning));
            if (!chunk) continue;
            sentRole = true;
            await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          } catch (e) {
            console.error("Parse error:", e);
          }
        }
      }

      if (usage) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({
          id: streamId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [],
          usage,
          conversation
        })}\n\n`));
      }

      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (e) {
      console.error("Stream error:", e);
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, { headers: responseHeaders });
}

async function collectQwenResponse(body, conversation) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let usage = null;
  let finishReason = "stop";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      try {
        const jsonData = parseQwenStreamLine(line);
        if (!jsonData) continue;
        if (jsonData["response.created"]) {
          const { chat_id, parent_id } = jsonData["response.created"];
          conversation["chat_id"] = chat_id;
          conversation["parent_id"] = parent_id;
        }
        const parsed = parseQwenDelta(jsonData);
        if (parsed.content) {
          content += parsed.content;
        }
        if (parsed.reasoning) {
          reasoning += parsed.reasoning;
        }
        if (parsed.usage) {
          usage = parsed.usage;
        }
        if (parsed.finishReason) {
          finishReason = parsed.finishReason;
        }
      } catch (_e) {
        continue;
      }
    }
  }

  return { content, reasoning, usage, finishReason };
}