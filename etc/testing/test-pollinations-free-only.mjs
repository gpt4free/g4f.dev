/**
 * Smoke test: pollinations worker free-only enforcement with default key.
 * Run: node etc/testing/test-pollinations-free-only.mjs
 */
import worker from '../../workers/pollinations.js';

const textModels = { data: [
  { name: 'openai-large', paid_only: false, pricing: { promptTextTokens: 0.001, completionTextTokens: 0.002 } },
  { name: 'openai-large:free', paid_only: false, pricing: { promptTextTokens: 0, completionTextTokens: 0 } },
  { name: 'qwen-coder', paid_only: true, pricing: { promptTextTokens: 0, completionTextTokens: 0 } },
]};
const imageModels = [
  { name: 'flux', paid_only: false, pricing: { completionImageTokens: 0 }, output_modalities: ['image'] },
  { name: 'flux-pro', paid_only: false, pricing: { completionImageTokens: 0.05 }, output_modalities: ['image'] },
];
const FREE_REGISTRY = ['openai-large:free', 'flux', 'gemini'];

let capturedAuth = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/text/models')) return new Response(JSON.stringify(textModels), { status: 200 });
  if (u.includes('/image/models')) return new Response(JSON.stringify(imageModels), { status: 200 });
  if (u.includes('balance')) return new Response(JSON.stringify({ balance: 100 }), { status: 200 });
  if (u.includes('/chat/completions') || u.includes('/images/generations')) {
    capturedAuth = init?.headers?.get?.('Authorization') ?? init?.headers?.Authorization ?? null;
    return new Response(JSON.stringify({ ok: true, choices: [] }), { status: 200 });
  }
  return new Response(JSON.stringify(FREE_REGISTRY), { status: 200 });
};

const env = { POLLINATIONS_API_KEY: 'sk-default' };
let failures = 0;
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`); if (!cond) failures++; };

// 1. /v1/models without key -> free only
let res = await worker.fetch(new Request('https://polli.g4f.dev/v1/models'), env, {});
let ids = (await res.json()).data.map(m => m.id);
check('models listing free-only with default key',
  ids.includes('openai-large:free') && ids.includes('flux') && !ids.includes('openai-large') && !ids.includes('flux-pro') && !ids.includes('qwen-coder'));

// 2. /v1/models with user key -> full list
res = await worker.fetch(new Request('https://polli.g4f.dev/v1/models', { headers: { Authorization: 'Bearer sk-user' } }), env, {});
ids = (await res.json()).data.map(m => m.id);
check('models listing full with user key', ids.includes('openai-large') && ids.includes('flux-pro'));

// 3. chat/completions with paid model + default key -> 404
res = await worker.fetch(new Request('https://polli.g4f.dev/v1/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'openai-large', messages: [{ role: 'user', content: 'hi' }] })
}), env, {});
check('paid chat model blocked with default key', res.status === 404);

// 4. chat/completions with free model + default key -> allowed
res = await worker.fetch(new Request('https://polli.g4f.dev/v1/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'openai-large:free', messages: [{ role: 'user', content: 'hi' }] })
}), env, {});
check('free chat model allowed with default key', res.status === 200);

// 5. chat/completions with paid model + user key -> allowed
res = await worker.fetch(new Request('https://polli.g4f.dev/v1/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-user' },
  body: JSON.stringify({ model: 'openai-large', messages: [{ role: 'user', content: 'hi' }] })
}), env, {});
check('paid chat model allowed with user key', res.status === 200);
check('user key forwarded upstream', capturedAuth === 'Bearer sk-user');

// 6. images/generations with paid model + default key -> 404
res = await worker.fetch(new Request('https://polli.g4f.dev/v1/images/generations', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'flux-pro', prompt: 'a cat' })
}), env, {});
check('paid image model blocked with default key', res.status === 404);

// 7. images/generations with free model + default key -> allowed
res = await worker.fetch(new Request('https://polli.g4f.dev/v1/images/generations', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'flux', prompt: 'a cat' })
}), env, {});
check('free image model allowed with default key', res.status === 200);

// 8. images/generations with paid model + user key -> allowed
res = await worker.fetch(new Request('https://polli.g4f.dev/v1/images/generations', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-user' },
  body: JSON.stringify({ model: 'flux-pro', prompt: 'a cat' })
}), env, {});
check('paid image model allowed with user key', res.status === 200);

if (failures > 0) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nAll free-only tests passed.');
