/*
 * g4f browsing layer for the public chat page.
 *
 * Adds live RSS/Atom conversations, prompt-created triggers and browser
 * notifications to /chat without touching the core chat bundle. It reuses the
 * page's own conversation storage (get_conversation/save_conversation) so feeds
 * appear in the normal conversation list and open in the normal chat view.
 */
(function () {
  "use strict";

  const NOTIFY_KEY = "g4f_browsing_notifications";
  const FEED_PREFIX = "feed-";
  const TRIGGER_CONV_ID = "g4f-trigger-notifications";
  const POLL_MS = 5 * 60 * 1000;
  const notified = new Set();
  let unread = 0;
  let lastRunning = false;
  let timer = null;

  function apiBase() {
    const explicit = localStorage.getItem("g4f_browsing_base");
    if (explicit) return explicit.replace(/\/+$/, "");
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".g4f.local")) {
      return location.origin;
    }
    return "https://g4f.space";
  }

  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const token = localStorage.getItem("g4f_session");
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${apiBase()}${path}`, { ...options, headers });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.error?.message || body?.detail || JSON.stringify(body);
      } catch {
        detail = await response.text().catch(() => "");
      }
      throw new Error(`Browsing API ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return response.json();
  }

  function notificationsEnabled() {
    return localStorage.getItem(NOTIFY_KEY) === "on";
  }

  function setNotificationsEnabled(enabled) {
    localStorage.setItem(NOTIFY_KEY, enabled ? "on" : "off");
    paintBell();
  }

  async function toggleNotifications() {
    if (!("Notification" in window)) {
      toast("Notifications are not supported in this browser");
      return;
    }
    if (notificationsEnabled()) {
      setNotificationsEnabled(false);
      toast("Notifications disabled");
      return;
    }
    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    setNotificationsEnabled(permission === "granted");
    toast(permission === "granted" ? "Notifications enabled" : "Notification permission denied");
  }

  function baseTitle() {
    return document.title.replace(/^\(\d+\)\s*/, "");
  }

  function setUnread(count) {
    unread = Math.max(0, count || 0);
    document.title = unread > 0 ? `(${unread}) ${baseTitle()}` : baseTitle();
  }

  function notify(title, body, options = {}) {
    if (document.hidden) {
      setUnread(unread + 1);
      if (notificationsEnabled() && "Notification" in window && Notification.permission === "granted") {
        const notification = new Notification(title || "G4F Chat", {
          body: (body || "").slice(0, 240),
          tag: options.tag || undefined,
          icon: "/dist/img/g4f.svg",
          badge: "/dist/img/g4f.svg",
        });
        notification.onclick = () => {
          try {
            window.focus();
            if (options.url && /^https?:\/\//i.test(options.url)) {
              window.open(options.url, "_blank", "noopener");
            }
          } finally {
            notification.close();
          }
        };
      }
    } else if (options.toast !== false) {
      toast(`${title}${body ? ` — ${String(body).slice(0, 100)}` : ""}`);
    }
  }

  function toast(message) {
    try {
      let box = document.getElementById("g4f-browsing-toasts");
      if (!box) {
        box = document.createElement("div");
        box.id = "g4f-browsing-toasts";
        box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:340px";
        document.body.appendChild(box);
      }
      const item = document.createElement("div");
      item.textContent = message;
      item.style.cssText = "background:var(--background-color,#1d1d1d);color:var(--colour-3,#eee);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:10px 12px;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.35)";
      box.appendChild(item);
      setTimeout(() => item.remove(), 5000);
    } catch (e) { /* ignore */ }
  }

  function paintBell() {
    const bell = document.getElementById("g4f-notify-btn");
    if (!bell) return;
    const on = notificationsEnabled() && "Notification" in window && Notification.permission === "granted";
    bell.innerHTML = `<i class="fa-solid ${on ? "fa-bell" : "fa-bell-slash"}" aria-hidden="true"></i>`;
    bell.title = on ? "Notifications are on" : "Enable notifications for finished messages and feeds";
    bell.setAttribute("aria-label", bell.title);
  }

  function feedId(url) {
    let hash = 5381;
    for (let i = 0; i < url.length; i += 1) hash = ((hash << 5) + hash) ^ url.charCodeAt(i);
    return `${FEED_PREFIX}${(hash >>> 0).toString(36)}`;
  }

  function feedItemToMessage(item, feedUrl) {
    const title = item.title || "Untitled";
    let content = `## ${title}`;
    if (item.summary) content += `\n\n${item.summary}`;
    const footer = [];
    if (item.published) footer.push(`_${item.published}_`);
    if (item.link) footer.push(`[Read more](${item.link})`);
    if (footer.length) content += `\n\n${footer.join(" · ")}`;
    return {
      role: "assistant",
      content,
      provider: { name: "RSS", label: "RSS / Atom", url: feedUrl },
    };
  }

  async function upsertFeedConversation(url) {
    const feed = await api(`/v1/browsing/feeds?url=${encodeURIComponent(url)}&limit=40`);
    const id = feedId(feed.feedUrl || url);
    const existing = await get_conversation(id);
    const seen = new Set(existing?.feedSeen || []);
    const items = existing?.items ? [...existing.items] : [{
      role: "user",
      content: `📡 Live feed: ${feed.title || url}\n${feed.feedUrl || url}`,
    }];
    for (const item of feed.items || []) {
      if (item.id && seen.has(item.id)) continue;
      items.push(feedItemToMessage(item, feed.feedUrl || url));
    }
    const conversation = {
      ...(existing || {}),
      id,
      title: `📡 ${feed.title || url}`,
      added: existing?.added || Date.now(),
      updated: Date.now(),
      items,
      feedUrl: feed.feedUrl || url,
      feedSeen: Array.from(new Set([...(existing?.feedSeen || []), ...(feed.feedSeen || [])])).slice(-500),
      type: "feed",
    };
    await save_conversation(conversation);
    await load_conversations();
    if (typeof set_conversation === "function") {
      await set_conversation(id);
    } else if (typeof safe_load_conversation === "function") {
      window.conversation_id = id;
      await safe_load_conversation(id);
    }
    return conversation;
  }

  async function addFeed() {
    const url = window.prompt("RSS or Atom feed URL (e.g. https://news.ycombinator.com/rss):");
    if (!url) return;
    try {
      toast("Loading feed…");
      const conversation = await upsertFeedConversation(url.trim());
      toast(`Live feed added: ${conversation.title}`);
    } catch (err) {
      toast(`Could not load feed: ${err.message}`);
    }
  }

  async function addTrigger() {
    const prompt = window.prompt(
      'Describe a trigger. Example: Notify me when the "AI" feed mentions OpenAI every 10 minutes'
    );
    if (!prompt) return;
    try {
      const trigger = await api("/v1/browsing/triggers/from-prompt", {
        method: "POST",
        body: JSON.stringify({ prompt, save: true }),
      });
      toast(`Trigger created: ${trigger.name || "Browsing trigger"}`);
    } catch (err) {
      toast(`Could not create trigger: ${err.message}`);
    }
  }

  async function refreshFeeds() {
    let conversations;
    try {
      conversations = (await list_conversations()).filter((conv) => conv.feedUrl);
    } catch {
      return;
    }
    for (const summary of conversations) {
      try {
        const conversation = await get_conversation(summary.id);
        if (!conversation || !conversation.feedUrl) continue;
        const feed = await api(
          `/v1/browsing/feeds?url=${encodeURIComponent(conversation.feedUrl)}&limit=40`
        );
        const seen = new Set(conversation.feedSeen || []);
        const fresh = (feed.items || []).filter((item) => item.id && !seen.has(item.id));
        if (!fresh.length) continue;
        conversation.items = [
          ...(conversation.items || []),
          ...fresh.map((item) => feedItemToMessage(item, conversation.feedUrl)),
        ];
        conversation.feedSeen = Array.from(
          new Set([...(conversation.feedSeen || []), ...fresh.map((item) => item.id)])
        ).slice(-500);
        conversation.updated = Date.now();
        await save_conversation(conversation);
        notify(
          `📡 ${feed.title || conversation.title}`,
          `${fresh.length} new item${fresh.length === 1 ? "" : "s"}: ${fresh[fresh.length - 1].title || ""}`,
          { tag: conversation.id }
        );
        if (window.conversation_id === conversation.id && typeof safe_load_conversation === "function") {
          await safe_load_conversation(conversation.id);
        }
      } catch (err) {
        console.debug("Feed refresh failed:", err);
      }
    }
    await load_conversations();
  }

  async function addTriggerNotificationToConversation(item) {
    try {
      let conversation = await get_conversation(TRIGGER_CONV_ID);
      if (!conversation) {
        conversation = {
          id: TRIGGER_CONV_ID,
          title: "🔔 Trigger notifications",
          added: Date.now(),
          items: [{ role: "user", content: "Notifications from my browsing triggers." }],
        };
      }
      const summary = (item.body || "").slice(0, 600);
      const content = `## ${item.title || "Trigger update"}${summary ? `\n\n${summary}` : ""}${item.url ? `\n\n[Open](${item.url})` : ""}`;
      conversation.items.push({
        role: "assistant",
        content,
        provider: { name: "Trigger", label: "Browsing trigger", url: item.url || "" },
      });
      conversation.updated = Date.now();
      await save_conversation(conversation);
      if (window.conversation_id === TRIGGER_CONV_ID && typeof safe_load_conversation === "function") {
        await safe_load_conversation(TRIGGER_CONV_ID);
      }
      await load_conversations();
    } catch (err) {
      console.debug("Could not store trigger notification:", err);
    }
  }

  async function pollNotifications() {
    try {
      const result = await api("/v1/browsing/notifications?unread_only=true&limit=20");
      const items = result.data || [];
      for (const item of items) {
        if (!item.id || notified.has(item.id) || item.kind === "chat") continue;
        notified.add(item.id);
        if (item.kind === "trigger") addTriggerNotificationToConversation(item);
        notify(item.title, item.body, { tag: `g4f-${item.id}`, url: item.url });
      }
      if (items.length > 0) {
        await api("/v1/browsing/notifications/read", {
          method: "POST",
          body: JSON.stringify({}),
        });
      }
    } catch (err) {
      console.debug("Notification poll skipped:", err);
    }
  }

  function watchFinishedMessages() {
    const controllers = typeof controller_storage !== "undefined" ? controller_storage : {};
    let running = false;
    for (const key in controllers) {
      if (controllers[key]?.signal && !controllers[key].signal.aborted) {
        running = true;
        break;
      }
    }
    if (lastRunning && !running && document.hidden) {
      const messages = document.querySelectorAll("#chatBody .message .content_inner");
      const last = messages[messages.length - 1]?.textContent?.trim() || "Your reply is ready";
      notify("Assistant finished", last.replace(/\s+/g, " ").slice(0, 200), { toast: false });
    }
    lastRunning = running;
  }

  function tick() {
    if (document.hidden) return;
    api("/v1/browsing/triggers/run-due", { method: "POST", body: "{}" }).catch(() => {});
    refreshFeeds();
    pollNotifications();
  }

  function addonButton(item) {
    const host = window.ChatAddonHost;
    if (host && host.sidebar && typeof host.sidebar.register === "function") {
      host.sidebar.register(item);
      return;
    }
    const panel = document.getElementById("addon-panel");
    if (!panel || document.getElementById(item.id)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = item.id;
    btn.className = "addon-panel-item";
    if (item.title) btn.title = item.title;
    const icon = document.createElement("i");
    icon.className = item.icon;
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = item.label;
    btn.append(icon, label);
    btn.addEventListener("click", item.onClick);
    panel.appendChild(btn);
  }

  const addonItems = [
    {
      id: "g4f-feed-btn",
      label: "Live Feed",
      title: "Add an RSS or Atom live feed",
      icon: "fa-solid fa-rss",
      order: 10,
      onClick: addFeed,
    },
    {
      id: "g4f-trigger-btn",
      label: "Trigger from Prompt",
      title: "Create a notification trigger from a prompt",
      icon: "fa-solid fa-bolt",
      order: 20,
      onClick: addTrigger,
    },
  ];

  function injectAddonButtons() {
    addonItems.forEach(addonButton);
    if (!window.ChatAddonHost && window.addonsLoaded instanceof Promise) {
      // Re-register once the addon host is available; registering through it
      // also re-renders the panel, replacing the temporary fallback buttons.
      window.addonsLoaded.then(() => addonItems.forEach(addonButton)).catch(() => {});
    }
  }

  function injectUi() {
    injectAddonButtons();

    const panel = document.querySelector(".chat-top-panel");
    if (panel && !document.getElementById("g4f-notify-btn")) {
      const bell = document.createElement("button");
      bell.id = "g4f-notify-btn";
      bell.className = "new_convo_icon";
      bell.addEventListener("click", toggleNotifications);
      const plus = panel.querySelector(".new_convo_icon");
      if (plus) plus.after(bell);
      else panel.appendChild(bell);
      paintBell();
    }
  }

  function start() {
    injectUi();
    paintBell();
    window.addEventListener("focus", () => setUnread(0));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        setUnread(0);
        tick();
      }
    });
    setInterval(watchFinishedMessages, 1000);
    if (timer) clearInterval(timer);
    timer = setInterval(tick, POLL_MS);
    setTimeout(tick, 4000);
  }

  function boot() {
    if (typeof get_conversation !== "function" || typeof save_conversation !== "function") {
      if (window.addonsLoaded instanceof Promise) window.addonsLoaded.then(start).catch(start);
      else window.addEventListener("load", start);
      return;
    }
    start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
