/**
 * Smoke test: auto/default model selection with retry on empty or
 * "User Safety: safe" responses.
 * Run: node etc/testing/test-auto-model-retry.mjs
 */
import worker from '../../workers/pollinations.js';
import openrouterHandler from '../../api/openrouter.js';

let failures = 0;
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`); if (!cond) failures++; };

// ---------------------------------------------------------------------------
// Pollinations worker
// ---------------------------------------------------------------------------
const textModels = { data: [
  { name: 'best-free', paid_only: false, pricing: { promptTextTokens: 0, completionTextTokens: 0 }, health: { success_rate: 99.9 } },
  { name: 'second-free', paid_only: false, pricing: { promptTextTokens: 0, completionTextTokens: 0 }, health: { success_rate: 90.0 } },
  { name: 'third-free', paid_only: false, pricing: { promptTextTokens: 0, completionTextTokens: 0 }, health: { success_rate: 80.0 } },
  { name: 'fourth-free', paid_only: false, pricing: { promptTextTokens: 0, completionTextTokens: 0 }, health: { success_rate: 70.0 } },
  { name: 'fifth-free', paid_only: false, pricing: { promptTextTokens: 0, completionTextTokens: 0 }, health: { success_rate: 60.0 } },
  { name: 'paid-model', paid_only: false, pricing: { promptTextTokens: 0.001, completionTextTokens: 0.002 }, health: { success_rate: 100 } },
  { name: 'agent-model', agent: true, paid_only: false, pricing: { promptTextTokens: 0, completionTextTokens: 0 }, health: { success_rate: 100 } },
]};
const imageModels = [
  { name: 'flux', paid_only: false, pricing: { completionImageTokens: 0 }, health: { success_rate: 100 } },
];
const FREE_REGISTRY = ['best-free', 'second-free', 'third-free', 'fourth-free', 'fifth-free', 'flux'];

const okBody = (text) => JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] });
const SAFETY = 'User Safety: safe';

let upstreamBodies = [];   // model names sent upstream per request
let upstreamResponses = []; // queue of {status, body} per upstream call

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/text/models')) return new Response(JSON.stringify(textModels), { status: 200 });
  if (u.includes('/image/models')) return new Response(JSON.stringify(imageModels), { status: 200 });
  if (u.includes('balance')) return new Response(JSON.stringify({ balance: 100 }), { status: 200 });
  if (u.includes('/chat/completions')) {
    let body = {};
    try { body = JSON.parse(init?.body || '{}'); } catch (e) {}
    upstreamBodies.push(body.model);
    const next = upstreamResponses.shift() || { status: 200, body: okBody('fallback ok') };
    return new Response(next.body, { status: next.status });
  }
  if (u.includes('/images/generations')) {
    return new Response(JSON.stringify({ created: 1, data: [{ url: 'data:image/png;base64,x' }] }), { status: 200 });
  }
  return new Response(JSON.stringify(FREE_REGISTRY), { status: 200 });
};

const env = { POLLINATIONS_API_KEY: 'sk-default' };
const chatReq = (model, extra = {}) => new Request('https://polli.g4f.dev/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], ...extra })
});

// 1. auto model: empty {} response on first model -> retry -> success on second
upstreamBodies = [];
upstreamResponses = [
  { status: 200, body: '{}' },
  { status: 200, body: okBody('hello from second') },
];
let res = await worker.fetch(chatReq('auto'), env, {});
let data = await res.json();
check('auto: empty {} retried, success on 2nd model', res.status === 200 && data.choices?.[0]?.message?.content === 'hello from second');
check('auto: tried best-free then second-free', upstreamBodies[0] === 'best-free' && upstreamBodies[1] === 'second-free');

// 2. auto model: "User Safety: safe" stub retried
upstreamBodies = [];
upstreamResponses = [
  { status: 200, body: okBody(SAFETY) },
  { status: 200, body: okBody('real answer') },
];
res = await worker.fetch(chatReq('auto'), env, {});
data = await res.json();
check('auto: User Safety stub retried, success on 2nd model', res.status === 200 && data.choices?.[0]?.message?.content === 'real answer');

// 3. auto model: first model succeeds -> no retry
upstreamBodies = [];
upstreamResponses = [{ status: 200, body: okBody('first try works') }];
res = await worker.fetch(chatReq('auto'), env, {});
data = await res.json();
check('auto: success on first model, no retry', res.status === 200 && data.choices?.[0]?.message?.content === 'first try works' && upstreamBodies.length === 1);

// 4. auto model: missing model field behaves like auto
upstreamBodies = [];
upstreamResponses = [{ status: 200, body: okBody('no model given') }];
res = await worker.fetch(new Request('https://polli.g4f.dev/v1/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
}), env, {});
check('auto: missing model field uses best free model', res.status === 200 && upstreamBodies[0] === 'best-free');

// 5. auto model: all 4 candidates fail -> last response returned
upstreamBodies = [];
upstreamResponses = [
  { status: 200, body: '{}' },
  { status: 200, body: okBody(SAFETY) },
  { status: 500, body: '{"error":"upstream"}' },
  { status: 200, body: okBody(SAFETY) },
];
res = await worker.fetch(chatReq('auto'), env, {});
data = await res.json();
check('auto: exhaustion after 4 models returns last response', res.status === 200 && upstreamBodies.length === 4 && data.choices?.[0]?.message?.content === SAFETY);

// 6. explicit model: failure retries with other free models
upstreamBodies = [];
upstreamResponses = [
  { status: 200, body: '{}' },
  { status: 200, body: okBody('recovered') },
];
res = await worker.fetch(chatReq('third-free'), env, {});
data = await res.json();
check('explicit model: retried with fallbacks after empty response', res.status === 200 && data.choices?.[0]?.message?.content === 'recovered');
check('explicit model: requested model tried first', upstreamBodies[0] === 'third-free');

// 7. explicit model: success -> no retry, model passed through
upstreamBodies = [];
upstreamResponses = [{ status: 200, body: okBody('direct') }];
res = await worker.fetch(chatReq('second-free'), env, {});
data = await res.json();
check('explicit model: success passes model upstream unchanged', upstreamBodies.length === 1 && upstreamBodies[0] === 'second-free');

// 8. auth errors (401) are not retried
upstreamBodies = [];
upstreamResponses = [{ status: 401, body: '{"error":"unauthorized"}' }];
res = await worker.fetch(chatReq('auto'), env, {});
check('auto: 401 upstream returned immediately without retry', res.status === 401 && upstreamBodies.length === 1);

// 9. streaming requests skip content validation (passthrough)
upstreamBodies = [];
upstreamResponses = [{ status: 200, body: 'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n' }];
res = await worker.fetch(chatReq('auto', { stream: true }), env, {});
check('auto: streaming response passed through without retry', res.status === 200 && upstreamBodies.length === 1);

// 10. paid model still blocked with default key (unchanged behavior)
res = await worker.fetch(chatReq('paid-model'), env, {});
check('paid model still blocked with default key', res.status === 404);

// 11. agent model still blocked (unchanged behavior)
res = await worker.fetch(chatReq('agent-model'), env, {});
check('agent model still blocked', res.status === 404);

// ---------------------------------------------------------------------------
// OpenRouter proxy
// ---------------------------------------------------------------------------
const orModels = { data: [
  { id: 'openrouter/free', pricing: { prompt: 0, completion: 0 } },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0' } },
  { id: 'google/gemini-2.0-flash-exp:free', pricing: { prompt: '0', completion: '0' } },
  { id: 'qwen/qwen-2.5-72b-instruct:free', pricing: { prompt: '0', completion: '0' } },
  { id: 'openai/gpt-4o', pricing: { prompt: '0.001', completion: '0.002' } },
]};

let orCalls = [];
let orResponses = [];

const readBody = async (body) => {
  if (!body) return '{}';
  if (typeof body === 'string') return body;
  if (body instanceof ReadableStream) return await new Response(body).text();
  return String(body);
};

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.endsWith('/models')) return new Response(JSON.stringify(orModels), { status: 200 });
  if (u.endsWith('/chat/completions')) {
    let body = {};
    try { body = JSON.parse(await readBody(init?.body)); } catch (e) {}
    orCalls.push(body.model);
    const next = orResponses.shift() || { status: 200, body: okBody('or fallback') };
    return new Response(next.body, { status: next.status });
  }
  return new Response('{}', { status: 404 });
};

process.env.OPENROUTER_API_KEY = 'sk-or-default';

const orReq = (model) => new Request('https://open.g4f.dev/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] })
});

// 12. openrouter/free: safety stub -> retry with concrete free models
orCalls = [];
orResponses = [
  { status: 200, body: okBody(SAFETY) },
  { status: 200, body: okBody('or recovered') },
];
res = await openrouterHandler(orReq('openrouter/free'), {}, {});
data = await res.json();
check('openrouter: free router safety stub retried', res.status === 200 && data.choices?.[0]?.message?.content === 'or recovered');
check('openrouter: router tried first, then concrete free model', orCalls[0] === 'openrouter/free' && orCalls[1] === 'meta-llama/llama-3.3-70b-instruct:free');

// 13. no model: auto-routes to openrouter/free
orCalls = [];
orResponses = [{ status: 200, body: okBody('or auto') }];
res = await openrouterHandler(new Request('https://open.g4f.dev/v1/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
}), {}, {});
data = await res.json();
check('openrouter: missing model routes to openrouter/free', res.status === 200 && data.choices?.[0]?.message?.content === 'or auto' && orCalls[0] === 'openrouter/free');

// 14. success on first attempt: no retry
orCalls = [];
orResponses = [{ status: 200, body: okBody('or direct') }];
res = await openrouterHandler(orReq('openrouter/free'), {}, {});
check('openrouter: success on first attempt, no retry', orCalls.length === 1 && orCalls[0] === 'openrouter/free');

// 15. exhaustion: last response returned
orCalls = [];
orResponses = [
  { status: 200, body: okBody(SAFETY) },
  { status: 200, body: '{}' },
  { status: 200, body: okBody(SAFETY) },
  { status: 200, body: okBody('last resort') },
];
res = await openrouterHandler(orReq('auto'), {}, {});
data = await res.json();
check('openrouter: exhaustion returns 4th model response', res.status === 200 && orCalls.length === 4 && data.choices?.[0]?.message?.content === 'last resort');

// 16. user key bypasses auto routing (passthrough)
orCalls = [];
orResponses = [{ status: 200, body: okBody('user key passthrough') }];
res = await openrouterHandler(new Request('https://open.g4f.dev/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-user' },
  body: JSON.stringify({ model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
}), {}, {});
data = await res.json();
check('openrouter: user key bypasses auto routing', orCalls.length === 1 && orCalls[0] === 'openai/gpt-4o' && data.choices?.[0]?.message?.content === 'user key passthrough');

// 17. /v1/quota maps to upstream /key with the resolved key
let quotaCalls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  quotaCalls.push({ url: u, auth: init?.headers?.get?.('Authorization') ?? init?.headers?.Authorization });
  if (u.endsWith('/key')) {
    return new Response(JSON.stringify({ data: { label: 'k', usage: 0.5, limit: null } }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};
res = await openrouterHandler(new Request('https://open.g4f.dev/v1/quota'), {}, {});
data = await res.json();
check('openrouter: /v1/quota maps to /key with default key', quotaCalls[0]?.url === 'https://openrouter.ai/api/v1/key' && quotaCalls[0]?.auth === 'Bearer sk-or-default' && data.data?.usage === 0.5);

quotaCalls = [];
res = await openrouterHandler(new Request('https://open.g4f.dev/v1/quota', { headers: { Authorization: 'Bearer sk-user' } }), {}, {});
check('openrouter: /v1/quota forwards user key', quotaCalls[0]?.url === 'https://openrouter.ai/api/v1/key' && quotaCalls[0]?.auth === 'Bearer sk-user');

if (failures > 0) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nAll auto-model retry tests passed.');
