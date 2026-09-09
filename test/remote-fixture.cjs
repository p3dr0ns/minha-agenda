const remote = require('../remote-json');
remote.remoteJson = async (input, options = {}) => {
  const url = String(input);
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
