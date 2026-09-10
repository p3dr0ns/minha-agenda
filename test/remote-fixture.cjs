const remote = require('../remote-json');
remote.remoteJson = async (input, options = {}) => {
  const url = String(input);
  if (url === 'https://laplata-web.pages.dev/config.js') return 'window.SUPABASE_URL = "https://fixture.supabase.co"; window.SUPABASE_ANON_KEY = "public-test-key";';
  if (url.startsWith('https://fixture.supabase.co/')) {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/login_email')) return 'bob@example.test';
    if (parsed.pathname.endsWith('/token')) return { access_token: 'la-plata-test-token', user: { id: 'la-plata-bob' } };
    if (parsed.pathname.endsWith('/streamers')) return [{ username: 'bob', display_name: 'Bob La Plata' }];
    if (parsed.pathname.endsWith('/slot_reservations')) return [{ id: 1, username: 'bob', slot_date: parsed.searchParams.getAll('slot_date')[0].slice(4), slot_hour: 19, slot_tela: 4, status: 'active' }];
  }
  if (url === 'https://skyvolk.com/api/cronograma') return [
    { id: 1, username: 'alice', diaSemana: 1, hora: 10, slot: 'A' },
    { id: 2, username: 'bob', diaSemana: 2, hora: 15, slot: 'B' }
  ];
  if (url.endsWith('/public-key')) return { data: { public_key: process.env.TEST_PUBLIC_KEY } };
  if (url.endsWith('/users')) {
    const alice = options.headers.authorization === 'Bearer token-alice';
    return { data: [{ user_id: alice ? 111 : 222, name: alice ? 'alice-kick' : 'bob-kick' }] };
  }
  if (url.includes('/events/subscriptions')) return { data: [{ name: 'chat.message.sent' }] };
  if (url.includes('/channels?') || url.includes('/livestreams?')) return { data: [] };
  throw new Error('Unexpected remote request in test: ' + url);
};
