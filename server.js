const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
fs.mkdirSync(DATA_DIR, { recursive: true });
const AGENDA_CONFIG_FILE = path.join(DATA_DIR, '.agenda-config.json');
const LIVE_HISTORY_FILE = path.join(DATA_DIR, '.live-history.json');
const KICK_SESSION_FILE = path.join(DATA_DIR, '.kick-session.json');
const CACHE_MS = 2 * 60 * 1000;

const defaultPlatforms = [
  { id: 'bros', name: 'Bros', color: '#ff7a45', api: 'https://api.bros-platform.com.br' },
  { id: 'chiefs', name: 'Chiefs', color: '#8b5cf6', api: 'https://api.chiefs-platform.com.br' },
  { id: 'printstream', name: 'PrintStream', color: '#14b8a6', api: 'https://api.printstream-platform.com.br' },
  { id: 'rivals', name: 'Rivals', color: '#f43f5e', api: 'https://api.rivals-platform.com.br' },
  { id: 'alcateia', name: 'Alcateia', color: '#a35fe0', api: 'https://alcateia-backend-production.up.railway.app', kind: 'grade' },
  { id: 'nexus', name: 'Nexus', color: '#2563eb', api: 'https://nexus-backend-production-be46.up.railway.app', kind: 'grade' },
  { id: 'skyvolk', name: 'SkyVolk', color: '#8b00ff', api: 'https://skyvolk.com', kind: 'auto', requiresPassword: false }
];

function configuredPlatforms({ includeAvailable = false } = {}) {
  const custom = Object.entries(agendaConfig)
    .filter(([, value]) => value?.custom)
    .map(([id, value]) => ({ id, name: value.name || 'Outra agenda', color: value.color || '#f59e0b', api: value.url, kind: 'auto', custom: true }));
  const defaults = includeAvailable ? defaultPlatforms : defaultPlatforms.filter((platform) => {
    const credentials = platformCredentials(platform);
    return Boolean(credentials.username && (platform.requiresPassword === false || credentials.password));
  });
  return [...defaults, ...custom];
}

let agendaConfig = loadAgendaConfig();

