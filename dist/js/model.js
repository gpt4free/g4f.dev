const modelTags = {
    image: "🎨",
    "image-edit": "🎨",
    vision: "👓",
    audio: "🎧",
    video: "🎥",
    paid_only: "💰",
    free: "🆓",
    tools: "🧰"
};

function getModelLabel(model) {
    const value = model.label || `${model.id || ""}`.replace("models/", "");
    return value;
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

function convertModel(inputModel, options = {}) {
    const model = inputModel;
    const useModelName = !!options.useModelName;
    if (!model.id || useModelName) {
        model.id = model.name || model.model_name;
    }
    model.label = getModelLabel(model);
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
    if (inputModalities.includes('audio')) {
        model.audio = true;
    }
    if (model.supports_tools) {
        model.tools = true;
    } else if (model.providers && model.providers.length > 0) {
        model.tools = model.providers[0].supports_tools;
    } else if (model.tags && model.tags.includes("tools")) {
        model.tools = true;
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
    model.tags = getModelTags(model);
    const count = model.count || model.requests || 0;
    model.label = model.label + (count > 1 ? ` (${count}+)` : "") + (model.tags ? ` ${model.tags}` : "");
    return model;
}

function isValidModel(model) {
    return !model.type || ["chat", "image", "image-edit", "video"].includes(model.type);
}

export { modelTags, getModelLabel, getModelTags, convertModel, isValidModel };
