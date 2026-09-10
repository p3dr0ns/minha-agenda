const crypto = require('node:crypto');
const path = require('node:path');
const { promisify } = require('node:util');
const { sameOrigin } = require('./request-origin');
const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function createAccounts(root, store) {
  const file = path.join(root, 'accounts.enc');
  const db = store.read(file, { users: [], sessions: {} });
  const attempts = new Map();
  let hashing = 0;
  const save = () => store.write(file, db);
  const digest = (token) => crypto.createHash('sha256').update(token).digest('hex');
  const publicUser = ({ id, username }) => ({ id, username });
  const cookie = (token, req, age = SESSION_MS / 1000) => `agenda_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${process.env.NODE_ENV === 'production' || process.env.APP_ORIGIN?.startsWith('https://') || req.socket.encrypted ? '; Secure' : ''}`;
  function current(req) {
    const token = /(?:^|;\s*)agenda_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const session = token && db.sessions[digest(token)];
    if (!session || session.expiresAt <= Date.now()) return null;
    return db.users.find((user) => user.id === session.userId) || null;
  }
  function json(res, status, data) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  async function readBody(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) throw new Error('Dados muito longos.');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async function handle(req, res) {
    if (req.url === '/api/auth/me' && req.method === 'GET') {
      const user = current(req);
      json(res, user ? 200 : 401, user ? { user: publicUser(user) } : { error: 'Entre na sua conta.' }); return;
    }
    if (req.method !== 'POST' || !['/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/auth/password'].includes(req.url)) return json(res, 404, { error: 'Página não encontrada.' });
    if (!sameOrigin(req)) return json(res, 403, { error: 'Origem não autorizada.' });
    if (req.url === '/api/auth/logout') {
      const user = current(req);
      const token = /(?:^|;\s*)agenda_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
      if (user && token) { delete db.sessions[digest(token)]; save(); }
      res.setHeader('set-cookie', cookie('', req, 0)); return json(res, 200, { ok: true });
    }
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').at(-1)?.trim();
    const ip = process.env.TRUST_PROXY === '1' && forwarded ? forwarded : req.socket.remoteAddress;
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const attempt = attempts.get(ip) || { count: 0, until: now + 15 * 60_000 };
    if (++attempt.count > 40 || hashing >= 4) return json(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
    attempts.set(ip, attempt);
    hashing++;
    try {
      const body = await readBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!/^[a-z0-9_.-]{3,40}$/.test(username) || password.length > 128) throw new Error('Use um usuário de 3 a 40 letras, números, pontos, traços ou sublinhados.');
      let user = db.users.find((item) => item.username === username);
      if (req.url === '/api/auth/register') {
        if (password.length < 10) throw new Error('Use uma senha com pelo menos 10 caracteres.');
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = (await scrypt(password, salt, 64)).toString('hex');
        if (db.users.some((item) => item.username === username)) throw new Error('Esse usuário já está em uso.');
        user = { id: crypto.randomUUID(), username, salt, hash };
        db.users.push(user);
      } else {
        const hash = await scrypt(password, user?.salt || 'invalid-user-salt', 64);
        if (!user || !crypto.timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) return json(res, 401, { error: 'Usuário ou senha incorretos.' });
        if (req.url === '/api/auth/password') {
          if (current(req)?.id !== user.id) return json(res, 401, { error: 'Entre na sua conta.' });
          const next = String(body.newPassword || '');
          if (next.length < 10 || next.length > 128) throw new Error('Use uma nova senha de 10 a 128 caracteres.');
          const salt = crypto.randomBytes(16).toString('hex');
          const hash = (await scrypt(next, salt, 64)).toString('hex');
          user.salt = salt; user.hash = hash;
          for (const [key, session] of Object.entries(db.sessions)) if (session.userId === user.id) delete db.sessions[key];
        }
      }
      for (const [key, session] of Object.entries(db.sessions)) if (session.expiresAt <= now) delete db.sessions[key];
      const ownSessions = Object.entries(db.sessions).filter(([, value]) => value.userId === user.id);
      for (const [key] of ownSessions.slice(0, Math.max(0, ownSessions.length - 9))) delete db.sessions[key];
      const token = crypto.randomBytes(32).toString('hex');
      db.sessions[digest(token)] = { userId: user.id, expiresAt: now + SESSION_MS };
      save();
      res.setHeader('set-cookie', cookie(token, req));
      json(res, 200, { user: publicUser(user) });
    } catch (error) { json(res, 400, { error: error.message || 'Não foi possível entrar.' }); }
    finally { hashing--; }
  }
  return { current, handle, sameOrigin, json, users: () => db.users.map(publicUser) };
}
module.exports = { createAccounts };
