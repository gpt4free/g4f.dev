// Debug the two failing cases
import worker from '../../workers/pollinations.js';
import orHandler from '../../api/openrouter.js';

const okBody = (text) => JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] });
const textModels = { data: [
  { name: 'best-free', paid_only: false, pricing: { promptTextTokens: 0, completionTextTokens: 0 }, health: { success_rate: 99.9 } },
]};
globalThis.fetch = async (url, init) => {
  const u = String(url);
  console.log('  [fetch]', u, 'model:', (() => { try { return JSON.parse(init?.body || '{}').model; } catch { return '-'; } })());
  if (u.includes('/text/models')) return new Response(JSON.stringify(textModels), { status: 200 });
  if (u.includes('/chat/completions')) return new Response('data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
  return new Response('[]', { status: 200 });
};

const env = { POLLINATIONS_API_KEY: 'sk-default' };
let res = await worker.fetch(new Request('https://polli.g4f.dev/v1/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hi' }], stream: true })
}), env, {});
console.log('pollinations streaming: status =', res.status, 'content-type =', res.headers.get('content-type'));

// openrouter user key passthrough
const orModels = { data: [{ id: 'openai/gpt-4o', pricing: { prompt: '0.001', completion: '0.002' } }] };
let orCalls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  let body = {};
  try { body = JSON.parse(init?.body || '{}'); } catch {}
  console.log('  [or fetch]', init?.method, u, 'model:', body.model);
  if (u.endsWith('/models')) return new Response(JSON.stringify(orModels), { status: 200 });
  orCalls.push(body.model);
  return new Response(okBody('user key passthrough'), { status: 200 });
};
process.env.OPENROUTER_API_KEY = 'sk-or-default';
res = await orHandler(new Request('https://open.g4f.dev/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-user' },
  body: JSON.stringify({ model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
}), {}, {});
const data = await res.json();
console.log('openrouter user key: status =', res.status, 'calls =', orCalls, 'content =', data.choices?.[0]?.message?.content);
