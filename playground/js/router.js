const Router = (() => {
  const routes = {
    '/': renderHome,
    '/chat': () => renderPage('chat', ChatPage),
    '/roleplay': () => renderPage('roleplay', RoleplayPage),
    '/coding': () => renderPage('coding', CodingPage),
    '/personas': renderPersonas,
    '/providers': () => renderPage('providers', ProvidersPage),
  };

  function getHash() {
    return location.hash.slice(1) || '/';
  }

  function closeNav() {
    const btn = document.getElementById('hamburger-btn');
    const links = document.getElementById('nav-links');
    if (btn) btn.classList.remove('open');
    if (links) links.classList.remove('open');
  }

  function initHamburger() {
    const btn = document.getElementById('hamburger-btn');
    const links = document.getElementById('nav-links');
    if (!btn || !links) return;

    btn.addEventListener('click', () => {
      btn.classList.toggle('open');
      links.classList.toggle('open');
    });

    links.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', closeNav);
    });
  }

  function navigate() {
    closeNav();
    const hash = getHash();
    const segments = hash.split('/').filter(Boolean);
    const base = '/' + (segments[0] || '');

    document.querySelectorAll('.nav-links a[data-route]').forEach(a => {
      a.classList.toggle('active', a.dataset.route === base);
    });

    if (base === '/personas') {
      renderPersonas();
      return;
    }

    const handler = routes[base] || renderHome;
    handler();
  }

  function renderPage(name, Page) {
    hideAll();
    const container = document.getElementById(`page-${name}`);
    if (!container) return;
    container.classList.add('active');
    Page.render(container);
    ProvidersPage.updateBadge();
    framework.translateElements(container.querySelectorAll('*'));
  }

  function renderHome() {
    hideAll();
    const container = document.getElementById('page-home');
    if (!container) return;
    container.classList.add('active');
    container.style.cssText = 'overflow-y:auto;-webkit-overflow-scrolling:touch;';
    container.innerHTML = `
      <div style="max-width:700px;margin:0 auto;padding:32px 16px;text-align:center;">
        <h1 class="notranslate" style="font-size:28px;font-weight:800;color:var(--accent);margin-bottom:8px">LLMPlayground</h1>
        <p style="color:var(--text2);font-size:15px;margin-bottom:32px">Your open-source AI playground — chat, roleplay, and code</p>
        <div style="display:grid;grid-template-columns:1fr;gap:12px;text-align:left;">
          ${[
            { icon: '💬', title: 'Chat', desc: 'Multi-turn conversations with any AI model', route: '/chat' },
            { icon: '🎭', title: 'Roleplay', desc: 'Character-based chats with custom personas', route: '/roleplay' },
            { icon: '💻', title: 'Coding', desc: 'Copilot-style coding assistant with code blocks', route: '/coding' },
            { icon: '🧑‍🎨', title: 'Personas', desc: 'Create and manage AI characters', route: '/personas' },
            { icon: '⚙️', title: 'Providers', desc: 'Configure API providers and models', route: '/providers' },
          ].map(item => `
            <a href="#${item.route}" style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px;text-decoration:none;display:flex;align-items:center;gap:14px;transition:border-color 0.15s;" ontouchstart="this.style.borderColor='var(--accent)'" ontouchend="this.style.borderColor='var(--border)'" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
              <div style="font-size:28px;flex-shrink:0">${item.icon}</div>
              <div>
                <div style="font-weight:600;font-size:15px;color:var(--text);margin-bottom:2px">${item.title}</div>
                <div style="font-size:13px;color:var(--text2)">${item.desc}</div>
              </div>
            </a>`).join('')}
        </div>
        <div style="margin-top:32px;padding:16px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;text-align:left;">
          <h2 style="font-size:13px;margin-bottom:8px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px">Default Provider</h2>
          <p style="font-size:13px;color:var(--text2);line-height:1.5">
            ${Store.getActiveProviderId() === 'api.airforce' ? 'Uses <strong style="color:var(--text)">Airforce API</strong> (api.airforce) by default — no API key required for free models.' : ``}
            Add your own providers in <a href="#/providers" style="color:var(--accent)">Providers</a>.
          </p>
        </div>
        <div style="margin-top:16px;font-size:12px;color:var(--text2)">
          Open source · <a href="https://github.com/meow18838/LLMPlayground" style="color:var(--accent)">GitHub</a>
        </div>
      </div>`;
    ProvidersPage.updateBadge();
    framework.translateElements(container.querySelectorAll('*'));
  }

  function renderPersonas() {
    hideAll();
    const container = document.getElementById('page-personas');
    if (!container) return;
    container.classList.add('active');
    PersonasPage.render(container);
    ProvidersPage.updateBadge();
    framework.translateElements(container.querySelectorAll('*'));
  }

  function hideAll() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  }

  function init() {
    initHamburger();
    window.addEventListener('hashchange', navigate);
    navigate();
  }

  return { init, navigate };
})();

Router.init();