let cache = { at: 0, result: null };
let kickSession = loadKickSession();
let kickRefreshPromise = null;
let kickLastError = null;
const kickOAuthStates = new Map();
let liveHistory = loadLiveHistory();
let liveAnalytics = restoreActiveLive(liveHistory.active);
let lastHistorySave = 0;
const webhookMessageIds = new Set();
let kickPublicKey = null;
let chatSubscription = { active: false, message: 'Webhook ainda não conectado.' };
let chatSubscriptionPromise = null;
let lastChatSubscriptionAttempt = 0;

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split < 1) continue;
    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function loadAgendaConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(AGENDA_CONFIG_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function loadKickSession() {
  try {
    const session = JSON.parse(fs.readFileSync(KICK_SESSION_FILE, 'utf8'));
    return session?.accessToken && session?.refreshToken ? session : null;
  } catch { return null; }
}

function saveKickSession() {
  if (!kickSession) {
    try { fs.unlinkSync(KICK_SESSION_FILE); } catch {}
    return;
  }
  const temporary = `${KICK_SESSION_FILE}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(kickSession, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, KICK_SESSION_FILE);
}

function loadLiveHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LIVE_HISTORY_FILE, 'utf8'));
    return { active: parsed.active || null, sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
  } catch { return { active: null, sessions: [] }; }
}

function emptyLiveAnalytics() {
  return { live: false, startedAt: null, endedAt: null, title: null, category: null, samples: [], chatStartedAt: null, chatters: new Map(), totalMessages: 0 };
}

function restoreActiveLive(active) {
  if (!active?.startedAt) return emptyLiveAnalytics();
  return { ...emptyLiveAnalytics(), ...active, chatters: new Map((active.chatters || []).map((user) => [String(user.id), user])) };
}

function serializableActive() {
  if (!liveAnalytics.startedAt) return null;
  return { ...liveAnalytics, chatters: [...liveAnalytics.chatters.values()] };
}

function saveLiveHistory(force = false) {
  const now = Date.now();
  if (!force && now - lastHistorySave < 20_000) return;
  liveHistory.active = serializableActive();
  const temporary = `${LIVE_HISTORY_FILE}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(liveHistory, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, LIVE_HISTORY_FILE);
  lastHistorySave = now;
}

function liveSummary(analytics, active = false) {
  const samples = analytics.samples || [];
  const peak = samples.reduce((best, sample) => Math.max(best, Number(sample.viewers || 0)), 0);
  const average = samples.length ? Math.round(samples.reduce((sum, sample) => sum + Number(sample.viewers || 0), 0) / samples.length) : 0;
  const end = active ? Date.now() : new Date(analytics.endedAt || Date.now()).getTime();
  const durationSeconds = Math.max(0, Math.round((end - new Date(analytics.startedAt).getTime()) / 1000));
  const topChatters = [...analytics.chatters.values()].sort((a, b) => b.messages - a.messages).slice(0, 10).map(({ id, username, messages }) => ({ id, username, messages }));
  return { id: analytics.startedAt, active, startedAt: analytics.startedAt, endedAt: active ? null : analytics.endedAt, durationSeconds, title: analytics.title, category: analytics.category, peak, average, messages: analytics.totalMessages || 0, topChatters };
}

function finalizeActiveLive(endedAt = new Date().toISOString()) {
  if (!liveAnalytics.startedAt) return;
  liveAnalytics.live = false;
  liveAnalytics.endedAt = endedAt;
  const summary = liveSummary(liveAnalytics, false);
  const existing = liveHistory.sessions.findIndex((session) => session.id === summary.id);
  if (existing >= 0) liveHistory.sessions[existing] = summary;
  else liveHistory.sessions.unshift(summary);
  liveHistory.sessions = liveHistory.sessions.slice(0, 500);
  liveAnalytics = emptyLiveAnalytics();
  liveHistory.active = null;
  saveLiveHistory(true);
}

function platformCredentials(platform) {
  const saved = agendaConfig[platform.id] || {};
  const prefix = platform.id.toUpperCase();
  return {
    api: saved.url || platform.api,
    username: saved.username || process.env[`${prefix}_USERNAME`] || '',
    password: saved.password || process.env[`${prefix}_PASSWORD`] || ''
  };
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      const detail = typeof body?.data === 'string' ? body.data : '';
      const summary = body?.message || body?.error || `HTTP ${response.status}`;
      const message = detail && detail !== summary ? `${summary}: ${detail}` : summary;
      const error = new Error(String(message));
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function getPlatformSchedule(platform) {
  const { api, username, password } = platformCredentials(platform);

  if (!username || (!password && platform.kind !== 'auto')) {
    return { ...platform, status: 'not_configured', events: [], message: platform.kind === 'auto' ? 'Informe o usuário usado no site' : 'Credenciais não configuradas' };
  }

  try {
    if (platform.kind === 'auto') return await discoverPlatformSchedule(platform, api, username, password);
    const loginEndpoint = platform.kind === 'grade' ? '/auth/login' : '/admin/login';
    const login = await loginAt(api, loginEndpoint, username, password);
    const token = login?.token || login?.accessToken || login?.access_token;
    if (!token) throw new Error('A plataforma não retornou um token de acesso');

    const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
    const thisWeek = currentWeekStart();
    const nextWeekDate = new Date(`${thisWeek}T12:00:00`);
    nextWeekDate.setDate(nextWeekDate.getDate() + 7);
    const nextWeek = `${nextWeekDate.getFullYear()}-${String(nextWeekDate.getMonth() + 1).padStart(2, '0')}-${String(nextWeekDate.getDate()).padStart(2, '0')}`;
    const weeks = [thisWeek, nextWeek];

    if (platform.kind === 'grade') {
      const payloads = await Promise.all(weeks.map(async (weekStart) => ({
        weekStart,
        payload: await requestJson(`${api}/grade/${weekStart}/mine`, { headers })
      })));
      return {
        ...platform,
        status: 'ok',
        events: payloads.flatMap(({ payload, weekStart }) => normalizeGradeEvents(payload, weekStart, platform)),
        fetchedAt: new Date().toISOString()
      };
    }

    const payloads = [];
    for (const weekStart of weeks) {
      let payload;
      let lastError;
      for (const endpoint of ['/me/multiview-schedule', '/admin/multiview-schedule']) {
        try {
          payload = await requestJson(`${api}${endpoint}?weekStartDate=${encodeURIComponent(weekStart)}`, { headers });
          break;
        } catch (error) {
          lastError = error;
          if (![403, 404].includes(error.status)) throw error;
        }
      }
      if (payload === undefined) throw lastError || new Error('Agenda indisponível');
      payloads.push(payload);
    }

    return {
      ...platform,
      status: 'ok',
      events: payloads.flatMap((payload) => normalizeEvents(payload, platform)),
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Tempo de resposta excedido' : safeError(error);
    return { ...platform, status: 'error', events: [], message };
  }
}

async function loginAt(api, endpoint, username, password) {
  return requestJson(`${api}${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ username, password })
  });
}

function urlBases(input) {
  const parsed = new URL(input);
  const pathBase = `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
  return [...new Set([pathBase, parsed.origin, `${parsed.origin}/api`, `${parsed.origin}/api/v1`])];
}

async function discoverPlatformSchedule(platform, inputUrl, username, password) {
  const weeks = [currentWeekStart()];
  const next = new Date(`${weeks[0]}T12:00:00`); next.setDate(next.getDate() + 7);
  weeks.push(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`);
  for (const base of urlBases(inputUrl)) {
    try {
      const payload = await requestJson(`${base}/api/cronograma`, { headers: { accept: 'application/json' } });
      const events = weeks.flatMap((week) => normalizeWeeklyUserEvents(payload, week, platform, username));
      if (events.length) return { ...platform, api: base, status: 'ok', events, fetchedAt: new Date().toISOString(), message: 'Grade semanal encontrada automaticamente' };
    } catch {}
  }
  if (!password) throw new Error('A grade pública não foi encontrada. Informe a senha para testar APIs autenticadas.');
  const loginCandidates = urlBases(inputUrl).flatMap((base) =>
    ['/auth/login', '/admin/login', '/api/auth/login', '/login'].map(async (endpoint) => {
      const login = await loginAt(base, endpoint, username, password);
      const token = login?.token || login?.accessToken || login?.access_token || login?.data?.token;
      if (!token) throw new Error('Login sem token');
      return { base, token };
    })
  );
  const sessions = (await Promise.allSettled(loginCandidates)).filter((item) => item.status === 'fulfilled').map((item) => item.value);
  const patterns = [
    (week) => `/grade/${week}/mine`,
    (week) => `/me/multiview-schedule?weekStartDate=${encodeURIComponent(week)}`,
    (week) => `/admin/multiview-schedule?weekStartDate=${encodeURIComponent(week)}`,
    (week) => `/schedule?weekStartDate=${encodeURIComponent(week)}`,
    (week) => `/agenda?weekStartDate=${encodeURIComponent(week)}`
  ];
  const scheduleCandidates = sessions.flatMap(({ base, token }) => patterns.map(async (pattern) => {
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
    const payloads = await Promise.all(weeks.map((week) => requestJson(`${base}${pattern(week)}`, { headers })));
    const events = payloads.flatMap((payload, index) => {
      const grade = normalizeGradeEvents(payload, weeks[index], platform);
      return grade.length ? grade : normalizeEvents(payload, platform);
    });
    if (!events.length) throw new Error('Resposta sem horários');
    return { ...platform, api: base, status: 'ok', events, fetchedAt: new Date().toISOString(), message: 'API encontrada automaticamente' };
  }));
  const schedules = await Promise.allSettled(scheduleCandidates);
  const found = schedules.find((item) => item.status === 'fulfilled');
  if (found) return found.value;
  throw new Error('Nenhuma API de agenda compatível foi encontrada. Confirme o endereço ou informe diretamente a URL base da API.');
}

function normalizeWeeklyUserEvents(payload, weekStart, platform, username) {
  if (!Array.isArray(payload)) return [];
  const wanted = String(username).trim().toLowerCase();
  return payload.map((item, index) => {
    if (String(item.username || '').trim().toLowerCase() !== wanted) return null;
    const siteDay = Number(item.diaSemana);
    const hour = Number(item.hora);
    if (!Number.isInteger(siteDay) || siteDay < 0 || siteDay > 6 || !Number.isFinite(hour)) return null;
    const mondayOffset = siteDay === 0 ? 6 : siteDay - 1;
    const start = new Date(`${weekStart}T00:00:00`);
    start.setDate(start.getDate() + mondayOffset);
    start.setHours(hour, 0, 0, 0);
    return {
      id: `${platform.id}-${weekStart}-${item.id || index}`,
      platformId: platform.id,
      platform: platform.name,
      color: platform.color,
      title: String(item.username || username),
      start: start.toISOString(),
      end: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      status: 'PUBLISHED',
      notes: item.slot ? `Alcateia ${item.slot}` : String(item.descricao || '')
    };
  }).filter(Boolean).sort((a, b) => new Date(a.start) - new Date(b.start));
}

function currentWeekStart() {
  const now = new Date();
  const day = now.getDay() || 7;
  now.setDate(now.getDate() - day + 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function normalizeGradeEvents(payload, weekStart, platform) {
  if (!Array.isArray(payload)) return [];
  return payload.map((item, index) => {
    const day = Number(item.day_of_week);
    const hour = Number(item.hour);
    if (!Number.isInteger(day) || !Number.isFinite(hour)) return null;
    const start = new Date(`${weekStart}T00:00:00`);
    start.setDate(start.getDate() + day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      id: `${platform.id}-${weekStart}-${day}-${hour}-${item.slot_number ?? index}`,
      platformId: platform.id,
      platform: platform.name,
      color: platform.color,
      title: String(item.display_name || item.username || item.slug || 'thepocoto'),
      start: start.toISOString(),
      end: end.toISOString(),
      status: 'PUBLISHED',
      notes: item.slot_number == null ? '' : `Slot ${item.slot_number}`
    };
  }).filter(Boolean).sort((a, b) => new Date(a.start) - new Date(b.start));
}

function safeError(error) {
  if (error.status === 401) return 'Usuário ou senha inválidos';
  if (error.status === 403) return 'Acesso à agenda não autorizado';
  return error.message || 'Não foi possível carregar a agenda';
}

function normalizeEvents(payload, platform) {
  if (payload?.weekStartDate && Array.isArray(payload.items)) {
    const dayOffsets = {
      MONDAY: 0, TUESDAY: 1, WEDNESDAY: 2, THURSDAY: 3,
      FRIDAY: 4, SATURDAY: 5, SUNDAY: 6
    };
    return payload.items.map((item, index) => {
      const offset = dayOffsets[String(item.dayOfWeek || '').toUpperCase()];
      if (offset === undefined || !item.hour) return null;
      const start = new Date(`${payload.weekStartDate}T${item.hour}:00`);
      start.setDate(start.getDate() + offset);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const title = String(item.displayName || item.slug || 'Horário reservado');
      return {
        id: `${platform.id}-${item.channelId || index}-${item.dayOfWeek}-${item.hour}`,
        platformId: platform.id,
        platform: platform.name,
        color: platform.color,
        title,
        start: start.toISOString(),
        end: end.toISOString(),
        status: String(payload.status || ''),
        notes: ''
      };
    }).filter(Boolean).sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  const candidates = collectObjects(payload);
  const events = [];
  const seen = new Set();

  for (const item of candidates) {
    const start = parseDate(first(item, ['startAt', 'startsAt', 'start', 'startTime', 'scheduledAt', 'dateTime', 'datetime', 'slotStart']));
    const end = parseDate(first(item, ['endAt', 'endsAt', 'end', 'endTime', 'slotEnd']), start);
    const date = first(item, ['date', 'day', 'scheduleDate', 'slotDate']);
    const startClock = first(item, ['startHour', 'startTime', 'from', 'time']);
    const endClock = first(item, ['endHour', 'endTime', 'to']);
    const combinedStart = start || combineDateTime(date, startClock);
    const combinedEnd = end || combineDateTime(date, endClock) || (combinedStart ? new Date(combinedStart.getTime() + 60 * 60 * 1000) : null);
    if (!combinedStart || Number.isNaN(combinedStart.getTime())) continue;

    const title = String(first(item, ['title', 'name', 'label', 'channelName', 'channel', 'streamerName', 'username', 'slug']) || 'Horário reservado');
    const id = String(first(item, ['id', 'slotId', 'scheduleId']) || `${platform.id}-${combinedStart.toISOString()}-${title}`);
    const key = `${platform.id}|${id}|${combinedStart.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      id: key,
      platformId: platform.id,
      platform: platform.name,
      color: platform.color,
      title,
      start: combinedStart.toISOString(),
      end: combinedEnd?.toISOString() || null,
      status: String(first(item, ['status', 'state']) || ''),
      notes: String(first(item, ['description', 'notes', 'observation']) || '')
    });
  }

  return events.sort((a, b) => new Date(a.start) - new Date(b.start));
}

function collectObjects(value, output = [], visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return output;
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => collectObjects(entry, output, visited));
  } else {
    output.push(value);
    Object.values(value).forEach((entry) => collectObjects(entry, output, visited));
  }
  return output;
}

function first(object, keys) {
  for (const key of keys) if (object[key] !== undefined && object[key] !== null && object[key] !== '') return object[key];
  return null;
}

function parseDate(value, relativeTo = null) {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value < 10_000_000_000 ? value * 1000 : value);
  const text = String(value).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text) && relativeTo) {
    const [hours, minutes, seconds = 0] = text.split(':').map(Number);
    const result = new Date(relativeTo);
    result.setHours(hours, minutes, seconds, 0);
    return result;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function combineDateTime(date, clock) {
  if (!date || !clock) return null;
  const day = String(date).slice(0, 10);
  const time = String(clock).match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0];
  if (!time) return null;
  return parseDate(`${day}T${time}`);
}

