import assert from "node:assert/strict";

import apiWorker from "./api-worker.js";

const serverId = "srv_pollinations_refresh_fixture";
const ownerId = "user_pollinations_refresh_fixture";
const initialModels = ["auto", "sana", "respan/span-01-lite"];
const refreshedModels = ["auto", "new-free-text", "new-free-image"];
const publicServer = {
  id: serverId,
  owner_id: ownerId,
  label: "gen.pollinations.ai",
  base_url: "https://pollinations.g4f.space/free",
  allowed_models: initialModels,
  auto_update_models: true,
  is_public: true,
  is_ollama: false,
  updated_at: "2020-01-01T00:00:00.000Z"
};
const owner = {
  id: ownerId,
  custom_servers: [{ ...publicServer }]
};
const values = new Map([
  ["public_servers_index", JSON.stringify([publicServer])],
  [`server:${serverId}`, JSON.stringify(publicServer)],
  [`user:${ownerId}`, JSON.stringify(owner)]
]);
const modelRequests = [];
const quotaUrl = "https://gen.pollinations.ai/account/balance";

globalThis.fetch = async (input) => {
  const url = String(input);
  assert.equal(url, quotaUrl, "only the configured quota check should use network fetch");
  return Response.json({ balance: 10 });
};

const env = {
  MEMBERS_KV: {
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    }
  },
  PROVIDER_WORKERS: {
    pollinations: {
      async fetch(request) {
        modelRequests.push(String(request.url));
        return Response.json({
          data: refreshedModels.map((id) => ({ id }))
        });
      }
    }
  }
};

await apiWorker.scheduled(
  { scheduledTime: Date.now() },
  env,
  { waitUntil() {} }
);

assert.deepEqual(modelRequests, ["https://pollinations.g4f.space/free/models"]);
assert.deepEqual(
  JSON.parse(values.get("public_servers_index"))[0].allowed_models,
  refreshedModels,
  "scheduled refresh should update the public server index"
);
assert.deepEqual(
  JSON.parse(values.get(`user:${ownerId}`)).custom_servers[0].allowed_models,
  refreshedModels,
  "scheduled refresh should update the owner's server configuration"
);
assert.equal(
  values.has(`server:${serverId}`),
  false,
  "scheduled refresh should invalidate the cached server record"
);

console.log("Pollinations model refresh test passed.");
