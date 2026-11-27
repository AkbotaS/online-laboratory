import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const PAGE_SIZE = 1000;
const defaultDataDir = resolve('data', 'learning-analytics');
const dataDir = resolve(process.argv[2] || defaultDataDir);
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const apiKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !apiKey) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in the process environment.');

async function request(path, { method = 'GET', body, prefer, range } = {}) {
  const headers = { apikey: apiKey, Authorization: 'Bearer ' + apiKey, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  if (range) { headers.Range = range; headers['Range-Unit'] = 'items'; }
  const response = await fetch(supabaseUrl + '/rest/v1/' + path, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  if (!response.ok) throw new Error('Supabase request failed with HTTP ' + response.status + '.');
  if (!text) return null;
  return JSON.parse(text);
}

async function getAll(table) {
  const result = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await request(table + '?select=*', { range: offset + '-' + (offset + PAGE_SIZE - 1) });
    if (!Array.isArray(page)) throw new Error('Unexpected response while reading ' + table + '.');
    result.push(...page);
    if (page.length < PAGE_SIZE) return result;
  }
}

async function readJson(name, fallback) {
  try { return JSON.parse(await readFile(join(dataDir, name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function readEvents(name, isMeasure, knownStudents) {
  let contents = '';
  try { contents = await readFile(join(dataDir, name), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const rows = [];
  for (const line of contents.split(/\r?\n/)) {
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); }
    catch { throw new Error('Malformed analytics record in ' + name + '; migration stopped before writing data.'); }
    if (!event?.id || !event?.studentId || !event?.type) throw new Error('Incomplete analytics record in ' + name + '; migration stopped before writing data.');
    if (!knownStudents.has(event.studentId)) throw new Error('Analytics record references an account missing from users.json; migration stopped before writing data.');
    rows.push({ id: event.id, student_id: event.studentId, is_measure: isMeasure, payload: event });
  }
  return rows;
}

async function main() {
  const users = await readJson('users.json', []);
  const curriculum = await readJson('curriculum.json', null);
  const settings = await readJson('settings.json', { rubricWeights: { equipment: 15, steps: 30, safety: 15, microscope: 20, questions: 20 } });
  if (!Array.isArray(users) || !curriculum || !Array.isArray(curriculum.labs) || !Array.isArray(curriculum.quizzes)) throw new Error('The backup does not contain a valid user list and curriculum.');
  for (const user of users) {
    if (!user.id || !user.username || !user.passwordSalt || !user.passwordHash || user.password) throw new Error('A user record is missing a valid password hash or contains an unsafe plaintext password field.');
  }

  const existing = await Promise.all([
    getAll('online_lab_users'),
    request('online_lab_documents?select=id,payload'),
    getAll('online_lab_events')
  ]);
  const [existingUsers, existingDocs, existingEvents] = existing;
  const existingIds = new Set(existingUsers.map(row => row.id));
  const existingDocIds = new Set(existingDocs.map(row => row.id));
  const existingEventIds = new Set(existingEvents.map(row => row.id));
  const sourceUserRows = users.map(user => ({
    id: user.id, username: user.username, display_name: user.displayName, role: user.role,
    group_id: user.groupId || '', active: user.active !== false,
    must_change_password: Boolean(user.mustChangePassword), password_salt: user.passwordSalt,
    password_hash: user.passwordHash, created_at: user.createdAt || new Date().toISOString(),
    password_changed_at: user.passwordChangedAt || null
  }));
  const sourceUsersById = new Map(sourceUserRows.map(row => [row.id, row]));
  const userRows = sourceUserRows.filter(row => !existingIds.has(row.id));
  for (const row of existingUsers) {
    const source = sourceUsersById.get(row.id);
    if (!source || !isDeepStrictEqual(source, row)) {
      throw new Error('Supabase already contains different account data. No existing rows were changed.');
    }
  }
  const sourceDocs = [
    { id: 'curriculum', payload: curriculum, revision: Number(curriculum.revision) || 1, updated_at: curriculum.updatedAt || new Date().toISOString() },
    { id: 'settings', payload: settings, revision: 1, updated_at: new Date().toISOString() }
  ];
  for (const row of existingDocs) {
    const source = sourceDocs.find(item => item.id === row.id);
    if (!source || !isDeepStrictEqual(source.payload, row.payload)) throw new Error('Supabase already contains different curriculum or settings. No existing rows were changed.');
  }
  const docs = sourceDocs.filter(row => !existingDocIds.has(row.id));
  const knownStudents = new Set(users.filter(user => user.role === 'student').map(user => user.id));
  const [events, measures] = await Promise.all([
    readEvents('events.ndjson', false, knownStudents),
    readEvents('measures.ndjson', true, knownStudents)
  ]);
  const eventRows = [...events, ...measures].filter(row => !existingEventIds.has(row.id));
  const existingEventById = new Map(existingEvents.map(row => [row.id, row]));
  for (const source of [...events, ...measures]) {
    const current = existingEventById.get(source.id);
    if (current && (current.student_id !== source.student_id || current.is_measure !== source.is_measure || !isDeepStrictEqual(current.payload, source.payload))) {
      throw new Error('Supabase already contains different analytics event data. No existing rows were changed.');
    }
  }

  if (userRows.length) await request('online_lab_users', { method: 'POST', body: userRows, prefer: 'return=minimal' });
  if (docs.length) await request('online_lab_documents', { method: 'POST', body: docs, prefer: 'return=minimal' });
  for (let offset = 0; offset < eventRows.length; offset += 100) {
    await request('online_lab_events', { method: 'POST', body: eventRows.slice(offset, offset + 100), prefer: 'return=minimal' });
  }
  console.log(JSON.stringify({
    migratedUsers: userRows.length,
    existingUsersPreserved: existingUsers.length,
    migratedDocuments: docs.length,
    migratedEvents: events.length,
    migratedMeasures: measures.length,
    curriculumLabs: curriculum.labs.length,
    curriculumQuizzes: curriculum.quizzes.length
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
