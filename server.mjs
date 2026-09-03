import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSemanticImage } from './semantic-analyzer-core.mjs';
import { MAX_JSON_BYTES, allowedOrigin, clientAddress, enforceRateLimit, publicError, validateDeclaredLength, validateJsonContentType } from './backend-http-security.mjs';
import { SupportTicketRepository } from './support-ticket-repository.mjs';
import { UsageLedgerRepository, buildUsageEvent } from './ai-usage-ledger.mjs';

const root = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]+$/, '');
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const supportTickets = new SupportTicketRepository(process.env.SUPPORT_TICKET_STORE || resolve(root, 'data', 'support-tickets.json'));
const usageLedger = new UsageLedgerRepository(process.env.AI_USAGE_LEDGER_STORE || resolve(root, 'data', 'ai-usage-ledger.json'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

async function loadLocalEnvironment() {
  if (process.env.OPENAI_API_KEY) return;
  try {
    const text = await readFile(resolve(root, '.env.local'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {}
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Request JSON is invalid.'), { statusCode: 400 }); }
}

function supportError(response, error) {
  const status = Number(error?.statusCode) || 500;
  const body = status >= 500 ? { error: 'Support ticket service is unavailable.', code: 'SUPPORT_TICKET_UNAVAILABLE' } : { error: error.message || 'Support ticket request is invalid.', code: error.code || 'INVALID_SUPPORT_TICKET' };
  return sendJson(response, status, body);
}
function adminAuthorized(request) { const token = process.env.NITROS_ADMIN_TOKEN; return Boolean(token) && request.headers.authorization === `Bearer ${token}`; }

await loadLocalEnvironment();
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/api/admin/ai-usage') {
      if (!adminAuthorized(request)) return sendJson(response, 401, { error: 'Admin authorization is required.', code: 'ADMIN_AUTH_REQUIRED' });
      if (request.method === 'GET') return sendJson(response, 200, await usageLedger.report());
      if (request.method === 'PATCH') { validateJsonContentType(request.headers['content-type']); const settings = await readJson(request); const permitted = ['monthlyBudgetUsd','warningPercent','criticalPercent','hardStopEnabled']; const clean = Object.fromEntries(permitted.filter(key => Object.hasOwn(settings,key)).map(key => [key, key === 'hardStopEnabled' ? settings[key] === true : Number(settings[key])])); if (Object.values(clean).some(value => typeof value === 'number' && (!Number.isFinite(value) || value < 0))) return sendJson(response, 400, { error: 'Budget settings are invalid.', code: 'INVALID_BUDGET_SETTINGS' }); await usageLedger.updateSettings(clean); return sendJson(response, 200, await usageLedger.report()); }
      response.setHeader('Allow', 'GET, PATCH'); return sendJson(response, 405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
    }
    if (url.pathname === '/api/support-tickets' || url.pathname.startsWith('/api/support-tickets/')) {
      response.setHeader('Vary', 'Origin');
      const origin = request.headers.origin;
      if (origin) {
        const sameOrigin = new URL(origin).host === request.headers.host;
        if (!sameOrigin && !allowedOrigin(origin)) return sendJson(response, 403, { error: 'Origin is not allowed.', code: 'ORIGIN_FORBIDDEN' });
        response.setHeader('Access-Control-Allow-Origin', origin);
      }
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      }
      try {
        enforceRateLimit(`support-ticket|${clientAddress(request.headers, request.socket.remoteAddress || 'unknown')}`);
        const id = decodeURIComponent(url.pathname.slice('/api/support-tickets/'.length));
        if (request.method === 'GET' && url.pathname === '/api/support-tickets') return sendJson(response, 200, { tickets: await supportTickets.list() });
        if (request.method === 'GET' && id) { const ticket = await supportTickets.get(id); return ticket ? sendJson(response, 200, { ticket }) : sendJson(response, 404, { error: 'Support ticket was not found.', code: 'TICKET_NOT_FOUND' }); }
        if (request.method === 'POST' && url.pathname === '/api/support-tickets') { validateJsonContentType(request.headers['content-type']); validateDeclaredLength(request.headers['content-length']); const result = await supportTickets.create(await readJson(request)); return sendJson(response, result.created ? 201 : 200, { ticket: result.ticket, duplicate: !result.created }); }
        if (request.method === 'PATCH' && id) { validateJsonContentType(request.headers['content-type']); validateDeclaredLength(request.headers['content-length']); const ticket = await supportTickets.update(id, await readJson(request)); return ticket ? sendJson(response, 200, { ticket }) : sendJson(response, 404, { error: 'Support ticket was not found.', code: 'TICKET_NOT_FOUND' }); }
        response.setHeader('Allow', 'GET, POST, PATCH, OPTIONS');
        return sendJson(response, 405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
      } catch (error) { return supportError(response, error); }
    }
    if (url.pathname === '/api/semantic-image-analysis') {
      response.setHeader('Vary', 'Origin');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const origin = request.headers.origin;
      if (!allowedOrigin(origin)) return sendJson(response, 403, { error: 'Origin is not allowed.', code: 'ORIGIN_FORBIDDEN' });
      response.setHeader('Access-Control-Allow-Origin', origin);
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        response.setHeader('Access-Control-Max-Age', '600');
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        return response.end();
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST, OPTIONS');
        return sendJson(response, 405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
      }
      try {
        enforceRateLimit(`${origin}|${clientAddress(request.headers, request.socket.remoteAddress || 'unknown')}`);
        validateJsonContentType(request.headers['content-type']);
        validateDeclaredLength(request.headers['content-length']);
        const body = await readJson(request);
        try { const result = await analyzeSemanticImage(body); await usageLedger.record(buildUsageEvent({ body, result })); return sendJson(response, 200, result); }
        catch (error) { await usageLedger.record(buildUsageEvent({ body, error })); throw error; }
      } catch (error) {
        const failure = publicError(error);
        if (failure.status === 429) response.setHeader('Retry-After', '60');
        return sendJson(response, failure.status, failure.body);
      }
    }
    if (url.pathname === '/dashboard') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed.' });
      const bytes = await readFile(resolve(root, 'dashboard.html'));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return response.end(request.method === 'HEAD' ? undefined : bytes);
    }
    if (url.pathname === '/admin/ai-usage') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed.' });
      const bytes = await readFile(resolve(root, 'ai-usage-dashboard.html'));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(request.method === 'HEAD' ? undefined : bytes);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed.' });
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '');
    const target = resolve(root, relative);
    if (target !== root && !target.startsWith(root + sep)) return sendJson(response, 403, { error: 'Forbidden.' });
    const bytes = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    const status = Number(error.statusCode) || (error.code === 'ENOENT' ? 404 : 500);
    sendJson(response, status, { error: error.message || 'Server error.', transportStatus: error.transportStatus || null });
  }
}).listen(port, host, () => console.log(`Nitros secure server listening on http://${host}:${port}`));
