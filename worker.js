const MCP_SERVER_URL = 'https://mcp.silpo.ua/mcp';
const TOKEN_KEY = 'silpo-oauth-token';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

function base64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function randomString(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return base64Url(data);
}

async function sha256(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

function readCookie(request, name) {
  const prefix = `${name}=`;
  return (request.headers.get('Cookie') || '').split(';').map(item => item.trim()).find(item => item.startsWith(prefix))?.slice(prefix.length);
}

async function isAdmin(request, env) {
  const session = readCookie(request, 'mcp_admin');
  if (!session || !env.MCP_SESSION_SECRET) return false;
  const separator = session.lastIndexOf('.');
  if (separator < 1) return false;
  const payload = session.slice(0, separator);
  if (session.slice(separator + 1) !== await sign(payload, env.MCP_SESSION_SECRET)) return false;
  try { return JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/'))).expiresAt > Date.now(); } catch { return false; }
}

async function requireAdmin(request, env) {
  if (!await isAdmin(request, env)) throw new HttpError(401, 'Потрібен адмін-доступ для live MCP.');
}

async function issueAdminSession(env) {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000, nonce: randomString(12) })));
  return `mcp_admin=${payload}.${await sign(payload, env.MCP_SESSION_SECRET)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

async function readJson(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'Некоректний JSON-запит.'); }
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new HttpError(502, `Зовнішній сервіс повернув ${response.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new HttpError(502, 'Зовнішній сервіс повернув неочікувану відповідь.'); }
}

async function discoverOAuthMetadata() {
  const probe = await fetch(MCP_SERVER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'probe', method: 'initialize', params: {} }) });
  const metadataUrl = probe.headers.get('WWW-Authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1];
  if (!metadataUrl) throw new HttpError(502, 'MCP не повернув OAuth resource metadata.');
  const resource = await fetchJson(metadataUrl);
  const authorizationServer = resource.authorization_servers?.[0];
  if (!authorizationServer) throw new HttpError(502, 'OAuth authorization server не знайдено.');
  return fetchJson(`${authorizationServer}/.well-known/oauth-authorization-server`);
}

async function createAuthorizationUrl(request, env) {
  const metadata = await discoverOAuthMetadata();
  const redirectUri = `${new URL(request.url).origin}/api/mcp-callback`;
  const client = await fetchJson(metadata.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'AI Charity Connect', redirect_uris: [redirectUri], grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'openid profile' }) });
  const verifier = randomString(48);
  const state = randomString(32);
  await env.MCP_STATE.put(`oauth:${state}`, JSON.stringify({ verifier, clientId: client.client_id, tokenEndpoint: metadata.token_endpoint, redirectUri }), { expirationTtl: 600 });
  const params = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri, code_challenge: await sha256(verifier), code_challenge_method: 'S256', state, scope: 'openid profile' });
  return `${metadata.authorization_endpoint}?${params}`;
}

async function completeAuthorization(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error')) throw new HttpError(400, `OAuth error: ${url.searchParams.get('error')}`);
  if (!state || !code) throw new HttpError(400, 'OAuth callback не містить code або state.');
  const saved = await env.MCP_STATE.get(`oauth:${state}`, 'json');
  await env.MCP_STATE.delete(`oauth:${state}`);
  if (!saved) throw new HttpError(400, 'OAuth state прострочений або не збігається. Спробуйте ще раз.');
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: saved.clientId, redirect_uri: saved.redirectUri, code_verifier: saved.verifier });
  const token = await fetchJson(saved.tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  token.clientId = saved.clientId;
  token.tokenEndpoint = saved.tokenEndpoint;
  token.expiresAt = Date.now() + Number(token.expires_in || 3600) * 1000;
  await env.MCP_STATE.put(TOKEN_KEY, JSON.stringify(token));
  return Response.redirect(`${new URL(request.url).origin}/?mcp=connected`, 302);
}

