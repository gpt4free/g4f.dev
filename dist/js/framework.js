const G4F_HOST = "https://g4f.dev";
const G4F_WILDCARD = ".g4f.dev";
const DB_NAME = 'chat-db';
const STORE_NAME = 'conversations';
const VERSION = 1;
const logStorage = document.querySelector(".log");
const logContent = document.querySelector(".log-content") || logStorage;

let privateConversation = null;

function add_error(event, log=false) {
    if (log instanceof Error) {
        log.message = event + " " + (log.message || "") ;
        event = log;
        log = true;
    }
    if (log) {
        console.error(event);
    }
    if (!logContent) {
        return;
    }
    let p = document.createElement("p");
    if (event.target && (event.target.src || event.target.href)) {
        p.innerText = `Resource failed to load: ${event.target.src || event.target.href}`;
    } else if (event.message) {
        p.innerText = event.type ? `${event.type}: ${event.message}` + (event.filename ? `\n${event.filename}:${event.lineno}:${event.colno}` : "") : event.message;
    } else {
        p.innerText = typeof event === 'string' ? event : JSON.stringify(event);
    }
    p.innerHTML = p.innerHTML.replaceAll("\n", "<br>");
    logContent.appendChild(p);
}

window.addEventListener('error', add_error, true);

if (window.location.origin === G4F_HOST || window.location.origin.endsWith(G4F_WILDCARD)) {
    window.oauthConfig = {
        clientId: '762e4f6f-2af6-437c-ad93-944cc17f9d23',
        scopes: ['inference-api']
    }
}
window.framework = {}
const checkUrls = [];
if (window.location.protocol === "file:") {
    checkUrls.push("http://localhost:1337");
    checkUrls.push("http://localhost:8080");
}
if (["https:", "http:"].includes(window.location.protocol)) {
    checkUrls.push(window.location.origin);
}
checkUrls.push(G4F_HOST);
async function checkUrl(url, connectStatus) {
    let response;
    try {
        response = await fetch(`${url}/backend-api/v2/version?cache=true`, {signal: AbortSignal.timeout(10000)});
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
framework.backendUrl = localStorage.getItem('backendUrl') || "";
framework.connectToBackend = async (connectStatus) => {
    for (const url of checkUrls) {
        if(await checkUrl(url, connectStatus)) {
            return;
        }
    }
    if (framework.backendUrl) {
        if(await checkUrl(framework.backendUrl, connectStatus)) {
            return;
        }
        localStorage.removeItem("backendUrl");
        framework.backendUrl = "";
    }
};
let newTranslations = [];
framework.translate = (text) => {
    const stripText = text.trim();
    if (stripText) {
        const endWithSpace = text.endsWith(" ");
        if (stripText in framework.translations && framework.translations[stripText]) {
            return framework.translations[stripText] + (endWithSpace ? " " : "");
        }
        stripText && !newTranslations.includes(stripText) ? newTranslations.push(stripText) : null;
    }
    return text;
};
framework.translationKey = "translations" + document.location.pathname;
framework.translations = JSON.parse(localStorage.getItem(framework.translationKey) || "{}");
framework.translateElements = function (elements = null) {
    if (!framework.translations) {
        return;
    }
    elements = elements || document.querySelectorAll("*");
    elements.forEach(function (element) {
        let parent = element.parentElement;
        if (element.classList.contains("notranslate") || parent && parent.classList.contains("notranslate")) {
            return;
        }
        if (["SCRIPT", "STYLE"].includes(element.tagName)) {
            return;
        } 
        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                child.textContent = framework.translate(child.textContent);
            }
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
window.addEventListener('load', async () => {
    if (!document.body.classList.contains("translate")) {
        return;
    }
    if (!localStorage.getItem(framework.translationKey)) {
        try {
            if (!framework.backendUrl) {
                await framework.connectToBackend();
            }
            if (await framework.translateAll()) {
                window.location.reload();
            }
        } catch (e) {
            add_error(e, true);
        }
    }
});
framework.translateAll = async () =>{
    let allTranslations = {...framework.translations};
    for (const text of newTranslations) {
        allTranslations[text] = "";
    }
    for (const key in allTranslations) {
        allTranslations[key] = "";
    }
    const jsonTranslations = "\n\n```json\n" + JSON.stringify(allTranslations, null, 4) + "\n```";
    const jsonLanguage = "`" + navigator.language + "`";
    const prompt = `Translate the following text snippets in a JSON object to ${jsonLanguage} (iso code): ${jsonTranslations}`;
    response = await query(prompt, true);
    let translations = await response.json();
    if (translations[navigator.language] && typeof translations[navigator.language] === 'object' && Object.keys(translations[navigator.language]).length > 0) {
        translations = translations[navigator.language];
    }
    localStorage.setItem(framework.translationKey, JSON.stringify(translations));
    return allTranslations;
}
function delete_translations() {
    for (let i = 0; i < appStorage.length; i++) {
        let key = appStorage.key(i);
        if (key.startsWith("translations")) {
            appStorage.removeItem(key);
        }
    }
}
framework.delete = async (bucketId) => {
    const deleteUrl = `${framework.backendUrl}/backend-api/v2/files/${encodeURIComponent(bucketId)}`;
    return await fetch(deleteUrl, {
        method: 'DELETE'
    });
}
async function query(prompt, options={ json: false, cache: true }) {
    if (options === true || options === false) {
        options = { json: options, cache: true };
    }
    let encodedParams = (new URLSearchParams(options)).toString();
    let secondPartyUrl = `https://g4f.dev/ai/${encodeURIComponent(prompt)}${encodedParams ? "?" + encodedParams : ""}`;
    let response = await fetch(secondPartyUrl);
    if (!response.ok) {
        const delay = parseInt(response.headers.get('Retry-After'), 10);
        if (delay > 0) {
            console.log(`Retrying after ${delay} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
            response = await fetch(secondPartyUrl);
        }
    }
    if (!response.ok) {
        add_error(`Error ${response.status} with URL: \`${secondPartyUrl}\`\n ${await response.text()}`, true);
        let firstPartyUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}${encodedParams ? "?" + encodedParams : ""}`;
        response = await fetch(firstPartyUrl);
        if (!response.ok) {
            add_error(`Error ${response.status} with URL: \`${firstPartyUrl}\`\n ${await response.text()}`, true);
            return;
        }
    }
    return response;
}
const renderMarkdown = (content) => {
    if (!content) {
        return "";
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
    if (!window.markdownit) {
        return escapeHtml(content);
    }
    const markdown = window.markdownit({
        html: window.sanitizeHtml ? true : false,
        breaks: true
    });
    content = markdown.render(content)
        .replaceAll("<a href=", '<a target="_blank" href=')
        .replaceAll('<code>', '<code class="language-plaintext">')
        .replaceAll('<iframe src="', '<iframe frameborder="0" height="224" width="400" src="')
        .replaceAll('<iframe type="text/html" src="', '<iframe type="text/html" frameborder="0" allow="fullscreen" height="224" width="400" src="')
        .replaceAll('"></iframe>', `?enablejsapi=1"></iframe>`)
        .replaceAll('src="/media/', `src="${framework.backendUrl}/media/`)
        .replaceAll('src="/thumbnail/', `src="${framework.backendUrl}/thumbnail/`)
        .replaceAll('href="/media/', `src="${framework.backendUrl}/media/`)
    if (window.sanitizeHtml) {
        content = window.sanitizeHtml(content, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'iframe', 'audio', 'video', 'details', 'summary']),
            allowedAttributes: {
                a: [ 'href', 'title', 'target', 'data-width', 'data-height', 'data-src' ],
                i: [ 'class' ],
                span: [ 'class' ],
                code: [ 'class' ],
                img: [ 'src', 'alt', 'width', 'height' ],
                iframe: [ 'src', 'type', 'frameborder', 'allow', 'height', 'width' ],
                audio: [ 'src', 'controls' ],
                video: [ 'src', 'controls', 'loop', 'autoplay', 'muted' ],
            },
            allowedIframeHostnames: ['www.youtube.com'],
            allowedSchemes: [ 'http', 'https', 'data' ]
        });
    }
    return content;
};
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
function nl2br(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML.replace(/\n/g, "<br>");
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
    let response = await fetch(`${backendUrl || framework.backendUrl}/backend-api/v2/public-key`, {method: 'POST'});
    if (!response.ok) {
        response = await fetch(`${backendUrl || framework.backendUrl}/backend-api/v2/public-key`);
    }
    if (response.ok) {
        return await response.json();
    }
    throw new Error("Failed to load public key");
}
async function genAK(_0x3d01f3){
    if (!window.JSEncrypt) return;
    const _0x1a = ['provider','model'];
    const _0x37f8=['getPublicKey','public_key','data','user_agent','navigator','userAgent','stringify','encrypt','localStorage','setItem','Azure-api'+'_key','Encryption failed. Please try again.','Error'];
    const _0x2cd1=function(_0x17e79b,_0x297747){_0x17e79b=_0x17e79b-0x0;return _0x37f8[_0x17e79b];}
    const _0x2a5a9d=await getPublicKey(G4F_HOST);
    const _0x4d5bf2=new JSEncrypt();
    _0x4d5bf2['setPublicKey'](_0x2a5a9d[_0x2cd1('0x1')]);
    const _0x348d07={
        [_0x2cd1('0x2')]:_0x2a5a9d[_0x2cd1('0x2')],
        user:_0x3d01f3||_0x2a5a9d.user||"error",
        [_0x2cd1('0x3')]:navigator[_0x2cd1('0x5')],
    };
    _0x348d07['\x74\x69\x6d\x65\x73\x74\x61\x6d\x70']=Date['\x6e\x6f\x77']();
    _0x348d07['\x72\x65\x66\x65\x72\x72\x65\x72']=document['\x72\x65\x66\x65\x72\x72\x65\x72'];
    _0x348d07[_0x1a[0]] = localStorage['getItem'](_0x1a[0]);
    _0x348d07[_0x1a[1]] = localStorage['getItem'](_0x1a[1]);
    const _0x2ea270=JSON[_0x2cd1('0x6')](_0x348d07);
    const _0x36d9be=_0x4d5bf2[_0x2cd1('0x7')](_0x2ea270);
    if(!_0x36d9be){
        throw new (window[_0x2cd1('0xc')]||Error)(_0x2cd1('0xb'));
    }
    window[_0x2cd1('0x8')][_0x2cd1('0x9')](_0x2cd1('0xa'),_0x36d9be);
    return _0x36d9be;
}
async function gen() {
    const user = userInput.value.trim();
    if (!user) {
    showMessage('Please enter a valid user ID.');
    return;
    }
    document.getElementById('apiBaseUrl').value = framework.backendUrl + "/v1"
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
function isValidModel(model) {
    return !model.type || ["chat", "image", "text", "image-edit", "video"].includes(model.type);
}

framework.query = query;
framework.markdown = renderMarkdown;
framework.filterMarkdown = filterMarkdown;
framework.escape = escapeHtml;
framework.getHeaders = getHeaders;
framework.getPublicKey = getPublicKey;
framework.nl2br = nl2br;

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
  try {
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
  } catch (e) {
      console.error("IndexedDB not available:", e);
      return [];
  }
}

const delete_conversation = async (id) => {
    const { store, done } = await withStore('readwrite');
    store.delete(id);
    return done;
};

function chunkArray(array, chunkSize) {
  return Array.from(
    { length: Math.ceil(array.length / chunkSize) },
    (_, index) => array.slice(index * chunkSize, index * chunkSize + chunkSize)
  );
}

try {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", async () => {
            framework.translateElements();
        });
    } else {
        framework.translateElements();
    }
} catch(e) {
    add_error(e, true);
}

window.addEventListener("load", async (event) => {
    try {
        const _0x5f1a=['localStorage','getItem','Azure-api'+'_key','setItem','user'];
        const _0x2c57=function(_0x49560b,_0x9768f2){_0x49560b=_0x49560b-0x0;return _0x5f1a[_0x49560b];}
        if (window.location.pathname.startsWith("/chat/")) {
            await genAK(window[_0x2c57('0x0')][_0x2c57('0x1')](_0x2c57('0x4'))||'')
        }
    } catch(e) {
        add_error(e, true);
    }
});

if (window.location.origin === G4F_HOST || window.location.origin.endsWith(G4F_WILDCARD)) {
    includeAdsense().catch(add_error);
}