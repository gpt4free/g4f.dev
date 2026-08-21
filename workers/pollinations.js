/**
 * Cloudflare Worker for Pollinations AI - OpenAI Compatible API
 * 
 * This worker provides an OpenAI-compatible API endpoint that proxies
 * requests to Pollinations AI services (both text.pollinations.ai and gen.pollinations.ai).
 * 
 * Environment Variables:
 * - POLLINATIONS_API_KEY: Optional API key for Pollinations AI (enables gen.pollinations.ai endpoints for premium features)
 */

const POLLINATIONS_TEXT_API = "https://text.pollinations.ai/openai";
const POLLINATIONS_IMAGE_API = "https://image.pollinations.ai/prompt/{prompt}";
const POLLINATIONS_MODELS_API = "https://gen.pollinations.ai/text/models";
const POLLINATIONS_IMAGE_MODELS_API = "https://gen.pollinations.ai/image/models";

const POLLINATIONS_GEN_TEXT_API = "https://gen.pollinations.ai/v1/chat/completions";
const POLLINATIONS_GEN_IMAGE_API = "https://gen.pollinations.ai/image/{prompt}";
const POLLINATIONS_GEN_API = "https://gen.pollinations.ai";

const MODEL_ALIASES = {
  "openai": "openai",
  "deepseek": "deepseek",
  "flux": "flux"
};

/**
 * Resolve model aliases
 */
function resolveModel(model) {
  return MODEL_ALIASES[model] || model;
}

// ---------------------------------------------------------------------------
// Pricing cache
// ---------------------------------------------------------------------------
// Pollinations pricing is published in two registries:
//   - Text/Audio: https://gen.pollinations.ai/text/models
//   - Image/Video: https://gen.pollinations.ai/image/models
// Each entry exposes a `pricing` object whose keys mirror the `x-usage-*`
// headers (promptTextTokens, promptCachedTokens, promptImageTokens,
// completionTextTokens, completionImageTokens, completionVideoSeconds, ...).
// Values are in pollen per single token (or per second, for video). We cache
// the registry for 5 minutes because it is stable but does change occasionally.

const PRICING_CACHE_TTL_MS = 5 * 60 * 1000;
const pricingCache = {
  text: { fetchedAt: 0, data: [] },
  image: { fetchedAt: 0, data: [] },
};

