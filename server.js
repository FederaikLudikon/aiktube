// AikTube local server — gestisce OAuth YouTube
// Avvio: node server.js
// Poi apri: http://localhost:51847

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 51847;
const HOST = 'localhost';
const ORIGIN = `http://${HOST}:${PORT}`;
const ALT_ORIGIN = `http://127.0.0.1:${PORT}`;
const CONFIG_FILE = path.join(__dirname, 'aiktube-config.json');
const API_CLIENT_HEADER = 'x-aiktube-client';
const TOKEN_SKEW_MS = 30 * 1000;

let pendingAuthState = null;

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(data) {
  const merged = { ...loadConfig(), ...data };
  Object.keys(merged).forEach(key => {
    if (merged[key] === undefined) delete merged[key];
  });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

function clearTokens() {
  saveConfig({
    accessToken: undefined,
    refreshToken: undefined,
    tokenExpiry: undefined,
  });
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readRequestBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function httpsRequest(reqUrl, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(reqUrl);
    const bodyStr = body == null
      ? null
      : typeof body === 'string'
        ? body
        : new URLSearchParams(body).toString();

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers },
    };

    if (bodyStr != null) {
      options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const request = https.request(options, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => {
        resolve({
          status: response.statusCode || 500,
          headers: response.headers,
          raw,
          data: parseJsonSafe(raw),
        });
      });
    });

    request.on('error', reject);

    if (bodyStr != null) request.write(bodyStr);
    request.end();
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function popupMessagePage(type, extra = {}) {
  const payload = JSON.stringify({ type, ...extra }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><title>AikTube OAuth</title></head>
<body>
<script>
  const message = ${payload};
  const targetOrigin = window.location.origin;
  window.opener?.postMessage(message, targetOrigin);
  window.close();
</script>
</body>
</html>`;
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Serve un referrer cross-origin per l'embed YouTube, altrimenti può comparire Error 153.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function isTrustedOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.origin === ORIGIN || parsed.origin === ALT_ORIGIN;
  } catch {
    return false;
  }
}

function isLoopbackAddress(address = '') {
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

function isTrustedApiRequest(req) {
  if (req.headers[API_CLIENT_HEADER] !== '1') return false;
  if (!isLoopbackAddress(req.socket.remoteAddress || '')) return false;

  const { origin, referer } = req.headers;
  if (origin && !isTrustedOrigin(origin)) return false;
  if (referer && !isTrustedOrigin(referer)) return false;

  return true;
}

function isAllowedYouTubeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname !== 'www.googleapis.com') return null;
    if (!parsed.pathname.startsWith('/youtube/')) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function refreshAccessToken(cfg = loadConfig()) {
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    return { ok: false, status: 401, error: 'no refresh token' };
  }

  const tokenResponse = await httpsRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    },
  });

  const tokenData = tokenResponse.data || {};
  if (tokenResponse.status >= 200 && tokenResponse.status < 300 && tokenData.access_token) {
    const tokenExpiry = Date.now() + (tokenData.expires_in || 3600) * 1000;
    saveConfig({
      accessToken: tokenData.access_token,
      refreshToken: cfg.refreshToken,
      tokenExpiry,
    });
    return {
      ok: true,
      status: 200,
      accessToken: tokenData.access_token,
      tokenExpiry,
    };
  }

  return {
    ok: false,
    status: tokenResponse.status,
    error: tokenData.error_description || tokenData.error || 'refresh failed',
    details: tokenData,
  };
}

async function ensureValidAccessToken(cfg = loadConfig()) {
  if (cfg.accessToken && Date.now() < (cfg.tokenExpiry || 0) - TOKEN_SKEW_MS) {
    return { ok: true, status: 200, accessToken: cfg.accessToken };
  }

  if (!cfg.refreshToken) {
    return { ok: false, status: 401, error: 'not authed' };
  }

  return refreshAccessToken(cfg);
}

async function revokeToken(token) {
  if (!token) return;
  try {
    await httpsRequest('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      body: { token },
    });
  } catch {
    // Anche se la revoca remota fallisce, il logout locale va comunque completato.
  }
}

function sendApiForbidden(res) {
  sendJson(res, 403, { error: 'forbidden' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);

  const reqUrl = new URL(req.url, ORIGIN);
  const pathname = reqUrl.pathname;
  const isApiRoute = pathname.startsWith('/api/');

  if (req.method === 'OPTIONS' && isApiRoute) {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── API: salva config (clientId + clientSecret)
  if (pathname === '/api/config' && req.method === 'POST') {
    if (!isTrustedApiRequest(req)) {
      sendApiForbidden(res);
      return;
    }

    try {
      const body = await readRequestBody(req);
      const data = JSON.parse(body);

      if (!data.clientId || !data.clientSecret) {
        sendJson(res, 400, { error: 'clientId e clientSecret mancanti' });
        return;
      }

      saveConfig({
        clientId: String(data.clientId).trim(),
        clientSecret: String(data.clientSecret).trim(),
      });
      sendJson(res, 200, { ok: true });
    } catch {
      sendJson(res, 400, { error: 'bad json' });
    }
    return;
  }

  // ── API: avvia OAuth → restituisce URL di redirect
  if (pathname === '/api/auth/start' && req.method === 'GET') {
    if (!isTrustedApiRequest(req)) {
      sendApiForbidden(res);
      return;
    }

    const cfg = loadConfig();
    if (!cfg.clientId || !cfg.clientSecret) {
      sendJson(res, 400, { error: 'clientId e clientSecret mancanti' });
      return;
    }

    pendingAuthState = crypto.randomBytes(24).toString('hex');
    const redirectUri = `${ORIGIN}/api/auth/callback`;
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state: pendingAuthState,
    });
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
    sendJson(res, 200, { url: authUrl, state: pendingAuthState });
    return;
  }

  // ── OAuth callback: scambia code → token
  if (pathname === '/api/auth/callback') {
    const code = reqUrl.searchParams.get('code');
    const error = reqUrl.searchParams.get('error');
    const state = reqUrl.searchParams.get('state');

    if (error || !code) {
      sendHtml(res, 200, popupMessagePage('auth_error', {
        error: error || 'no code',
        state,
      }));
      return;
    }

    if (!pendingAuthState || state !== pendingAuthState) {
      pendingAuthState = null;
      sendHtml(res, 200, popupMessagePage('auth_error', {
        error: 'invalid auth state',
        state,
      }));
      return;
    }

    try {
      const cfg = loadConfig();
      const redirectUri = `${ORIGIN}/api/auth/callback`;
      const tokenResponse = await httpsRequest('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: {
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        },
      });
      const tokenData = tokenResponse.data || {};
      pendingAuthState = null;

      if (tokenResponse.status >= 200 && tokenResponse.status < 300 && tokenData.access_token) {
        saveConfig({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || cfg.refreshToken,
          tokenExpiry: Date.now() + (tokenData.expires_in || 3600) * 1000,
        });
        sendHtml(res, 200, popupMessagePage('auth_success', { state }));
      } else {
        sendHtml(res, 200, popupMessagePage('auth_error', {
          error: tokenData.error_description || tokenData.error || 'oauth failed',
          state,
        }));
      }
    } catch (errorObj) {
      pendingAuthState = null;
      sendHtml(res, 200, popupMessagePage('auth_error', {
        error: errorObj.message,
        state,
      }));
    }
    return;
  }

  // ── API: stato auth
  if (pathname === '/api/auth/status' && req.method === 'GET') {
    if (!isTrustedApiRequest(req)) {
      sendApiForbidden(res);
      return;
    }

    try {
      const auth = await ensureValidAccessToken(loadConfig());
      const latestCfg = loadConfig();
      sendJson(res, 200, {
        authed: auth.ok,
        hasRefresh: !!latestCfg.refreshToken,
      });
    } catch (errorObj) {
      sendJson(res, 500, { error: errorObj.message });
    }
    return;
  }

  // ── API: refresh token
  if (pathname === '/api/auth/refresh' && req.method === 'POST') {
    if (!isTrustedApiRequest(req)) {
      sendApiForbidden(res);
      return;
    }

    try {
      const result = await refreshAccessToken(loadConfig());
      if (!result.ok) {
        sendJson(res, result.status || 401, { error: result.error, details: result.details || null });
        return;
      }
      sendJson(res, 200, { ok: true, tokenExpiry: result.tokenExpiry });
    } catch (errorObj) {
      sendJson(res, 500, { error: errorObj.message });
    }
    return;
  }

  // ── API: logout/revoke
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    if (!isTrustedApiRequest(req)) {
      sendApiForbidden(res);
      return;
    }

    const cfg = loadConfig();
    await Promise.allSettled([
      revokeToken(cfg.accessToken),
      revokeToken(cfg.refreshToken),
    ]);
    pendingAuthState = null;
    clearTokens();
    sendJson(res, 200, { ok: true });
    return;
  }

  // ── API: proxy YouTube (token gestito server-side)
  if (pathname === '/api/youtube' && req.method === 'GET') {
    if (!isTrustedApiRequest(req)) {
      sendApiForbidden(res);
      return;
    }

    const ytUrl = isAllowedYouTubeUrl(reqUrl.searchParams.get('url') || '');
    if (!ytUrl) {
      sendJson(res, 400, { error: 'invalid url' });
      return;
    }

    try {
      let auth = await ensureValidAccessToken(loadConfig());
      if (!auth.ok) {
        sendJson(res, 401, { error: 'Token scaduto — riconnetti YouTube' });
        return;
      }

      ytUrl.searchParams.set('access_token', auth.accessToken);
      let upstream = await httpsRequest(ytUrl.toString());

      if (upstream.status === 401) {
        auth = await refreshAccessToken(loadConfig());
        if (auth.ok) {
          ytUrl.searchParams.set('access_token', auth.accessToken);
          upstream = await httpsRequest(ytUrl.toString());
        }
      }

      if (upstream.status >= 200 && upstream.status < 300) {
        sendJson(res, upstream.status, upstream.data || {});
        return;
      }

      const errorMessage = upstream.data?.error_description
        || upstream.data?.error?.message
        || upstream.data?.error
        || upstream.raw
        || 'upstream error';

      sendJson(res, upstream.status || 502, {
        error: errorMessage,
        details: upstream.data || null,
      });
    } catch (errorObj) {
      sendJson(res, 500, { error: errorObj.message });
    }
    return;
  }

  // ── Servi file statici
  const relativePath = pathname === '/'
    ? 'AikTube.html'
    : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(__dirname, relativePath);

  if (!filePath.startsWith(__dirname + path.sep) && filePath !== path.join(__dirname, 'AikTube.html')) {
    res.writeHead(403);
    res.end();
    return;
  }

  const blockedFiles = new Set(['aiktube-config.json', 'DaGooglePlatform.json']);
  if (blockedFiles.has(path.basename(filePath))) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'text/plain; charset=utf-8',
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n✅  AikTube server attivo → ${ORIGIN}\n`);
});
