var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// members-worker.js
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id, X-API-Key",
  "Access-Control-Expose-Headers": "Content-Type, X-User-Id, Retry-After, X-User-Tier"
};
var OAUTH_REDIRECT_URI = "https://g4f.dev/members.html";
var RATE_LIMITS = {
  // Window durations in milliseconds
  windows: {
    minute: 60 * 1e3,
    hour: 60 * 60 * 1e3,
    day: 24 * 60 * 60 * 1e3
  },
  // Burst allowance multiplier for short-term limits
  burstMultiplier: 2
};
var ADMIN_USERS = {
  discord: ["hlohaus789"],
  github: [],
  huggingface: []
};
var EXTRA_SPONSORS = ["Screenmax1234", "kirill670"];
async function fetchContributors(env) {
  const contributors = [];
  let nextUrl = "https://api.github.com/repos/xtekky/gpt4free/contributors?per_page=100";
  const headers = { "User-Agent": "G4F-Members-Worker" };
  if (env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
  }
  try {
    while (nextUrl) {
      const response = await fetch(nextUrl, { headers });
      if (!response.ok) {
        console.error(`Failed to fetch contributors: ${response.status}`);
        if (contributors.length === 0) {
          return EXTRA_SPONSORS;
        }
        break;
      }
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        contributors.push(...data.map((user) => user.login));
      }
      nextUrl = null;
      const linkHeader = response.headers.get("Link");
      if (linkHeader) {
        const links = linkHeader.split(",");
        for (const link of links) {
          const match = link.match(/<([^>]+)>;\s*rel="next"/);
          if (match) {
            nextUrl = match[1];
            break;
          }
        }
      }
    }
    EXTRA_SPONSORS.forEach((sponsor) => {
      if (!contributors.includes(sponsor)) {
        contributors.push(sponsor);
      }
    });
    console.log(`Fetched ${contributors.length} contributors`);
    return contributors;
  } catch (error) {
    console.error("Failed to fetch contributors:", error);
    return contributors.length > 0 ? contributors : EXTRA_SPONSORS;
  }
}
__name(fetchContributors, "fetchContributors");
async function fetchSponsors() {
  try {
    const sponsorsUrl = "https://ghs.vercel.app/v3/sponsors/hlohaus";
    const response = await fetch(sponsorsUrl);
    if (!response.ok) return [];
    const data = await response.json();
    data.sponsors = data.sponsors || {};
    data.sponsors.current = data.sponsors.current || [];
    data.sponsors.past = data.sponsors.past || [];
    return data.sponsors.past.map((user) => user.username).concat(data.sponsors.current.map((user) => user.username));
  } catch (error) {
    console.error("Failed to fetch sponsors:", error);
    return [];
  }
}
__name(fetchSponsors, "fetchSponsors");
function calculateUserTier(userData, contributors, sponsors) {
  const adminList = ADMIN_USERS[userData.provider] || [];
  if (adminList.includes(userData.username)) {
    return "admin";
  }
  if (userData.provider === "github" && contributors.includes(userData.username)) {
    return "pro";
  }
  if (userData.provider === "github" && sponsors.includes(userData.username)) {
    return "pro";
  }
  if (userData.created_at) {
    const created = new Date(userData.created_at);
    const now = /* @__PURE__ */ new Date();
    if (now - created > 24 * 60 * 60 * 1e3) {
      return "free";
    }
  }
  return "new";
}
__name(calculateUserTier, "calculateUserTier");
var USER_TIER_LIMITS = {
  new: {
    tokens: { perMinute: 2e4, perHour: 5e4, perDay: 1e5 },
    requests: { perMinute: 5, perHour: 20, perDay: 50 },
    api_keys: 1,
    burstMultiplier: 1.2
  },
  free: {
    tokens: { perMinute: 15e4, perHour: 5e5, perDay: 1e6 },
    requests: { perMinute: 20, perHour: 200, perDay: 2e3 },
    api_keys: 1,
    burstMultiplier: 2
  },
  sponsor: {
    tokens: { perMinute: 5e5, perHour: 25e5, perDay: 1e7 },
    requests: { perMinute: 50, perHour: 500, perDay: 5e3 },
    api_keys: 5,
    burstMultiplier: 1.5
  },
  pro: {
    tokens: { perMinute: 1e6, perHour: 5e6, perDay: 2e7 },
    requests: { perMinute: 100, perHour: 1e3, perDay: 1e4 },
    api_keys: 10,
    burstMultiplier: 1.5
  }
};
var USER_TIERS = {
  new: {
    requests_per_day: USER_TIER_LIMITS.new.requests.perDay,
    tokens_per_day: USER_TIER_LIMITS.new.tokens.perDay,
    api_keys: USER_TIER_LIMITS.new.api_keys
  },
  free: {
    requests_per_day: USER_TIER_LIMITS.free.requests.perDay,
    tokens_per_day: USER_TIER_LIMITS.free.tokens.perDay,
    api_keys: USER_TIER_LIMITS.free.api_keys
  },
  sponsor: {
    requests_per_day: USER_TIER_LIMITS.sponsor.requests.perDay,
    tokens_per_day: USER_TIER_LIMITS.sponsor.tokens.perDay,
    api_keys: USER_TIER_LIMITS.sponsor.api_keys
  },
  pro: {
    requests_per_day: USER_TIER_LIMITS.pro.requests.perDay,
    tokens_per_day: USER_TIER_LIMITS.pro.tokens.perDay,
    api_keys: USER_TIER_LIMITS.pro.api_keys
  }
};
var members_worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    try {
      if (pathname === "/members/auth/github" || pathname === "/members/oauth/github") {
        return handleGitHubAuth(request, env, url);
      }
      if (pathname === "/members/auth/github/callback" || pathname === "/members/oauth/github/callback") {
        return handleGitHubCallback(request, env, url);
      }
      if (pathname === "/members/auth/discord" || pathname === "/members/oauth/discord") {
        return handleDiscordAuth(request, env, url);
      }
      if (pathname === "/members/auth/discord/callback" || pathname === "/members/oauth/discord/callback") {
        return handleDiscordCallback(request, env, url);
      }
      if (pathname === "/members/auth/huggingface" || pathname === "/members/oauth/huggingface") {
        return handleHuggingFaceAuth(request, env, url);
      }
      if (pathname === "/members/auth/huggingface/callback" || pathname === "/members/oauth/huggingface/callback") {
        return handleHuggingFaceCallback(request, env, url);
      }
      if (pathname === "/members/api/user") {
        return handleGetUser(request, env);
      }
      if (pathname === "/members/api/user/update") {
        return handleUpdateUser(request, env);
      }
      if (pathname === "/members/api/user/delete") {
        return handleDeleteUser(request, env);
      }
      if (pathname === "/members/api/keys") {
        return handleListApiKeys(request, env);
      }
      if (pathname === "/members/api/keys/generate") {
        return handleGenerateApiKey(request, env, ctx);
      }
      if (pathname === "/members/api/keys/revoke") {
        return handleRevokeApiKey(request, env);
      }
      if (pathname === "/members/api/keys/validate") {
        return handleValidateApiKey(request, env);
      }
      if (pathname === "/members/api/usage") {
        return handleGetUsage(request, env);
      }
      if (pathname === "/members/api/usage/history") {
        return handleGetUsageHistory(request, env);
      }
      if (pathname === "/members/api/usage/track") {
        return handleTrackUsage(request, env, ctx);
      }
      if (pathname === "/members/api/rate-limit") {
        return handleGetRateLimit(request, env);
      }
      if (pathname === "/members/api/rate-limit/check") {
        return handleCheckRateLimit(request, env);
      }
      if (pathname === "/members/api/rate-limit/update") {
        return handleUpdateRateLimit(request, env, ctx);
      }
      if (pathname === "/members/api/logout") {
        return handleLogout(request, env);
      }
      if (pathname === "/members/api/session") {
        return handleCheckSession(request, env);
      }
      if (pathname === "/members/api/conversations") {
        if (request.method === "GET") {
          return handleListConversations(request, env);
        } else if (request.method === "POST") {
          return handleSyncConversations(request, env);
        }
      }
      if (pathname === "/members/api/conversations/sync") {
        return handleSyncConversations(request, env);
      }
      if (pathname.startsWith("/members/api/conversations/") && pathname !== "/members/api/conversations/" && pathname !== "/members/api/conversations/sync") {
        const conversationId = pathname.replace("/members/api/conversations/", "");
        if (request.method === "GET") {
          return handleGetConversation(request, env, conversationId);
        } else if (request.method === "DELETE") {
          return handleDeleteConversation(request, env, conversationId);
        }
      }
      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Worker error:", error);
      return jsonResponse({ error: error.message || "Internal server error" }, 500);
    }
  },
  /**
   * Scheduled handler to update user tiers periodically
   * Configure in wrangler.toml with cron trigger, e.g.:
   * [triggers]
   * crons = ["0 * * * *"]  # Run every hour
   */
  async scheduled(event, env, ctx) {
    console.log("Starting scheduled tier update...");
    try {
      const [contributors, sponsors] = await Promise.all([
        fetchContributors(env),
        fetchSponsors()
      ]);
      console.log(`Fetched ${contributors.length} contributors and ${sponsors.length} sponsors`);
      const usersList = await env.MEMBERS_BUCKET.list({ prefix: "users/" });
      let updatedCount = 0;
      let errorCount = 0;
      for (const object of usersList.objects) {
        try {
          if (!object.key.endsWith(".json")) continue;
          const userObject = await env.MEMBERS_BUCKET.get(object.key);
          if (!userObject) continue;
          const user = await userObject.json();
          const newTier = calculateUserTier(user, contributors, sponsors);
          if (user.tier !== newTier) {
            const oldTier = user.tier;
            user.tier = newTier;
            user.updated_at = (/* @__PURE__ */ new Date()).toISOString();
            await env.MEMBERS_BUCKET.put(
              object.key,
              JSON.stringify(user, null, 2),
              { httpMetadata: { contentType: "application/json" } }
            );
            await env.MEMBERS_KV.put(
              `user:${user.id}`,
              JSON.stringify(user),
              { expirationTtl: 3600 }
            );
            for (const keyData of user.api_keys || []) {
              const keyInfo = await env.MEMBERS_KV.get(`api_key:${keyData.key_hash}`);
              if (keyInfo) {
                const parsed = JSON.parse(keyInfo);
                parsed.tier = newTier;
                await env.MEMBERS_KV.put(
                  `api_key:${keyData.key_hash}`,
                  JSON.stringify(parsed)
                );
              }
            }
            console.log(`Updated user ${user.username} (${user.provider}): ${oldTier} -> ${newTier}`);
            updatedCount++;
          }
        } catch (userError) {
          console.error(`Error processing user ${object.key}:`, userError);
          errorCount++;
        }
      }
      console.log(`Scheduled tier update complete: ${updatedCount} users updated, ${errorCount} errors`);
    } catch (error) {
      console.error("Scheduled tier update failed:", error);
    }
  }
};
async function handleGitHubAuth(request, env, url) {
  const state = generateState();
  const scope = "user:email read:user";
  const redirectParam = url.searchParams.get("redirect_chat") || url.searchParams.get("redirect");
  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", `${url.origin}/members/auth/github/callback`);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("state", state);
  const stateData = JSON.stringify({ provider: "github", redirect: redirectParam || null });
  await env.MEMBERS_KV.put(`oauth_state:${state}`, stateData, { expirationTtl: 600 });
  return Response.redirect(authUrl.toString(), 302);
}
__name(handleGitHubAuth, "handleGitHubAuth");
async function handleGitHubCallback(request, env, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return redirectWithError("Missing code or state parameter");
  }
  const storedStateData = await env.MEMBERS_KV.get(`oauth_state:${state}`);
  let stateData;
  try {
    stateData = JSON.parse(storedStateData);
  } catch {
    stateData = { provider: storedStateData, redirect: null };
  }
  if (stateData.provider !== "github") {
    return redirectWithError("Invalid state parameter");
  }
  await env.MEMBERS_KV.delete(`oauth_state:${state}`);
  const externalRedirect = stateData.redirect;
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/members/auth/github/callback`
    })
  });
  const tokenData = await tokenResponse.json();
  if (tokenData.error) {
    return redirectWithError(tokenData.error_description || tokenData.error);
  }
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      "Authorization": `Bearer ${tokenData.access_token}`,
      "User-Agent": "G4F-Members-Worker"
    }
  });
  const githubUser = await userResponse.json();
  const emailResponse = await fetch("https://api.github.com/user/emails", {
    headers: {
      "Authorization": `Bearer ${tokenData.access_token}`,
      "User-Agent": "G4F-Members-Worker"
    }
  });
  const emails = await emailResponse.json();
  const primaryEmail = emails.find((e) => e.primary)?.email || emails[0]?.email;
  const user = await createOrUpdateUser(env, {
    provider: "github",
    provider_id: githubUser.id.toString(),
    username: githubUser.login,
    name: githubUser.name || githubUser.login,
    email: primaryEmail,
    avatar: githubUser.avatar_url,
    access_token: tokenData.access_token
  });
  const sessionToken = await createSession(env, user.id);
  if (externalRedirect) {
    try {
      const redirectUrl = new URL(externalRedirect);
      if (redirectUrl.hostname.endsWith("g4f.dev") || redirectUrl.hostname === "localhost") {
        return redirectWithSessionToExternal(sessionToken, user, externalRedirect);
      }
    } catch (e) {
      console.error("Invalid redirect URL:", e);
    }
    return redirectWithTempApiKey(env, user, externalRedirect);
  }
  return redirectWithSession(sessionToken, user);
}
__name(handleGitHubCallback, "handleGitHubCallback");
async function handleDiscordAuth(request, env, url) {
  const state = generateState();
  const scope = "identify email";
  const redirectParam = url.searchParams.get("redirect_chat") || url.searchParams.get("redirect");
  const authUrl = new URL("https://discord.com/api/oauth2/authorize");
  authUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", `${url.origin}/members/auth/discord/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("state", state);
  const stateData = JSON.stringify({ provider: "discord", redirect: redirectParam || null });
  await env.MEMBERS_KV.put(`oauth_state:${state}`, stateData, { expirationTtl: 600 });
  return Response.redirect(authUrl.toString(), 302);
}
__name(handleDiscordAuth, "handleDiscordAuth");
async function handleDiscordCallback(request, env, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return redirectWithError("Missing code or state parameter");
  }
  const storedStateData = await env.MEMBERS_KV.get(`oauth_state:${state}`);
  let stateData;
  try {
    stateData = JSON.parse(storedStateData);
  } catch {
    stateData = { provider: storedStateData, redirect: null };
  }
  if (stateData.provider !== "discord") {
    return redirectWithError("Invalid state parameter");
  }
  await env.MEMBERS_KV.delete(`oauth_state:${state}`);
  const externalRedirect = stateData.redirect;
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}/members/auth/discord/callback`
    })
  });
  const tokenData = await tokenResponse.json();
  if (tokenData.error) {
    return redirectWithError(tokenData.error_description || tokenData.error);
  }
  const userResponse = await fetch("https://discord.com/api/users/@me", {
    headers: {
      "Authorization": `Bearer ${tokenData.access_token}`
    }
  });
  const discordUser = await userResponse.json();
  const user = await createOrUpdateUser(env, {
    provider: "discord",
    provider_id: discordUser.id,
    username: discordUser.username,
    name: discordUser.global_name || discordUser.username,
    email: discordUser.email,
    avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null,
    access_token: tokenData.access_token
  });
  const sessionToken = await createSession(env, user.id);
  if (externalRedirect) {
    try {
      const redirectUrl = new URL(externalRedirect);
      if (redirectUrl.hostname.endsWith("g4f.dev") || redirectUrl.hostname === "localhost") {
        return redirectWithSessionToExternal(sessionToken, user, externalRedirect);
      }
    } catch (e) {
      console.error("Invalid redirect URL:", e);
    }
    return redirectWithTempApiKey(env, user, externalRedirect);
  }
  return redirectWithSession(sessionToken, user);
}
__name(handleDiscordCallback, "handleDiscordCallback");
async function handleHuggingFaceAuth(request, env, url) {
  const state = generateState();
  const scope = "openid profile email";
  const redirectParam = url.searchParams.get("redirect_chat") || url.searchParams.get("redirect");
  const authUrl = new URL("https://huggingface.co/oauth/authorize");
  authUrl.searchParams.set("client_id", env.HUGGINGFACE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", `${url.origin}/members/auth/huggingface/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("state", state);
  const stateData = JSON.stringify({ provider: "huggingface", redirect: redirectParam || null });
  await env.MEMBERS_KV.put(`oauth_state:${state}`, stateData, { expirationTtl: 600 });
  return Response.redirect(authUrl.toString(), 302);
}
__name(handleHuggingFaceAuth, "handleHuggingFaceAuth");
async function handleHuggingFaceCallback(request, env, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return redirectWithError("Missing code or state parameter");
  }
  const storedStateData = await env.MEMBERS_KV.get(`oauth_state:${state}`);
  let stateData;
  try {
    stateData = JSON.parse(storedStateData);
  } catch {
    stateData = { provider: storedStateData, redirect: null };
  }
  if (stateData.provider !== "huggingface") {
    return redirectWithError("Invalid state parameter");
  }
  await env.MEMBERS_KV.delete(`oauth_state:${state}`);
  const externalRedirect = stateData.redirect;
  const tokenResponse = await fetch("https://huggingface.co/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: env.HUGGINGFACE_CLIENT_ID,
      client_secret: env.HUGGINGFACE_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}/members/auth/huggingface/callback`
    })
  });
  const tokenData = await tokenResponse.json();
  if (tokenData.error) {
    return redirectWithError(tokenData.error_description || tokenData.error);
  }
  const userResponse = await fetch("https://huggingface.co/api/whoami-v2", {
    headers: {
      "Authorization": `Bearer ${tokenData.access_token}`
    }
  });
  const hfUser = await userResponse.json();
  const user = await createOrUpdateUser(env, {
    provider: "huggingface",
    provider_id: hfUser.id || hfUser.name,
    username: hfUser.name,
    name: hfUser.fullname || hfUser.name,
    email: hfUser.email,
    avatar: hfUser.avatarUrl,
    access_token: tokenData.access_token
  });
  const sessionToken = await createSession(env, user.id);
  if (externalRedirect) {
    try {
      const redirectUrl = new URL(externalRedirect);
      if (redirectUrl.hostname.endsWith("g4f.dev") || redirectUrl.hostname === "localhost") {
        return redirectWithSessionToExternal(sessionToken, user, externalRedirect);
      }
    } catch (e) {
      console.error("Invalid redirect URL:", e);
    }
    return redirectWithTempApiKey(env, user, externalRedirect);
  }
  return redirectWithSession(sessionToken, user);
}
__name(handleHuggingFaceCallback, "handleHuggingFaceCallback");
async function createOrUpdateUser(env, userData) {
  const lookupKey = `user_lookup:${userData.provider}:${userData.provider_id}`;
  let userId = await env.MEMBERS_KV.get(lookupKey);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let user;
  if (userId) {
    user = await getUser(env, userId);
    if (user) {
      user.username = userData.username;
      user.name = userData.name;
      user.email = userData.email;
      user.avatar = userData.avatar;
      user.access_token = userData.access_token;
      user.updated_at = now;
      user.last_login = now;
    }
  }
  if (!user) {
    userId = generateUserId();
    user = {
      id: userId,
      provider: userData.provider,
      provider_id: userData.provider_id,
      username: userData.username,
      name: userData.name,
      email: userData.email,
      avatar: userData.avatar,
      access_token: userData.access_token,
      tier: "new",
      // Tier is updated by scheduled handler
      api_keys: [],
      created_at: now,
      updated_at: now,
      last_login: now,
      usage: {
        requests_today: 0,
        tokens_today: 0,
        total_requests: 0,
        total_tokens: 0,
        last_reset: now
      }
    };
    await env.MEMBERS_KV.put(lookupKey, userId);
  }
  await saveUser(env, user);
  await env.MEMBERS_KV.put(`user:${userId}`, JSON.stringify(user), { expirationTtl: 3600 });
  return user;
}
__name(createOrUpdateUser, "createOrUpdateUser");
async function getUser(env, userId) {
  const cached = await env.MEMBERS_KV.get(`user:${userId}`);
  if (cached) {
    return JSON.parse(cached);
  }
  const object = await env.MEMBERS_BUCKET.get(`users/${userId}.json`);
  if (!object) {
    return null;
  }
  const user = await object.json();
  await env.MEMBERS_KV.put(`user:${userId}`, JSON.stringify(user), { expirationTtl: 3600 });
  return user;
}
__name(getUser, "getUser");
async function saveUser(env, user) {
  await env.MEMBERS_BUCKET.put(
    `users/${user.id}.json`,
    JSON.stringify(user, null, 2),
    {
      httpMetadata: {
        contentType: "application/json"
      }
    }
  );
  await env.MEMBERS_KV.put(`user:${user.id}`, JSON.stringify(user), { expirationTtl: 3600 });
}
__name(saveUser, "saveUser");
async function handleGetUser(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const safeUser = { ...user };
  delete safeUser.access_token;
  delete safeUser.api_keys;
  return jsonResponse({ user: safeUser });
}
__name(handleGetUser, "handleGetUser");
async function handleUpdateUser(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  const body = await request.json();
  const allowedFields = ["name", "email"];
  for (const field of allowedFields) {
    if (body[field] !== void 0) {
      user[field] = body[field];
    }
  }
  user.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  await saveUser(env, user);
  const safeUser = { ...user };
  delete safeUser.access_token;
  delete safeUser.api_keys;
  return jsonResponse({ user: safeUser, message: "User updated successfully" });
}
__name(handleUpdateUser, "handleUpdateUser");
async function handleDeleteUser(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (request.method !== "POST" && request.method !== "DELETE") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  await env.MEMBERS_BUCKET.delete(`users/${user.id}.json`);
  await env.MEMBERS_KV.delete(`user:${user.id}`);
  await env.MEMBERS_KV.delete(`user_lookup:${user.provider}:${user.provider_id}`);
  for (const keyData of user.api_keys || []) {
    await env.MEMBERS_KV.delete(`api_key:${keyData.key_hash}`);
  }
  await env.MEMBERS_KV.delete(`session:${user.id}`);
  return jsonResponse({ message: "User deleted successfully" });
}
__name(handleDeleteUser, "handleDeleteUser");
async function handleListApiKeys(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const keys = (user.api_keys || []).map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    created_at: k.created_at,
    last_used: k.last_used,
    usage: k.usage
  }));
  return jsonResponse({ api_keys: keys });
}
__name(handleListApiKeys, "handleListApiKeys");
async function handleGenerateApiKey(request, env, ctx) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  const tierLimits = USER_TIERS[user.tier] || USER_TIERS.new;
  let revokedKey = null;
  if ((user.api_keys || []).length >= tierLimits.api_keys) {
    const sortedKeys = [...user.api_keys || []].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );
    const oldestKey = sortedKeys[0];
    if (oldestKey) {
      await env.MEMBERS_KV.delete(`api_key:${oldestKey.key_hash}`);
      const keyIndex = user.api_keys.findIndex((k) => k.id === oldestKey.id);
      if (keyIndex !== -1) {
        user.api_keys.splice(keyIndex, 1);
      }
      await env.MEMBERS_BUCKET.put(
        `api_keys/${user.id}/${oldestKey.id}_revoked.json`,
        JSON.stringify({
          ...oldestKey,
          revoked_at: (/* @__PURE__ */ new Date()).toISOString(),
          revoked_reason: "auto_revoked_on_new_key_generation"
        }, null, 2),
        {
          httpMetadata: { contentType: "application/json" }
        }
      );
      revokedKey = {
        id: oldestKey.id,
        name: oldestKey.name,
        prefix: oldestKey.prefix
      };
    }
  }
  const body = await request.json().catch(() => ({}));
  const keyName = body.name || `API Key ${(user.api_keys || []).length + 1}`;
  const apiKey = await generateApiKey(env, user.id);
  const keyHash = await hashApiKey(apiKey);
  const keyPrefix = apiKey.substring(0, 8);
  const keyData = {
    id: generateKeyId(),
    name: keyName,
    key_hash: keyHash,
    prefix: keyPrefix,
    user_id: user.id,
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    last_used: null,
    usage: {
      requests: 0,
      tokens: 0
    }
  };
  await env.MEMBERS_KV.put(`api_key:${keyHash}`, JSON.stringify({
    user_id: user.id,
    key_id: keyData.id,
    tier: user.tier,
    username: user.username
  }));
  user.api_keys = user.api_keys || [];
  user.api_keys.push(keyData);
  user.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  await saveUser(env, user);
  await env.MEMBERS_BUCKET.put(
    `api_keys/${user.id}/${keyData.id}.json`,
    JSON.stringify({
      ...keyData,
      user_id: user.id,
      user_email: user.email
    }, null, 2),
    {
      httpMetadata: { contentType: "application/json" }
    }
  );
  const response = {
    message: "API key generated successfully",
    api_key: apiKey,
    key_data: {
      id: keyData.id,
      name: keyData.name,
      prefix: keyPrefix,
      created_at: keyData.created_at
    },
    warning: "Save this API key now. You won't be able to see it again!"
  };
  if (revokedKey) {
    response.revoked_key = revokedKey;
    response.message = "API key generated successfully. Old key was automatically revoked.";
  }
  return jsonResponse(response);
}
__name(handleGenerateApiKey, "handleGenerateApiKey");
async function handleRevokeApiKey(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (request.method !== "POST" && request.method !== "DELETE") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  const body = await request.json();
  const keyId = body.key_id;
  if (!keyId) {
    return jsonResponse({ error: "key_id is required" }, 400);
  }
  const keyIndex = (user.api_keys || []).findIndex((k) => k.id === keyId);
  if (keyIndex === -1) {
    return jsonResponse({ error: "API key not found" }, 404);
  }
  const keyData = user.api_keys[keyIndex];
  await env.MEMBERS_KV.delete(`api_key:${keyData.key_hash}`);
  user.api_keys.splice(keyIndex, 1);
  user.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  await saveUser(env, user);
  await env.MEMBERS_BUCKET.put(
    `api_keys/${user.id}/${keyData.id}_revoked.json`,
    JSON.stringify({
      ...keyData,
      revoked_at: (/* @__PURE__ */ new Date()).toISOString()
    }, null, 2),
    {
      httpMetadata: { contentType: "application/json" }
    }
  );
  return jsonResponse({ message: "API key revoked successfully" });
}
__name(handleRevokeApiKey, "handleRevokeApiKey");
async function handleValidateApiKey(request, env) {
  const apiKey = request.headers.get("X-API-Key") || request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!apiKey) {
    return jsonResponse({ valid: false, error: "No API key provided" }, 401);
  }
  const keyHash = await hashApiKey(apiKey);
  const keyData = await env.MEMBERS_KV.get(`api_key:${keyHash}`);
  if (!keyData) {
    return jsonResponse({ valid: false, error: "Invalid API key" }, 401);
  }
  const { user_id, key_id, tier } = JSON.parse(keyData);
  const user = await getUser(env, user_id);
  if (!user) {
    return jsonResponse({ valid: false, error: "User not found" }, 401);
  }
  const keyIndex = user.api_keys.findIndex((k) => k.id === key_id);
  if (keyIndex !== -1) {
    user.api_keys[keyIndex].last_used = (/* @__PURE__ */ new Date()).toISOString();
    await saveUser(env, user);
  }
  return jsonResponse({
    valid: true,
    user_id: user.id,
    tier: user.tier,
    username: user.username,
    limits: USER_TIERS[user.tier] || USER_TIERS.new
  });
}
__name(handleValidateApiKey, "handleValidateApiKey");
async function handleGetUsage(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (!user.usage) {
    user.usage = {
      requests_today: 0,
      tokens_today: 0,
      total_requests: 0,
      total_tokens: 0,
      last_reset: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  const now = Date.now();
  let requestsToday = 0;
  let tokensToday = 0;
  if (env.MEMBERS_KV) {
    const dayKey = `rate_limit:${user.id}:day`;
    const dayData = await env.MEMBERS_KV.get(dayKey);
    if (dayData) {
      const data = JSON.parse(dayData);
      if (now - data.timestamp < RATE_LIMITS.windows.day) {
        requestsToday = data.requests || 0;
        tokensToday = data.tokens || 0;
      }
    }
  }
  const tierLimits = USER_TIERS[user.tier] || USER_TIERS.new;
  return jsonResponse({
    usage: {
      requests_today: requestsToday,
      tokens_today: tokensToday,
      total_requests: user.usage.total_requests || 0,
      total_tokens: user.usage.total_tokens || 0
    },
    limits: {
      requests_per_day: tierLimits.requests_per_day,
      tokens_per_day: tierLimits.tokens_per_day
    },
    remaining: {
      requests: Math.max(0, tierLimits.requests_per_day - requestsToday),
      tokens: Math.max(0, tierLimits.tokens_per_day - tokensToday)
    }
  });
}
__name(handleGetUsage, "handleGetUsage");
async function handleGetUsageHistory(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7");
  const history = [];
  const now = /* @__PURE__ */ new Date();
  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - i);
    const dateKey = date.toISOString().split("T")[0];
    const usageData = await env.MEMBERS_BUCKET.get(`usage/${user.id}/${dateKey}.json`);
    if (usageData) {
      history.push(await usageData.json());
    } else {
      history.push({
        date: dateKey,
        requests: 0,
        tokens: 0
      });
    }
  }
  return jsonResponse({ history });
}
__name(handleGetUsageHistory, "handleGetUsageHistory");
async function handleTrackUsage(request, env, ctx) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  const apiKey = request.headers.get("X-API-Key") || request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!apiKey) {
    return jsonResponse({ error: "No API key provided" }, 401);
  }
  const keyHash = await hashApiKey(apiKey);
  const keyDataStr = await env.MEMBERS_KV.get(`api_key:${keyHash}`);
  if (!keyDataStr) {
    return jsonResponse({ error: "Invalid API key" }, 401);
  }
  const { user_id, key_id } = JSON.parse(keyDataStr);
  const user = await getUser(env, user_id);
  if (!user) {
    return jsonResponse({ error: "User not found" }, 404);
  }
  const body = await request.json();
  const { requests = 1, tokens = 0, provider = null, model = null, username = null } = body;
  user.usage.requests_today += requests;
  user.usage.tokens_today += tokens;
  user.usage.total_requests += requests;
  user.usage.total_tokens += tokens;
  const keyIndex = user.api_keys.findIndex((k) => k.id === key_id);
  if (keyIndex !== -1) {
    user.api_keys[keyIndex].usage.requests += requests;
    user.api_keys[keyIndex].usage.tokens += tokens;
    user.api_keys[keyIndex].last_used = (/* @__PURE__ */ new Date()).toISOString();
  }
  await saveUser(env, user);
  const dateKey = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  ctx.waitUntil(updateDailyUsage(env, user.id, dateKey, requests, tokens, provider, model));
  return jsonResponse({ success: true });
}
__name(handleTrackUsage, "handleTrackUsage");
async function updateDailyUsage(env, userId, dateKey, requests, tokens, provider, model) {
  const usagePath = `usage/${userId}/${dateKey}.json`;
  const existing = await env.MEMBERS_BUCKET.get(usagePath);
  let usageData;
  if (existing) {
    usageData = await existing.json();
  } else {
    usageData = {
      date: dateKey,
      requests: 0,
      tokens: 0,
      providers: {},
      models: {}
    };
  }
  usageData.requests += requests;
  usageData.tokens += tokens;
  if (provider) {
    usageData.providers[provider] = (usageData.providers[provider] || 0) + requests;
  }
  if (model) {
    usageData.models[model] = (usageData.models[model] || 0) + requests;
  }
  await env.MEMBERS_BUCKET.put(usagePath, JSON.stringify(usageData, null, 2), {
    httpMetadata: { contentType: "application/json" }
  });
}
__name(updateDailyUsage, "updateDailyUsage");
async function createSession(env, userId) {
  const sessionToken = generateSessionToken();
  const user = await getUser(env, userId);
  const sessionData = {
    user_id: userId,
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString()
    // 7 days
  };
  await env.MEMBERS_KV.put(
    `session:${sessionToken}`,
    JSON.stringify(sessionData),
    { expirationTtl: 7 * 24 * 60 * 60 }
    // 7 days
  );
  return sessionToken;
}
__name(createSession, "createSession");
async function authenticateRequest(request, env, refreshSession = false) {
  let sessionToken = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!sessionToken) {
    const cookie = request.headers.get("Cookie");
    if (cookie) {
      const match = cookie.match(/g4f_session=([^;]+)/);
      sessionToken = match ? match[1] : null;
    }
  }
  const userId = request.headers.get("X-User-Id");
  if (sessionToken) {
    const sessionData = await env.MEMBERS_KV.get(`session:${sessionToken}`);
    if (sessionData) {
      const session = JSON.parse(sessionData);
      if (new Date(session.expires_at) > /* @__PURE__ */ new Date()) {
        const user = await getUser(env, session.user_id);
        if (user && refreshSession) {
          await refreshSessionExpiry(env, sessionToken);
        }
        return user;
      }
    }
  }
  if (userId) {
    return await getUser(env, userId);
  }
  return null;
}
__name(authenticateRequest, "authenticateRequest");
async function refreshSessionExpiry(env, sessionToken) {
  const sessionData = await env.MEMBERS_KV.get(`session:${sessionToken}`);
  if (sessionData) {
    const session = JSON.parse(sessionData);
    session.expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString();
    await env.MEMBERS_KV.put(
      `session:${sessionToken}`,
      JSON.stringify(session),
      { expirationTtl: 7 * 24 * 60 * 60 }
      // 7 days
    );
  }
}
__name(refreshSessionExpiry, "refreshSessionExpiry");
async function handleLogout(request, env) {
  let sessionToken = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!sessionToken) {
    const cookie = request.headers.get("Cookie");
    if (cookie) {
      const match = cookie.match(/g4f_session=([^;]+)/);
      sessionToken = match ? match[1] : null;
    }
  }
  if (sessionToken) {
    await env.MEMBERS_KV.delete(`session:${sessionToken}`);
  }
  const clearCookie = "g4f_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure";
  return new Response(JSON.stringify({ message: "Logged out successfully" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearCookie,
      ...CORS_HEADERS
    }
  });
}
__name(handleLogout, "handleLogout");
async function handleCheckSession(request, env) {
  const user = await authenticateRequest(request, env, true);
  if (!user) {
    return jsonResponse({ authenticated: false }, 401);
  }
  const safeUser = { ...user };
  delete safeUser.access_token;
  delete safeUser.api_keys;
  let sessionToken = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!sessionToken) {
    const cookie = request.headers.get("Cookie");
    if (cookie) {
      const match = cookie.match(/g4f_session=([^;]+)/);
      sessionToken = match ? match[1] : null;
    }
  }
  const cookieExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toUTCString();
  const cookieHeader = sessionToken ? `g4f_session=${sessionToken}; Path=/; Expires=${cookieExpiry}; SameSite=Lax; Secure` : null;
  const headers = {
    "Content-Type": "application/json",
    ...CORS_HEADERS
  };
  if (cookieHeader) {
    headers["Set-Cookie"] = cookieHeader;
  }
  return new Response(JSON.stringify({
    authenticated: true,
    user: safeUser
  }), {
    status: 200,
    headers
  });
}
__name(handleCheckSession, "handleCheckSession");
function generateState() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(generateState, "generateState");
function generateUserId() {
  const timestamp = Date.now().toString(36);
  const randomPart = crypto.getRandomValues(new Uint8Array(8));
  const randomStr = Array.from(randomPart, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `u_${timestamp}${randomStr}`;
}
__name(generateUserId, "generateUserId");
function generateKeyId() {
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  return `k_${Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
__name(generateKeyId, "generateKeyId");
function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return "gfs_" + Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(generateSessionToken, "generateSessionToken");
async function generateApiKey(env, userId) {
  const timestamp = Date.now();
  const randomPart = crypto.getRandomValues(new Uint8Array(24));
  const randomStr = Array.from(randomPart, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const userPrefix = userId.substring(0, 8);
  const keyBase = `g4f_${userPrefix}_${randomStr}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(keyBase + (env.API_KEY_SALT || "g4f-salt"));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  const checksum = Array.from(hashArray.slice(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${keyBase}_${checksum}`;
}
__name(generateApiKey, "generateApiKey");
async function hashApiKey(apiKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(hashApiKey, "hashApiKey");
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders
    }
  });
}
__name(jsonResponse, "jsonResponse");
function redirectWithError(error) {
  const redirectUrl = new URL(OAUTH_REDIRECT_URI);
  redirectUrl.searchParams.set("error", error);
  return Response.redirect(redirectUrl.toString(), 302);
}
__name(redirectWithError, "redirectWithError");
function redirectWithSession(sessionToken, user) {
  const redirectUrl = new URL(OAUTH_REDIRECT_URI);
  redirectUrl.searchParams.set("session", sessionToken);
  redirectUrl.searchParams.set("user", encodeURIComponent(JSON.stringify({
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    provider: user.provider,
    tier: user.tier
  })));
  const cookieExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toUTCString();
  const cookie = `g4f_session=${sessionToken}; Path=/; Expires=${cookieExpiry}; SameSite=Lax; Secure`;
  return new Response(null, {
    status: 302,
    headers: {
      "Location": redirectUrl.toString(),
      "Set-Cookie": cookie
    }
  });
}
__name(redirectWithSession, "redirectWithSession");
function redirectWithSessionToExternal(sessionToken, user, externalRedirectUrl) {
  const redirectUrl = new URL(externalRedirectUrl);
  redirectUrl.searchParams.set("session_token", sessionToken);
  redirectUrl.searchParams.set("user", encodeURIComponent(JSON.stringify({
    id: user.id,
    name: user.name,
    username: user.username,
    avatar: user.avatar,
    provider: user.provider,
    tier: user.tier
  })));
  const cookieExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toUTCString();
  const cookie = `g4f_session=${sessionToken}; Path=/; Expires=${cookieExpiry}; SameSite=Lax; Secure`;
  return new Response(null, {
    status: 302,
    headers: {
      "Location": redirectUrl.toString(),
      "Set-Cookie": cookie
    }
  });
}
__name(redirectWithSessionToExternal, "redirectWithSessionToExternal");
async function redirectWithTempApiKey(env, user, externalRedirectUrl) {
  try {
    const apiKey = await generateApiKey(env, user.id);
    const keyHash = await hashApiKey(apiKey);
    const keyPrefix = apiKey.substring(0, 8);
    const keyData = {
      id: generateKeyId(),
      name: "Temporary Login Key",
      key_hash: keyHash,
      prefix: keyPrefix,
      user_id: user.id,
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      last_used: null,
      is_temporary: true,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1e3).toISOString(),
      // 24 hour expiry
      usage: {
        requests: 0,
        tokens: 0
      }
    };
    await env.MEMBERS_KV.put(`api_key:${keyHash}`, JSON.stringify({
      user_id: user.id,
      key_id: keyData.id,
      tier: user.tier,
      is_temporary: true,
      expires_at: keyData.expires_at
    }), { expirationTtl: 86400 });
    user.api_keys = user.api_keys || [];
    user.api_keys.push(keyData);
    user.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await saveUser(env, user);
    const redirectUrl = `${new URL(externalRedirectUrl).toString()}#${encodeURIComponent(apiKey)}`;
    return Response.redirect(redirectUrl.toString(), 302);
  } catch (error) {
    console.error("Failed to generate temp API key:", error);
    return Response.redirect(externalRedirectUrl, 302);
  }
}
__name(redirectWithTempApiKey, "redirectWithTempApiKey");
function getRateLimitsForTier(tier) {
  const tierLimits = USER_TIER_LIMITS[tier] || USER_TIER_LIMITS.new;
  return {
    tokens: tierLimits.tokens,
    requests: tierLimits.requests,
    burstMultiplier: tierLimits.burstMultiplier || 1.5,
    windows: RATE_LIMITS.windows
  };
}
__name(getRateLimitsForTier, "getRateLimitsForTier");
async function getUserRateLimitUsage(env, userId) {
  if (!env.MEMBERS_KV) {
    return {
      minute: { tokens: 0, requests: 0, timestamp: Date.now() },
      hour: { tokens: 0, requests: 0, timestamp: Date.now() },
      day: { tokens: 0, requests: 0, timestamp: Date.now() }
    };
  }
  const now = Date.now();
  const keys = ["minute", "hour", "day"];
  const results = {};
  const promises = keys.map(async (window) => {
    const key = `user_rate:${userId}:${window}`;
    const data = await env.MEMBERS_KV.get(key, { type: "json" });
    if (!data || now - data.timestamp > RATE_LIMITS.windows[window]) {
      return { window, data: { tokens: 0, requests: 0, timestamp: now } };
    }
    return { window, data };
  });
  const resolved = await Promise.all(promises);
  for (const { window, data } of resolved) {
    results[window] = data;
  }
  return results;
}
__name(getUserRateLimitUsage, "getUserRateLimitUsage");
async function checkUserRateLimits(env, userId, tier) {
  const limits = getRateLimitsForTier(tier);
  const usage = await getUserRateLimitUsage(env, userId);
  const now = Date.now();
  const checks = [
    {
      window: "minute",
      tokenLimit: limits.tokens.perMinute * limits.burstMultiplier,
      requestLimit: limits.requests.perMinute * limits.burstMultiplier,
      usage: usage.minute
    },
    {
      window: "hour",
      tokenLimit: limits.tokens.perHour,
      requestLimit: limits.requests.perHour,
      usage: usage.hour
    },
    {
      window: "day",
      tokenLimit: limits.tokens.perDay,
      requestLimit: limits.requests.perDay,
      usage: usage.day
    }
  ];
  for (const check of checks) {
    if (check.usage.tokens >= check.tokenLimit) {
      const retryAfter = Math.ceil((RATE_LIMITS.windows[check.window] - (now - check.usage.timestamp)) / 1e3);
      return {
        allowed: false,
        reason: "tokens",
        window: check.window,
        limit: check.tokenLimit,
        used: check.usage.tokens,
        retryAfter: Math.max(1, retryAfter),
        tier
      };
    }
    if (check.usage.requests >= check.requestLimit) {
      const retryAfter = Math.ceil((RATE_LIMITS.windows[check.window] - (now - check.usage.timestamp)) / 1e3);
      return {
        allowed: false,
        reason: "requests",
        window: check.window,
        limit: check.requestLimit,
        used: check.usage.requests,
        retryAfter: Math.max(1, retryAfter),
        tier
      };
    }
  }
  return { allowed: true, usage, tier };
}
__name(checkUserRateLimits, "checkUserRateLimits");
async function updateUserRateLimitUsage(env, userId, tokensUsed, ctx) {
  if (!env.MEMBERS_KV || tokensUsed <= 0) return;
  const now = Date.now();
  const windows = ["minute", "hour", "day"];
  for (const window of windows) {
    const key = `user_rate:${userId}:${window}`;
    const windowMs = RATE_LIMITS.windows[window];
    const data = await env.MEMBERS_KV.get(key, { type: "json" });
    let newData;
    if (!data || now - data.timestamp > windowMs) {
      newData = {
        tokens: tokensUsed,
        requests: 1,
        timestamp: now
      };
    } else {
      newData = {
        tokens: data.tokens + tokensUsed,
        requests: data.requests + 1,
        timestamp: data.timestamp
      };
    }
    const elapsed = now - newData.timestamp;
    const remaining = Math.max(60, Math.ceil((windowMs - elapsed) / 1e3) + 60);
    ctx.waitUntil(env.MEMBERS_KV.put(key, JSON.stringify(newData), { expirationTtl: remaining }));
  }
}
__name(updateUserRateLimitUsage, "updateUserRateLimitUsage");
async function handleGetRateLimit(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const tier = user.tier || "new";
  const limits = getRateLimitsForTier(tier);
  const usage = await getUserRateLimitUsage(env, user.id);
  const now = Date.now();
  const windowLabels = { minute: "per minute", hour: "per hour", day: "per day" };
  const response = {
    user_id: user.id,
    tier,
    limits: {
      tokens: limits.tokens,
      requests: limits.requests
    },
    usage: {
      minute: {
        tokens: usage.minute.tokens,
        requests: usage.minute.requests,
        remaining_tokens: Math.max(0, limits.tokens.perMinute * limits.burstMultiplier - usage.minute.tokens),
        remaining_requests: Math.max(0, limits.requests.perMinute * limits.burstMultiplier - usage.minute.requests),
        resets_in: Math.max(0, Math.ceil((RATE_LIMITS.windows.minute - (now - usage.minute.timestamp)) / 1e3))
      },
      hour: {
        tokens: usage.hour.tokens,
        requests: usage.hour.requests,
        remaining_tokens: Math.max(0, limits.tokens.perHour - usage.hour.tokens),
        remaining_requests: Math.max(0, limits.requests.perHour - usage.hour.requests),
        resets_in: Math.max(0, Math.ceil((RATE_LIMITS.windows.hour - (now - usage.hour.timestamp)) / 1e3))
      },
      day: {
        tokens: usage.day.tokens,
        requests: usage.day.requests,
        remaining_tokens: Math.max(0, limits.tokens.perDay - usage.day.tokens),
        remaining_requests: Math.max(0, limits.requests.perDay - usage.day.requests),
        resets_in: Math.max(0, Math.ceil((RATE_LIMITS.windows.day - (now - usage.day.timestamp)) / 1e3))
      }
    }
  };
  return jsonResponse(response);
}
__name(handleGetRateLimit, "handleGetRateLimit");
async function handleCheckRateLimit(request, env) {
  let userId, tier;
  const apiKey = request.headers.get("X-API-Key") || request.headers.get("Authorization")?.replace("Bearer ", "");
  if (apiKey && apiKey.startsWith("g4f_")) {
    const keyHash = await hashApiKey(apiKey);
    const keyDataStr = await env.MEMBERS_KV.get(`api_key:${keyHash}`);
    if (keyDataStr) {
      const keyData = JSON.parse(keyDataStr);
      userId = keyData.user_id;
      tier = keyData.tier || "new";
    }
  }
  if (!userId) {
    const user = await authenticateRequest(request, env);
    if (user) {
      userId = user.id;
      tier = user.tier || "new";
    }
  }
  if (!userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const rateCheck = await checkUserRateLimits(env, userId, tier);
  if (!rateCheck.allowed) {
    const windowLabels = { minute: "per minute", hour: "per hour", day: "per day" };
    const message = rateCheck.reason === "tokens" ? `Token limit (${rateCheck.limit.toLocaleString()} ${windowLabels[rateCheck.window]}) exceeded for ${tier} tier. Used: ${rateCheck.used.toLocaleString()} tokens.` : `Request limit (${rateCheck.limit} ${windowLabels[rateCheck.window]}) exceeded for ${tier} tier. Made: ${rateCheck.used} requests.`;
    return jsonResponse({
      allowed: false,
      error: {
        message,
        type: "rate_limit_exceeded",
        tier: rateCheck.tier,
        window: rateCheck.window,
        limit: rateCheck.limit,
        used: rateCheck.used,
        retry_after: rateCheck.retryAfter
      }
    }, 429, { "Retry-After": rateCheck.retryAfter.toString(), "X-User-Tier": tier });
  }
  return jsonResponse({
    allowed: true,
    tier,
    usage: rateCheck.usage
  });
}
__name(handleCheckRateLimit, "handleCheckRateLimit");
async function handleUpdateRateLimit(request, env, ctx) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  const apiKey = request.headers.get("X-API-Key") || request.headers.get("Authorization")?.replace("Bearer ", "");
  let userId, tier;
  if (apiKey && apiKey.startsWith("g4f_")) {
    const keyHash = await hashApiKey(apiKey);
    const keyDataStr = await env.MEMBERS_KV.get(`api_key:${keyHash}`);
    if (keyDataStr) {
      const keyData = JSON.parse(keyDataStr);
      userId = keyData.user_id;
      tier = keyData.tier || "new";
    }
  }
  if (!userId) {
    const user = await authenticateRequest(request, env);
    if (user) {
      userId = user.id;
      tier = user.tier || "new";
    }
  }
  if (!userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const body = await request.json();
  const { tokens = 0, requests = 1, provider = null, model = null } = body;
  if (tokens > 0 || requests > 0) {
    await updateUserRateLimitUsage(env, userId, tokens, ctx);
    const user = await getUser(env, userId);
    if (user) {
      const now = /* @__PURE__ */ new Date();
      const lastReset = new Date(user.usage?.last_reset || 0);
      if (now.getUTCDate() !== lastReset.getUTCDate() || now.getUTCMonth() !== lastReset.getUTCMonth() || now.getUTCFullYear() !== lastReset.getUTCFullYear()) {
        user.usage = {
          ...user.usage,
          requests_today: 0,
          tokens_today: 0,
          last_reset: now.toISOString()
        };
      }
      user.usage = user.usage || { requests_today: 0, tokens_today: 0, total_requests: 0, total_tokens: 0 };
      user.usage.requests_today = (user.usage.requests_today || 0) + requests;
      user.usage.tokens_today = (user.usage.tokens_today || 0) + tokens;
      user.usage.total_requests = (user.usage.total_requests || 0) + requests;
      user.usage.total_tokens = (user.usage.total_tokens || 0) + tokens;
      await saveUser(env, user);
      const dateKey = now.toISOString().split("T")[0];
      ctx.waitUntil(updateDailyUsage(env, userId, dateKey, requests, tokens, provider, model));
    }
  }
  return jsonResponse({ success: true, tokens_added: tokens, requests_added: requests });
}
__name(handleUpdateRateLimit, "handleUpdateRateLimit");
async function handleListConversations(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  try {
    const prefix = `conversations/${user.id}/`;
    const listed = await env.MEMBERS_BUCKET.list({ prefix });
    const conversations = [];
    for (const object of listed.objects) {
      try {
        const convObject = await env.MEMBERS_BUCKET.get(object.key);
        if (convObject) {
          const convData = await convObject.json();
          conversations.push(convData);
        }
      } catch (e) {
        console.error("Failed to load conversation:", object.key, e);
      }
    }
    conversations.sort((a, b) => (b.updated || b.added || 0) - (a.updated || a.added || 0));
    return jsonResponse({
      conversations,
      count: conversations.length
    });
  } catch (error) {
    console.error("Failed to list conversations:", error);
    return jsonResponse({ error: "Failed to list conversations" }, 500);
  }
}
__name(handleListConversations, "handleListConversations");
async function handleSyncConversations(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  try {
    const body = await request.json();
    const { conversations } = body;
    if (!Array.isArray(conversations)) {
      return jsonResponse({ error: "conversations must be an array" }, 400);
    }
    const MAX_CONVERSATIONS = 1e3;
    if (conversations.length > MAX_CONVERSATIONS) {
      return jsonResponse({
        error: `Maximum ${MAX_CONVERSATIONS} conversations allowed`
      }, 400);
    }
    const results = [];
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (const conv of conversations) {
      if (!conv.id) {
        results.push({ id: null, success: false, error: "Missing conversation ID" });
        continue;
      }
      try {
        const key = `conversations/${user.id}/${conv.id}.json`;
        await env.MEMBERS_BUCKET.put(
          key,
          JSON.stringify({
            ...conv,
            synced_at: now,
            user_id: user.id
          }),
          {
            httpMetadata: {
              contentType: "application/json",
              cacheControl: now
            }
          }
        );
        results.push({ id: conv.id, success: true });
      } catch (err) {
        results.push({ id: conv.id, success: false, error: err.message });
      }
    }
    const successCount = results.filter((r) => r.success).length;
    return jsonResponse({
      message: `Synced ${successCount} of ${conversations.length} conversations`,
      results
    });
  } catch (error) {
    console.error("Failed to sync conversations:", error);
    return jsonResponse({ error: "Failed to sync conversations" }, 500);
  }
}
__name(handleSyncConversations, "handleSyncConversations");
async function handleGetConversation(request, env, conversationId) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  try {
    const key = `conversations/${user.id}/${conversationId}.json`;
    const object = await env.MEMBERS_BUCKET.get(key);
    if (!object) {
      return jsonResponse({ error: "Conversation not found" }, 404);
    }
    const conversation = await object.json();
    return jsonResponse({ conversation });
  } catch (error) {
    console.error("Failed to get conversation:", error);
    return jsonResponse({ error: "Failed to get conversation" }, 500);
  }
}
__name(handleGetConversation, "handleGetConversation");
async function handleDeleteConversation(request, env, conversationId) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  try {
    const key = `conversations/${user.id}/${conversationId}.json`;
    await env.MEMBERS_BUCKET.delete(key);
    return jsonResponse({ message: "Conversation deleted successfully" });
  } catch (error) {
    console.error("Failed to delete conversation:", error);
    return jsonResponse({ error: "Failed to delete conversation" }, 500);
  }
}
__name(handleDeleteConversation, "handleDeleteConversation");
export {
  members_worker_default as default
};
//# sourceMappingURL=members-worker.js.map
