
class HtmlRenderPlugin {
    constructor(options = {}) {
        self.hook = options.hook;
        self.callback = options.callback
    }
    "after:highlightElement"({
        el,
        text
    }) {
        if (!el.classList.contains("language-html") && !el.classList.contains("language-svg")) {
            return;
        }
        let button = Object.assign(document.createElement("button"), {
            innerHTML: '<i class="fa-regular fa-folder-open"></i>',
            className: "hljs-iframe-button",
        });
        el.parentElement.appendChild(button);
        button.onclick = async () => {
            let newText = text;
            if (hook && typeof hook === "function") {
                newText = hook(text, el) || text
            }
            const mimeType = el.classList.contains("language-svg") ? "image/svg+xml" : "text/html";
            iframe.src = `data:${mimeType};charset=utf-8,${encodeURIComponent(newText)}`;
            iframe_container.classList.remove("hidden");
            if (typeof callback === "function") return callback(newText, el);
        }
    }
}
let typesetPromise = Promise.resolve();
let hljs_loaded = false;
const highlight = (container) => {
    if (window.hljs) {
        if (window.hljs && !hljs_loaded) {
            hljs.addPlugin(new HtmlRenderPlugin());
            if (typeof CopyButtonPlugin === 'function') {
                hljs.addPlugin(new CopyButtonPlugin());
                hljs_loaded = true;
            }
        }
        container.querySelectorAll('code:not(.hljs)').forEach((el) => {
            if (el.className != "hljs") {
                hljs.highlightElement(el);
            }
        });
    }
    if (window.MathJax && window.MathJax.typesetPromise) {
        typesetPromise = typesetPromise.then(
            () => MathJax.typesetPromise([container])
        ).catch(
            (err) => console.log('Typeset failed: ' + err.message)
        );
    }
}

export default { highlight, typesetPromise };