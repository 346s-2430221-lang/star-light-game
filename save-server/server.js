'use strict';
const http = require('http');
const PORT = Number(process.env.PORT || 10000);
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const TABLE = 'device_server_saves';
const MAX_BODY = 512 * 1024;
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'content-type': 'application/json; charset=utf-8'
};
function reply(res, status, body) { res.writeHead(status, cors); res.end(JSON.stringify(body)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > MAX_BODY) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('BAD_JSON')); } });
    req.on('error', reject);
  });
}
function validDeviceId(value) { return /^[a-f0-9-]{36}$/i.test(String(value || '')); }
function validServerId(value) { return /^[a-zA-Z0-9_-]{1,40}$/.test(String(value || '')); }
async function db(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('DATABASE_NOT_CONFIGURED');
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error('DATABASE_HTTP_' + response.status + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') {
    return reply(res, 200, { ok: true, service: 'starlight-device-save-server', databaseConfigured: !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) });
  }
  if (url.pathname !== '/save') return reply(res, 404, { ok: false, error: 'NOT_FOUND' });
  try {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const deviceId = String(body.deviceId || '');
      const serverId = String(body.serverId || 'solo');
      const save = body.save;
      if (!validDeviceId(deviceId) || !validServerId(serverId) || !save || typeof save !== 'object' || !save.player) return reply(res, 400, { ok: false, error: 'INVALID_SAVE' });
      const record = { device_id: deviceId, server_id: serverId, payload: save, updated_at: new Date().toISOString() };
      await db(TABLE + '?on_conflict=device_id,server_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(record)
      });
      return reply(res, 200, { ok: true, saved: true, updatedAt: record.updated_at });
    }
    if (req.method === 'GET') {
      const deviceId = String(url.searchParams.get('deviceId') || '');
      const serverId = String(url.searchParams.get('serverId') || 'solo');
      if (!validDeviceId(deviceId) || !validServerId(serverId)) return reply(res, 400, { ok: false, error: 'INVALID_DEVICE_OR_SERVER_ID' });
      const rows = await db(TABLE + '?select=payload,updated_at&device_id=eq.' + encodeURIComponent(deviceId) + '&server_id=eq.' + encodeURIComponent(serverId) + '&limit=1');
      const row = Array.isArray(rows) ? rows[0] : null;
      return reply(res, 200, { ok: true, save: row ? row.payload : null, updatedAt: row ? row.updated_at : null });
    }
    return reply(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    const missing = error.message === 'DATABASE_NOT_CONFIGURED';
    console.error('[save-api]', error.message);
    return reply(res, missing ? 503 : 500, { ok: false, error: missing ? 'DATABASE_NOT_CONFIGURED' : 'SAVE_SERVICE_ERROR' });
  }
});
server.listen(PORT, '0.0.0.0', () => console.log('Starlight device save API listening on ' + PORT));
