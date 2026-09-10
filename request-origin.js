function sameOrigin(req, env = process.env) {
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site') return false;
  if (!req.headers.origin) return true;
  let origin;
  try { origin = new URL(req.headers.origin); } catch { return false; }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) return false;

  const allowed = new Set();
  for (const value of [env.APP_ORIGIN, env.RAILWAY_PUBLIC_DOMAIN && `https://${env.RAILWAY_PUBLIC_DOMAIN}`]) {
    if (!value) continue;
    try {
      const url = new URL(value.trim());
      if (['http:', 'https:'].includes(url.protocol)) allowed.add(url.origin);
    } catch { /* An outdated variable must not prevent a valid same-origin request. */ }
  }
  if (allowed.has(origin.origin)) return true;

  // Browsers control Sec-Fetch-Site; scripts on another site cannot forge it.
  // Host stays tied to the requested site even when TLS terminates at a proxy.
  if (site === 'same-origin' && origin.host === req.headers.host) return true;

  const trustedProxy = env.TRUST_PROXY === '1' || Boolean(env.RAILWAY_SERVICE_ID);
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = req.socket.encrypted ? 'https' : trustedProxy && forwardedProto === 'https' ? 'https' : 'http';
  const host = trustedProxy ? (req.headers['x-forwarded-host'] || req.headers.host) : req.headers.host;
  // With an explicit origin, older clients must match the configured allowlist.
  if (allowed.size && site !== 'same-origin') return false;
  return origin.origin === `${protocol}://${host}`;
}

module.exports = { sameOrigin };
