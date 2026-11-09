import assert from "node:assert/strict";

import pollinationsWorker from "./pollinations.js";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalError = console.error;

async function runScheduled(env) {
  let task;
  await pollinationsWorker.scheduled(
    { scheduledTime: Date.now() },
    env,
    {
      waitUntil(value) {
        task = Promise.resolve(value);
      }
    }
  );
  assert.ok(task, "scheduled should hand the budget job to waitUntil");
  return task;
}

try {
  {
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ pollenBalance: 0.25 });
    };

    const result = await runScheduled({
      POLLINATIONS_ACCOUNT_KEY: "sk_admin",
      POLLINATIONS_KEY_ID: "key_1",
      POLLINATIONS_MIN_POLLEN_BUDGET: "0.25"
    });

    assert.equal(result.ok, true, "a successful update should report ok");
    assert.equal(requests.length, 1, "the cron should make exactly one request");
    assert.equal(
      requests[0].url,
      "https://gen.pollinations.ai/account/keys/key_1",
      "the cron should update the configured key"
    );
    assert.equal(requests[0].init.method, "PATCH");
    assert.equal(requests[0].init.headers.authorization, "Bearer sk_admin");
    assert.deepEqual(
      JSON.parse(requests[0].init.body),
      { pollenBudget: 0.25 },
      "the cron should write the configured minimum pollen budget"
    );
  }

  {
    let warning = "";
    let error = "";
    console.warn = (message) => {
      warning += String(message);
    };
    console.error = (message) => {
      error += String(message);
    };
    globalThis.fetch = async () =>
      Response.json(
        { error: "API key does not have 'account:keys' permission" },
        { status: 403 }
      );

    const result = await runScheduled({
      POLLINATIONS_ACCOUNT_KEY: "sk_admin",
      POLLINATIONS_KEY_ID: "key_1"
    });

    assert.equal(result.skipped, true, "a permission error should skip the run");
    assert.equal(result.status, 403);
    assert.match(
      warning,
      /account:keys/,
      "the warning should explain which permission the admin key needs"
    );
    assert.equal(
      error,
      "",
      "an expired or under-scoped credential should not be logged as a failure"
    );
  }

  {
    let warning = "";
    let fetchCalled = false;
    console.warn = (message) => {
      warning += String(message);
    };
    globalThis.fetch = async () => {
      fetchCalled = true;
      return Response.json({});
    };

    const result = await runScheduled({
      POLLINATIONS_KEY_ID: "key_1"
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "missing_credentials");
    assert.equal(fetchCalled, false, "without a credential the cron should not call the API");
    assert.match(warning, /skipping key budget update/);
  }

  console.log("Pollinations key budget cron test passed.");
} finally {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  console.error = originalError;
}
