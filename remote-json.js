const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
  }
  // Only global unicast; excludes loopback, mapped IPv4, local and multicast.
  return net.isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:(?:db8|0:|10:|20:)/i.test(address) && !/^2002:/i.test(address);
}

async function remoteJson(input, options = {}, redirects = 0) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Use um endereço público com HTTPS.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let timeout;
  let addresses;
  try {
    addresses = await Promise.race([
      net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : dns.lookup(hostname, { all: true }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Tempo de conexão esgotado.')), 12_000); })
    ]);
  } finally { clearTimeout(timeout); }
  if (!addresses.length || addresses.some((item) => !publicAddress(item.address))) throw new Error('O endereço deve apontar para um site público.');
  const target = addresses[0];
  const result = await new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: options.method || 'GET', headers: options.headers,
      lookup: (_hostname, lookupOptions, callback) => lookupOptions.all ? callback(null, [target]) : callback(null, target.address, target.family)
    }, (response) => {
      let size = 0; const chunks = [];
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) request.destroy(new Error('Resposta da comunidade muito grande.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({ status: response.statusCode, location: response.headers.location, text: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    const timer = setTimeout(() => request.destroy(new Error('A comunidade demorou para responder.')), 12_000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
    if (options.body) request.write(String(options.body));
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(result.status) && result.location) {
    const destination = new URL(result.location, url);
    if (redirects >= 3 || (options.method && options.method !== 'GET') || (options.headers?.authorization && destination.origin !== url.origin)) throw new Error('Redirecionamento não permitido. Informe o link final da comunidade.');
    return remoteJson(destination.href, options, redirects + 1);
  }
  let body;
  try { body = JSON.parse(result.text); } catch { body = result.text; }
  if (result.status < 200 || result.status >= 300) {
    const error = new Error(result.status === 401 || result.status === 403 ? 'Login não autorizado.' : `A comunidade retornou HTTP ${result.status}.`);
    error.status = result.status; throw error;
  }
  return body;
}
module.exports = { remoteJson, publicAddress };