async function getValidToken(env) {
  const token = await env.MCP_STATE.get(TOKEN_KEY, 'json');
  if (!token) return null;
  if (Date.now() < Number(token.expiresAt || 0) - 60_000) return token;
  if (!token.refresh_token) return null;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: token.clientId });
  const refreshed = await fetchJson(token.tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  refreshed.clientId = token.clientId;
  refreshed.tokenEndpoint = token.tokenEndpoint;
  refreshed.refresh_token = refreshed.refresh_token || token.refresh_token;
  refreshed.expiresAt = Date.now() + Number(refreshed.expires_in || 3600) * 1000;
  await env.MCP_STATE.put(TOKEN_KEY, JSON.stringify(refreshed));
  return refreshed;
}

async function mcpRpc(env, method, params = {}) {
  const token = await getValidToken(env);
  if (!token) throw new HttpError(401, 'MCP ще не підключено або токен прострочений.');
  const response = await fetch(MCP_SERVER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: randomString(8), method, params }) });
  const text = await response.text();
  if (!response.ok) throw new HttpError(response.status, `MCP request failed: ${text.slice(0, 300)}`);
  const payload = response.headers.get('Content-Type')?.includes('text/event-stream') ? JSON.parse(text.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('')) : JSON.parse(text);
  if (payload.error) throw new HttpError(502, `MCP error: ${JSON.stringify(payload.error)}`);
  if (payload.result?.isError) throw new HttpError(502, 'MCP tool повернув помилку.');
  return payload.result;
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/api/admin-login') {
    if (!env.MCP_ADMIN_PASSWORD || !env.MCP_SESSION_SECRET) throw new HttpError(503, 'Live MCP ще не налаштовано: відсутні server secrets.');
    const body = await readJson(request);
    if (body.password !== env.MCP_ADMIN_PASSWORD) throw new HttpError(401, 'Невірний адмін-код.');
    return json({ success: true }, 200, { 'Set-Cookie': await issueAdminSession(env) });
  }
  if (request.method === 'POST' && url.pathname === '/api/mcp-authenticate') {
    await requireAdmin(request, env);
    return json({ authorizationUrl: await createAuthorizationUrl(request, env) });
  }
  if (request.method === 'GET' && url.pathname === '/api/mcp-callback') return completeAuthorization(request, env);
  if (request.method === 'GET' && url.pathname === '/api/status') {
    const token = await getValidToken(env);
    if (!token) return json({ status: 'online', mcpAuthenticated: false, mcpConnected: false, mcpToolCount: 0, dataSource: 'demo' });
    try {
      const tools = await mcpRpc(env, 'tools/list');
      return json({ status: 'online', mcpAuthenticated: true, mcpConnected: true, mcpToolCount: tools.tools?.length || 0, dataSource: 'mcp' });
    } catch (error) {
      return json({ status: 'online', mcpAuthenticated: true, mcpConnected: false, mcpToolCount: 0, mcpError: error.message, dataSource: 'demo' });
    }
  }
  if (request.method === 'GET' && url.pathname === '/api/mcp-tools') {
    await requireAdmin(request, env);
    const result = await mcpRpc(env, 'tools/list');
    return json({ tools: result.tools || [], count: result.tools?.length || 0 });
  }
  if (request.method === 'GET' && url.pathname === '/api/mcp-proof') {
    await requireAdmin(request, env);
    const names = ['silpo_get_loyalty_info', 'silpo_get_my_food_restrictions', 'silpo_get_my_online_orders'];
    const checks = await Promise.all(names.map(async tool => {
      try { await mcpRpc(env, 'tools/call', { name: tool, arguments: {} }); return { tool, success: true, summary: 'Live MCP-виклик виконано' }; }
      catch (error) { return { tool, success: false, summary: error.message }; }
    }));
    return json({ source: 'mcp', checks });
  }
  throw new HttpError(404, 'API route не знайдено.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) return json({});
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error.message || 'Невідома помилка Worker.' }, error instanceof HttpError ? error.status : 500);
    }
  },
};
