import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAssistantRequest, handleMentorEvent } from './assistant-api.mjs';
import { LearningAnalyticsStore, createSessionToken, hashSessionToken } from './learning-analytics-store.mjs';
import { SupabaseLearningAnalyticsStore } from './supabase-store.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const isVercel = ['1', 'true'].includes(String(process.env.VERCEL || '').toLowerCase());
const isRender = String(process.env.RENDER || '').toLowerCase() === 'true';
const isPreview = process.argv.includes('--preview');
const configuredPort = String(process.env.PORT || '').trim();
const port = configuredPort ? Number(configuredPort) : (isPreview ? 3000 : 4173);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be a valid TCP port number.');
const host = isRender ? '0.0.0.0' : (String(process.env.HOST || '').trim() || (configuredPort || isPreview ? '0.0.0.0' : '127.0.0.1'));
const dataDirectory = process.env.ONLINE_LAB_DATA_DIR
  ? resolve(process.env.ONLINE_LAB_DATA_DIR)
  : (isRender ? '/var/data' : '');
const useSupabase = isVercel || Boolean(process.env.SUPABASE_URL || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
export const store = useSupabase ? new SupabaseLearningAnalyticsStore(root) : new LearningAnalyticsStore(root, dataDirectory);
// Keep configuration failures inside the API handler so Vercel can return a
// controlled 503 response instead of failing while importing this module.
if (isVercel) store.ready.catch(() => undefined);
const sessions = new Map();
const loginWindows = new Map();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const SESSION_MS = 8 * 60 * 60 * 1000;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,40}$/;

function sendJson(response, status, data, headers = {}) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); response.end(JSON.stringify(data)); }
function localCorsHeaders(request) {
  const origin = request.headers.origin;
  if (!origin) return {};
  const configured = String(process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const allowed = new Set(['http://127.0.0.1:' + port, 'http://localhost:' + port, ...configured]);
  const forwardedHost = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
  const forwardedProto = String(request.headers['x-forwarded-proto'] || (request.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.host === forwardedHost && parsedOrigin.protocol === forwardedProto + ':') allowed.add(origin);
  } catch {}
  if (!allowed.has(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' };
}
function originAllowed(request) { return !request.headers.origin || Object.keys(localCorsHeaders(request)).length > 0; }
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}
function sessionCookie(request, token, maxAge) {
  const secure = request.headers['x-forwarded-proto'] === 'https' || Boolean(request.socket.encrypted);
  return 'lab_session=' + encodeURIComponent(token || '') + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}
async function getSessionUser(request) {
  const token = parseCookies(request.headers.cookie).lab_session;
  if (!token) return null;
  const key = hashSessionToken(token), session = store.isRemote ? await store.getSession(key) : sessions.get(key);
  if (!session || session.expiresAt <= Date.now()) {
    if (store.isRemote) await store.deleteSession(key); else sessions.delete(key);
    return null;
  }
  const user = store.getUser(session.userId);
  if (!user) {
    if (store.isRemote) await store.deleteSession(key); else sessions.delete(key);
    return null;
  }
  return { ...user, sessionKey: key };
}
async function revokeUserSessions(userId) {
  if (store.isRemote) return store.revokeUserSessions(userId);
  for (const [key, session] of sessions) if (session.userId === userId) sessions.delete(key);
}
function loginRateLimited(request) {
  const ip = request.socket.remoteAddress || 'local';
  const now = Date.now(), entry = loginWindows.get(ip) || { start: now, count: 0 };
  if (now - entry.start > 60_000) { entry.start = now; entry.count = 0; }
  entry.count += 1; loginWindows.set(ip, entry);
  if (loginWindows.size > 1000) for (const [key, value] of loginWindows) if (now - value.start > 60_000) loginWindows.delete(key);
  return entry.count > 12;
}
async function readRequest(request, maxBytes = 32_000) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > maxBytes) throw Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 }); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('INVALID_JSON'), { status: 400 }); }
}
async function requireUser(request, response, adminOnly = false) {
  const user = await getSessionUser(request);
  if (!user) { sendJson(response, 401, { error: 'Сессия не найдена. Войдите снова.' }, localCorsHeaders(request)); return null; }
  if (user.mustChangePassword) { sendJson(response, 428, { error: 'Перед продолжением смените временный пароль.' }, localCorsHeaders(request)); return null; }
  if (adminOnly && user.role !== 'admin') { sendJson(response, 403, { error: 'Бұл әрекетке әкімші құқығы қажет.' }, localCorsHeaders(request)); return null; }
  return user;
}
function removeSessionCookie(request) { return { 'Set-Cookie': sessionCookie(request, '', 0) }; }

