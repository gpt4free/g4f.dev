const modelTags = {
    image: "🎨",
    "image-edit": "🎨",
    vision: "👓",
    audio: "🎧",
    video: "🎥",
    paid_only: "💰",
    free: "🆓",
    tools: "🧰",
    reasoning: "🧠",
};

function getModelLabel(model) {
    let label = model.label;
    if (model.title) {
        label = `${model.title} (${model.id})`;
    } else if (!label) {
        label = `${model.id || ""}`.replace("models/", "");
    }
    if (model.default) {
        label += ` (${framework.translate("default")})`;
    }
    if (model.cost_label) {
        label += ` (${model.cost_label})`;
    }
    return label;
}

function getModelTags(model, addVision = true) {
    const parts = [];
    for (const [name, text] of Object.entries(modelTags)) {
        if (name !== "vision" || addVision) {
            parts.push(model[name] ? ` ${text}` : "");
        }
        if (!model[name] && model.type === name) {
            parts.push(` ${text}`);
        }
    }
    return parts.join("");
}

// ------------------------------------------------------------------
// Cost estimation
//
// Pricing data arrives in several formats depending on the source:
//   • OpenRouter:      { prompt: "0.000002", completion: "0.000006", image: "...", audio: "...", request: "0.01" }
//                       values are USD per single token (or per request for `request`)
//   • Pollinations:    { promptTextTokens: "0.00000015", completionTextTokens: "0.0000009375",
//                        completionImageTokens: "0.004", completionVideoSeconds: "0.08" }
//                       values are USD per token / per second; `flat_rate: true` means
//                       completionImageTokens is USD per image, not per token
//   • DeepInfra:       { cents_per_input_token: 0.000285, cents_per_output_token: 0.001425 }
//                       { cents_per_image_unit: 1.4 }  |  { cents_per_input_chars: 0.002 }
//                       values are cents per token / per image / per char
//   • OrcaRouter:      { prompt, completion, prompt_per_million, request, request_unit: "second"|"minute" }
//                       `prompt: "-1"` is a sentinel for routing/variable-pricing models
//   • Legacy/g4f:      { completionTextTokens, completionImageTokens, completionVideoSeconds }
//   • Generic:         { output: "0.002" } | { completion: "0.000002" }
//
// We normalise everything to a single `per_million` value: the estimated
// USD cost for 1 million tokens (input + output combined for chat models,
// or per-unit for image/video/audio). This matches how OpenAI, Anthropic
// and OpenRouter display pricing on their sites.
// ------------------------------------------------------------------
const COST_TOKENS_PER_UNIT = 1_000_000; // report per 1M tokens
const COST_TYPICAL_INPUT = 500;         // assumed prompt tokens for a chat turn
const COST_TYPICAL_OUTPUT = 500;        // assumed completion tokens for a chat turn

function _num(v) {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : 0;
}

function _formatCost(perMillion) {
    if (perMillion <= 0) return null;
    if (perMillion < 0.01) return `$${perMillion.toFixed(4)}/M`;
    if (perMillion < 1)    return `$${perMillion.toFixed(3)}/M`;
    if (perMillion < 100)  return `$${perMillion.toFixed(2)}/M`;
    return `$${perMillion.toFixed(1)}/M`;
}

// Blended per-1M-token cost for a typical 500-in / 500-out chat request
function _chatResult(inputPerToken, outputPerToken) {
    const typicalTotal = COST_TYPICAL_INPUT + COST_TYPICAL_OUTPUT;
    const perToken = (inputPerToken * COST_TYPICAL_INPUT + outputPerToken * COST_TYPICAL_OUTPUT) / typicalTotal;
    const perMillion = perToken * COST_TOKENS_PER_UNIT;
    return { per_million: perMillion, label: _formatCost(perMillion) };
}

function _imgResult(usdPerImage) {
    const label = usdPerImage < 1 ? `$${usdPerImage.toFixed(4)}/img` : `$${usdPerImage.toFixed(2)}/img`;
    return { per_million: usdPerImage, label };
}

