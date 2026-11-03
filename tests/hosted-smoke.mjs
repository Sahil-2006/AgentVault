// Run with: node tests/hosted-smoke.mjs https://your-deployment.example
// Creates one private simulation workspace; never calls payment providers.
import assert from 'node:assert/strict';
const origin = new URL(process.argv[2]).origin;
let cookie = '', csrf = '';
async function call(path, body, expected = 200) {
  const response = await fetch(origin + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  assert.equal(response.status, expected, value.error || path);
  const session = response.headers.get('set-cookie');
  if (session) cookie = session.split(';')[0];
  if (value.csrf) csrf = value.csrf;
  return value;
}
assert.equal((await call('/health')).status, 'ok');
await call('/auth/demo', {}, 201);
const before = await call('/overview');
assert.equal(before.user.isDemo, true);
const payment = before.requests.find(r => r.state === 'AWAITING_APPROVAL');
assert.equal(payment.simulated, true);
await call(`/requests/${payment.id}/decision`, { approve: true });
assert.equal((await call(`/requests/${payment.id}/checkout`, {})).simulated, true);
assert.equal((await call(`/requests/${payment.id}/capture`, {})).state, 'COMPLETED');
await call(`/requests/${payment.id}/capture`, {});
const after = await call('/overview');
assert.equal(after.totals.spent, before.totals.spent + payment.amountCents);
assert.equal(after.totals.reserved, 0);
await call('/vault/pause', { paused: true });
assert.equal((await call('/overview')).user.paused, true);
await call('/auth/me');
await call('/auth/logout', {});
await call('/overview', undefined, 401);
console.log('Hosted smoke passed: database, session, approval, simulated checkout/capture, idempotency, pause and logout.');