export async function handleRequest(request, response) {
  const url = new URL(request.url || '/', 'http://' + (request.headers.host || '127.0.0.1'));
  if (url.pathname.startsWith('/api/')) {
    const cors = localCorsHeaders(request);
    if (!originAllowed(request)) return sendJson(response, 403, { error: 'Origin рұқсат етілмеген.' });
    if (request.method === 'OPTIONS') { response.writeHead(204, cors); return response.end(); }
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') return sendJson(response, 200, { ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY), adminConfigured: store.hasAdmin(), databaseConfigured: store.isRemote ? Boolean(store.isConnected) : true }, cors);
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        if (loginRateLimited(request)) return sendJson(response, 429, { error: 'Кіру әрекеттері жиілеп кетті. Бір минуттан соң қайталап көріңіз.' }, cors);
        const body = await readRequest(request, 8_000);
        const username = String(body.username || '').trim();
        if (!USERNAME_RE.test(username) || !String(body.password || '').length) return sendJson(response, 400, { error: 'Логин мен құпиясөзді енгізіңіз.' }, cors);
        const user = await store.authenticate(username, body.password);
        if (!user) return sendJson(response, 401, { error: 'Логин немесе құпиясөз дұрыс емес.' }, cors);
        const token = createSessionToken(), key = hashSessionToken(token);
        const expiresAt = Date.now() + SESSION_MS;
        if (store.isRemote) await store.createSession(key, user.id, expiresAt);
        else sessions.set(key, { userId: user.id, expiresAt });
        return sendJson(response, 200, { user }, { ...cors, 'Set-Cookie': sessionCookie(request, token, SESSION_MS / 1000) });
      }
      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        const user = await getSessionUser(request);
        return user ? sendJson(response, 200, { user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role, groupId: user.groupId, mustChangePassword: Boolean(user.mustChangePassword) } }, cors) : sendJson(response, 401, { error: 'Войти для продолжения нужно.' }, cors);
      }
      if (url.pathname === '/api/auth/change-password' && request.method === 'POST') {
        const user = await getSessionUser(request);
        if (!user || user.role !== 'student') return sendJson(response, 401, { error: 'Сначала войдите как студент.' }, cors);
        const body = await readRequest(request, 8_000);
        const updated = await store.changeOwnPassword(user.id, body.password);
        return sendJson(response, 200, { user: updated }, cors);
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        const token = parseCookies(request.headers.cookie).lab_session;
        if (token) {
          const key = hashSessionToken(token);
          if (store.isRemote) await store.deleteSession(key); else sessions.delete(key);
        }
        return sendJson(response, 200, { ok: true }, { ...cors, ...removeSessionCookie(request) });
      }
      if (url.pathname === '/api/assistant' || url.pathname === '/api/mentor-event') {
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'POST қажет.' }, cors);
        const user = await requireUser(request, response);
        if (!user) return;
        const isMentor = url.pathname === '/api/mentor-event';
        const raw = await readRequest(request, isMentor ? 900_000 : 40_000);
        const apiRequest = new Request('http://' + (request.headers.host || '127.0.0.1') + url.pathname, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': request.socket.remoteAddress || 'local' }, body: JSON.stringify(raw) });
        const result = await (isMentor ? handleMentorEvent(apiRequest, process.env) : handleAssistantRequest(apiRequest, process.env));
        response.writeHead(result.status, { ...Object.fromEntries(result.headers), ...cors }); response.end(Buffer.from(await result.arrayBuffer())); return;
      }
      if (url.pathname === '/api/learning/events' && request.method === 'POST') {
        const user = await requireUser(request, response);
        if (!user) return;
        const body = await readRequest(request, 256_000);
        const batch = Array.isArray(body.events) ? body.events.slice(0, 50) : [body];
        const results = [];
        for (const event of batch) {
          try { results.push({ eventId: event.eventId, ...(await store.appendEvent(user, event)) }); }
          catch (error) { results.push({ eventId: event?.eventId || '', accepted: false, duplicate: false, rejected: true, reason: error.status ? error.message : 'Событие қабылданбады.' }); }
        }
        return sendJson(response, 200, { results, accepted: results.filter(item => item.accepted).length, duplicates: results.filter(item => item.duplicate).length, rejected: results.filter(item => item.rejected).length }, cors);
      }
      if (url.pathname === '/api/learning/grade' && request.method === 'POST') {
        const user = await requireUser(request, response);
        if (!user) return;
        return sendJson(response, 200, { result: store.gradeLab(user, await readRequest(request, 64_000)) }, cors);
      }
      if (url.pathname === '/api/learning/quiz-grade' && request.method === 'POST') {
        const user = await requireUser(request, response);
        if (!user) return;
        return sendJson(response, 200, { result: store.gradeQuiz(user, await readRequest(request, 64_000)) }, cors);
      }
      if (url.pathname === '/api/learning/me' && request.method === 'GET') {
        const user = await requireUser(request, response);
        if (!user) return;
        return sendJson(response, 200, store.queryAnalytics(user, { labId: url.searchParams.get('labId'), from: url.searchParams.get('from'), to: url.searchParams.get('to'), limit: url.searchParams.get('limit') }), cors);
      }
      if (url.pathname === '/api/learning/admin' && request.method === 'GET') {
        const user = await requireUser(request, response, true);
        if (!user) return;
        return sendJson(response, 200, store.queryAnalytics(user, {
          studentId: url.searchParams.get('studentId'), groupId: url.searchParams.get('groupId'), labId: url.searchParams.get('labId'),
          from: url.searchParams.get('from'), to: url.searchParams.get('to'), limit: url.searchParams.get('limit')
        }), cors);
      }
      if (url.pathname === '/api/learning/settings' && request.method === 'GET') {
        const user = await requireUser(request, response);
        if (!user) return;
        return sendJson(response, 200, store.getSettings(), cors);
      }
      if (url.pathname === '/api/learning/settings' && request.method === 'PATCH') {
        const user = await requireUser(request, response, true);
        if (!user) return;
        return sendJson(response, 200, await store.setRubricWeights(user, await readRequest(request, 8_000)), cors);
      }
      if (url.pathname === '/api/curriculum' && request.method === 'GET') {
        const user = await requireUser(request, response);
        if (!user) return;
        return sendJson(response, 200, store.getCurriculum(user), cors);
      }
      if (url.pathname === '/api/curriculum/meta' && request.method === 'GET') {
        const user = await requireUser(request, response);
        if (!user) return;
        return sendJson(response, 200, store.getCurriculumMeta(), cors);
      }
      if (url.pathname === '/api/curriculum' && request.method === 'PUT') {
        const user = await requireUser(request, response, true);
        if (!user) return;
        return sendJson(response, 200, await store.saveCurriculum(user, await readRequest(request, 30 * 1024 * 1024)), cors);
      }
      if (url.pathname === '/api/admin/students' && request.method === 'GET') {
        const user = await requireUser(request, response, true);
        if (!user) return;
        return sendJson(response, 200, { students: store.listStudents() }, cors);
      }
      if (url.pathname === '/api/admin/students' && request.method === 'POST') {
        const user = await requireUser(request, response, true);
        if (!user) return;
        const created = await store.createStudent(await readRequest(request, 8_000));
        return sendJson(response, 201, { student: created }, cors);
      }
      if (url.pathname === '/api/admin/students/import' && request.method === 'POST') {
        const user = await requireUser(request, response, true);
        if (!user) return;
        const body = await readRequest(request, 2_000_000);
        const result = await store.createStudentsBatch(body.students);
        return sendJson(response, 200, result, cors);
      }
      const studentMatch = url.pathname.match(/^\/api\/admin\/students\/([a-f0-9-]{36})$/i);
      if (studentMatch && request.method === 'PATCH') {
        const user = await requireUser(request, response, true);
        if (!user) return;
        const updated = await store.updateStudent(studentMatch[1], await readRequest(request, 8_000));
        await revokeUserSessions(studentMatch[1]);
        return sendJson(response, 200, { student: updated }, cors);
      }
      if (studentMatch && request.method === 'DELETE') {
        const user = await requireUser(request, response, true);
        if (!user) return;
        const deleted = await store.deleteStudent(studentMatch[1]);
        await revokeUserSessions(studentMatch[1]);
        return sendJson(response, 200, { student: deleted }, cors);
      }
      return sendJson(response, 404, { error: 'API бағыты табылмады.' }, cors);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status >= 500) console.error('API request failed:', request.method, url.pathname, error?.name || 'Error');
      const message = status >= 500 ? 'Сұрауды өңдеу мүмкін болмады.' : error.message;
      return sendJson(response, status, { error: message }, cors);
    }
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'GET қажет.' });
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return sendJson(response, 400, { error: 'URL қате.' }); }
  if (pathname === '/') pathname = '/index.html';
  if (pathname.split('/').some(part => part.startsWith('.'))) return sendJson(response, 404, { error: 'Табылмады.' });
  const file = resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + sep)) return sendJson(response, 403, { error: 'Тыйым салынған.' });
  const extension = extname(file).toLowerCase();
  if (extension === '.mjs') return sendJson(response, 404, { error: 'Табылмады.' });
  const type = types[extension];
  if (!type) return sendJson(response, 404, { error: 'Табылмады.' });
  try { await stat(file); const content = await readFile(file); response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': pathname.endsWith('.js') || pathname.endsWith('.mjs') ? 'no-cache' : 'no-store' }); response.end(request.method === 'HEAD' ? undefined : content); }
  catch { sendJson(response, 404, { error: 'Файл табылмады.' }); }
}

