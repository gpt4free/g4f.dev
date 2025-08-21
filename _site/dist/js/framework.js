window.oauthConfig = {
    clientId: '762e4f6f-2af6-437c-ad93-944cc17f9d23',
    scopes: ['inference-api']
}
window.framework = {}
g4f_host = "https://host.g4f.dev";
const checkUrls = [];
if (window.location.protocol === "file:") {
    checkUrls.push("http://localhost:1337");
    checkUrls.push("http://localhost:8080");
}
if (["https:", "http:"].includes(window.location.protocol)) {
    checkUrls.push(window.location.origin);
}
checkUrls.push(g4f_host);
checkUrls.push("https://phone.g4f.dev");
checkUrls.push("https://home.g4f.dev");
async function checkUrl(url, connectStatus) {
    let response;
    try {
        response = await fetch(`${url}/backend-api/v2/version?cache=true`, {signal: AbortSignal.timeout(3000)});
    } catch (error) {
        console.debug("Error check url: ", url);
        return false;
    }
    if (response.ok) {
        connectStatus ? connectStatus.innerText = url : null;
        localStorage.setItem("backendUrl", url);
        framework.backendUrl = url;
        return true;
    }
    return false;
}
framework.backendUrl = localStorage.getItem('backendUrl')
if (framework.backendUrl && !framework.backendUrl.endsWith(".g4f.dev")) {
    framework.backendUrl = "";
}
framework.connectToBackend = async (connectStatus) => {
    for (const url of checkUrls) {
        if(await checkUrl(url, connectStatus)) {
            return;
        }
    }
};
let newTranslations = [];
framework.translate = (text) => {
    if (text) {
        const endWithSpace = text.endsWith(" ");
        strip_text = text.trim();
        if (strip_text in framework.translations && framework.translations[strip_text]) {
            return framework.translations[strip_text] + (endWithSpace ? " " : "");
        }
        strip_text && !newTranslations.includes(strip_text) ? newTranslations.push(strip_text) : null;
    }
    return text;
};
framework.translationKey = "translations" + document.location.pathname;
framework.translations = JSON.parse(localStorage.getItem(framework.translationKey) || "{}");
framework.translateElements = function (elements = null) {
    if (!framework.translations && !document.body.classList.contains("translate")) {
        return;
    }
    elements = elements || document.querySelectorAll("p:not(:has(*)), a:not(:has(*)), h1, h2, h3, h4, h5, h6, button:not(:has(*)), title, span:not(:has(*)), strong, a:not(:has(*)), [data-translate], input, textarea, label:not(:has(*)), i, option[value='']");
    elements.forEach(function (element) {
        let parent = element.parentElement;
        if (element.classList.contains("notranslate") || parent && parent.classList.contains("notranslate")) {
            return;
        }
        if (element.textContent.trim()) {
            element.textContent = framework.translate(element.textContent);
        }
        if (element.alt) {
            element.alt = framework.translate(element.alt);
        }
        if (element.title) {
            element.title = framework.translate(element.title);
        }
        if (element.placeholder) {
            element.placeholder = framework.translate(element.placeholder);
        }
    });
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", async () => {
        framework.translateElements();
    });
} else {
    framework.translateElements();
}
window.addEventListener('load', async () => {
    if (!localStorage.getItem(framework.translationKey)) {
        try {
            if (!framework.backendUrl) {
                await framework.connectToBackend();
            }
            if (await framework.translateAll()) {
                window.location.reload();
            }
        } catch (e) {
            console.debug(e);
        }
    }
});
framework.translateAll = async () =>{
    let allTranslations = {...framework.translations};
    for (const text of newTranslations) {
        allTranslations[text] = "";
    }
    console.log("newTranslations", newTranslations);
    console.log("allTranslations", allTranslations);
    const json_translations = "\n\n```json\n" + JSON.stringify(allTranslations, null, 4) + "\n```";
    const json_language = "`" + navigator.language + "`";
    const prompt = `Translate the following text snippets in a JSON object to ${json_language} (iso code): ${json_translations}`;
    response = await query(prompt, true);
    let translations = await response.json();
    if (translations[navigator.language]) {
        translations = translations[navigator.language];
    }
    localStorage.setItem(framework.translationKey, JSON.stringify(translations || allTranslations));
    return allTranslations;
}
framework.delete = async (bucket_id) => {
    const delete_url = `${framework.backendUrl}/backend-api/v2/files/${encodeURIComponent(bucket_id)}`;
    await fetch(delete_url, {
        method: 'DELETE'
    });
}
async function query(prompt, options={ json: false, cache: true }) {
    if (options === true || options === false) {
        options = { json: options, cache: true };
    }
    const params = {};
    if (options.json) {
        params.json = true;
    }
    if (options.model) {
        params.model = options.model;
    }
    const encodedParams = (new URLSearchParams(params)).toString();
    let liveUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}`;
    if (encodedParams) {
        liveUrl += "?" + encodedParams
    }
    const response = await fetch(liveUrl);
    if (response.status !== 200) {
        const fallbackParams = { prompt: prompt };
        if (options.model) {
            fallbackParams.model = options.model;
        }
        if (options.json) {
            fallbackParams.filter_markdown = true;
        }
        if (options.cache) {
            fallbackParams.cache = true;
        }
        const fallbackEncodedParams = (new URLSearchParams(fallbackParams)).toString();
        const fallbackUrl = `${framework.backendUrl}/backend-api/v2/create?${fallbackEncodedParams}`;
        const response = await fetch(fallbackUrl);
        if (response.status !== 200) {
            console.error("Error on query: ", response.statusText);
            return;
        }
    }
    return response;
}
const renderMarkdown = (content) => {
    if (!content) {
        return "";
    }
    if (!window.markdownit) {
        return escapeHtml(content);
    }
    if (Array.isArray(content)) {
        content = content.map((item) => {
            if (!item.name) {
                if (item.text) {
                    return item.text;
                }
                size = parseInt(appStorage.getItem(`bucket:${item.bucket_id}`), 10);
                return `**Bucket:** [[${item.bucket_id}]](${item.url})${size ? ` (${formatFileSize(size)})` : ""}`
            }
            if (item.name.endsWith(".wav") || item.name.endsWith(".mp3")) {
                return `<audio controls src="${item.url}"></audio>` + (item.text ? `\n${item.text}` : "");
            }
            if (item.name.endsWith(".mp4") || item.name.endsWith(".webm")) {
                return `<video controls src="${item.url}"></video>` + (item.text ? `\n${item.text}` : "");
            }
            if (item.width && item.height) {
                return `<a href="${item.url}" data-width="${item.width}" data-height="${item.height}"><img src="${item.url.replaceAll("/media/", "/thumbnail/") || item.image_url?.url}" alt="${framework.escape(item.name)}"></a>`;
            }
            return `[![${item.name}](${item.url.replaceAll("/media/", "/thumbnail/") || item.image_url?.url})](${item.url || item.image_url?.url})`;
        }).join("\n");
    }
    const markdown = window.markdownit({
        html: window.sanitizeHtml ? true : false,
        breaks: true
    });
    content = markdown.render(content)
        .replaceAll("<a href=", '<a target="_blank" href=')
        .replaceAll('<code>', '<code class="language-plaintext">')
        .replaceAll('<iframe src="', '<iframe frameborder="0" height="400" width="400" src="')
        .replaceAll('<iframe type="text/html" src="', '<iframe type="text/html" frameborder="0" allow="fullscreen" height="224" width="400" src="')
        .replaceAll('"></iframe>', `?enablejsapi=1"></iframe>`)
        .replaceAll('src="/media/', `src="${framework.backendUrl}/media/`)
        .replaceAll('src="/thumbnail/', `src="${framework.backendUrl}/thumbnail/`)
        .replaceAll('href="/media/', `src="${framework.backendUrl}/media/`)
    if (window.sanitizeHtml) {
        content = window.sanitizeHtml(content, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'iframe', 'audio', 'video']),
            allowedAttributes: {
                a: [ 'href', 'title', 'target', 'data-width', 'data-height' ],
                i: [ 'class' ],
                code: [ 'class' ],
                img: [ 'src', 'alt', 'width', 'height' ],
                iframe: [ 'src', 'type', 'frameborder', 'allow', 'height', 'width' ],
                audio: [ 'src', 'controls' ],
                video: [ 'src', 'controls', 'loop', 'autoplay', 'muted' ],
            },
            allowedIframeHostnames: ['www.youtube.com']
        });
    }
    return content;
};
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
function filterMarkdown(text, allowedTypes = null, defaultValue = null) {
    const match = text.match(/```(.+)\n(?<code>[\s\S]+?)(\n```|$)/);
    if (match) {
        const [, type, code] = match;
        if (!allowedTypes || allowedTypes.includes(type)) {
            return code;
        }
    }
    return defaultValue;
}
async function getPublicKey(backendUrl) {
    const response = await fetch(`${backendUrl || framework.backendUrl}/backend-api/v2/public-key`);
    if (response.ok) {
        return await response.json();
    }
    throw new Error("Failed to load public key");
}
async function genAK(_0x3d01f3){
    const _0x37f8=['getPublicKey','public_key','data','user_agent','navigator','userAgent','stringify','encrypt','localStorage','setItem','Azure-api'+'_key','Encryption failed. Please try again.','Error'];
    const _0x2cd1=function(_0x17e79b,_0x297747){_0x17e79b=_0x17e79b-0x0;return _0x37f8[_0x17e79b];}
    const _0x2a5a9d=await getPublicKey(g4f_host);
    const _0x4d5bf2=new JSEncrypt();
    _0x4d5bf2['setPublicKey'](_0x2a5a9d[_0x2cd1('0x1')]);
    const _0x348d07={
        [_0x2cd1('0x2')]:_0x2a5a9d[_0x2cd1('0x2')],
        user:_0x3d01f3,
        timestamp:Date.now(),
        [_0x2cd1('0x3')]:navigator[_0x2cd1('0x5')]
    };
    const _0x2ea270=JSON[_0x2cd1('0x6')](_0x348d07);
    const _0x36d9be=_0x4d5bf2[_0x2cd1('0x7')](_0x2ea270);
    if(!_0x36d9be){
        throw new (window[_0x2cd1('0xc')]||Error)(_0x2cd1('0xb'));
    }
    window[_0x2cd1('0x8')][_0x2cd1('0x9')](_0x2cd1('0xa'),_0x36d9be);
    return _0x36d9be;
}
(async ()=>{
    const _0x5f1a=['localStorage','getItem','Azure-api'+'_key','setItem','user'];
    const _0x2c57=function(_0x49560b,_0x9768f2){_0x49560b=_0x49560b-0x0;return _0x5f1a[_0x49560b];}
    if (window.location.pathname.startsWith("/chat/")) {
        await genAK(window[_0x2c57('0x0')][_0x2c57('0x1')](_0x2c57('0x4'))||'')
    }
})();
async function gen() {
    const user = userInput.value.trim();
    if (!user) {
    showMessage('Please enter a valid user ID.');
    return;
    }
    document.getElementById('apiBaseUrl').value = framework.backendUrl + "/api/Azure"
    showMessage('Loading...');
    if (!localStorage.getItem('user')) localStorage.setItem('user', user);

    try {
        message = await genAK(user);
        showMessage(message);
    } catch (error) {
        showMessage('Error generating API key: ' + error.message);
    }
}
async function getHeaders(){const _0x2658={};const _0x3f7c=localStorage.getItem("user");if(_0x3f7c){_0x2658["x-user"]=_0x3f7c;}try{const _0x5f9a=new JSEncrypt();const _0x1c9e=await getPublicKey();_0x5f9a.setPublicKey(_0x1c9e['public_key']);const _0x36a5=["x_","sec","ret"].join("");_0x2658[_0x36a5]=_0x5f9a.encrypt(_0x1c9e['data']);return _0x2658;}catch(_0x4b7f){console.error("Encryption failed:",_0x4b7f);}return _0x2658;}
async function includeAdsense() {
    if (window.location.pathname.startsWith("/chat/")) {
        return;
    }
    const script = document.createElement("script");
    script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5896143631849307";
    script.async = true;
    script.crossOrigin = "anonymous";
    document.head.appendChild(script);
}
if (window.location.origin.endsWith(".g4f.dev") || window.location.origin === "https://g4f.dev") {
    includeAdsense().catch(console.error);
}
framework.query = query;
framework.markdown = renderMarkdown;
framework.filterMarkdown = filterMarkdown;
framework.escape = escapeHtml;
framework.getHeaders = getHeaders;
framework.getPublicKey = getPublicKey;

let privateConversation = null;
const DB_NAME = 'chat-db';
const STORE_NAME = 'conversations';
const VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function withStore(mode) {
  return openDB().then(db => {
    const tx = db.transaction(STORE_NAME, mode);
    return {
      store: tx.objectStore(STORE_NAME),
      done: new Promise((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      }),
    };
  });
}

// Get one conversation by id
async function get_conversation(id) {
    if (!id) {
        return privateConversation;
    }
    const { store } = await withStore('readonly');
    return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Save conversation (insert or update)
async function save_conversation(conv) {
    if (!conv.id) {
        privateConversation = conv;
        return true;
    }
    const { store, done } = await withStore('readwrite');
    store.put(conv);
    return done;
}

// List all conversations
async function list_conversations() {
  const { store } = await withStore('readonly');
  return new Promise((resolve, reject) => {
    const conversations = [];
    const request = store.openCursor();

    request.onsuccess = event => {
      const cursor = event.target.result;
      if (cursor) {
        conversations.push(cursor.value);
        cursor.continue();
      } else {
        resolve(conversations);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

const delete_conversation = async (id) => {
    const { store, done } = await withStore('readwrite');
    store.delete(id);
    return done;
};