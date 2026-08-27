'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const MCP_SERVER_URL = 'https://mcp.silpo.ua/mcp';
const TOKEN_CACHE_PATH = path.join(__dirname, '..', '.token-cache.json');
const REDIRECT_PORT = Number(process.env.MCP_REDIRECT_PORT) || 9876;
const REDIRECT_URI = process.env.MCP_REDIRECT_URI || `http://localhost:${REDIRECT_PORT}/callback`;

function httpsRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function generateRandomString(length) {
  return crypto.randomBytes(length).toString('hex').substring(0, length);
}

function loadCachedToken() {
  try {
    const data = fs.readFileSync(TOKEN_CACHE_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function saveCachedToken(token) {
  try {
    fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(token, null, 2));
  } catch (e) {
    console.error('Failed to cache token:', e.message);
  }
}

async function discoverOAuthMetadata(serverUrl) {
  const parsed = new URL(serverUrl);

  // Step 1: Get protected resource metadata via 401 WWW-Authenticate header
  console.log('[MCP] Probing MCP endpoint for OAuth metadata...');
  const probeRes = await httpsRequest(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
  }, JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'initialize', params: {} }));

  if (probeRes.status === 401 && probeRes.headers['www-authenticate']) {
    const wwwAuth = probeRes.headers['www-authenticate'];
    const metadataMatch = wwwAuth.match(/resource_metadata="([^"]+)"/);
    if (metadataMatch) {
      // Step 2: Get protected resource metadata
      console.log('[MCP] Fetching protected resource metadata...');
      const resourceRes = await httpsRequest(metadataMatch[1], { method: 'GET' });
      if (resourceRes.status === 200) {
        const resourceData = JSON.parse(resourceRes.body);
        if (resourceData.authorization_servers && resourceData.authorization_servers.length > 0) {
          // Step 3: Get authorization server metadata
          const authServer = resourceData.authorization_servers[0];
          console.log('[MCP] Fetching OAuth server metadata from:', authServer);
          const authRes = await httpsRequest(`${authServer}/.well-known/oauth-authorization-server`, { method: 'GET' });
          if (authRes.status === 200) {
            return JSON.parse(authRes.body);
          }
        }
      }
    }
  }

  // Fallback: try direct discovery
  const metadataUrl = `${parsed.origin}/.well-known/oauth-authorization-server`;
  console.log('[MCP] Fallback: discovering OAuth metadata at:', metadataUrl);
  const res = await httpsRequest(metadataUrl, { method: 'GET' });
  if (res.status !== 200) {
    throw new Error(`OAuth metadata discovery failed: ${res.status}`);
  }
  return JSON.parse(res.body);
}

async function dynamicClientRegistration(registrationEndpoint) {
  console.log('[MCP] Registering client at:', registrationEndpoint);
  const clientMetadata = {
    client_name: 'AI Charity Connect',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'openid profile',
  };

  const res = await httpsRequest(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, JSON.stringify(clientMetadata));

  if (res.status >= 400) {
    throw new Error(`Client registration failed: ${res.status} ${res.body}`);
  }

  return JSON.parse(res.body);
}

async function exchangeCodeForToken(tokenEndpoint, code, clientId, redirectUri, codeVerifier) {
  console.log('[MCP] Exchanging authorization code for token...');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  }).toString();

  const res = await httpsRequest(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);

  if (res.status >= 400) {
    throw new Error(`Token exchange failed: ${res.status} ${res.body}`);
  }

  return JSON.parse(res.body);
}

async function refreshToken(tokenEndpoint, refreshToken, clientId) {
  console.log('[MCP] Refreshing token...');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  }).toString();

  const res = await httpsRequest(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);

  if (res.status >= 400) {
    return null;
  }

  return JSON.parse(res.body);
}

function openBrowser(url) {
  const { exec } = require('child_process');
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) console.error('[MCP] Failed to open browser:', err.message);
  });
}