let requestQueue = Promise.resolve();
export async function handleDatabaseRequest(request, response) {
  const run = requestQueue.then(async () => {
    await store.refresh();
    await handleRequest(request, response);
  });
  requestQueue = run.catch(() => undefined);
  try {
    await run;
  } catch (error) {
    console.error('Database request failed:', request.method, error?.name || 'Error');
    if (!response.headersSent) sendJson(response, 503, { error: 'Сервер базасына қосылу мүмкін болмады.' });
    else if (!response.writableEnded) response.end();
  }
}

if (!isVercel) {
  await store.ready;
  const server = createServer((req, res) => {
    if (store.isRemote && req.url?.startsWith('/api/')) return handleDatabaseRequest(req, res);
    return handleRequest(req, res);
  });
  if (isPreview && !store.hasAdmin()) throw new Error('Preview needs the existing accounts. Set SUPABASE_URL and SUPABASE_SECRET_KEY as server secrets or point ONLINE_LAB_DATA_DIR at your private data directory.');
  const adminUsername = String(process.env.ADMIN_USERNAME || '').trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || '');
  const adminProvisioned = (store.isRemote || isPreview) ? store.hasAdmin() : await store.ensureAdmin(adminUsername, adminPassword);
  const adminConfigured = store.hasAdmin();
  if (!adminProvisioned) {
    const issues = [];
    if (!USERNAME_RE.test(adminUsername)) issues.push('ADMIN_USERNAME must be 3–40 ASCII letters, digits, dots, hyphens, or underscores');
    if (adminPassword.length < 12) issues.push('ADMIN_PASSWORD must contain at least 12 characters');
    console.warn('Admin environment credentials were not applied. ' + issues.join('; ') + '. Credential values are never logged.');
  }
  server.on('error', error => {
    console.error('HTTP server failed to listen:', error?.code || 'SERVER_ERROR');
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const address = server.address();
    const listeningPort = address && typeof address === 'object' ? address.port : port;
    console.log('Online Laboratory listening on ' + host + ':' + listeningPort);
  });
}
console.log('Optional AI mentor: ' + (process.env.OPENAI_API_KEY ? 'configured' : 'disabled (OPENAI_API_KEY is optional)'));
if (!isVercel) console.log('Administrator account: ' + (store.hasAdmin() ? 'ready' : 'not configured'));