async function fetchPricingRegistry(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Pricing registry fetch failed (${response.status})`);
  }
  return response.json();
}

async function getPricingRegistry(kind) {
  const slot = kind === "image" ? pricingCache.image : pricingCache.text;
  const now = Date.now();
  if (now - slot.fetchedAt < PRICING_CACHE_TTL_MS && slot.data.length) {
    return slot.data;
  }
  const url =
    kind === "image" ? POLLINATIONS_IMAGE_MODELS_API : POLLINATIONS_MODELS_API;
  try {
    const data = await fetchPricingRegistry(url);
    slot.data = Array.isArray(data) ? data : data.data || [];
    slot.fetchedAt = now;
  } catch (err) {
    console.log(`Pollinations ${kind} pricing registry fetch failed:`, err.message);
    // If a previous cache exists keep it; otherwise return empty.
    if (!slot.data.length) {
      slot.data = [];
    }
  }
  return slot.data;
}

function findPricingEntry(registry, modelName) {
  if (!modelName) return null;
  const lower = String(modelName).toLowerCase();
  for (const entry of registry) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.name === modelName) return entry;
    if (Array.isArray(entry.aliases) && entry.aliases.includes(modelName)) {
      return entry;
    }
  }
  // Fallback: case-insensitive name match (community models may keep case).
  for (const entry of registry) {
    if (entry && entry.name && entry.name.toLowerCase() === lower) {
      return entry;
    }
  }
  return null;
}

async function getModelPricing(modelName) {
  // Try image registry first because it covers video models too; fall back to
  // text registry. Both share the same pricing key naming convention.
  for (const kind of ["image", "text"]) {
    const registry = await getPricingRegistry(kind);
    const entry = findPricingEntry(registry, modelName);
    if (entry && entry.pricing) {
      return { pricing: entry.pricing, category: entry.category || kind };
    }
  }
  return null;
}

/**
 * Extract per-component token counts from `x-usage-*` response headers.
 * Keys mirror Pollinations' header naming (see shared/registry/usage-headers.ts).
 */
function extractUsageFromHeaders(headers) {
  const usage = {};
  if (!headers) return usage;
  for (const [name, value] of headers.entries()) {
    const match = name.match(/^x-usage-(.+)$/i);
    if (!match) continue;
    const key = match[1].replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    usage[key] = parsed;
  }
  return usage;
}

/**
 * Read an OpenAI-style `usage` object from an SSE chunk payload and convert
 * it to the same key shape returned by `extractUsageFromHeaders`. Handles
 * Anthropic-style top-level fallbacks (`cached_input_tokens`,
 * `cache_creation_input_tokens`, `reasoning_tokens`) and the OpenAI
 * `prompt_tokens_details` / `completion_tokens_details` sub-objects.
 *
 * The OpenAI spec says `completion_tokens` (and `prompt_tokens`) is the
 * inclusive grand total and the details are subcategories that sum into it.
 * Some providers violate this – notably Grok/xAI exposes reasoning as an
 * additive counter separate from `completion_tokens` (so `total_tokens` is
 * strictly greater than `prompt_tokens + completion_tokens`). We detect
 * that convention from `total_tokens` and only subtract detail counters
 * from their parent when the parent is inclusive. Otherwise the detail is
 * its own billable bucket.
 */
function convertOpenAIUsageToHeadersShape(openaiUsage) {
  const usage = {};
  if (!openaiUsage || typeof openaiUsage !== "object") return usage;

  const promptDetails = openaiUsage.prompt_tokens_details || {};
  const completionDetails = openaiUsage.completion_tokens_details || {};

  const promptText =
    typeof openaiUsage.prompt_tokens === "number" ? openaiUsage.prompt_tokens : 0;
  const completionText =
    typeof openaiUsage.completion_tokens === "number"
      ? openaiUsage.completion_tokens
      : 0;
  const totalText =
    typeof openaiUsage.total_tokens === "number"
      ? openaiUsage.total_tokens
      : promptText + completionText;

  let promptCached =
    numberOrZero(promptDetails.cached_tokens) ||
    numberOrZero(openaiUsage.cache_read_input_tokens) ||
    numberOrZero(openaiUsage.cached_input_tokens);
  let promptCacheWrite =
    numberOrZero(promptDetails.cache_write_tokens) ||
    numberOrZero(openaiUsage.cache_creation_input_tokens);
  const promptAudio = numberOrZero(promptDetails.audio_tokens);
  const promptImage = numberOrZero(promptDetails.image_tokens);
  const promptVideo = numberOrZero(promptDetails.video_tokens);

  const completionAudio = numberOrZero(completionDetails.audio_tokens);
  const completionImage = numberOrZero(completionDetails.image_tokens);
  let completionReasoning =
    numberOrZero(completionDetails.reasoning_tokens) ||
    numberOrZero(openaiUsage.reasoning_tokens);

  const promptDetailTotal = promptCached + promptCacheWrite + promptAudio + promptImage + promptVideo;
  const completionDetailTotal = completionAudio + completionImage + completionReasoning;
  const extra = totalText - (promptText + completionText);

  // Convention detection mirrors `detectUsageConvention` in
  // shared/registry/usage-headers.ts so cost lines up with Pollinations'
  // own billing.
  let promptDetailsAreAdditive = false;
  let completionDetailsAreAdditive = false;
  if (extra <= 0) {
    // Standard OpenAI inclusive accounting: details are subcategories of
    // their parent total. Cap each detail against its parent so we never
    // emit negative text tokens.
    promptDetailsAreAdditive = false;
    completionDetailsAreAdditive = false;
  } else if (extra === promptDetailTotal + completionDetailTotal) {
    promptDetailsAreAdditive = promptDetailTotal > 0;
    completionDetailsAreAdditive = completionDetailTotal > 0;
  } else if (
    completionReasoning > 0 &&
    extra === completionReasoning
  ) {
    // Grok-style additive reasoning.
    completionDetailsAreAdditive = true;
  } else if (extra === promptDetailTotal) {
    promptDetailsAreAdditive = true;
  } else if (extra === completionDetailTotal) {
    completionDetailsAreAdditive = true;
  }

  if (!promptDetailsAreAdditive) {
    promptCached = Math.min(promptCached, promptText);
    promptCacheWrite = Math.min(
      promptCacheWrite,
      Math.max(0, promptText - promptCached),
    );
  }
  if (!completionDetailsAreAdditive) {
    completionReasoning = Math.min(completionReasoning, completionText);
  }

  // promptTextTokens is the billable text component. Under additive
  // accounting the parent total is already the visible-text count so we
  // skip the subtraction and just use `prompt_tokens` directly.
  const promptTextNet = promptDetailsAreAdditive
    ? promptText
    : Math.max(
        0,
        promptText -
          promptCached -
          promptCacheWrite -
          promptAudio -
          promptImage -
          promptVideo,
      );
  const completionTextNet = completionDetailsAreAdditive
    ? completionText
    : Math.max(0, completionText - completionReasoning - completionAudio - completionImage);

  if (promptTextNet > 0) usage.promptTextTokens = promptTextNet;
  if (promptCached > 0) usage.promptCachedTokens = promptCached;
  if (promptCacheWrite > 0) usage.promptCacheWriteTokens = promptCacheWrite;
  if (promptAudio > 0) usage.promptAudioTokens = promptAudio;
  if (promptImage > 0) usage.promptImageTokens = promptImage;
  if (promptVideo > 0) usage.promptVideoTokens = promptVideo;
  if (completionTextNet > 0) usage.completionTextTokens = completionTextNet;
  if (completionReasoning > 0) usage.completionReasoningTokens = completionReasoning;
  if (completionAudio > 0) usage.completionAudioTokens = completionAudio;
  if (completionImage > 0) usage.completionImageTokens = completionImage;

  return usage;
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Merge two usage objects summing their per-bucket counters. Missing keys are
 * treated as zero. Used to combine header-derived usage with usage captured
 * from the SSE body so we never lose information when both sources are
 * populated.
 */
function mergeUsage(a, b) {
  const merged = {};
  for (const obj of [a || {}, b || {}]) {
    for (const [key, value] of Object.entries(obj)) {
      if (!Number.isFinite(value)) continue;
      merged[key] = (merged[key] || 0) + value;
    }
  }
  return merged;
}

/**
 * Extract usage data from any Response (streaming or not). For non-streaming
 * responses we just read the `x-usage-*` headers. For SSE streams without
 * those headers we buffer the body, scan each `data: {...}` line for a
 * `usage` field, and return a fresh Response whose body can still be
 * forwarded to the client. Returns `{ response, usage }`; the resolved
 * `response.body` is safe to forward.
 *
 * NOTE: streaming responses buffer the full body before returning. This
 * sacrifices per-chunk delivery but is unavoidable because cost headers must
 * be attached *before* the body starts. If the upstream already provides
 * `x-usage-*` headers, those are returned synchronously without buffering –
 * callers should forward the header-only response untouched.
 */
async function extractUsageFromResponse(response) {
  if (!response) return { response, usage: {} };

  // Fast path: header usage is sufficient for non-streaming responses and for
  // SSE responses that include `x-usage-*` trailers before the body.
  const headerUsage = extractUsageFromHeaders(response.headers);
  const contentType = response.headers.get("content-type") || "";
  const isSSE = contentType.includes("text/event-stream");

  if (!response.body || !isSSE) {
    return { response, usage: headerUsage };
  }

  if (Object.keys(headerUsage).length) {
    // Upstream already provided the canonical usage via headers – skip the
    // body scan entirely so the SSE stream is forwarded unmodified.
    return { response, usage: headerUsage };
  }

  // Streaming path: buffer the body, parse SSE lines as we go, capture the
  // most recent `usage` object, and reconstruct a fresh Response whose body
  // still contains the original SSE payload.
  const chunks = [];
  let textBuffer = "";
  let capturedUsage = {};
  let capturedModel = null;
  let readFailed = false;

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const consumeLine = (rawLine) => {
      const line = rawLine.replace(/\r$/, "");
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object") return;
      if (!capturedModel && typeof parsed.model === "string") {
        capturedModel = parsed.model;
      }
      if (parsed.usage) {
        capturedUsage = mergeUsage(
          capturedUsage,
          convertOpenAIUsageToHeadersShape(parsed.usage),
        );
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      textBuffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
        const line = textBuffer.slice(0, newlineIndex);
        textBuffer = textBuffer.slice(newlineIndex + 1);
        consumeLine(line);
      }
    }

    // Flush the decoder and parse any final partial line.
    textBuffer += decoder.decode();
    if (textBuffer.length) consumeLine(textBuffer);
  } catch (err) {
    // If body read fails (network drop, decoder error, etc.) we still want
    // to forward whatever bytes we captured and surface no usage rather than
    // blowing up the whole request.
    readFailed = true;
    console.log("extractUsageFromResponse: body read failed:", err.message);
  }

  // If we never managed to read a single chunk, fall back to the original
  // response untouched so the client still gets the live stream.
  if (readFailed && chunks.length === 0) {
    return { response, usage: headerUsage };
  }

  const newHeaders = new Headers(response.headers);
  if (capturedModel) newHeaders.set("x-model-used", capturedModel);

  const bufferedResponse = new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    },
  );

  return {
    response: bufferedResponse,
    usage: mergeUsage(headerUsage, capturedUsage),
  };
}

/**
 * Calculate the pollen cost for a model + usage bundle using the registry
 * pricing. Cached/flat-rate pricing is handled by `flatRate` and the special
 * prompt-cached discount. Returns `null` when no pricing is available so the
 * caller can decide whether to skip the header.
 */
function calculatePollenCost(pricing, usage) {
  if (!pricing || !usage) return null;
  // Flat-rate endpoints (e.g. diffusion images, some community models) charge
  // exactly the listed `completionImageTokens` per generated output regardless
  // of token counts.
  if (pricing.flatRate) {
    if (pricing.completionImageTokens && usage.completionImageTokens) {
      return pricing.completionImageTokens * usage.completionImageTokens;
    }
    if (pricing.completionVideoSeconds && usage.completionVideoSeconds) {
      return pricing.completionVideoSeconds * usage.completionVideoSeconds;
    }
    if (pricing.completionTextTokens && usage.completionTextTokens) {
      return pricing.completionTextTokens * usage.completionTextTokens;
    }
  }

  let cost = 0;
  let matchedAny = false;

  // Prompt tokens: cached tokens are discounted by their own rate when present,
  // otherwise they fall back to the standard promptTextTokens rate. Image,
  // audio, cache-write and video prompt variants are summed up explicitly so a
  // multimodal request is billed correctly.
  const promptText = usage.promptTextTokens || 0;
  const promptCached = usage.promptCachedTokens || 0;
  const promptCacheWrite = usage.promptCacheWriteTokens || 0;
  const promptImage = usage.promptImageTokens || 0;
  const promptAudio = usage.promptAudioTokens || 0;
  const promptVideo = usage.promptVideoTokens || 0;

  const billablePromptText = Math.max(0, promptText - promptCached);
  if (billablePromptText && pricing.promptTextTokens) {
    cost += billablePromptText * Number(pricing.promptTextTokens);
    matchedAny = true;
  }
  if (promptCached && pricing.promptCachedTokens) {
    cost += promptCached * Number(pricing.promptCachedTokens);
    matchedAny = true;
  } else if (promptCached && pricing.promptTextTokens) {
    // No explicit cache rate: charge cached tokens at the regular prompt rate
    // as a safe upper bound. Pollinations typically exposes promptCachedTokens
    // so this branch is a fallback for community/legacy entries.
    cost += promptCached * Number(pricing.promptTextTokens);
    matchedAny = true;
  }
  if (promptCacheWrite && pricing.promptCacheWriteTokens) {
    cost += promptCacheWrite * Number(pricing.promptCacheWriteTokens);
    matchedAny = true;
  }
  if (promptImage && pricing.promptImageTokens) {
    cost += promptImage * Number(pricing.promptImageTokens);
    matchedAny = true;
  }
  if (promptAudio && pricing.promptAudioTokens) {
    cost += promptAudio * Number(pricing.promptAudioTokens);
    matchedAny = true;
  }
  if (promptVideo && pricing.promptVideoTokens) {
    cost += promptVideo * Number(pricing.promptVideoTokens);
    matchedAny = true;
  }

  // Completion tokens: split across text/reasoning/audio/image variants.
  const completionText = usage.completionTextTokens || 0;
  const completionReasoning = usage.completionReasoningTokens || 0;
  const completionAudio = usage.completionAudioTokens || 0;
  const completionImage = usage.completionImageTokens || 0;
  const completionVideoSeconds = usage.completionVideoSeconds || 0;
  const completionAudioSeconds = usage.completionAudioSeconds || 0;

  if (completionText && pricing.completionTextTokens) {
    cost += completionText * Number(pricing.completionTextTokens);
    matchedAny = true;
  }
  if (completionReasoning && pricing.completionReasoningTokens) {
    cost += completionReasoning * Number(pricing.completionReasoningTokens);
    matchedAny = true;
  } else if (completionReasoning && pricing.completionTextTokens) {
    cost += completionReasoning * Number(pricing.completionTextTokens);
    matchedAny = true;
  }
  if (completionAudio && pricing.completionAudioTokens) {
    cost += completionAudio * Number(pricing.completionAudioTokens);
    matchedAny = true;
  }
  if (completionImage && pricing.completionImageTokens) {
    cost += completionImage * Number(pricing.completionImageTokens);
    matchedAny = true;
  }
  if (completionVideoSeconds && pricing.completionVideoSeconds) {
    cost += completionVideoSeconds * Number(pricing.completionVideoSeconds);
    matchedAny = true;
  }
  if (completionAudioSeconds && pricing.completionAudioSeconds) {
    cost += completionAudioSeconds * Number(pricing.completionAudioSeconds);
    matchedAny = true;
  }

  return matchedAny ? cost : null;
}

/**
 * Attach pollen cost headers to an outgoing Response by reading the upstream
 * `x-usage-*` headers (or, for streaming responses without those headers,
 * scanning the SSE body for the final `usage` chunk) and consulting the
 * pricing registry. The returned Response always has the original body
 * preserved; for streaming responses the body stream is fully consumed so
 * the cost headers can be attached before forwarding – callers that need
 * true streaming should rely on the upstream `x-usage-*` headers instead.
 */
async function attachPollenCost(response, modelName) {
  if (!response || !response.headers) return response;

  // SSE responses get the cost inlined into the `usage` chunk so streaming
  // clients can read it from the OpenAI-compatible payload without scraping
  // HTTP headers. Non-streaming responses keep the original header-based
  // attachment because there is no streaming chunk to embed into.
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return await injectPollenCostIntoStream(response, modelName);
  }
  return await attachPollenCostToHeaders(response, modelName);
}

/**
 * Attach pollen cost as `x-pollen-*` HTTP response headers. Used for
 * non-streaming (JSON) responses where there is no SSE chunk to inject into.
 */
async function attachPollenCostToHeaders(response, modelName) {
  const usage = extractUsageFromHeaders(response.headers);
  if (!Object.keys(usage).length) return response;

  const resolvedModel = modelName || response.headers.get("x-model-used") || "";

  const pricingEntry = await getModelPricing(resolvedModel);
  if (!pricingEntry || !pricingEntry.pricing) {
    // Still surface the raw usage so clients know the request was metered.
    const newHeaders = new Headers(response.headers);
    newHeaders.set("x-pollen-currency", "pollen");
    newHeaders.set("x-pollen-pricing-available", "false");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }
  const cost = calculatePollenCost(pricingEntry.pricing, usage);
  const newHeaders = new Headers(response.headers);
  newHeaders.set("x-pollen-currency", pricingEntry.pricing.currency || "pollen");
  newHeaders.set("x-pollen-model", resolvedModel);
  newHeaders.set("x-pollen-pricing-available", "true");
  if (cost !== null && Number.isFinite(cost)) {
    newHeaders.set("x-pollen-cost", cost.toFixed(9));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/**
 * Inject the pollen cost into the OpenAI-compatible SSE payload. The cost is
 * added as `usage.pollen_cost` (plus `usage.pollen_pricing_available` and
 * `usage.pollen_currency`) on the last chunk that already carries a `usage`
 * object. When the upstream never sends a usage chunk we append a new one
 * just before `data: [DONE]` so streaming clients always get the cost in
 * the same place they would read other usage stats.
 *
 * Note: streaming responses buffer the full body so we can compute the cost
 * and rewrite the payload. Pollinations already sends `x-usage-*` headers
 * for streamed responses so callers that prefer the header path can read
 * those instead of waiting for the body – the headers and the injected
 * `pollen_cost` always agree.
 */
async function injectPollenCostIntoStream(response, modelName) {
  if (!response || !response.body) return response;

  const headerUsage = extractUsageFromHeaders(response.headers);
  const resolvedModel = modelName || response.headers.get("x-model-used") || "";

  // Resolve pricing metadata up front so we can inject the cost into usage
  // chunks as they pass through, even when the upstream didn't send
  // `x-usage-*` headers.
  const pricingEntry = await getModelPricing(resolvedModel);
  const pricingAvailable = !!(pricingEntry && pricingEntry.pricing);
  const currency =
    pricingEntry && pricingEntry.pricing
      ? pricingEntry.pricing.currency || "pollen"
      : "pollen";

  // If the upstream already published the canonical usage via headers we
  // know the cost immediately and can stream the body through unmodified,
  // mutating each usage chunk in place as it goes by.
  const immediateUsage = Object.keys(headerUsage).length > 0 ? headerUsage : null;
  let immediateCostFields = null;
  if (immediateUsage) {
    const immediateCost = pricingAvailable
      ? calculatePollenCost(pricingEntry.pricing, immediateUsage)
      : null;
    immediateCostFields = {
      pollen_cost:
        immediateCost !== null && Number.isFinite(immediateCost)
          ? Number(immediateCost.toFixed(9))
          : null,
      pollen_pricing_available: pricingAvailable,
      pollen_currency: currency,
    };
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const newlineCode = "\n".charCodeAt(0);

  if (immediateCostFields) {
    // Fast path: header usage already gives us the cost, so we can stream
    // chunks straight through and rewrite usage chunks inline.
    let pending = "";
    const reader = response.body.getReader();
    const fields = immediateCostFields;
    const out = new ReadableStream({
      async pull(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (pending.length) {
                controller.enqueue(encoder.encode(pending));
                pending = "";
              }
              controller.close();
              return;
            }
            const text = pending + decoder.decode(value, { stream: true });
            let lastSplit = -1;
            for (let i = 0; i < text.length; i++) {
              if (text.charCodeAt(i) === newlineCode) lastSplit = i;
            }
            if (lastSplit === -1) {
              pending = text;
              continue;
            }
            const outText = text.slice(0, lastSplit + 1);
            pending = text.slice(lastSplit + 1);
            controller.enqueue(encoder.encode(rewriteLines(outText, fields)));
          }
        } catch (err) {
          console.log("injectPollenCostIntoStream: read failed:", err.message);
          controller.error(err);
        }
      },
      cancel(reason) {
        try { reader.cancel(reason); } catch {}
      },
    });
    return wrapStreamResponse(response, out, immediateCostFields, resolvedModel, pricingAvailable);
  }

  // Header-less streaming path: we don't know the cost until the upstream
  // emits a usage chunk. We pipe non-usage chunks straight through as they
  // arrive while buffering usage chunks. Once the first usage chunk
  // surfaces we compute the cost, flush the buffered usage chunks with the
  // cost injected, and continue forwarding the rest of the stream in real
  // time.
  const reader = response.body.getReader();
  const state = {
    pending: "",
    capturedUsage: {},
    costFields: null,
  };
  const usageBuffer = [];

  const out = new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Flush remaining usage buffer and any trailing partial line.
            const tail = state.pending;
            state.pending = "";
            for (const raw of usageBuffer) {
              controller.enqueue(encoder.encode(raw));
            }
            usageBuffer.length = 0;
            if (tail) controller.enqueue(encoder.encode(tail));
            controller.close();
            return;
          }
          const text = state.pending + decoder.decode(value, { stream: true });
          let lastSplit = -1;
          for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === newlineCode) lastSplit = i;
          }
          if (lastSplit === -1) {
            state.pending = text;
            continue;
          }
          const outText = text.slice(0, lastSplit + 1);
          state.pending = text.slice(lastSplit + 1);

          // Walk the lines: forward non-usage lines immediately, buffer
          // usage lines so we can rewrite them once the cost is known.
          const parts = outText.split("\n");
          let passThrough = "";
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;
            const lineText = part + (isLast ? "" : "\n");
            const lineInfo = parseSSELine(part);
            if (lineInfo && lineInfo.usage) {
              if (state.costFields) {
                const rewritten = rewriteLine(part, state.costFields);
                if (rewritten !== null) {
                  controller.enqueue(encoder.encode(rewritten + "\n"));
                } else {
                  controller.enqueue(encoder.encode(lineText));
                }
              } else {
                usageBuffer.push(lineText);
                state.capturedUsage = mergeUsage(
                  state.capturedUsage,
                  lineInfo.usage,
                );
                if (!state.costFields && Object.keys(state.capturedUsage).length) {
                  const cost = pricingAvailable
                    ? calculatePollenCost(pricingEntry.pricing, state.capturedUsage)
                    : null;
                  state.costFields = {
                    pollen_cost:
                      cost !== null && Number.isFinite(cost)
                        ? Number(cost.toFixed(9))
                        : null,
                    pollen_pricing_available: pricingAvailable,
                    pollen_currency: currency,
                  };
                  // Now that we know the cost, flush every buffered usage
                  // chunk in order with the cost injected.
                  for (const bufferedRaw of usageBuffer) {
                    const bufferedInfo = parseSSELine(bufferedRaw.replace(/\n$/, ""));
                    if (bufferedInfo && bufferedInfo.usage) {
                      const rewritten = rewriteLine(
                        bufferedRaw.replace(/\n$/, ""),
                        state.costFields,
                      );
                      controller.enqueue(
                        encoder.encode((rewritten !== null ? rewritten : bufferedRaw.replace(/\n$/, "")) + "\n"),
                      );
                    } else {
                      controller.enqueue(encoder.encode(bufferedRaw));
                    }
                  }
                  usageBuffer.length = 0;
                }
              }
            } else if (lineText.length > 0) {
              passThrough += lineText;
            }
          }
          if (passThrough.length) controller.enqueue(encoder.encode(passThrough));
        }
      } catch (err) {
        console.log("injectPollenCostIntoStream: read failed:", err.message);
        controller.error(err);
      }
    },
    cancel(reason) {
      try { reader.cancel(reason); } catch {}
    },
  });

  return wrapStreamResponse(response, out, null, resolvedModel, pricingAvailable);
}

/**
 * Rewrite every `data: ...` line that already carries a `usage` object in a
 * chunk of SSE text. The cost fields are merged into the existing usage so
 * upstream token counts are preserved.
 */
function rewriteLines(text, costFields) {
  const parts = text.split("\n");
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    if (!isLast) {
      const rewritten = rewriteLine(part, costFields);
      out += (rewritten !== null ? rewritten : part) + "\n";
    } else {
      // Trailing partial line – keep it untouched; the next chunk will
      // combine with it.
      out += part;
    }
  }
  return out;
}

/**
 * Rewrite a single SSE line so that any `usage` object it carries gains the
 * pollen cost fields. Returns the new line text, or `null` if the line
 * doesn't carry a usage object or could not be parsed.
 */
function rewriteLine(line, costFields) {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (!parsed.usage || typeof parsed.usage !== "object") return null;
  parsed.usage = { ...parsed.usage, ...costFields };
  return "data: " + JSON.stringify(parsed);
}

/**
 * Parse a single SSE line and return its `{ parsed, usage }` shape if it
 * carries a JSON payload with a `usage` object. Returns `null` for non-data
 * lines, [DONE] sentinels, and unparseable payloads.
 */
function parseSSELine(line) {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (!parsed.usage || typeof parsed.usage !== "object") return null;
  return { parsed, usage: convertOpenAIUsageToHeadersShape(parsed.usage) };
}

/**
 * Build the final Response wrapping the transformed stream, with pollen cost
 * headers attached when we have them.
 */
function wrapStreamResponse(originalResponse, body, costFields, resolvedModel, pricingAvailable) {
  const newHeaders = new Headers(originalResponse.headers);
  if (costFields) {
    newHeaders.set("x-pollen-currency", costFields.pollen_currency);
    newHeaders.set(
      "x-pollen-pricing-available",
      costFields.pollen_pricing_available ? "true" : "false",
    );
    if (resolvedModel) newHeaders.set("x-pollen-model", resolvedModel);
    if (costFields.pollen_cost !== null && Number.isFinite(costFields.pollen_cost)) {
      newHeaders.set("x-pollen-cost", costFields.pollen_cost.toFixed(9));
    }
  } else if (pricingAvailable !== undefined) {
    newHeaders.set(
      "x-pollen-pricing-available",
      pricingAvailable ? "true" : "false",
    );
  }
  return new Response(body, {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: newHeaders,
  });
}

/**
 * Handle GET /v1/models - List available models
 */
async function handleListModels(request, env, free) {
  const models = [];

  // Extract API key if provided
  const authHeader = request.headers.get("Authorization");
  let apiKey = env.POLLINATIONS_API_KEY;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7).split(/\s+/);
  }

  try {
    // Fetch text models
    const textResponse = await fetch(POLLINATIONS_MODELS_API);
    if (textResponse.ok) {
      const textData = await textResponse.json();
      const textModels = textData.data || textData || [];
      for (const model of textModels) {
        const costs = (model.pricing.promptTextTokens || 0) * 1e5
        if (costs > 0.25) {
          continue;
        }
        if (free && model.paid_only) {
          continue;
        }
        models.push({
          id: model.name,
          object: "model",
          created: 0,
          owned_by: "pollinations",
          costs: costs,
          ...model
        });
      }
    }

    // Fetch image models
    const imageResponse = await fetch(POLLINATIONS_IMAGE_MODELS_API);
    if (imageResponse.ok) {
      const imageData = await imageResponse.json();
      for (const model of imageData) {
        const costs = model.pricing.completionImageTokens * 5;
        if (costs > 0.25) {
          continue;
        }
        if (free && model.paid_only) {
          continue;
        }
        const isVideo = model.output_modalities && model.output_modalities.includes('video');
        models.push({
          id: model.name,
          object: "model",
          created: 0,
          owned_by: "pollinations",
          costs: costs,
          image: !isVideo,
          video: isVideo,
          ...model
        });
      }
    }
  } catch (e) {
    console.log("Pollinations models fetch failed:", e.message);
  }

  //models.sort((a, b) => b.added_date - a.added_date);

  return new Response(JSON.stringify({
    object: "list",
    data: models
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Handle GET /image/models - List available image models
 */
async function handleListImageModels(request, env) {
  const models = [];

  // Extract API key if provided
  const authHeader = request.headers.get("Authorization");
  let apiKey = env.POLLINATIONS_API_KEY;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokens = authHeader.substring(7).split(/\s+/);
    const providerKey = tokens.find(t => t && !t.startsWith('g4f_'));
    if (providerKey) {
      apiKey = providerKey;
    }
  }

  const useGen = !!apiKey;
  try {
    // Fetch image models
    const imageModelsUrl = useGen ? POLLINATIONS_GEN_IMAGE_MODELS_API : POLLINATIONS_IMAGE_MODELS_API;
    const imageResponse = await fetch(imageModelsUrl);
    if (imageResponse.ok) {
      const imageData = await imageResponse.json();
      for (const model of imageData) {
        const modelName = model.name || model;
        const isVideo = model.output_modalities && model.output_modalities.includes('video');
        models.push({
          id: modelName,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "pollinations",
          image: !isVideo,
          video: isVideo
        });
      }
    }
  } catch (e) {
    console.log("Pollinations image models fetch failed:", e.message);
  }

  return new Response(JSON.stringify({
    object: "list",
    data: models
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Handle GET /image/models - List available image models
 */
async function handlePath(dir, path, request, env) {

  return await fetch(`https://gen.pollinations.ai/${dir}/${path}`, request)
}