async function loadSchedules(force = false) {
  if (!force && cache.result && Date.now() - cache.at < CACHE_MS) return cache.result;
  const sources = await Promise.all(configuredPlatforms().map(getPlatformSchedule));
  const result = {
    updatedAt: new Date().toISOString(),
    sources: sources.map(({ events, ...source }) => ({ ...source, eventCount: events.length })),
    events: sources.flatMap((source) => source.events).sort((a, b) => new Date(a.start) - new Date(b.start))
  };
  cache = { at: Date.now(), result };
  return result;
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function oauthCookieValue(data) {
  const payload = base64url(Buffer.from(JSON.stringify(data)));
  const signature = base64url(crypto.createHmac('sha256', process.env.KICK_CLIENT_SECRET).update(payload).digest());
  return `${payload}.${signature}`;
}

function readOAuthCookie(req) {
  try {
    const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim().split(/=(.*)/s).slice(0, 2)));
    const [payload, signature] = String(cookies.kick_oauth || '').split('.');
    if (!payload || !signature) return null;
    const expected = base64url(crypto.createHmac('sha256', process.env.KICK_CLIENT_SECRET).update(payload).digest());
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch { return null; }
}

function oauthCookie(value, maxAge = 600) {
  const secure = String(process.env.KICK_REDIRECT_URI || '').startsWith('https://') ? '; Secure' : '';
  return `kick_oauth=${value}; Path=/api/kick; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function kickConfigured() {
  return Boolean(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET && process.env.KICK_REDIRECT_URI);
}

async function refreshKickAccessToken(force = false) {
  if (!kickSession?.refreshToken) throw new Error('Não há token de renovação');
  if (!force && kickSession.expiresAt && Date.now() < kickSession.expiresAt - 60_000) return kickSession.accessToken;
  if (kickRefreshPromise) return kickRefreshPromise;
  kickRefreshPromise = (async () => {
    const body = new URLSearchParams({
      grant_type: 'refresh_token', client_id: process.env.KICK_CLIENT_ID,
      client_secret: process.env.KICK_CLIENT_SECRET, refresh_token: kickSession.refreshToken
    });
    const token = await requestJson('https://id.kick.com/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body
    });
    if (!token?.access_token) throw new Error('A Kick não retornou um novo token');
    kickSession = { accessToken: token.access_token, refreshToken: token.refresh_token || kickSession.refreshToken, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 };
    saveKickSession();
    return kickSession.accessToken;
  })();
  try { return await kickRefreshPromise; }
  finally { kickRefreshPromise = null; }
}

async function getKickStats() {
  if (!kickSession?.accessToken) return { configured: kickConfigured(), connected: false, message: kickLastError };
  try {
    const accessToken = await refreshKickAccessToken(false);
    const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/json' };
    const users = await requestJson('https://api.kick.com/public/v1/users', { headers });
    const user = users?.data?.[0] || users?.[0] || users?.data || null;
    const broadcasterId = user?.user_id || user?.id;
    let channel = null;
    let live = null;
    if (broadcasterId) {
      const channels = await requestJson(`https://api.kick.com/public/v1/channels?broadcaster_user_id=${encodeURIComponent(broadcasterId)}`, { headers }).catch(() => null);
      channel = channels?.data?.[0] || channels?.[0] || null;
      const streams = await requestJson(`https://api.kick.com/public/v1/livestreams?broadcaster_user_id=${encodeURIComponent(broadcasterId)}`, { headers }).catch(() => null);
      live = streams?.data?.[0] || streams?.[0] || null;
    }
    const result = {
      configured: true,
      connected: true,
      user: { username: user?.name || user?.username || channel?.slug || 'Conta Kick', avatar: user?.profile_picture || null },
      live: Boolean(live),
      viewers: live?.viewer_count ?? 0,
      title: live?.stream_title || channel?.stream_title || null,
      category: live?.category?.name || channel?.category?.name || null,
      startedAt: live?.created_at || live?.started_at || null
    };
    ensureChatSubscription(accessToken, broadcasterId);
    recordAudienceSample(result);
    return result;
  } catch (error) {
    if (error.status === 401 && kickSession?.refreshToken) {
      try { await refreshKickAccessToken(true); return getKickStats(); }
      catch (refreshError) {
        if ([400, 401, 403].includes(refreshError.status)) { kickSession = null; saveKickSession(); }
      }
    }
    return { configured: kickConfigured(), connected: false, message: 'A sessão da Kick expirou. Conecte novamente.' };
  }
}