function _imageCost(p, flatRate) {
    const imageCost = _num(p.image);
    const legacyImage = _num(p.completionImageTokens);
    const perUnit = imageCost > 0 ? imageCost : legacyImage;
    if (perUnit <= 0) return null;
    if (flatRate) return _imgResult(perUnit);
    return { per_million: perUnit * COST_TOKENS_PER_UNIT, label: _formatCost(perUnit * COST_TOKENS_PER_UNIT) };
}

function _videoCost(p) {
    const v = _num(p.completionVideoSeconds);
    if (v <= 0) return null;
    const label = v < 1 ? `$${v.toFixed(3)}/s` : `$${v.toFixed(2)}/s`;
    return { per_million: v, label };
}

function _audioCost(p) {
    const a = _num(p.audio);
    const legacy = _num(p.completionAudioSeconds);
    const perSec = a > 0 ? a : legacy;
    if (perSec <= 0) return null;
    const label = perSec < 1 ? `$${perSec.toFixed(4)}/s` : `$${perSec.toFixed(2)}/s`;
    return { per_million: perSec, label };
}

function estimateModelCost(pricing, type, options = {}) {
    if (!pricing || typeof pricing !== "object") return null;

    const p = pricing;
    const isImage = type === "image" || type === "image-edit";
    const isVideo = type === "video";
    const isAudio = type === "audio";
    const flatRate = options.flat_rate || p.flat_rate;

    // Sentinel: negative prompt/completion = routing/variable-pricing model
    if (_num(p.prompt) < 0 || _num(p.completion) < 0) return null;

    // --- DeepInfra specialised formats (unambiguous, check first) ---
    if ("cents_per_image_unit" in p) {
        const usd = _num(p.cents_per_image_unit) / 100;
        if (usd > 0) return _imgResult(usd);
    }
    if ("cents_per_input_chars" in p) {
        const usd = _num(p.cents_per_input_chars) / 100;
        if (usd > 0) return { per_million: usd, label: `$${(usd * 1000).toFixed(4)}/1K chars` };
    }

    // --- Type-prioritised media pricing ---
    // For multimodal models (e.g. Nano Banana), use the pricing that
    // matches the model type so image models show image costs, not text.
    if (isImage) {
        const r = _imageCost(p, flatRate);
        if (r) return r;
    }
    if (isVideo) {
        const r = _videoCost(p);
        if (r) return r;
    }
    if (isAudio) {
        const r = _audioCost(p);
        if (r) return r;
    }

    // --- Chat / text pricing ---
    // DeepInfra: cents_per_input_token + cents_per_output_token
    if ("cents_per_output_token" in p || "cents_per_input_token" in p) {
        const inUsd = _num(p.cents_per_input_token) / 100;
        const outUsd = _num(p.cents_per_output_token) / 100;
        if (inUsd > 0 || outUsd > 0) return _chatResult(inUsd, outUsd);
    }

    // Pollinations: promptTextTokens + completionTextTokens (USD per token)
    if ("promptTextTokens" in p) {
        const inUsd = _num(p.promptTextTokens);
        const outUsd = _num(p.completionTextTokens);
        if (inUsd > 0 || outUsd > 0) return _chatResult(inUsd, outUsd);
    }

    if ("input" in p) {
        const inUsd = _num(p.input) / 1e6;
        const outUsd = _num(p.output) / 1e6;
        if (inUsd > 0 || outUsd > 0) return _chatResult(inUsd, outUsd);
    }

    // OpenRouter: prompt + completion (USD per token)
    {
        const inUsd = _num(p.prompt);
        const outUsd = _num(p.completion);
        if (inUsd > 0 || outUsd > 0) return _chatResult(inUsd, outUsd);
    }

    // --- Fallback media pricing (type didn't match but fields exist) ---
    if (!isImage) {
        const r = _imageCost(p, flatRate);
        if (r) return r;
    }
    if (!isVideo) {
        const r = _videoCost(p);
        if (r) return r;
    }
    if (!isAudio) {
        const r = _audioCost(p);
        if (r) return r;
    }

    // --- Legacy completionTextTokens (output-only, USD per token) ---
    const legacyText = _num(p.completionTextTokens);
    if (legacyText > 0) return _chatResult(0, legacyText);

    // --- Flat per-request fee (with optional time unit) ---
    const requestCost = _num(p.request);
    if (requestCost > 0) {
        const unit = p.request_unit === "second" ? "s" : p.request_unit === "minute" ? "min" : "req";
        const label = requestCost < 1 ? `$${requestCost.toFixed(4)}/${unit}` : `$${requestCost.toFixed(2)}/${unit}`;
        return { per_million: requestCost, label };
    }

    return null;
}

