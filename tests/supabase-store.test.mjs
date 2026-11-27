import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SupabaseLearningAnalyticsStore } from '../supabase-store.mjs';

test('Supabase store preserves accounts, documents, events, and persistent sessions', async t => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldSecretKey = process.env.SUPABASE_SECRET_KEY;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tables = {
    online_lab_users: [],
    online_lab_documents: [
      { id: 'curriculum', payload: JSON.parse(await readFile(resolve('seed/curriculum.json'), 'utf8')), revision: 1, updated_at: new Date().toISOString() },
      { id: 'settings', payload: { rubricWeights: { equipment: 15, steps: 30, safety: 15, microscope: 20, questions: 20 } }, revision: 1, updated_at: new Date().toISOString() }
    ],
    online_lab_events: [],
    online_lab_sessions: []
  };

  process.env.SUPABASE_URL = 'https://supabase-test.invalid';
  process.env.SUPABASE_SECRET_KEY = 'test-only-secret';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const table = url.pathname.split('/').at(-1);
    const rows = tables[table];
    if (!rows) return new Response('', { status: 404 });
    if (init.method === 'GET' || !init.method) {
      let selected = rows.filter(row => [...url.searchParams.entries()].every(([key, value]) => {
        if (key === 'select') return true;
        const [operator, filter] = value.split('.', 2);
        return operator === 'eq' && String(row[key]) === decodeURIComponent(filter);
      }));
      if (init.headers?.Range) {
        const [start, end] = init.headers.Range.split('-').map(Number);
        selected = selected.slice(start, end + 1);
      }
      return Response.json(selected);
    }
    if (init.method === 'POST') {
      const incoming = JSON.parse(init.body);
      const list = Array.isArray(incoming) ? incoming : [incoming];
      const inserted = [];
      for (const row of list) {
        const key = table === 'online_lab_sessions' ? 'token_hash' : 'id';
        const index = rows.findIndex(current => current[key] === row[key]);
        if (index >= 0) {
          if (init.headers?.Prefer?.includes('resolution=merge-duplicates')) rows[index] = { ...rows[index], ...row };
          continue;
        }
        rows.push(row);
        inserted.push(row);
      }
      return init.headers?.Prefer?.includes('return=representation') ? Response.json(inserted) : new Response(null, { status: 201 });
    }
    if (init.method === 'DELETE') {
      for (const [key, value] of url.searchParams.entries()) {
        if (key === 'select') continue;
        const [operator, filter] = value.split('.', 2);
        if (operator === 'eq') {
          const target = decodeURIComponent(filter);
          for (let index = rows.length - 1; index >= 0; index--) if (String(rows[index][key]) === target) rows.splice(index, 1);
        }
      }
      return new Response(null, { status: 204 });
    }
    return new Response('', { status: 405 });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldSecretKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = oldSecretKey;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  });

  const store = new SupabaseLearningAnalyticsStore(process.cwd());
  await store.ready;
  assert.equal(store.isConnected, true);
  assert.equal(store.curriculum.labs.length, 2);

  assert.equal(await store.ensureAdmin('testteacher', 'TestAdminPassword2026!'), true);
  const admin = await store.authenticate('testteacher', 'TestAdminPassword2026!');
  assert.equal(admin.role, 'admin');
  const student = await store.createStudent({ displayName: 'Student Test', groupId: 'BIO-10A', username: 'student_test01', password: 'TemporaryStudent2026!' });
  assert.equal((await store.authenticate(student.username, 'TemporaryStudent2026!')).id, student.id);
  assert.equal(tables.online_lab_users.length, 2);

  await store.createSession('hashed-session-token', student.id, Date.now() + 60_000);
  assert.deepEqual(await store.getSession('hashed-session-token'), { userId: student.id, expiresAt: (await store.getSession('hashed-session-token')).expiresAt });
  await store.refresh();
  assert.equal(store.getUser(student.id).role, 'student');

  const curriculum = { labs: [{ id: 'lab-db', title: 'Persistent lab', equipment: [], steps: [] }], quizzes: [], assistantConfig: null };
  await store.saveCurriculum(admin, curriculum);
  assert.equal(tables.online_lab_documents.find(row => row.id === 'curriculum').payload.labs[0].id, 'lab-db');
  assert.equal(store.getCurriculum(student).labs[0]._answerKeyHidden, true);

  const eventInput = { eventId: 'event_database_0001', type: 'lab_started', labId: 'lab-db', sessionId: 'session_database_01', data: {} };
  assert.equal((await store.appendEvent(student, eventInput)).accepted, true);
  assert.equal((await store.appendEvent(student, eventInput)).duplicate, true);
  await store.refresh();
  assert.equal(store.queryAnalytics(student).events.length, 1);
  await store.deleteSession('hashed-session-token');
  assert.equal(await store.getSession('hashed-session-token'), null);
});
