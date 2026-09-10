const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isLaPlata, loadLaPlata } = require('../la-plata');
const platform = { id: 'custom-test', name: 'La Plata', color: '#abc123' };
function fixture(rows = [], options = {}) {
  const calls = [];
  const request = async (input, init = {}) => {
    const url = new URL(input); calls.push({ url, init });
    if (url.pathname === '/config.js') return 'window.SUPABASE_URL = "https://example.supabase.co"; window.SUPABASE_ANON_KEY = "public-test-key";';
    if (url.pathname.endsWith('/login_email')) { assert.deepEqual(JSON.parse(init.body), { p_username: 'member' }); return options.missingUser ? null : 'member@example.test'; }
    if (url.pathname.endsWith('/token')) {
      assert.deepEqual(JSON.parse(init.body), { email: 'member@example.test', password: 'test-password' });
      if (options.invalidPassword) throw Object.assign(new Error('HTTP 400'), { status: 400 });
      return { access_token: 'private-test-token', user: { id: 'authenticated-id' } };
    }
    assert.equal(init.headers.authorization, 'Bearer private-test-token');
    if (url.pathname.endsWith('/streamers')) {
      assert.equal(url.searchParams.get('user_id'), 'eq.authenticated-id');
      return [{ username: 'canonical-member', display_name: 'My name' }];
    }
    assert.equal(url.pathname, '/rest/v1/slot_reservations');
    assert.equal(url.searchParams.get('username'), 'eq.canonical-member');
    assert.equal(url.searchParams.get('status'), 'eq.active');
    assert.deepEqual(url.searchParams.getAll('slot_date'), ['gte.2026-09-07', 'lt.2026-09-21']);
    return rows.slice(Number(url.searchParams.get('offset')), Number(url.searchParams.get('offset')) + 1000);
  };
  return { request, calls };
}
const row = (id, overrides = {}) => ({ id, username: 'canonical-member', slot_date: '2026-09-09', slot_hour: 22, slot_tela: 2, status: 'active', ...overrides });

test('La Plata recognizes site links and imports only own active reservations in Brazil time', async () => {
  for (const link of ['https://laplata-web.pages.dev', 'https://laplata-web.pages.dev/dashboard', 'https://laplata-web.pages.dev/reservar.html']) assert.equal(isLaPlata(link), true);
  assert.equal(isLaPlata('https://laplata-web.pages.dev.evil.example'), false);
  const f = fixture([row(1), row(1), row(2, { username: 'other' }), row(3, { status: 'cancelled' }), row(4, { slot_date: '2026-09-21' }), row(5, { slot_hour: 24 })]);
  const result = await loadLaPlata(platform, ' Member ', 'test-password', '2026-09-07', f.request);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].start, '2026-09-10T01:00:00.000Z');
  assert.equal(result.events[0].end, '2026-09-10T02:00:00.000Z');
  assert.equal(result.events[0].notes, 'Tela 2');
  assert.equal(result.adapter.kind, 'la-plata');
  for (const secret of ['test-password', 'private-test-token', 'member@example.test']) assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(f.calls.filter(({ init }) => init.method === 'POST').every(({ url }) => ['/rest/v1/rpc/login_email', '/auth/v1/token'].includes(url.pathname)));
});

test('La Plata handles empty schedules, pagination and login errors', async () => {
  const empty = await loadLaPlata(platform, 'member', 'test-password', '2026-09-07', fixture().request);
  assert.equal(empty.status, 'ok'); assert.equal(empty.events.length, 0);
  const paged = await loadLaPlata(platform, 'member', 'test-password', '2026-09-07', fixture(Array.from({ length: 1001 }, (_, index) => row(index))).request);
  assert.equal(paged.events.length, 1001);
  await assert.rejects(loadLaPlata(platform, 'member', '', '2026-09-07', fixture().request), /Informe sua senha/);
  await assert.rejects(loadLaPlata(platform, 'member', 'test-password', '2026-09-07', fixture([], { missingUser: true }).request), /Usuário não encontrado/);
  await assert.rejects(loadLaPlata(platform, 'member', 'test-password', '2026-09-07', fixture([], { invalidPassword: true }).request), /recusou o login/);
});
