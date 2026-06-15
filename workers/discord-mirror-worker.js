/**
 * G4F Discord Mirror Worker
 * 
 * Fetches messages from a Discord channel and mirrors them to the community page.
 * 
 * Environment Variables Required:
 * - DISCORD_TOKEN: Bot token for Discord API
 * - DISCORD_CHANNEL_ID: ID of the channel to mirror
 * - COMMUNITY_KV: KV namespace for storing mirrored messages
 */

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, { 
                headers: { 
                    "Access-Control-Allow-Origin": "*", 
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization"
                } 
            });
        }

        if (request.method === "GET") {
            const messages = await env.COMMUNITY_KV.get("messages") || "[]";
            return new Response(messages, {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        if (request.method === "POST") {
            // Rate limiting: 5 requests per minute per IP
            const ip = request.headers.get("cf-connecting-ip") || "unknown";
            const rateLimitKey = `rate_limit:${ip}`;
            const count = parseInt(await env.COMMUNITY_KV.get(rateLimitKey) || "0");
            if (count >= 5) {
                return new Response("Too Many Requests", { status: 429 });
            }
            await env.COMMUNITY_KV.put(rateLimitKey, (count + 1).toString(), { expirationTtl: 60 });

            const authHeader = request.headers.get("Authorization");
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                return new Response("Unauthorized", { 
                    status: 401, 
                    headers: { "Access-Control-Allow-Origin": "*" } 
                });
            }

            // Simple token validation (in production, verify JWT)
            const token = authHeader.split(" ")[1];
            
            // Verify JWT using the same secret as members-worker
            const encoder = new TextEncoder();
            const key = await crypto.subtle.importKey(
                "raw",
                encoder.encode(env.JWT_SECRET),
                { name: "HMAC", hash: "SHA-256" },
                false,
                ["verify"]
            );

            const [header, payload, signature] = token.split(".");
            const isValid = await crypto.subtle.verify(
                "HMAC",
                key,
                Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)),
                encoder.encode(`${header}.${payload}`)
            );

            if (!isValid) {
                return new Response("Unauthorized", { 
                    status: 401, 
                    headers: { "Access-Control-Allow-Origin": "*" } 
                });
            }
            
            // Decode payload to get username
            const payloadData = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
            const author = payloadData.username;
            const provider = payloadData.provider;

            // Check if user is blocked
            const blockedUsers = JSON.parse(await env.COMMUNITY_KV.get("blocked_users") || "[]");
            if (blockedUsers.includes(`${provider}:${author}`)) {
                return new Response("Forbidden", { status: 403 });
            }
            
            // Validate content length
            const data = await request.json();
            if (!data.content || data.content.length > 1000) {
                return new Response("Invalid content", { status: 400 });
            }
            const content = `${data.content} #report:${provider}:${author}`;
            const messages = JSON.parse(await env.COMMUNITY_KV.get("messages") || "[]");
            messages.unshift({
                author: author,
                provider: provider,
                content: content,
                timestamp: new Date().toISOString()
            });
            await env.COMMUNITY_KV.put("messages", JSON.stringify(messages.slice(0, 20)));
            
            // Post to Discord
            await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
                method: 'POST',
                headers: { 
                    "Authorization": `Bot ${env.DISCORD_TOKEN}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ content: `**${content}` })
            });

            return new Response(JSON.stringify({ success: true }), {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        if (request.method === "PUT" && request.url.endsWith("/report")) {
            const data = await request.json();
            // Log report to KV
            await env.COMMUNITY_KV.put(`report:${data.provider}:${data.username}:${Date.now()}`, JSON.stringify({
                provider: data.provider,
                username: data.username,
                reason: data.reason,
                timestamp: new Date().toISOString()
            }));

            // Block the reported user
            const blockedUsers = JSON.parse(await env.COMMUNITY_KV.get("blocked_users") || "[]");
            const blockedKey = `${data.provider}:${data.username}`;
            if (!blockedUsers.includes(blockedKey)) {
                blockedUsers.push(blockedKey);
                await env.COMMUNITY_KV.put("blocked_users", JSON.stringify(blockedUsers));
            }

            return new Response(JSON.stringify({ success: true }), {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        return new Response("Not Found", { status: 404 });
    },

    async scheduled(event, env, ctx) {
        const response = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/messages?limit=20`, {
            headers: { "Authorization": `Bot ${env.DISCORD_TOKEN}` }
        });
        
        if (response.ok) {
            const messages = await response.json();
            const formatted = messages.map(m => ({
                author: m.author.username,
                content: m.content + m.embeds.filter(e=>e.video).map(v=>`\n![](${v.video.url})`).join(' ') + m.attachments.map((a)=>`\n![](${a.url})`).join(' '),
                timestamp: m.timestamp
            }));
            await env.COMMUNITY_KV.put("messages", JSON.stringify(formatted));
        }
    }
};
