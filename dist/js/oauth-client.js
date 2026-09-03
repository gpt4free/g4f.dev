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
        window.location.href = `${OAUTH_BASE}/members/oauth/authorize?${params.toString()}`;
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

    window.G4FOAuth = { authorize, exchangeCode, handleCallback, OAUTH_BASE, CLIENT_ID };
})();
