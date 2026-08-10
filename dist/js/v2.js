const v = "{{ v }}";
const addons = [["core"], ["legacy", "init"], ["photoswipe", "host", "manager", "load"], ["api-worker", "voice-preview", "baked-credits", "highlight", "renderers", "mobile-experience", "worker", "ask", "messages", "ask-gpt", "conversations", "settings", "providers-ui", "providers-models", "mobile", "theme-manager"]];

window.domReady = new Promise((resolve) => {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", resolve);
    } else {
        resolve();
    }
});

window.addonsLoaded = new Promise(async (resolve) => {
    for (let i = 0; i < addons.length; i++) {
        const chunks = addons[i];
        const jobs = chunks.map((addon) => {
            return new Promise((resolve) => {
                const script = document.createElement("script");
                script.type = "module";
                //script.defer = true;
                window[`resolve_${addon.replaceAll("-", "_")}`] = resolve;
                script.textContent = `import container from "/dist/js/addons/addon-${addon}.js?v=${v}";
                window.addon_${addon.replaceAll("-", "_")} = container;
                for (const [key, value] of Object.entries(container)) {
                    window[key] = value;
                }
                window.resolve_${addon.replaceAll("-", "_")}()
                `;
                document.head.appendChild(script);
            });
        });
        await Promise.all(jobs);
    }
    resolve();
});