// ─── Mock Installation API ──────────────────────────────────────────
// Serves device and job data for the Sunbelt Installer app.
// Zero dependencies — runs on Node's built-in http/https/crypto modules.
//
//   node server/index.js            # starts on PORT (default 4000)
//
// Okta verification:
//   Set OKTA_ISSUER to enforce Okta access-token verification on every
//   data endpoint. When unset, the API runs in open mock mode (the
//   Authorization header is accepted but not checked).
//
//     OKTA_ISSUER=https://trial-1152722.okta.com \
//     node server/index.js
//
//   The issuer's shape selects the authorization server: a bare domain is
//   the Org server (endpoints under /oauth2/v1/*); an issuer ending in
//   /oauth2/<id> is a Custom server. JWKS URL and default audience follow.
//
// Endpoints:
//   GET /health        → { status: 'ok' }   (always public)
//   GET /devices       → Device[]   (optional ?status= filter)
//   GET /devices/:id   → Device
//   GET /jobs          → Job[]       (optional ?status= / ?assignedTo= filter)
//   GET /jobs/:id      → Job

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, 'data');

// ─── Okta access-token verification ─────────────────────────────────
// Verification is enabled only when an issuer is configured. This keeps
// the server usable as a pure mock while allowing real Okta enforcement
// in demos/production by setting OKTA_ISSUER.
const OKTA_ISSUER = (process.env.OKTA_ISSUER || '').replace(/\/+$/, '');
const AUTH_ENABLED = Boolean(OKTA_ISSUER);

// Okta exposes two kinds of authorization server, and their endpoints live
// under different paths (mirrors createOktaDiscovery in App.js):
//   • Org server    → issuer is the bare domain (https://x.okta.com);
//                     endpoints are under /oauth2/v1/*, tokens carry
//                     aud = the org URL itself.
//   • Custom server → issuer ends in /oauth2/<id> (e.g. /oauth2/default);
//                     endpoints are under /oauth2/<id>/v1/*, tokens carry
//                     aud = api://<id>.
const IS_ORG_SERVER = AUTH_ENABLED && !/\/oauth2(\/|$)/.test(OKTA_ISSUER);
const OKTA_METADATA_ROOT = IS_ORG_SERVER ? `${OKTA_ISSUER}/oauth2` : OKTA_ISSUER;
const OKTA_JWKS_URL = `${OKTA_METADATA_ROOT}/v1/keys`;
const OKTA_AUDIENCE =
  process.env.OKTA_AUDIENCE || (IS_ORG_SERVER ? OKTA_ISSUER : 'api://default');

// Cache Okta's JSON Web Key Set so we don't refetch it on every request.
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour
let jwksCache = { keys: [], fetchedAt: 0 };

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`GET ${url} → HTTP ${res.statusCode}`));
        }
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

// Return the JWK matching `kid`, refetching the JWKS if the key is
// unknown or the cache has expired (Okta rotates signing keys).
async function getSigningKey(kid) {
  const fresh =
    jwksCache.keys.length && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  let key = fresh ? jwksCache.keys.find((k) => k.kid === kid) : null;
  if (!key) {
    const jwks = await fetchJson(OKTA_JWKS_URL);
    jwksCache = { keys: jwks.keys || [], fetchedAt: Date.now() };
    key = jwksCache.keys.find((k) => k.kid === kid);
  }
  return key || null;
}

function decodeSegment(segment) {
  return Buffer.from(segment, 'base64url');
}

