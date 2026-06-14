const MembersAuth = (() => {
  const AUTH_BASE = 'https://auth.g4f.space';
  const USER_KEY = 'g4f_user';
  const SESSION_KEY = 'g4f_session';
  const EXPIRES_KEY = 'g4f_expires';
  const API_KEY_PREFIX = 'g4f_';
  const DEFAULT_ACCOUNT_NAME = 'User';
  const KNOWN_ORIGINS = ["https://g4f.dev", "http://localhost:8080", "http://localhost:1337", "https://gpt4free.github.io"]; 

  function getHash() {
    return location.hash.slice(1) || '/';
  }

  function isKnownOrigin() {
    return KNOWN_ORIGINS.includes(location.origin);
  }

  function getUser() {
    const expires = localStorage.getItem(EXPIRES_KEY);
    if (isTokenExpired(expires)) {
      clearSession();
      return null;
    }
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function setUser(user, expires) {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      if (expires) {
        localStorage.setItem(EXPIRES_KEY, expires);
      }
    } else {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(EXPIRES_KEY);
    }
    window.dispatchEvent(new CustomEvent('g4f-auth-updated', { detail: { user } }));
  }

  function getCurrentUrl() {
    if (window.parent) {
      const parentUrl = window.parent.location.href.split('#')[0];
      let parentHash = window.parent.location.hash || '';
      if (parentHash.startsWith('#/')) {
        return parentUrl + parentHash;
      }
      return parentUrl;
    }
    return window.location.href.split('#')[0];
  }

  function isTokenExpired(expires) {
    if (!expires) return false;
    const expiresMs = expires > 1e12 ? expires : expires * 1000;
    return Date.now() > expiresMs;
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(EXPIRES_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function handleRedirectCallback() {
    const hash = window.location.hash || '';
    const decodedHash = hash ? decodeURIComponent(hash.substring(1)) : '';
    const hashParams = new URLSearchParams(decodedHash);
    let handled = false;

    const sessionToken = hashParams.get('session');
    const userParam = hashParams.get('user');
    const expiresParam = hashParams.get('expires');
    if (sessionToken) {
      let user = getUser();
      if (userParam) {
        try {
          user = JSON.parse(decodeURIComponent(userParam));
        } catch {
          user = getUser();
        }
      }
      applyAuthResult(sessionToken, user, expiresParam);
      handled = true;
    }

    if (handled) {
      window.history.replaceState({}, document.title, `${window.location.pathname}#/providers`);
    }
    return handled;
  }

  
  function applyAuthResult(sessionToken, user, expires) {
    console.log('Applying auth result:', { sessionToken, user, expires });
    if (sessionToken) {
      localStorage.setItem(SESSION_KEY, sessionToken);
    }
    setUser(user || getUser(), expires);
  }

  async function refreshSession() {
    const token = localStorage.getItem(SESSION_KEY);
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const endpoint = isApiKeyToken(token) ? 'keys/validate' : 'session';
      const response = await fetch(`${AUTH_BASE}/members/api/${endpoint}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        localStorage.removeItem(SESSION_KEY);
        setUser(null);
        return;
      }
      const data = await response.json();
      if (endpoint === 'keys/validate') {
        setUser({
          name: data.username || DEFAULT_ACCOUNT_NAME,
          username: data.username || DEFAULT_ACCOUNT_NAME,
          tier: data.tier || 'free'
        }, data.expires);
      } else {
        applyAuthResult(null, data.user || getUser(), data.expires);
      }
    } catch (e) {
      console.error('Error refreshing session:', e);
      updateAuthButton(getUser());
    }
  }

  async function login(provider) {
    if (provider === 'pollinations') {
      const params = new URLSearchParams({
        redirect: getCurrentUrl(),
        provider: 'pollinations'
      });
      window.location.href = `https://g4f.dev/members?${params.toString()}`;
      return;
    }
    window.location.href = `${AUTH_BASE}/members/auth/${provider}?redirect=${encodeURIComponent(getCurrentUrl())}`;
  }

  async function logout() {
    clearSession();
    const token = localStorage.getItem(SESSION_KEY);
    if (token) {
      try {
        await fetch(`${AUTH_BASE}/members/api/logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (e) {
        console.warn('Logout request failed:', e);
      }
    }
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
  }

  function isApiKeyToken(token) {
    return token.startsWith(API_KEY_PREFIX);
  }

  return { getUser, login, logout, refreshSession, clearSession, isKnownOrigin, handleRedirectCallback, getCurrentUrl };
})();

window.MembersAuth = MembersAuth;
