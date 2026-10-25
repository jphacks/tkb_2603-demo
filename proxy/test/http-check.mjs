// 別ターミナルで npm run dev:test を起動してから実行。実際のDOで枠の競合を検証する。
import assert from 'node:assert/strict';
const origin = 'http://127.0.0.1:8788';
const post = (id, body = { userText: 'synthetic test', assistantText: 'synthetic response', previousTask: '' }) => fetch(`${origin}/classify`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-Hitoiki-Install-Id': id }, body: JSON.stringify(body),
});
assert.equal((await fetch(`${origin}/health`)).status, 200);
const id = crypto.randomUUID();
assert.equal((await post(id)).status, 200);
assert.equal((await post(id)).status, 200);
assert.equal((await post(id)).status, 429);
const results = await Promise.all(Array.from({ length: 12 }, () => post(crypto.randomUUID())));
assert.equal(results.filter((response) => response.status === 200).length, 3);
assert.equal(results.filter((response) => response.status === 429).length, 9);
assert.ok(Number(results.find((r) => r.status === 429).headers.get('Retry-After')) > 0);
console.log('Local Worker + SQLite Durable Object: per-install cap, shared cap and concurrent reservations passed.');
