const modelTags = {
    image: "🎨",
    "image-edit": "🎨",
    vision: "👓",
    audio: "🎧",
    video: "🎥",
    paid_only: "💰",
    free: "🆓",
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
    if (model.id) {
        if (model.id.endsWith("/free") || model.id.endsWith(":free")) {
            parts.push(` ${modelTags.free}`);
        }
        if (model.id.startsWith("models/gemini-") && model.id.includes("-flash-") && (model.id.endsWith("-latest") || model.id.endsWith("-preview")) && !model.id.includes("-image-") && !model.id.includes("-audio-") && !model.id.includes("-live-")) {
            parts.push(` ${modelTags.free}`);
        }
        if (model.id.startsWith("models/gemma-")) {
            parts.push(` ${modelTags.free}`);
        }
    }
    if (model.tiers && model.tiers.includes("Free")) {
        parts.push(` ${modelTags.free}`);
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
        } else if (model.supports_chat) {
            model.type = "chat";
        } else if (model.supports_images) {
            model.type = "image";
        } else if (model.image) {
            model.type = "image";
        } else if (model.task?.name) {
            model.type = "unknown";
        } else if (model.id.toLowerCase().includes("embedding")) {
            model.type = "embedding";
        } else if (model.id.toLowerCase().includes("tts") || model.id.toLowerCase().includes("whisper")) {
            model.type = "audio";
        } else if (model.id.toLowerCase().includes("flux") || model.id.toLowerCase().includes("image")) {
            model.type = "image";
        } else if (["sdxl", "nano-banana", "lucid-origin"].includes(model.id)) {
            model.type = "image";
        } else if (model.id.includes("generate")) {
            model.type = "image";
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
    model.tags = getModelTags(model);
    model.labelWithTags = model.label + (model.requests > 1 ? ` (${model.requests}+)` : "") + (model.tags ? ` ${model.tags}` : "");
    return model;
}

export { modelTags, getModelLabel, getModelTags, convertModel };
