const Store = (() => {
  const KEYS = {
    providers: 'llmp_providers',
    activeProvider: 'llmp_active_provider',
    personas: 'llmp_personas',
    chats: 'llmp_chats',
    settings: 'llmp_settings',
  };
  const DB_NAME = 'chat-db';
  const STORE_NAME = 'conversations';
  const VERSION = 1;

  function loadProviders() {
    const url = 'https://g4f.dev/dist/js/providers.json';
    fetch(url).then(res => res.json()).then(data => {
      for ([key, provider] of Object.entries(data.providers)) {
        provider.id = key;
        provider.name = (provider.label || key) + (provider.tags ? ` ${provider.tags}` : '');
        provider.baseUrl = provider.baseUrl || `https://g4f.space/api/${key}`;
        provider.defaultModel = data.defaultModels[key] || provider.defaultModel;
        provider.baseUrl = provider.baseUrl.replace('{model}', provider.defaultModel)
        provider.type = provider.type || 'openai';
        provider.models = provider.models || [];
        provider.fetchedModels = [];
        provider.defaultModel = data.defaultModels[key] || provider.defaultModel;
        provider.localStorageKey = data.providerLocalStorage[key] || null;
      }
      delete data.providers.custom;
      Store.setProviders(Object.values(data.providers));
      Store.setActiveProviderId(document.location.hostname === 'llmplayground.net' ? 'api.airforce' : Object.keys(data.providers)[0]);
      ProvidersPage.renderList();
    });
  }

  if (!localStorage.getItem(KEYS['providers'])) {
    loadProviders();
  }

  const defaults = {
    providers: [
      {
        id: 'api.airforce',
        name: 'Airforce API',
        baseUrl: 'https://api.airforce/v1',
        apiKey: '',
        type: 'openai',
        models: [],
        fetchedModels: [],
        defaultModel: 'llama-4-scout',
      },
    ],
    activeProvider: 'api.airforce',
    personas: [],
    chats: [],
    settings: {
      streamingEnabled: true,
      codingTemperature: 0,
      maxRetries: 2,
      theme: 'dark',
    },
  };

  let privateConversation;

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

  function get(key) {
    try {
      const raw = localStorage.getItem(KEYS[key]);
      return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(defaults[key]));
    } catch {
      return JSON.parse(JSON.stringify(defaults[key]));
    }
  }

  function set(key, value) {
    localStorage.setItem(KEYS[key], JSON.stringify(value));
  }

  function deleteSettings() {
    localStorage.removeItem(KEYS['settings']);
  }

  function getProviders() { return get('providers'); }
  function setProviders(v) { set('providers', v); }

  function getActiveProviderId() { return get('activeProvider'); }
  function setActiveProviderId(id) { set('activeProvider', id); }

  function getActiveProvider() {
    const providers = getProviders();
    const id = getActiveProviderId();
    const provider = providers.find(p => p.id === id) || providers[0];
    if (provider.localStorageKey && localStorage.getItem(provider.localStorageKey)) {
      provider.apiKey = localStorage.getItem(provider.localStorageKey);
    } else if (!provider.apiKey && provider.backupUrl) {
      provider.apiKey = localStorage.getItem("session_token");
    }
    if (provider.apiKey && (provider.apiKey.startsWith("g4f_") || provider.apiKey.startsWith("gfs_"))) {
      provider.baseUrl = provider.backupUrl || provider.baseUrl;
    }
    return provider;
  }

  function upsertProvider(provider) {
    const providers = getProviders();
    const idx = providers.findIndex(p => p.id === provider.id);
    if (idx >= 0) providers[idx] = provider;
    else providers.push(provider);
    setProviders(providers);
  }

  function deleteProvider(id) {
    const providers = getProviders().filter(p => p.id !== id);
    setProviders(providers);
    if (getActiveProviderId() === id && providers.length > 0) {
      setActiveProviderId(providers[0].id);
    }
  }

  function getPersonas() { return get('personas'); }
  function setPersonas(v) { set('personas', v); }

  function upsertPersona(persona) {
    const personas = getPersonas();
    const idx = personas.findIndex(p => p.id === persona.id);
    if (idx >= 0) personas[idx] = persona;
    else personas.push(persona);
    setPersonas(personas);
  }

  function deletePersona(id) {
    setPersonas(getPersonas().filter(p => p.id !== id));
  }

  async function getChat(id) {
      if (!id) {
          return privateConversation;
      }
      const { store } = await withStore('readonly');
      return new Promise((resolve, reject) => {
          const request = store.get(id);
          request.onsuccess = () => {
            request.result.items = request.result.items || [];
            request.result.type = request.result.type || 'chat';
            request.result.items.forEach((item, index) => {
              item.id = item.id || index;
            });
            resolve(request.result);
          };
          request.onerror = () => reject(request.error);
      });
  }

  async function upsertChat(conv) {
      if (!conv.id) {
          privateConversation = conv;
          return true;
      }
      conv.added = conv.added || Date.now();
      conv.updated = Date.now();
      conv.type = conv.type || 'chat';
      const { store, done } = await withStore('readwrite');
      store.put(conv);
      return done;
  }

  async function getChats() {
    try {
      const { store } = await withStore('readonly');
      return new Promise((resolve, reject) => {
          const conversations = [];
          const request = store.openCursor();

          request.onsuccess = event => {
              const cursor = event.target.result;
              if (cursor) {
                  cursor.value.count = cursor.value.items?.filter(m => m.role !== 'system').length || 0;
                  delete cursor.value.items;
                  conversations.push(cursor.value);
                  cursor.continue();
              } else {
                  if (conversations.length === 0) {
                    conversations = get('chats');
                    conversations.forEach((c, i)=>{
                      c.added = c.added || Date.now();
                      c.updated = c.updated || c.added || Date.now() + i;
                      c.items = c.messages || c.items || [];
                      delete c.messages;
                    })
                  } else {
                    conversations.forEach(c => {
                      c.type = c.type || 'chat';
                    });
                    conversations.sort((a, b) => (b.updated || b.added) - (a.updated || a.added));
                  }
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

  async function getLastChat() {
    const chats = await getChats();
    for (const chat of chats) {
      if (chat.type === 'chat') {
        return chat;
      }
    }
    return null;
  }

  const deleteChat = async (id) => {
      const { store, done } = await withStore('readwrite');
      store.delete(id);
      return done;
  };

  function getSettings() { return get('settings'); }
  function setSettings(v) { set('settings', v); }

  function updateSettings(patch) {
    setSettings({ ...getSettings(), ...patch });
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  return {
    getProviders, setProviders, getActiveProviderId, setActiveProviderId,
    getActiveProvider, upsertProvider, deleteProvider,
    getPersonas, setPersonas, upsertPersona, deletePersona,
    getChats, getChat, upsertChat, deleteChat, getLastChat,
    getSettings, setSettings, updateSettings, deleteSettings,
    newId, loadProviders,
  };
})();