/**
 * Generic authenticated proxy for the remaining `/v1/*` generation endpoints
 * on gen.pollinations.ai that don't need custom handling:
 *   - POST /v1/embeddings
 *   - POST /v1/audio/speech
 *   - POST /v1/audio/transcriptions
 *   - GET  /v1/models/status
 * The Authorization header is forwarded as-is so callers can use their own
 * Pollinations key (`sk_`/`pk_`); when absent the worker's default key is
 * used. WebSocket upgrade requests (`/v1/realtime`) are also passed through
 * untouched so realtime sessions work end-to-end.
 */
async function handleGenProxy(request, env) {
  const url = new URL(request.url);
  const upstreamUrl = POLLINATIONS_GEN_API + url.pathname + url.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  if (!headers.has("Authorization") && env.POLLINATIONS_API_KEY) {
    headers.set("Authorization", `Bearer ${env.POLLINATIONS_API_KEY}`);
  }

  if (request.headers.get("Upgrade") === "websocket") {
    return fetch(upstreamUrl, request);
  }

  const response = await fetch(upstreamUrl, {
    method: request.method,
    headers: headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
  });
  return new Response(response.body, response);
}

/**
 * Handle POST /v1/chat/completions - Chat completion
 */
async function handleChatCompletion(request, env, ctx) {
  const body = await request.json();
  const model = resolveModel(body.model);

  // Extract API key if provided
  const authHeader = request.headers.get("Authorization");
  let apiKey = env.POLLINATIONS_API_KEY;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokens = authHeader.substring(7).split(/\s+/);
    const providerKey = tokens.find(t => t && !t.startsWith('g4f_'));
    if (providerKey) {
      apiKey = providerKey;
    }
  }

  const useGen = !!apiKey;
  const textApiUrl = useGen ? POLLINATIONS_GEN_TEXT_API : POLLINATIONS_TEXT_API;

  const requestBody = {
    ...body,
    model: model
  };

  const headers = {
    "Content-Type": "application/json"
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(textApiUrl, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Pollinations attaches `x-usage-*` headers to the final response. For
  // streaming responses (`stream: true`) the headers are sent on the SSE
  // "trailer" – we need to copy them into a new Response before the body
  // stream is consumed by the client.
  const costed = await attachPollenCost(response, model);
  return costed;
}

/**
 * Handle POST /v1/images/generations - Image generation
 */
/**
 * Handle POST /v1/images/generations - Image generation
 *
 * Uses the OpenAI-compatible `/v1/images/generations` endpoint on
 * gen.pollinations.ai when an API key is present (returns b64_json / url),
 * otherwise falls back to the legacy `image.pollinations.ai/prompt/{prompt}`
 * GET endpoint for unauthenticated URL-based generation.
 */
async function handleImageGeneration(request, env, ctx) {
  const body = await request.json();
  const prompt = body.prompt;
  delete body.prompt;
  const size = body.size;
  delete body.size;
  const response_format = body.response_format || "url";
  delete body.response_format;

  // Extract API key if provided
  const authHeader = request.headers.get("Authorization");
  let apiKey = env.POLLINATIONS_API_KEY;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokens = authHeader.substring(7).split(/\s+/);
    const providerKey = tokens.find(t => t && !t.startsWith('g4f_'));
    if (providerKey) {
      apiKey = providerKey;
    }
  }

  if (!prompt) {
    return new Response(JSON.stringify({
      error: {
        message: "Prompt is required",
        type: "invalid_request_error",
        code: 400
      }
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Authenticated path: use the OpenAI-compatible endpoint on gen.pollinations.ai
  if (apiKey) {
    const requestBody = {
      ...body,
      prompt: prompt,
      response_format: response_format,
    };
    if (size) requestBody.size = size;

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };

    const response = await fetch(POLLINATIONS_GEN_API + "/v1/images/generations", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Capture upstream usage headers before consuming the body so we can
    // compute and surface the pollen cost on the synthesized JSON response.
    const upstreamUsage = extractUsageFromHeaders(response.headers);
    const pricingEntry = await getModelPricing(body.model);

    const newResponse = new Response(response.body, response);
    newResponse.headers.set("Content-Type", "application/json");

    // Attach pollen cost metadata when we have upstream usage data.
    if (Object.keys(upstreamUsage).length) {
      if (pricingEntry && pricingEntry.pricing) {
        const cost = calculatePollenCost(pricingEntry.pricing, upstreamUsage);
        newResponse.headers.set("x-pollen-currency", pricingEntry.pricing.currency || "pollen");
        newResponse.headers.set("x-pollen-model", body.model || "");
        newResponse.headers.set("x-pollen-pricing-available", "true");
        if (cost !== null && Number.isFinite(cost)) {
          newResponse.headers.set("x-pollen-cost", cost.toFixed(9));
        }
      } else {
        newResponse.headers.set("x-pollen-currency", "pollen");
        newResponse.headers.set("x-pollen-pricing-available", "false");
      }
    }
    return newResponse;
  }

  // Unauthenticated fallback: legacy image.pollinations.ai GET endpoint
  const imageApiUrl = POLLINATIONS_IMAGE_API;
  let imageUrl = imageApiUrl.replace('{prompt}', encodeURIComponent(prompt));
  const params = new URLSearchParams();
  if (size) {
    const [width, height] = size.split('x').map(Number);
    params.append('width', width);
    params.append('height', height);
  }
  params.append('nologo', 'true');
  params.append('seed', '10352102');
  for (const [key, value] of Object.entries(body)) {
    params.append(key, String(value));
  }

  imageUrl += '?' + params.toString();

  try {
    const response = await fetch(imageUrl);
    if (!response.ok || response.headers.get("x-error-type")) {
      throw new Error(`Image generation failed: ${response.headers.get("x-error-type") || response.status}`);
    }

    const imageBlob = await response.blob();
    const base64 = await blobToBase64(imageBlob);
    const contentType = response.headers.get('Content-Type');
    const newResponse = new Response(JSON.stringify({
      created: Math.floor(Date.now() / 1000),
      data: [{
        url: `data:${contentType};base64,${base64.split(',')[1]}`
      }]
    }), response);
    newResponse.headers.set("Content-Type", "application/json");
    return newResponse;
  } catch (error) {
    return new Response(JSON.stringify({
      error: {
        message: error.message,
        type: "api_error",
        code: 500
      }
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Handle CORS preflight requests
 */
function handleOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

/**
 * Add CORS headers to response
 */
function addCorsHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    let response;

    try {
      // Route requests
      if (path.includes("/image/") && request.method === "GET") {
        response = await handlePath("image", path.split("/image/", 2)[1], request, env);
      } else if (path.includes("/text/") && request.method === "GET") {
        response = await handlePath("text", path.split("/text/", 2)[1], request, env);
      } else if (path == "/api/usage" && request.method === "GET") {
        response = await handlePath("api", "usage", request, env);
      } else if (path.startsWith("/account/") && request.method === "GET") {
        response = await handlePath("account", path.substring("/account/".length), request, env);
      } else if (path.endsWith("/models") && request.method === "GET") {
        response = await handleListModels(request, env, path.startsWith("/free/"));
      } else if (path.endsWith("/quota") && request.method === "GET") {
        response = await handlePath("account", "balance", request, env);
      } else if (path.endsWith("/chat/completions") && request.method === "POST") {
        response = await handleChatCompletion(request, env, ctx);
      } else if (path.endsWith("/images/generations") && request.method === "POST") {
        response = await handleImageGeneration(request, env, ctx);
      } else if (path.startsWith("/v1/")) {
        response = await handleGenProxy(request, env);
      } else if (path === "/" || path === "/health") {
        response = new Response(JSON.stringify({
          status: "ok",
          service: "Pollinations AI OpenAI-Compatible API (text.pollinations.ai & gen.pollinations.ai)",
          endpoints: [
            "/v1/chat/completions",
            "/v1/images/generations",
            "/v1/embeddings",
            "/v1/audio/speech",
            "/v1/audio/transcriptions",
            "/v1/models",
            "/v1/models/status",
            "/v1/realtime",
            "/models",
            "/image/models",
            "/image/{prompt}",
            "/text/{prompt}"
          ]
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } else {
        response = new Response(JSON.stringify({
          error: {
            message: "Not found",
            type: "invalid_request_error",
            code: 404
          }
        }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
    } catch (error) {
      response = new Response(JSON.stringify({
        error: {
          message: error.message,
          type: "internal_error",
          code: 500
        }
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return addCorsHeaders(response);
  }
};

/**
 * Convert blob to base64 data URL
 */
async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const binaryString = uint8Array.reduce((data, byte) => data + String.fromCharCode(byte), '');
  const base64 = btoa(binaryString);
  return `data:${blob.type};base64,${base64}`;
}