async function waitForRedirect(port, expectedState) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Authentication timeout — no redirect received within 120s'));
    }, 120000);

    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url, `http://localhost:${port}`);
      if (parsed.pathname === '/callback') {
        const code = parsed.searchParams.get('code');
        const error = parsed.searchParams.get('error');
        const returnedState = parsed.searchParams.get('state');
        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><h1>Помилка авторизації</h1><p>Можна закрити це вікно.</p></body></html>');
          clearTimeout(timeout);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
        } else if (code && returnedState !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><h1>Невірний OAuth state</h1><p>Спробуйте підключення ще раз.</p></body></html>');
          clearTimeout(timeout);
          server.close();
          reject(new Error('OAuth state mismatch'));
        } else if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><h1>Авторизація успішна!</h1><p>Можна закрити це вікно та повернутись до застосунку.</p></body></html>');
          clearTimeout(timeout);
          server.close();
          resolve(code);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(port, () => {
      console.log(`[MCP] Waiting for OAuth redirect on port ${port}...`);
    });

    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function mcpJsonRpc(method, params = {}) {
  let token = loadCachedToken();

  const message = {
    jsonrpc: '2.0',
    id: generateRandomString(8),
    method,
    params,
  };

  const doRequest = (accessToken) => {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    return httpsRequest(MCP_SERVER_URL, {
      method: 'POST',
      headers,
    }, JSON.stringify(message));
  };

  let res = await doRequest(token?.access_token);

  // Handle 401 — need authentication
  if (res.status === 401) {
    console.log('[MCP] Not authenticated. Starting OAuth flow...');
    token = await authenticate();
    res = await doRequest(token.access_token);
  }

  if (res.status >= 400) {
    throw new Error(`MCP request failed: ${res.status} ${res.body.substring(0, 500)}`);
  }

  // Parse response — could be SSE or plain JSON
  let jsonBody;
  if (res.headers['content-type']?.includes('text/event-stream')) {
    // Extract JSON from SSE data lines
    const lines = res.body.split('\n');
    const dataLines = lines.filter(l => l.startsWith('data: ')).map(l => l.substring(6));
    jsonBody = JSON.parse(dataLines.join(''));
  } else {
    jsonBody = JSON.parse(res.body);
  }

  if (jsonBody.error) {
    throw new Error(`MCP error: ${JSON.stringify(jsonBody.error)}`);
  }

  if (jsonBody.result?.isError) {
    const message = (jsonBody.result.content || [])
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n') || 'Unknown tool error';
    throw new Error(`MCP tool error: ${message}`);
  }

  return jsonBody.result;
}

async function authenticate() {
  // 1. Discover OAuth metadata
  const metadata = await discoverOAuthMetadata(MCP_SERVER_URL);

  // 2. Dynamic client registration
  const client = await dynamicClientRegistration(metadata.registration_endpoint);

  // 3. Generate PKCE
  const pkce = generatePKCE();
  const state = generateRandomString(32);

  // 4. Build authorization URL
  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: REDIRECT_URI,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state,
    scope: 'openid profile',
  });

  const authUrl = `${metadata.authorization_endpoint}?${authParams.toString()}`;
  console.log('[MCP] Opening browser for authentication...');
  console.log('[MCP] Auth URL:', authUrl);
  openBrowser(authUrl);

  // 5. Wait for redirect with authorization code
  const code = await waitForRedirect(REDIRECT_PORT, state);

  // 6. Exchange code for token
  const tokenResponse = await exchangeCodeForToken(
    metadata.token_endpoint,
    code,
    client.client_id,
    REDIRECT_URI,
    pkce.verifier
  );

  tokenResponse.client_id = client.client_id;
  tokenResponse.token_endpoint = metadata.token_endpoint;
  tokenResponse.expires_at = Date.now() + (tokenResponse.expires_in * 1000);

  saveCachedToken(tokenResponse);
  console.log('[MCP] Authentication successful! Token cached.');

  return tokenResponse;
}

async function ensureValidToken() {
  let token = loadCachedToken();
  if (!token) {
    return false;
  }

  // Check if token is expired or about to expire
  if (token.expires_at && Date.now() > token.expires_at - 60000) {
    if (token.refresh_token) {
      const newToken = await refreshToken(token.token_endpoint, token.refresh_token, token.client_id);
      if (newToken) {
        newToken.client_id = token.client_id;
        newToken.token_endpoint = token.token_endpoint;
        newToken.refresh_token = newToken.refresh_token || token.refresh_token;
        newToken.scope = newToken.scope || token.scope;
        newToken.expires_at = Date.now() + (newToken.expires_in * 1000);
        saveCachedToken(newToken);
        return true;
      }
    }
    return false;
  }

  return true;
}

async function listTools() {
  return mcpJsonRpc('tools/list');
}

async function callTool(name, args = {}) {
  return mcpJsonRpc('tools/call', { name, arguments: args });
}

async function initialize() {
  return mcpJsonRpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'ai-charity-connect', version: '1.0.0' },
  });
}

async function healthCheck() {
  if (!await ensureValidToken()) {
    return { authenticated: false, reachable: false, toolCount: 0 };
  }
  try {
    await initialize();
    const result = await listTools();
    return {
      authenticated: true,
      reachable: true,
      toolCount: Array.isArray(result.tools) ? result.tools.length : 0,
    };
  } catch (error) {
    return { authenticated: true, reachable: false, toolCount: 0, error: String(error?.message || error || 'Unknown MCP error') };
  }
}

module.exports = {
  initialize,
  listTools,
  callTool,
  ensureValidToken,
  authenticate,
  healthCheck,
};
