const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sameOrigin } = require('../request-origin');
const request = (headers) => ({ headers, socket: {} });

test('Railway HTTPS registration works with missing or stale APP_ORIGIN', () => {
  const req = request({ origin: 'https://agenda.up.railway.app', host: 'agenda.up.railway.app', 'sec-fetch-site': 'same-origin', 'x-forwarded-proto': 'https' });
  for (const APP_ORIGIN of ['', 'http://localhost:3000', 'invalid-url', 'https://old.example']) {
    assert.equal(sameOrigin(req, { APP_ORIGIN }), true);
    assert.equal(sameOrigin(request({ origin: req.headers.origin }), { APP_ORIGIN, RAILWAY_PUBLIC_DOMAIN: 'agenda.up.railway.app' }), true);
  }
});

test('trusted HTTPS proxy and custom domains work without accepting arbitrary origins', () => {
  const headers = { origin: 'https://agenda.example', host: 'internal:3000', 'x-forwarded-host': 'agenda.example', 'x-forwarded-proto': 'https', 'sec-fetch-site': 'same-origin' };
  assert.equal(sameOrigin(request(headers), { RAILWAY_SERVICE_ID: 'service', APP_ORIGIN: 'http://localhost:3000' }), true);
  assert.equal(sameOrigin(request(headers), { TRUST_PROXY: '1' }), true);
  assert.equal(sameOrigin(request(headers), {}), false);
  assert.equal(sameOrigin(request({ ...headers, origin: 'https://evil.example' }), { RAILWAY_SERVICE_ID: 'service' }), false);
});

test('cross-site, sibling domains, opaque origins and forged forwarded headers stay blocked', () => {
  const env = { APP_ORIGIN: 'https://agenda.example' };
  for (const site of ['cross-site', 'same-site', undefined]) {
    assert.equal(sameOrigin(request({ origin: 'https://evil.example', host: 'agenda.example', 'sec-fetch-site': site }), env), false);
  }
  assert.equal(sameOrigin(request({ origin: 'https://agenda.example', host: 'agenda.example', 'sec-fetch-site': 'cross-site' }), env), false);
  for (const origin of ['null', 'file:///tmp/a', 'invalid', 'https://user:pass@agenda.example']) assert.equal(sameOrigin(request({ origin, host: 'agenda.example', 'sec-fetch-site': 'same-origin' }), env), false);
  assert.equal(sameOrigin(request({ origin: 'https://evil.example', host: 'agenda.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }), {}), false);
  assert.equal(sameOrigin(request({ origin: 'http://localhost:3000', host: 'localhost:3000' }), {}), true);
});
