const SITE = 'https://laplata-web.pages.dev';

function isLaPlata(input) {
  try { return new URL(input).origin === SITE; } catch { return false; }
}

async function loadLaPlata(platform, username, password, weekStart, requestJson) {
  if (!password) throw new Error('Informe sua senha da La Plata.');
  const config = await requestJson(`${SITE}/config.js`);
  if (typeof config !== 'string') throw new Error('Não foi possível identificar a configuração da La Plata.');
  const api = config.match(/\bSUPABASE_URL\s*=\s*["']([^"']+)["']/)?.[1];
  const key = config.match(/\bSUPABASE_ANON_KEY\s*=\s*["']([^"']+)["']/)?.[1];
  if (!api || !key || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(api)) throw new Error('A configuração da La Plata mudou. Atualize a integração.');
  const base = api.replace(/\/$/, '');
  const headers = { apikey: key, 'content-type': 'application/json', accept: 'application/json' };
  const email = await requestJson(`${base}/rest/v1/rpc/login_email`, {
    method: 'POST', headers, body: JSON.stringify({ p_username: username.trim().toLowerCase() })
  });
  if (typeof email !== 'string' || !email) throw new Error('Usuário não encontrado na La Plata.');
  let auth;
  try {
    auth = await requestJson(`${base}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers, body: JSON.stringify({ email, password })
    });
  } catch (error) {
    if ([400, 401, 403].includes(error.status)) throw new Error('A La Plata recusou o login. Confira seu usuário e sua senha.');
    throw error;
  }
  if (!auth?.access_token || !auth?.user?.id) throw new Error('A La Plata não retornou uma sessão válida.');
  const privateHeaders = { ...headers, authorization: `Bearer ${auth.access_token}` };
  const profileQuery = new URLSearchParams({ select: 'username,display_name', user_id: `eq.${auth.user.id}` });
  const profiles = await requestJson(`${base}/rest/v1/streamers?${profileQuery}`, { headers: privateHeaders });
  const profile = Array.isArray(profiles) && profiles.length === 1 ? profiles[0] : null;
  if (!profile?.username) throw new Error('Seu perfil da La Plata não foi encontrado.');
  const until = new Date(`${weekStart}T12:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 14);
  const endDate = until.toISOString().slice(0, 10);
  const events = [];
  const seen = new Set();
  for (let offset = 0; offset < 4000; offset += 1000) {
    const query = new URLSearchParams({ select: 'id,username,slot_date,slot_hour,slot_tela,kind,status', username: `eq.${profile.username}`, status: 'eq.active', order: 'slot_date.asc,slot_hour.asc,id.asc', limit: '1000', offset: String(offset) });
    query.append('slot_date', `gte.${weekStart}`);
    query.append('slot_date', `lt.${endDate}`);
    const rows = await requestJson(`${base}/rest/v1/slot_reservations?${query}`, { headers: privateHeaders });
    if (!Array.isArray(rows)) throw new Error('A La Plata retornou uma grade inválida.');
    for (const item of rows) {
      if (item.username !== profile.username || item.status !== 'active') continue;
      const hour = Number(item.slot_hour);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.slot_date) || item.slot_date < weekStart || item.slot_date >= endDate || !Number.isInteger(hour) || hour < 0 || hour > 23 || item.slot_hour == null) continue;
      const start = new Date(`${item.slot_date}T${String(hour).padStart(2, '0')}:00:00-03:00`);
      if (!Number.isFinite(start.getTime())) continue;
      const id = `${platform.id}-${item.id ?? `${item.slot_date}-${hour}-${item.slot_tela}`}`;
      if (seen.has(id)) continue;
      seen.add(id);
      events.push({ id, platformId: platform.id, platform: platform.name, color: platform.color,
        title: profile.display_name || profile.username, start: start.toISOString(),
        end: new Date(start.getTime() + 3600000).toISOString(), status: 'PUBLISHED',
        notes: `Tela ${item.slot_tela}` });
    }
    if (rows.length < 1000) break;
    if (offset === 3000) throw new Error('A La Plata retornou reservas demais para este período.');
  }
  return { ...platform, api: base, status: 'ok', events, adapter: { kind: 'la-plata', base: SITE },
    fetchedAt: new Date().toISOString(), message: events.length ? `${events.length} horários encontrados na La Plata` : 'La Plata conectada. Nenhuma reserva ativa neste período.' };
}

module.exports = { isLaPlata, loadLaPlata };