function recordAudienceSample(status) {
  if (!status.live || !status.startedAt) { finalizeActiveLive(); return; }
  if (liveAnalytics.startedAt !== status.startedAt) {
    if (liveAnalytics.startedAt) finalizeActiveLive(status.startedAt);
    liveAnalytics = { ...emptyLiveAnalytics(), live: true, startedAt: status.startedAt, title: status.title, category: status.category, samples: [], chatStartedAt: Date.now() };
  }
  liveAnalytics.live = true;
  liveAnalytics.title = status.title || liveAnalytics.title;
  liveAnalytics.category = status.category || liveAnalytics.category;
  const now = Date.now();
  const last = liveAnalytics.samples.at(-1);
  if (!last || now - last.at >= 25_000) {
    liveAnalytics.samples.push({ at: now, viewers: Number(status.viewers || 0) });
    if (liveAnalytics.samples.length > 720) liveAnalytics.samples.shift();
  }
  saveLiveHistory();
}

function analyticsPayload() {
  const samples = liveAnalytics.samples;
  const peakSample = samples.reduce((best, sample) => !best || sample.viewers > best.viewers ? sample : best, null);
  const average = samples.length ? Math.round(samples.reduce((sum, sample) => sum + sample.viewers, 0) / samples.length) : null;
  const elapsedMinutes = Math.max(1 / 60, (Date.now() - (liveAnalytics.chatStartedAt || Date.now())) / 60000);
  const ranking = [...liveAnalytics.chatters.values()].sort((a, b) => b.messages - a.messages).slice(0, 10).map((user) => ({ ...user, perMinute: user.messages / elapsedMinutes }));
  return {
    live: liveAnalytics.live,
    startedAt: liveAnalytics.startedAt,
    audience: { samples, peak: peakSample?.viewers ?? null, peakAt: peakSample?.at ?? null, average },
    chat: { total: liveAnalytics.totalMessages, ranking, message: chatSubscription.message, subscriptionActive: chatSubscription.active }
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > 1024 * 1024) { reject(new Error('Payload muito grande')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function verifyKickWebhook(req, rawBody) {
  const messageId = req.headers['kick-event-message-id'];
  const timestamp = req.headers['kick-event-message-timestamp'];
  const signature = req.headers['kick-event-signature'];
  if (!messageId || !timestamp || !signature) return false;
  if (!kickPublicKey) {
    const response = await requestJson('https://api.kick.com/public/v1/public-key');
    kickPublicKey = response?.data?.public_key || response?.public_key || response?.data;
  }
  return crypto.verify('sha256', Buffer.from(`${messageId}.${timestamp}.${rawBody.toString('utf8')}`), kickPublicKey, Buffer.from(signature, 'base64'));
}

function countChatMessage(payload, messageId) {
  if (webhookMessageIds.has(messageId)) return;
  webhookMessageIds.add(messageId);
  if (webhookMessageIds.size > 5000) webhookMessageIds.delete(webhookMessageIds.values().next().value);
  const sender = payload.sender || payload.user || payload.chatter || {};
  const id = String(sender.user_id || sender.id || sender.username || sender.name || 'desconhecido');
  const username = String(sender.username || sender.name || sender.display_name || 'Desconhecido');
  const current = liveAnalytics.chatters.get(id) || { id, username, messages: 0 };
  current.username = username; current.messages += 1;
  liveAnalytics.chatters.set(id, current);
  liveAnalytics.totalMessages += 1;
  if (!liveAnalytics.chatStartedAt) liveAnalytics.chatStartedAt = Date.now();
  saveLiveHistory();
}

async function subscribeToChat(accessToken) {
  try {
    const users = await requestJson('https://api.kick.com/public/v1/users', { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
    const user = users?.data?.[0] || users?.[0] || users?.data;
    const broadcasterId = user?.user_id || user?.id;
    const body = { method: 'webhook', events: [{ name: 'chat.message.sent', version: 1 }] };
    if (broadcasterId) body.broadcaster_user_id = Number(broadcasterId);
    await requestJson('https://api.kick.com/public/v1/events/subscriptions', { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    chatSubscription = { active: true, message: 'Webhook do chat ativo.' };
  } catch (error) {
    chatSubscription = { active: false, message: `Webhook pendente: ${error.message}` };
  }
}

function ensureChatSubscription(accessToken, broadcasterId) {
  if (chatSubscription.active || chatSubscriptionPromise || Date.now() - lastChatSubscriptionAttempt < 5 * 60_000) return;
  lastChatSubscriptionAttempt = Date.now();
  chatSubscription.message = 'Verificando assinatura do chat…';
  chatSubscriptionPromise = (async () => {
    try {
      const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/json' };
      const existing = await requestJson('https://api.kick.com/public/v1/events/subscriptions', { headers });
      const hasChat = collectObjects(existing).some((item) => item?.name === 'chat.message.sent' || item?.event === 'chat.message.sent');
      if (hasChat) {
        chatSubscription = { active: true, message: 'Webhook do chat ativo.' };
        return;
      }
      await subscribeToChat(accessToken, broadcasterId);
    } catch (error) {
      chatSubscription = { active: false, message: `Webhook pendente: ${error.message}` };
    }
  })().finally(() => { chatSubscriptionPromise = null; });
}

function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(PUBLIC_DIR, `.${requestPath}`);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end('Não encontrado');
    return;
  }
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/agenda-config') {
    const data = configuredPlatforms({ includeAvailable: true }).map((platform) => {
      const credentials = platformCredentials(platform);
      return { id: platform.id, name: platform.name, color: platform.color, custom: Boolean(platform.custom), configured: platform.custom || Boolean(credentials.username && (platform.requiresPassword === false || credentials.password)), url: credentials.api, username: credentials.username, hasPassword: Boolean(credentials.password) };
    });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(data));
  }
  if (req.method === 'POST' && req.url === '/api/agenda-config') {
    try {
      const body = JSON.parse((await readRequestBody(req)).toString('utf8'));
      const isNew = body.platformId === 'new';
      const platform = isNew ? null : configuredPlatforms({ includeAvailable: true }).find((item) => item.id === body.platformId);
      if (!isNew && !platform) throw new Error('Plataforma inválida');
      const url = String(body.url || '').trim().replace(/\/$/, '');
      if (!/^https?:\/\//i.test(url)) throw new Error('Informe um link válido, começando com http:// ou https://');
      const name = String(body.name || '').trim();
      if (isNew && !name) throw new Error('Informe um nome para a agenda');
      const id = isNew ? `custom-${crypto.randomBytes(6).toString('hex')}` : platform.id;
      const current = agendaConfig[id] || {};
      agendaConfig[id] = {
        url,
        username: String(body.username || '').trim(),
        password: body.clearPassword ? '' : (body.password ? String(body.password) : (current.password || '')),
        ...(isNew || platform.custom ? { custom: true, name: name || current.name || platform.name, color: String(body.color || current.color || '#f59e0b') } : {})
      };
      fs.writeFileSync(AGENDA_CONFIG_FILE, `${JSON.stringify(agendaConfig, null, 2)}\n`, { mode: 0o600 });
      cache = { at: 0, result: null };
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, id }));
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: error.message || 'Não foi possível salvar' }));
    }
  }
  if (req.method === 'POST' && req.url === '/api/kick/webhook') {
    try {
      const rawBody = await readRequestBody(req);
      if (!await verifyKickWebhook(req, rawBody)) {
        res.writeHead(403).end('Assinatura inválida'); return;
      }
      const messageId = String(req.headers['kick-event-message-id']);
      const eventType = String(req.headers['kick-event-type'] || '');
      const payload = JSON.parse(rawBody.toString('utf8'));
      if (!eventType || eventType === 'chat.message.sent') countChatMessage(payload, messageId);
      res.writeHead(200).end('OK');
    } catch {
      res.writeHead(400).end('Webhook inválido');
    }
    return;
  }
  if (req.method === 'GET' && req.url === '/api/kick/analytics') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(analyticsPayload()));
  }
  if (req.method === 'GET' && req.url === '/api/kick/history') {
    const sessions = [...(liveAnalytics.startedAt ? [liveSummary(liveAnalytics, true)] : []), ...liveHistory.sessions];
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ sessions }));
  }
  if (req.method === 'GET' && req.url === '/api/kick/status') {
    const data = await getKickStats();
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(data));
  }
  if (req.method === 'GET' && req.url === '/api/kick/login') {
    if (!kickConfigured()) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Configure o aplicativo da Kick antes de conectar.' }));
    }
    kickLastError = null;
    const state = base64url(crypto.randomBytes(24));
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const pending = { state, verifier, createdAt: Date.now() };
    kickOAuthStates.set(state, pending);
    const params = new URLSearchParams({
      response_type: 'code', client_id: process.env.KICK_CLIENT_ID,
      redirect_uri: process.env.KICK_REDIRECT_URI, scope: 'user:read channel:read events:subscribe',
      code_challenge: challenge, code_challenge_method: 'S256', state
    });
    res.writeHead(302, { location: `https://id.kick.com/oauth/authorize?${params}`, 'set-cookie': oauthCookie(oauthCookieValue(pending)) });
    return res.end();
  }
  if (req.method === 'GET' && req.url.startsWith('/api/kick/callback')) {
    const query = new URL(req.url, 'http://localhost').searchParams;
    const state = query.get('state');
    const code = query.get('code');
    const oauthError = query.get('error_description') || query.get('error');
    const cookiePending = readOAuthCookie(req);
    const pending = kickOAuthStates.get(state) || (cookiePending?.state === state ? cookiePending : null);
    kickOAuthStates.delete(state);
    if (!code || !pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      kickLastError = oauthError ? `A Kick recusou o login: ${oauthError}` : 'A autorização expirou ou não pôde ser validada. Tente novamente.';
      res.writeHead(302, { location: '/?kick=error', 'set-cookie': oauthCookie('', 0) }); return res.end();
    }
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code', client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET, redirect_uri: process.env.KICK_REDIRECT_URI,
        code_verifier: pending.verifier, code
      });
      const token = await requestJson('https://id.kick.com/oauth/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body
      });
      kickSession = { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 };
      saveKickSession();
      await subscribeToChat(token.access_token);
      kickLastError = null;
      res.writeHead(302, { location: '/?kick=connected', 'set-cookie': oauthCookie('', 0) }); return res.end();
    } catch (error) {
      kickLastError = `Não foi possível concluir o login: ${error.message}`;
      res.writeHead(302, { location: '/?kick=error', 'set-cookie': oauthCookie('', 0) }); return res.end();
    }
  }
  if (req.method === 'GET' && req.url.startsWith('/api/schedule')) {
    try {
      const force = new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1';
      const data = await loadSchedules(force);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Não foi possível atualizar as agendas' }));
    }
    return;
  }
  if (req.method !== 'GET') return res.writeHead(405).end('Método não permitido');
  serveStatic(req, res);
});

server.listen(PORT, () => console.log(`Agenda disponível em http://localhost:${PORT}`));
