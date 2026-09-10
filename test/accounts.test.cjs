const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createPrivateStore } = require('../private-store');
const { publicAddress, remoteJson } = require('../remote-json');

test('private addresses are rejected before any connection', async () => {
  for (const ip of ['127.0.0.1', '10.1.1.1', '169.254.169.254', '192.168.1.1', '172.16.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  await assert.rejects(remoteJson('https://127.0.0.1'), /público/);
  await assert.rejects(remoteJson('http://example.com'), /HTTPS/);
});

test('legacy import targets an explicit account and never overwrites private data', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-import-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createPrivateStore(root);
  const owner = crypto.randomUUID(), other = crypto.randomUUID();
  store.write(path.join(root, 'accounts.enc'), { users: [{ id: owner, username: 'owner' }, { id: other, username: 'other' }], sessions: {} });
  fs.writeFileSync(path.join(root, '.agenda-config.json'), JSON.stringify({ alcateia: { username: 'legacy', password: 'legacy-test-password' } }));
  const env = { ...process.env, DATA_DIR: root };
  for (const name of ['BROS', 'CHIEFS', 'ALCATEIA', 'NEXUS', 'SKYVOLK']) { env[name + '_USERNAME'] = ''; env[name + '_PASSWORD'] = ''; }
  const run = (username) => spawnSync(process.execPath, [path.join(__dirname, '../scripts/import-legacy.cjs'), username], { env, encoding: 'utf8' });
  assert.equal(run('missing').status, 1);
  assert.equal(run('owner').status, 0);
  const file = path.join(root, 'users', owner, 'agenda.enc');
  assert.equal(store.read(file, {}).alcateia.username, 'legacy');
  assert.ok(!fs.existsSync(path.join(root, 'users', other, 'agenda.enc')));
  assert.equal(run('owner').status, 1);
  assert.ok(fs.existsSync(path.join(root, '.agenda-config.json')));
  const encrypted = JSON.parse(fs.readFileSync(file));
  const tag = Buffer.from(encrypted.tag, 'base64'); tag[0] ^= 1; encrypted.tag = tag.toString('base64');
  fs.writeFileSync(file, JSON.stringify(encrypted));
  assert.throws(() => store.read(file, {}));
});

test('accounts, agendas, Kick and sessions remain isolated across requests and restart', { timeout: 30000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-accounts-'));
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  let child; let base;
  async function start() {
    child = spawn(process.execPath, ['--require', path.join(__dirname, 'remote-fixture.cjs'), path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: '0', DATA_DIR: root, APP_ORIGIN: 'http://agenda.test', NODE_ENV: 'test', BROS_USERNAME: 'legacy-owner', BROS_PASSWORD: 'legacy-secret', KICK_CLIENT_ID: 'test', KICK_CLIENT_SECRET: 'test-secret', KICK_REDIRECT_URI: 'http://agenda.test/api/kick/callback', TEST_PUBLIC_KEY: keys.publicKey.export({ type: 'spki', format: 'pem' }) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let error = ''; child.stderr.on('data', (data) => { error += data; });
    await new Promise((resolve, reject) => {
      child.once('exit', () => reject(new Error(error || 'Server exited')));
      child.stdout.on('data', (data) => { const port = /localhost:(\d+)/.exec(String(data))?.[1]; if (port) { base = 'http://localhost:' + port; resolve(); } });
    });
  }
  async function stop() { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
  t.after(async () => { await stop(); fs.rmSync(root, { recursive: true, force: true }); });
  async function call(route, cookie, body, method = body ? 'POST' : 'GET', extraHeaders = {}) {
    const response = await fetch(base + route, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders }, ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
  }
  await start();
  for (const route of ['/api/agenda-config', '/api/schedule', '/api/kick/status', '/api/kick/history', '/api/kick/analytics']) assert.equal((await call(route)).status, 401);
  assert.match((await call('/')).data, /authForm/);
  const [alice, bob] = await Promise.all(['alice', 'bob'].map((username) => call('/api/auth/register', null, { username, password: 'test-password-123' }, 'POST', { origin: base.replace('http:', 'https:'), 'sec-fetch-site': 'same-origin', 'x-forwarded-proto': 'https' })));
  assert.equal(alice.status, 200); assert.equal(bob.status, 200);
  assert.notEqual(alice.data.user.id, bob.data.user.id);
  assert.match(alice.headers.get('set-cookie'), /HttpOnly/);
  assert.match((await call('/', alice.cookie)).data, /session.js/);
  assert.equal((await call('/session.js')).status, 200);
  assert.deepEqual((await call('/api/agenda-config', alice.cookie)).data, []);
  assert.deepEqual((await call('/api/agenda-config', bob.cookie)).data, []);
  assert.equal((await call('/api/agenda-config', alice.cookie, {}, 'POST', { origin: 'https://evil.example' })).status, 403);
  const [a, b] = await Promise.all([
    call('/api/agenda-config', alice.cookie, { platformId: 'new', url: 'https://skyvolk.com', username: 'alice', password: 'private-alice-secret', name: 'Alice community' }),
    call('/api/agenda-config', bob.cookie, { platformId: 'new', url: 'https://skyvolk.com', username: 'bob', name: 'Bob community' })
  ]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const [sa, sb] = await Promise.all([call('/api/schedule', alice.cookie), call('/api/schedule', bob.cookie)]);
  assert.equal(sa.data.events.length, 2); assert.equal(sb.data.events.length, 2);
  assert.ok(sa.data.events.every((item) => item.title === 'alice'));
  assert.ok(sa.data.events.every((item) => item.start.endsWith('T13:00:00.000Z')), '10h in Brazil must not change with the hosting timezone');
  assert.ok(sb.data.events.every((item) => item.title === 'bob'));
  assert.equal((await call('/api/agenda-config/' + a.data.id, bob.cookie, null, 'DELETE')).status, 400);
  assert.equal((await call('/api/agenda-config', bob.cookie, { platformId: a.data.id, url: 'https://skyvolk.com', username: 'bob' })).status, 400);
  assert.ok(!JSON.stringify((await call('/api/agenda-config', alice.cookie)).data).includes('private-alice-secret'));
  const agendaFile = path.join(root, 'users', alice.data.user.id, 'agenda.enc');
  assert.ok(!fs.readFileSync(agendaFile, 'utf8').includes('private-alice-secret'));
  await stop();
  const store = createPrivateStore(root);
  for (const [account, name, broadcasterId] of [[alice, 'alice', '111'], [bob, 'bob', '222']]) {
    store.write(path.join(root, 'users', account.data.user.id, 'kick.enc'), { accessToken: 'token-' + name, refreshToken: 'refresh-' + name, broadcasterId, expiresAt: Date.now() + 3600000 });
  }
  await start();
  assert.equal((await call('/api/auth/me', alice.cookie)).data.user.username, 'alice');
  assert.equal((await call('/api/agenda-config', bob.cookie)).data[0].name, 'Bob community');
  const [ka, kb] = await Promise.all([call('/api/kick/status', alice.cookie), call('/api/kick/status', bob.cookie)]);
  assert.equal(ka.data.user.username, 'alice-kick'); assert.equal(kb.data.user.username, 'bob-kick');
  const raw = JSON.stringify({ broadcaster: { user_id: 111 }, sender: { user_id: 42, username: 'viewer' } });
  const timestamp = new Date().toISOString(), id = 'test-message';
  const signature = crypto.sign('sha256', Buffer.from(id + '.' + timestamp + '.' + raw), keys.privateKey).toString('base64');
  const headers = { 'kick-event-message-id': id, 'kick-event-message-timestamp': timestamp, 'kick-event-signature': signature, 'kick-event-type': 'chat.message.sent' };
  assert.equal((await call('/api/kick/webhook', null, raw, 'POST', headers)).status, 200);
  await call('/api/kick/webhook', null, raw, 'POST', headers);
  assert.equal((await call('/api/kick/analytics', alice.cookie)).data.chat.total, 1);
  assert.equal((await call('/api/kick/analytics', bob.cookie)).data.chat.total, 0);
  const oauth = await call('/api/kick/login', alice.cookie);
  const state = new URL(oauth.headers.get('location')).searchParams.get('state');
  const cross = await call('/api/kick/callback?code=fake&state=' + state, bob.cookie + '; ' + oauth.cookie);
  assert.equal(cross.headers.get('location'), '/?kick=error');
  assert.equal((await call('/api/auth/login', null, { username: 'alice', password: 'wrong' })).status, 401);
  const changed = await call('/api/auth/password', alice.cookie, { username: 'alice', password: 'test-password-123', newPassword: 'changed-password-123' });
  assert.equal(changed.status, 200);
  assert.equal((await call('/api/auth/me', alice.cookie)).status, 401);
  assert.equal((await call('/api/auth/me', bob.cookie)).status, 200);
  await call('/api/auth/logout', changed.cookie, {});
  assert.equal((await call('/api/auth/me', changed.cookie)).status, 401);
});