function convertModel(inputModel, options = {}) {
    const model = inputModel;
    const useModelName = !!options.useModelName;
    if (!model.id || useModelName) {
        model.id = model.name || model.model_name || model.model;
    }
    if (options.defaultModel && model.id === options.defaultModel) {
        model.default = true;
    }
    if (!model.type) {
        if (model.task?.name === "Text Generation") {
            model.type = "chat";
        } else if (model.task?.name === "Text-to-Image") {
            model.type = "image";
        } else if (model.id.toLowerCase().includes("video")) {
            model.type = "video";
        } else if (model.video) {
            model.type = "video";
        } else if (model.id.includes("veo-")) {
            model.type = "video";
        } else if (model.supports_chat) {
            model.type = "chat";
        } else if (model.supports_images) {
            model.type = "image";
        } else if (model.image) {
            model.type = "image";
        } else if (model.task?.name) {
            model.type = "unknown";
        } else if (model.id.toLowerCase().includes("embed")) {
            model.type = "embedding";
        } else if (model.id.toLowerCase().includes("tts") || model.id.toLowerCase().includes("whisper")) {
            model.type = "audio";
        } else if (model.id.toLowerCase().includes("flux") || model.id.toLowerCase().includes("image")) {
            model.type = "image";
        } else if (["sdxl", "nano-banana", "lucid-origin"].includes(model.id)) {
            model.type = "image";
        } else if (model.id.includes("generate")) {
            model.type = "image";
        } else if (model.media_type) {
            model.type = model.media_type;
        } else {
            model.type = "chat";
        }
    }
    if (["text", "text-generation", "chat.completions"].includes(model.type)) {
        model.type = "chat";
    } else if (model.type === "text-to-image") {
        model.type = "image";
    }
    const inputModalities = model.input_modalities || model.architecture?.input_modalities || [];
    if (inputModalities.includes("image")) {
        model.vision = true;
    }
    if (inputModalities.includes("audio") || model.id.includes("audio")) {
        model.audio = true;
    }
    if (model.supports_tools) {
        model.tools = true;
    } else if (model.providers && model.providers.length > 0) {
        model.tools = model.providers[0].supports_tools;
    } else if (model.tags && model.tags.includes("tools")) {
        model.tools = true;
    } else if (model.properties?.function_calling) {
        model.tools = true;
    }
    if (model.tags && model.tags.includes("reasoning")) {
        model.reasoning = true;
    } else if (model.properties?.reasoning) {
        model.reasoning = true;
    }
    if (model.id) {
        if (model.id.endsWith("/free") || model.id.endsWith(":free")) {
            model.free = true;
        }
        if (model.id.startsWith("models/gemini-") && model.id.includes("-flash-") && (model.id.endsWith("-latest") || model.id.endsWith("-preview")) && !model.id.includes("-image-") && !model.id.includes("-audio-") && !model.id.includes("-live-")) {
            model.free = true;
        }
        if (model.id.startsWith("models/gemma-")) {
            model.free = true;
        }
    }
    if (model.tiers && model.tiers.includes("Free")) {
        model.free = true;
    }
    if (model.multiplier === 1) {
        model.free = true;
    }
    if (model.pricing) {
        const cost = estimateModelCost(model.pricing, model.type, { flat_rate: model.flat_rate });
        if (cost) {
            model.total_cost = cost.per_million;
            model.cost_label = cost.label;
            model.free = false;
            console.log(`Model ${model.id} estimated cost: ${cost.label}`);
        } else {
            model.free = true;
        }
    }
    model.label = getModelLabel(model);
    model.tags = getModelTags(model);
    const count = model.count || model.requests || 0;
    model.label = model.label + (count > 1 ? ` (${count}+)` : "") + (model.tags ? ` ${model.tags}` : "");
    return model;
}

function isValidModel(model) {
    return !model.type || ["chat", "image", "image-edit", "video"].includes(model.type);
}

export { modelTags, getModelLabel, getModelTags, convertModel, isValidModel, estimateModelCost };
