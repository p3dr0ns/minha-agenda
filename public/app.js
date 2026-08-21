const savedPreferences = loadPreferences();
const state = { data: null, weekStart: startOfWeek(new Date()), hiddenPlatforms: new Set(savedPreferences.hiddenPlatforms), dayFilter: 'all', agendaConfig: [], preferences: savedPreferences };
let scheduleRefreshTimer = null;
const weekGrid = document.querySelector('#weekGrid');
const sourceStrip = document.querySelector('#sourceStrip');
const emptyState = document.querySelector('#emptyState');
const refreshButton = document.querySelector('#refreshButton');

function startOfWeek(input) {
  const date = new Date(input);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
function esc(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function loadPreferences() {
  try { return { refreshMinutes: 2, notificationLead: 0, timezone: 'America/Sao_Paulo', hiddenPlatforms: [], ...JSON.parse(localStorage.getItem('agendaPreferences') || '{}') }; }
  catch { return { refreshMinutes: 2, notificationLead: 0, timezone: 'America/Sao_Paulo', hiddenPlatforms: [] }; }
}
function formatDate(value, options) { return new Date(value).toLocaleString('pt-BR', { ...options, timeZone: state.preferences.timezone }); }

async function load(force = false) {
  refreshButton.classList.add('loading');
  document.querySelector('#syncLabel').textContent = 'Sincronizando…';
  try {
    const response = await fetch(`/api/schedule${force ? '?refresh=1' : ''}`);
    if (!response.ok) throw new Error('Falha ao atualizar');
    state.data = await response.json();
    render();
    const time = new Date(state.data.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    document.querySelector('#syncLabel').textContent = `Atualizado às ${time}`;
  } catch {
    document.querySelector('#syncLabel').textContent = 'Erro ao sincronizar';
  } finally {
    refreshButton.classList.remove('loading');
  }
}

function render() {
  renderSources();
  renderFilters();
  renderWeek();
  renderNext();
  renderDashboardSchedule();
  renderSettingsPlatforms();
  renderPreferenceSummary();
}

function filteredEvents() {
  return state.data.events.filter((event) => {
    if (state.hiddenPlatforms.has(event.platformId)) return false;
    if (state.dayFilter === 'all') return true;
    const day = new Date(event.start).getDay() || 7;
    return day - 1 === Number(state.dayFilter);
  });
}

function renderFilters() {
  const holder = document.querySelector('#platformFilters');
  if (!holder) return;
  holder.innerHTML = state.data.sources.map((source) => `<button class="filter-chip ${state.hiddenPlatforms.has(source.id) ? '' : 'active'}" data-platform-filter="${esc(source.id)}"><span style="background:${source.color}"></span>${esc(source.name)}</button>`).join('');
  holder.querySelectorAll('[data-platform-filter]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.platformFilter;
    state.hiddenPlatforms.has(id) ? state.hiddenPlatforms.delete(id) : state.hiddenPlatforms.add(id);
    renderFilters(); renderWeek(); renderNext(); renderDashboardSchedule();
  }));
}

function openView(name) {
  document.querySelectorAll('.view-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${name}View`));
  document.querySelectorAll('.nav-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderDashboardSchedule() {
  if (!state.data) return;
  const upcoming = filteredEvents().filter((event) => new Date(event.start) >= new Date()).slice(0, 3);
  document.querySelector('#dashboardNext').innerHTML = upcoming.length ? upcoming.map((event) => `
    <div class="next-row"><span class="group-dot" style="--dot-color:${event.color}"></span><strong>${formatDate(event.start, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</strong><span>${esc(event.platform)}</span></div>`).join('') : '<span class="muted">Nenhum próximo horário.</span>';
}

async function loadKickStatus() {
  const message = document.querySelector('#kickMessage');
  const hint = document.querySelector('#kickConnectHint');
  try {
    const response = await fetch('/api/kick/status');
    const data = await response.json();
    const loginButton = document.querySelector('#kickLoginButton');
    loginButton.dataset.configured = String(Boolean(data.configured));
    loginButton.textContent = data.connected ? 'Reconectar' : data.configured ? 'Conectar com a Kick' : 'Configurar integração';
    document.querySelector('#kickStatusDot').classList.toggle('connected', data.connected);
    document.querySelector('#kickAccount').textContent = data.connected ? data.user?.username || 'Conectada' : 'Não conectada';
    document.querySelector('#statLive').textContent = data.live ? 'Ao vivo' : 'Offline';
    document.querySelector('#statLive').classList.toggle('live', Boolean(data.live));
    document.querySelector('.live-nav-tab').classList.toggle('is-live', Boolean(data.live));
    document.querySelector('#statLiveDetail').textContent = data.connected ? (data.live ? 'transmitindo agora' : 'canal conectado') : 'conecte sua conta';
    document.querySelector('#statViewers').textContent = data.connected ? Number(data.viewers || 0).toLocaleString('pt-BR') : '—';
    document.querySelector('#liveTitle').textContent = data.title || (data.live ? 'Live em andamento' : 'Nenhuma live ativa');
    document.querySelector('#liveCategory').textContent = data.category || '—';
    document.querySelector('#liveStarted').textContent = data.startedAt ? formatDate(data.startedAt, { dateStyle: 'short', timeStyle: 'short' }) : '—';
    document.querySelector('#liveBadge').textContent = data.live ? 'AO VIVO' : 'OFFLINE';
    document.querySelector('#liveBadge').classList.toggle('online', Boolean(data.live));
    if (data.startedAt && data.live) {
      const minutes = Math.max(0, Math.floor((Date.now() - new Date(data.startedAt)) / 60000));
      document.querySelector('#statDuration').textContent = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    }
    if (!data.configured) {
      hint.textContent = 'Faltam o Client ID e o Client Secret da Kick.';
      message.innerHTML = 'Para ativar o login, crie um aplicativo em <a href="https://dev.kick.com" target="_blank" rel="noreferrer">dev.kick.com</a> e configure as chaves no arquivo .env.';
    } else {
      hint.textContent = data.message || '';
      message.textContent = data.message || '';
    }
  } catch { message.textContent = 'Não foi possível consultar a Kick agora.'; }
}

async function loadKickAnalytics() {
  try {
    const data = await fetch('/api/kick/analytics').then((response) => response.json());
    document.querySelector('#audiencePeak').textContent = data.audience.peak == null ? '—' : Number(data.audience.peak).toLocaleString('pt-BR');
    document.querySelector('#audienceAverage').textContent = data.audience.average == null ? '—' : Number(data.audience.average).toLocaleString('pt-BR');
    document.querySelector('#audiencePeakTime').textContent = data.audience.peakAt ? new Date(data.audience.peakAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
    document.querySelector('#audienceStatus').textContent = data.live ? `${data.audience.samples.length} amostras` : 'Live offline';
    renderAudienceChart(data.audience.samples);
    document.querySelector('#chatTotal').textContent = `${data.chat.total} mensage${data.chat.total === 1 ? 'm' : 'ns'}`;
    document.querySelector('#chatRanking').innerHTML = data.chat.ranking.length ? data.chat.ranking.map((user, index) => `
      <div class="chat-rank-row"><span class="rank-position">${index + 1}</span><strong>${esc(user.username)}</strong><span>${user.messages} msg</span><small>${user.perMinute.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}/min</small></div>`).join('') : `<div class="chart-empty">${esc(data.chat.message || 'Aguardando mensagens do webhook.')}</div>`;
  } catch {}
}

function formatDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round(Number(seconds || 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}min` : `${minutes}min`;
}

async function loadKickHistory() {
  const holder = document.querySelector('#liveHistory');
  try {
    const data = await fetch('/api/kick/history').then((response) => response.json());
    document.querySelector('#historyTotal').textContent = `${data.sessions.length} live${data.sessions.length === 1 ? '' : 's'}`;
    holder.innerHTML = data.sessions.length ? data.sessions.map((session) => {
      const chatters = session.topChatters?.length ? session.topChatters.slice(0, 3).map((user) => `${esc(user.username)} (${user.messages})`).join(', ') : 'Nenhuma mensagem registrada';
      return `<article class="history-row">
        <div class="history-main"><span class="history-date">${formatDate(session.startedAt, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><strong>${esc(session.title || 'Live sem título')}</strong><small>${esc(session.category || 'Sem categoria')}${session.active ? ' · AO VIVO' : ''}</small></div>
        <div class="history-stat"><span>DURAÇÃO</span><strong>${formatDuration(session.durationSeconds)}</strong></div>
        <div class="history-stat"><span>PICO</span><strong>${Number(session.peak || 0).toLocaleString('pt-BR')}</strong></div>
        <div class="history-stat"><span>MÉDIA</span><strong>${Number(session.average || 0).toLocaleString('pt-BR')}</strong></div>
        <div class="history-stat"><span>MENSAGENS</span><strong>${Number(session.messages || 0).toLocaleString('pt-BR')}</strong></div>
        <div class="history-chatters"><span>MAIS ATIVOS</span><small>${chatters}</small></div>
      </article>`;
    }).join('') : '<div class="chart-empty history-empty">As transmissões aparecerão aqui depois que a conta da Kick registrar uma live.</div>';
  } catch { holder.innerHTML = '<div class="chart-empty history-empty">Não foi possível carregar o histórico.</div>'; }
}

function renderAudienceChart(samples) {
  const chart = document.querySelector('#audienceChart');
  if (!samples.length) { chart.innerHTML = '<div class="chart-empty">As amostras aparecerão durante a live.</div>'; return; }
  const width = 760, height = 220, pad = 24;
  const max = Math.max(...samples.map((sample) => sample.viewers), 1);
  const coordinates = samples.map((sample, index) => ({
    x: samples.length === 1 ? pad : pad + (index / (samples.length - 1)) * (width - pad * 2),
    y: height - pad - (sample.viewers / max) * (height - pad * 2)
  }));
  const points = coordinates.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${pad},${height - pad} ${points} ${width - pad},${height - pad}`;
  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução da audiência"><defs><linearGradient id="audienceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef3340" stop-opacity=".4"/><stop offset="1" stop-color="#ef3340" stop-opacity="0"/></linearGradient></defs><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="chart-axis"/><polygon points="${area}" fill="url(#audienceFill)"/><polyline points="${points}" class="chart-line"/>${samples.map((sample, index) => `<circle cx="${coordinates[index].x}" cy="${coordinates[index].y}" r="3" class="chart-point"><title>${sample.viewers} espectadores · ${new Date(sample.at).toLocaleTimeString('pt-BR')}</title></circle>`).join('')}</svg>`;
}

function renderSources() {
  sourceStrip.classList.toggle('hidden', state.data.sources.length === 0);
  const visibleSources = state.data.sources.filter((source) => !state.hiddenPlatforms.has(source.id));
  const exclusiveId = visibleSources.length === 1 ? visibleSources[0].id : null;
  sourceStrip.innerHTML = state.data.sources.map((source) => `
    <button type="button" class="source ${source.status === 'ok' ? '' : 'error'} ${exclusiveId === source.id ? 'selected' : ''}" data-source-filter="${esc(source.id)}" title="${esc(source.message || `Mostrar somente ${source.name}`)}" aria-pressed="${exclusiveId === source.id}">
      <span class="source-dot" style="background:${source.color}"></span>
      <span>${esc(source.name)}</span>
      <span class="source-state">${source.status === 'ok' ? `${source.eventCount} horário${source.eventCount === 1 ? '' : 's'}` : source.status === 'not_configured' ? 'Configurar' : 'Indisponível'}</span>
    </button>`).join('');
  sourceStrip.querySelectorAll('[data-source-filter]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.sourceFilter;
    if (exclusiveId === id) state.hiddenPlatforms.clear();
    else state.hiddenPlatforms = new Set(state.data.sources.filter((source) => source.id !== id).map((source) => source.id));
    renderSources(); renderFilters(); renderWeek(); renderNext(); renderDashboardSchedule(); renderSettingsPlatforms();
  }));
}

function renderWeek() {
  const end = new Date(state.weekStart); end.setDate(end.getDate() + 6);
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'long' });
  const title = state.weekStart.getMonth() === end.getMonth()
    ? `${state.weekStart.getDate()}–${end.getDate()} de ${month.format(end)} de ${end.getFullYear()}`
    : `${state.weekStart.getDate()} de ${month.format(state.weekStart)} – ${end.getDate()} de ${month.format(end)}`;
  document.querySelector('#weekTitle').textContent = title;
  const current = startOfWeek(new Date());
  const isCurrent = state.weekStart.getTime() === current.getTime();
  document.querySelector('#currentWeek').classList.toggle('active', isCurrent);
  document.querySelector('#nextWeek').classList.toggle('active', !isCurrent);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(state.weekStart); date.setDate(date.getDate() + index); return date;
  });
  const weekdays = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  const eventsByDay = days.map((day, index) => state.dayFilter !== 'all' && index !== Number(state.dayFilter) ? [] : filteredEvents().filter((event) => sameDay(new Date(event.start), day)));
  const eventClock = (event) => formatDate(event.start, { hour: '2-digit', minute: '2-digit', hour12: false });
  const times = [...new Set(eventsByDay.flat().map(eventClock))].sort();

  const header = weekdays.map((weekday, index) => `<th class="${sameDay(days[index], new Date()) ? 'today' : ''}"><span>${weekday}</span><small>${days[index].getDate()}/${days[index].getMonth() + 1}</small></th>`).join('');
  const rows = times.map((time) => {
    const cells = eventsByDay.map((events, index) => {
      const matching = events.filter((event) => {
        return eventClock(event) === time;
      });
      return `<td class="${sameDay(days[index], new Date()) ? 'today' : ''}">${matching.length ? matrixEventHtml(matching) : '<span class="empty-slot">—</span>'}</td>`;
    }).join('');
    return `<tr><th class="time-cell">${time}</th>${cells}</tr>`;
  }).join('');

  weekGrid.innerHTML = `<div class="matrix-scroll"><table class="schedule-matrix"><thead><tr><th class="time-heading">Hora</th>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
  weekGrid.classList.toggle('hidden', times.length === 0);
  emptyState.classList.toggle('hidden', times.length !== 0);
}

function groupEvents(events) {
  const groups = new Map();
  for (const event of events) {
    const start = new Date(event.start);
    const key = `${start.getHours()}:${start.getMinutes()}`;
    if (!groups.has(key)) groups.set(key, { start: event.start, events: [] });
    groups.get(key).events.push(event);
  }
  return [...groups.values()].sort((a, b) => new Date(a.start) - new Date(b.start));
}

function eventHtml(group) {
  const start = new Date(group.start);
  const clock = (date) => date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const unique = [...new Map(group.events.map((event) => [event.platformId, event])).values()];
  const dots = unique.map((event) => `<span class="group-dot" style="--dot-color:${event.color}" title="${esc(event.platform)}" aria-label="${esc(event.platform)}"></span>`).join('');
  const label = `${unique.length} grupo${unique.length === 1 ? '' : 's'}`;
  const names = unique.map((event) => event.platform).join(', ');
  return `<div class="event grouped-event" style="--event-color:${unique[0]?.color || '#1f5b46'}" title="${esc(`${label}: ${names}`)}">
    <div class="event-time">${clock(start)}</div>
    <div class="group-summary"><strong>${label}</strong><span class="group-dots">${dots}</span></div>
    <div class="event-source">${esc(names)}</div>
  </div>`;
}

function scheduleRowHtml(group, day, weekday) {
  const start = new Date(group.start);
  const unique = [...new Map(group.events.map((event) => [event.platformId, event])).values()];
  const dots = unique.map((event) => `<span class="group-dot" style="--dot-color:${event.color}" title="${esc(event.platform)}" aria-label="${esc(event.platform)}"></span>`).join('');
  const names = unique.map((event) => event.platform).join(', ');
  const clock = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `<article class="schedule-row ${sameDay(day, new Date()) ? 'today' : ''}" title="${esc(names)}">
    <div class="row-day"><strong>${weekday}</strong><span>${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}</span></div>
    <time class="row-time" datetime="${start.toISOString()}">${clock}</time>
    <div class="row-groups"><span class="group-dots">${dots}</span><strong>${unique.length} grupo${unique.length === 1 ? '' : 's'}</strong></div>
    <div class="row-platforms">${esc(names)}</div>
  </article>`;
}

function matrixEventHtml(events) {
  const unique = [...new Map(events.map((event) => [event.platformId, event])).values()];
  const dots = unique.map((event) => `<span class="group-dot" style="--dot-color:${event.color}" title="${esc(event.platform)}"></span>`).join('');
  const names = unique.map((event) => event.platform).join(', ');
  return `<div class="matrix-event" title="${esc(names)}">
    <div class="matrix-event-top"><strong>${unique.length} grupo${unique.length === 1 ? '' : 's'}</strong><span class="group-dots">${dots}</span></div>
    <span class="matrix-names">${esc(names)}</span>
  </div>`;
}

function renderNext() {
  const now = new Date();
  const visibleEvents = filteredEvents();
  const next = visibleEvents.find((event) => new Date(event.start) >= now);
  const simultaneous = next ? [...new Set(visibleEvents
    .filter((event) => new Date(event.start).getTime() === new Date(next.start).getTime())
    .map((event) => event.platformId))].length : 0;
  document.querySelector('#nextTitle').textContent = next ? `${simultaneous} grupo${simultaneous === 1 ? '' : 's'}` : 'Agenda livre';
  document.querySelector('#nextTime').textContent = next
    ? `${next.platform} · ${formatDate(next.start, { weekday: 'long', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : 'Nenhum próximo horário encontrado';
}

function renderSettingsPlatforms() {
  const holder = document.querySelector('#settingsPlatforms');
  if (!state.data || !holder) return;
  holder.innerHTML = state.data.sources.map((source) => `<label class="platform-toggle"><input type="checkbox" value="${esc(source.id)}" ${state.hiddenPlatforms.has(source.id) ? '' : 'checked'}><span style="--platform-color:${source.color}"></span>${esc(source.name)}</label>`).join('');
  holder.querySelectorAll('input').forEach((input) => input.addEventListener('change', () => {
    input.checked ? state.hiddenPlatforms.delete(input.value) : state.hiddenPlatforms.add(input.value);
    renderFilters(); renderWeek(); renderNext(); renderDashboardSchedule();
  }));
}

function renderPreferenceSummary() {
  const zones = { 'America/Sao_Paulo': 'Brasília', 'America/Manaus': 'Manaus', 'America/Rio_Branco': 'Acre', 'America/Noronha': 'Fernando de Noronha', UTC: 'UTC' };
  const refresh = state.preferences.refreshMinutes ? `atualização a cada ${state.preferences.refreshMinutes} min` : 'atualização manual';
  document.querySelector('#siteFooter').textContent = `Fuso: ${zones[state.preferences.timezone] || state.preferences.timezone} · ${refresh}`;
  const permission = document.querySelector('#notificationPermission');
  if ('Notification' in window && Notification.permission === 'granted') permission.textContent = 'Notificações permitidas';
}

function restartScheduleRefresh() {
  clearInterval(scheduleRefreshTimer);
  const minutes = Number(state.preferences.refreshMinutes);
  if (minutes > 0) scheduleRefreshTimer = setInterval(() => load(true), minutes * 60_000);
}

function savePreferences() {
  state.preferences = {
    refreshMinutes: Number(document.querySelector('#refreshInterval').value),
    notificationLead: Number(document.querySelector('#notificationLead').value),
    timezone: document.querySelector('#timezoneSetting').value,
    hiddenPlatforms: [...state.hiddenPlatforms]
  };
  localStorage.setItem('agendaPreferences', JSON.stringify(state.preferences));
  restartScheduleRefresh();
  render();
  const message = document.querySelector('#preferencesMessage');
  message.textContent = 'Configurações salvas.';
  setTimeout(() => { message.textContent = 'As alterações são salvas neste navegador.'; }, 2500);
}

async function requestNotificationPermission() {
  const button = document.querySelector('#notificationPermission');
  if (!('Notification' in window)) { button.textContent = 'Não disponível neste navegador'; button.disabled = true; return; }
  const permission = await Notification.requestPermission();
  button.textContent = permission === 'granted' ? 'Notificações permitidas' : 'Permissão não concedida';
}

function checkScheduleNotifications() {
  if (!state.data || !state.preferences.notificationLead || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  const leadMs = state.preferences.notificationLead * 60_000;
  filteredEvents().forEach((event) => {
    const distance = new Date(event.start).getTime() - now;
    const key = `agenda-notified:${event.id}:${state.preferences.notificationLead}`;
    if (distance > 0 && distance <= leadMs && !sessionStorage.getItem(key)) {
      new Notification(`Horário em ${Math.max(1, Math.ceil(distance / 60_000))} min`, { body: `${event.platform} · ${event.title || 'Agenda'}` });
      sessionStorage.setItem(key, '1');
    }
  });
}

document.querySelector('#refreshInterval').value = String(state.preferences.refreshMinutes);
document.querySelector('#notificationLead').value = String(state.preferences.notificationLead);
document.querySelector('#timezoneSetting').value = state.preferences.timezone;
document.querySelector('#savePreferences').addEventListener('click', savePreferences);
document.querySelector('#notificationPermission').addEventListener('click', requestNotificationPermission);

document.querySelector('#currentWeek').addEventListener('click', () => { state.weekStart = startOfWeek(new Date()); renderWeek(); });
document.querySelector('#nextWeek').addEventListener('click', () => {
  state.weekStart = startOfWeek(new Date());
  state.weekStart.setDate(state.weekStart.getDate() + 7);
  renderWeek();
});
document.querySelector('#dayFilter').addEventListener('change', (event) => { state.dayFilter = event.target.value; renderWeek(); renderNext(); renderDashboardSchedule(); });

async function openAgendaSettings() {
  const dialog = document.querySelector('#agendaSettingsDialog');
  const message = document.querySelector('#configMessage');
  message.textContent = 'Carregando…';
  dialog.showModal();
  try {
    state.agendaConfig = await fetch('/api/agenda-config').then((response) => response.json());
    const configured = state.agendaConfig.filter((item) => item.configured);
    const available = state.agendaConfig.filter((item) => !item.configured);
    document.querySelector('#configPlatform').innerHTML = `${configured.length ? '<optgroup label="Suas agendas">' + configured.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('') + '</optgroup>' : ''}${available.length ? '<optgroup label="Integrações disponíveis">' + available.map((item) => `<option value="${esc(item.id)}">＋ ${esc(item.name)}</option>`).join('') + '</optgroup>' : ''}<option value="new">＋ Outro site ou API</option>`;
    fillAgendaConfig(); message.textContent = '';
  } catch { message.textContent = 'Não foi possível carregar as configurações.'; }
}

function fillAgendaConfig() {
  const selectedId = document.querySelector('#configPlatform').value;
  const isNew = selectedId === 'new';
  const selected = state.agendaConfig.find((entry) => entry.id === selectedId);
  document.querySelector('#customSourceFields').classList.toggle('hidden', !isNew && !selected?.custom);
  const item = selected;
  if (!item) {
    document.querySelector('#configName').value = '';
    document.querySelector('#configColor').value = '#f59e0b';
    document.querySelector('#configUrl').value = '';
    document.querySelector('#configUsername').value = '';
    document.querySelector('#configPassword').value = '';
    document.querySelector('#configPassword').placeholder = 'Sua senha';
    return;
  }
  document.querySelector('#configName').value = item.name || '';
  document.querySelector('#configColor').value = item.color || '#f59e0b';
  document.querySelector('#configUrl').value = item.url || '';
  document.querySelector('#configUsername').value = item.username || '';
  document.querySelector('#configPassword').value = '';
  document.querySelector('#configPassword').placeholder = item.hasPassword ? 'Senha já salva — deixe vazio para manter' : 'Sua senha';
}

async function saveAgendaConfig() {
  const message = document.querySelector('#configMessage');
  const button = document.querySelector('#saveAgendaConfig');
  button.disabled = true; message.textContent = 'Salvando…';
  try {
    const response = await fetch('/api/agenda-config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platformId: document.querySelector('#configPlatform').value, name: document.querySelector('#configName').value, color: document.querySelector('#configColor').value, url: document.querySelector('#configUrl').value, username: document.querySelector('#configUsername').value, password: document.querySelector('#configPassword').value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    message.textContent = 'Configuração salva. Atualizando a agenda…';
    await load(true);
    setTimeout(() => document.querySelector('#agendaSettingsDialog').close(), 500);
  } catch (error) { message.textContent = error.message || 'Não foi possível salvar.'; }
  finally { button.disabled = false; }
}

document.querySelector('#openAgendaSettings').addEventListener('click', openAgendaSettings);
document.querySelector('#emptyAddAgenda').addEventListener('click', openAgendaSettings);
document.querySelector('#configPlatform').addEventListener('change', fillAgendaConfig);
document.querySelector('#openConfigSite').addEventListener('click', () => {
  const value = document.querySelector('#configUrl').value.trim();
  if (!/^https?:\/\//i.test(value)) {
    document.querySelector('#configMessage').textContent = 'Informe primeiro o endereço do site.';
    return;
  }
  window.open(value, '_blank', 'noopener,noreferrer');
});
document.querySelector('#saveAgendaConfig').addEventListener('click', saveAgendaConfig);
refreshButton.addEventListener('click', () => load(true));
document.querySelectorAll('.nav-tab').forEach((button) => button.addEventListener('click', () => openView(button.dataset.view)));
document.querySelector('[data-open-schedule]').addEventListener('click', () => openView('schedule'));
document.querySelector('#kickLoginButton').addEventListener('click', () => {
  const button = document.querySelector('#kickLoginButton');
  if (button.dataset.configured === 'true') {
    window.location.assign('/api/kick/login');
    return;
  }
  const hint = document.querySelector('#kickConnectHint');
  hint.textContent = 'Cadastre o aplicativo no portal da Kick e adicione as credenciais ao arquivo .env.';
  hint.classList.remove('attention');
  requestAnimationFrame(() => hint.classList.add('attention'));
  window.open('https://dev.kick.com', '_blank', 'noopener,noreferrer');
});

load();
loadKickStatus();
loadKickAnalytics();
loadKickHistory();
restartScheduleRefresh();
setInterval(loadKickStatus, 30_000);
setInterval(loadKickAnalytics, 30_000);
setInterval(loadKickHistory, 30_000);
setInterval(checkScheduleNotifications, 30_000);
