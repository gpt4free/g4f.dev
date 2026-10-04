/* ================================================================== *
 * G4F OAuth Client (self-hosted OAuth server)
 *
 * First-party browser client for the central authorization endpoints
 * served by the members worker:
 *
 *   GET  /members/oauth/authorize   (login chooser / session skip)
 *   POST /members/oauth/token       (authorization_code + PKCE)
 *
 * Usage:
 *   G4FOAuth.authorize(redirectUri, stateData)  - start the flow
 *   G4FOAuth.handleCallback(redirectUri)        - complete the flow
 *
 * The client id/secret belong to the built-in first-party web client
 * (BUILTIN_OAUTH_CLIENTS in members-worker.js). The secret is public by
 * design - browser clients cannot hold secrets; PKCE protects the code.
 * ================================================================== */

(function () {
    'use strict';

    const OAUTH_BASE = "https://auth.g4f.space";
    const CLIENT_ID = "g4f-web";
    const CLIENT_SECRET = "5594a516-0da6-4167-bcaa-132e715c54a3";

    const VERIFIER_KEY = "g4f_oauth_verifier";
    const STATE_KEY = "g4f_oauth_state";

    // --- Framed-context helpers -------------------------------------------
    // When the chat runs inside an iframe (e.g. the browser-extension side
    // panel), assigning window.location.href would navigate the frame away
    // from the chat. Instead the auth URL is opened in a popup window; the
    // popup shares localStorage/sessionStorage with the framed page (same
    // origin), so the session written by the callback is immediately
    // visible here once we refresh the UI.
    function isFramed() {
        try {
            return window.self !== window.top;
        } catch (e) {
            return true; // cross-origin access to window.top throws => framed
        }
    }

    // Open an auth URL in a centered popup window. Returns a truthy value
    // when the login window was opened (or handed to the host frame) and
    // null when the caller should navigate the current frame instead.
    function openAuthPopup(url, name) {
        if (!isFramed()) return null;
        // Inside the browser-extension side panel, window.open() from this
        // cross-origin frame is suppressed (or opens a full tab). The host
        // panel listens for this message and opens a real popup window.
        if (window.g4fExtHost) {
            try {
                window.parent.postMessage({ type: "g4f-ext:open-auth", url: String(url) }, "*");
                return true;
            } catch (e) { /* fall through to window.open */ }
        }
        const w = Math.min(520, window.screen.width - 40);
        const h = Math.min(760, window.screen.height - 80);
        const x = Math.max(0, Math.round((window.screen.width - w) / 2));
        const y = Math.max(0, Math.round((window.screen.height - h) / 2));
        const popup = window.open(
            url,
            name || "g4f-login",
            `width=${w},height=${h},left=${x},top=${y},popup=yes`
        );
        if (popup) {
            try { popup.opener = window; } catch (e) { /* ignore */ }
            popup.focus();
            return true;
        }
        // Popup blocked: ask the host frame to open it (the g4f extension
        // side panel handles this; other embedders ignore the message).
        try {
            window.parent.postMessage({ type: "g4f-ext:open-auth", url: String(url) }, "*");
            return true;
        } catch (e) { /* ignore */ }
        console.warn("Login popup blocked - falling back to navigation");
        return null;
    }

    // Notify the opener (the framed chat that spawned this popup) that the
    // login finished, then close the popup. No-op outside popups.
    function closeAuthPopup() {
        if (!window.opener || window.opener === window) return false;
        try {
            window.opener.postMessage({ type: "g4f-login:done" }, "*");
        } catch (e) { /* ignore */ }
        window.close();
        return true;
    }

    function randomString(length) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
        const bytes = new Uint8Array(length);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => chars[b % chars.length]).join("");
    }

    async function generateCodeChallenge(verifier) {
        const data = new TextEncoder().encode(verifier);
        const digest = await crypto.subtle.digest("SHA-256", data);
        const bytes = new Uint8Array(digest);
        let bin = "";
        for (const b of bytes) bin += String.fromCharCode(b);
        return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    // Start the authorization code flow: persist the PKCE verifier + state
    // in sessionStorage, then navigate to the central authorize endpoint.
    // stateData is round-tripped via sessionStorage and returned by
    // handleCallback() after the redirect back.
    async function authorize(redirectUri, stateData, provider=null) {
        const verifier = randomString(64);
        const challenge = await generateCodeChallenge(verifier);
        const state = randomString(32);
        sessionStorage.setItem(VERIFIER_KEY, verifier);
        sessionStorage.setItem(STATE_KEY, JSON.stringify({
            state: state,
            redirectUri: redirectUri,
            data: stateData || null,
            provider: provider || null
        }));
        const params = new URLSearchParams({
            response_type: "code",
            client_id: provider ? `g4f-web-${provider}` : CLIENT_ID,
            redirect_uri: redirectUri,
            state: state,
            code_challenge: challenge,
            code_challenge_method: "S256",
        });
        const authUrl = `${OAUTH_BASE}/members/oauth/authorize?${params.toString()}`;
        // Inside an iframe: open the flow in a popup instead of navigating
        // the frame away from the chat.
        if (openAuthPopup(authUrl)) return;
        window.location.href = authUrl;
    }

    async function exchangeCode(code, redirectUri, provider=null) {
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: provider ? `g4f-web-${provider}` : CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: code,
            redirect_uri: redirectUri,
            code_verifier: sessionStorage.getItem(VERIFIER_KEY) || "",
        });
        const res = await fetch(`${OAUTH_BASE}/members/oauth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            credentials: "include",
            body: body.toString(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error_description || data.error || `token exchange failed (${res.status})`);
        }
        return data;
    }

    // If the current URL carries ?code=&state=, exchange it for tokens.
    // Returns { token, user, expires, stateData } or null when the URL has
    // no code. Throws on state mismatch or a failed token exchange.
    async function handleCallback(redirectUri) {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (!code) return null;
        const state = url.searchParams.get("state");
        let saved = null;
        try {
            saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || "null");
        } catch (e) { saved = null; }
        sessionStorage.removeItem(STATE_KEY);
        if (!saved || saved.state !== state) {
            sessionStorage.removeItem(VERIFIER_KEY);
            throw new Error("OAuth state mismatch - please retry signing in");
        }
        let data;
        try {
            data = await exchangeCode(code, saved.redirectUri || redirectUri, saved.provider || null);
        } finally {
            sessionStorage.removeItem(VERIFIER_KEY);
        }
        // clean the URL (drop code/state)
        url.searchParams.delete("code");
        url.searchParams.delete("state");
        window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
        return {
            token: data.access_token,
            user: data.user || null,
            // expires_in is in seconds; clamp to 7 days
            expires: data.expires_in ? Math.floor(Date.now() / 1000) + Math.min(data.expires_in, 7 * 24 * 3600) : null,
            stateData: saved.data || null,
        };
    }

    // RFC 7009 token revocation — the OAuth-compatible logout. Revokes the
    // given access token (temporary login key or gfs_ session token)
    // server-side and clears the session cookie. Best-effort: never throws.
    async function revoke(token) {
        if (!token) return;
        const body = new URLSearchParams({
            token: token,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
        });
        try {
            await fetch(`${OAUTH_BASE}/members/oauth/revoke`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                credentials: "include",
                body: body.toString(),
            });
        } catch (e) {
            console.warn("OAuth revoke failed:", e);
        }
    }

    window.G4FOAuth = {
        authorize,
        exchangeCode,
        handleCallback,
        revoke,
        isFramed,
        openAuthPopup,
        closeAuthPopup,
        OAUTH_BASE,
        CLIENT_ID
    };

    // When this page runs as the login popup, close it automatically once
    // the OAuth callback stored the session (same origin => shared storage).
    window.addEventListener("load", () => {
        if (window.opener && new URLSearchParams(window.location.search).get("code")) {
            setTimeout(closeAuthPopup, 800);
        }
    });

    // When this page runs framed, refresh the login UI whenever the popup
    // writes the session into the shared localStorage.
    window.addEventListener("storage", (event) => {
        if (isFramed() && (event.key === "g4f_session" || event.key === "g4f_user" || event.key === "g4f_expires")) {
            window.dispatchEvent(new CustomEvent("g4f-login:changed"));
        }
    });
})();