// Verify an Okta RS256 access token: signature against the JWKS, then
// the standard issuer/audience/expiry claims. Throws on any failure.
async function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(decodeSegment(headerB64).toString('utf8'));
  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported signing algorithm: ${header.alg}`);
  }
  if (!header.kid) throw new Error('Token header missing kid');

  const jwk = await getSigningKey(header.kid);
  if (!jwk) throw new Error('No matching signing key for kid');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signatureValid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerB64}.${payloadB64}`),
    publicKey,
    decodeSegment(sigB64)
  );
  if (!signatureValid) throw new Error('Invalid token signature');

  const payload = JSON.parse(decodeSegment(payloadB64).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  const skew = 60; // seconds of allowed clock skew

  if (payload.iss !== OKTA_ISSUER) throw new Error('Issuer mismatch');

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(OKTA_AUDIENCE)) throw new Error('Audience mismatch');

  if (typeof payload.exp === 'number' && now > payload.exp + skew) {
    throw new Error('Token expired');
  }
  if (typeof payload.nbf === 'number' && now + skew < payload.nbf) {
    throw new Error('Token not yet valid');
  }

  return payload;
}

function getBearerToken(req) {
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// Load mock data fresh on each request so edits to the JSON show up
// without restarting the server.
function loadData(name) {
  const raw = fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw);
}

function sendJson(res, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    // Allow the Expo web build / browsers to call the API directly.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    ...extraHeaders
  });
  res.end(payload);
}

function filterByQuery(items, query) {
  return items.filter((item) =>
    Object.entries(query).every(([key, value]) => {
      if (item[key] === undefined) return true;
      return String(item[key]).toLowerCase() === String(value).toLowerCase();
    })
  );
}

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(searchParams.entries());

  // Pre-flight CORS request.
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  // Log every request so it's easy to see the app hitting the API.
  console.log(`${req.method} ${req.url}`);

  try {
    // Health check is always public.
    if (pathname === '/health') {
      return sendJson(res, 200, { status: 'ok' });
    }

    // Enforce Okta verification on every data endpoint when configured.
    if (AUTH_ENABLED) {
      const token = getBearerToken(req);
      if (!token) {
        return sendJson(
          res,
          401,
          { error: 'Missing bearer token' },
          { 'WWW-Authenticate': 'Bearer' }
        );
      }
      try {
        await verifyToken(token);
      } catch (err) {
        console.warn(`Auth rejected: ${err.message}`);
        return sendJson(
          res,
          401,
          { error: 'Invalid token', detail: err.message },
          { 'WWW-Authenticate': `Bearer error="invalid_token"` }
        );
      }
    }

    // ── Devices ──────────────────────────────────────────────
    if (pathname === '/devices') {
      const devices = loadData('devices');
      return sendJson(res, 200, filterByQuery(devices, query));
    }

    const deviceMatch = pathname.match(/^\/devices\/(\d+)$/);
    if (deviceMatch) {
      const id = Number(deviceMatch[1]);
      const device = loadData('devices').find((d) => d.id === id);
      return device
        ? sendJson(res, 200, device)
        : sendJson(res, 404, { error: `Device ${id} not found` });
    }

    // ── Jobs ─────────────────────────────────────────────────
    if (pathname === '/jobs') {
      const jobs = loadData('jobs');
      return sendJson(res, 200, filterByQuery(jobs, query));
    }

    const jobMatch = pathname.match(/^\/jobs\/(\d+)$/);
    if (jobMatch) {
      const id = Number(jobMatch[1]);
      const job = loadData('jobs').find((j) => j.id === id);
      return job
        ? sendJson(res, 200, job)
        : sendJson(res, 404, { error: `Job ${id} not found` });
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Mock Installation API running at http://localhost:${PORT}`);
  if (AUTH_ENABLED) {
    console.log(`  Okta verification: ON (${IS_ORG_SERVER ? 'Org' : 'Custom'} authorization server)`);
    console.log(`    issuer   = ${OKTA_ISSUER}`);
    console.log(`    audience = ${OKTA_AUDIENCE}`);
    console.log(`    jwks     = ${OKTA_JWKS_URL}`);
  } else {
    console.log(`  Okta verification: OFF (set OKTA_ISSUER to enable)`);
  }
  console.log(`  GET /devices  → ${path.join(DATA_DIR, 'devices.json')}`);
  console.log(`  GET /jobs     → ${path.join(DATA_DIR, 'jobs.json')}`);
});
