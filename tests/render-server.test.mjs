import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const adminUsername = 'render_test_admin';
const adminPassword = 'RenderTestAdminPass2026!';
const temporaryStudentPassword = 'TemporaryStudentPass2026!';
const newStudentPassword = 'ChangedStudentPass2026!';

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startServer(dataRoot) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      RENDER: 'true',
      ONLINE_LAB_DATA_DIR: dataRoot,
      ADMIN_USERNAME: adminUsername,
      ADMIN_PASSWORD: adminPassword,
      OPENAI_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  let lastRequestError = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited before health check: ${output}`);
    try {
      const response = await rawRequest(baseUrl, '/api/health');
      if (response.status === 200) return { child, baseUrl, output: () => output };
    } catch (error) { lastRequestError = error?.cause?.code || error.message; }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  await stopServer(child);
  throw new Error(`Server did not become healthy (${lastRequestError}): ${output}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
}

function rawRequest(baseUrl, path, { method = 'GET', body, rawBody, cookie } = {}) {
  const url = new URL(path, baseUrl);
  const headers = {};
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (payload !== undefined) headers['Content-Length'] = Buffer.byteLength(payload);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.once('error', reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

async function jsonRequest(baseUrl, path, { method = 'GET', body, cookie } = {}) {
  const response = await rawRequest(baseUrl, path, { method, body, cookie });
  return { response, data: JSON.parse(response.text || '{}') };
}

function sessionCookie(response) {
  const value = response.headers['set-cookie']?.[0] || '';
  return value.split(';', 1)[0];
}

test('Render-style startup binds publicly and auth, curriculum, grading, and analytics work without AI', async t => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'online-lab-render-'));
  let child;
  t.after(async () => {
    await stopServer(child);
    await rm(dataRoot, { recursive: true, force: true });
  });

  let server = await startServer(dataRoot);
  child = server.child;
  let baseUrl = server.baseUrl;
  const health = await jsonRequest(baseUrl, '/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(health.data.aiConfigured, false);
  assert.equal(health.data.adminConfigured, true);
  assert.match(server.output(), new RegExp(`Online Laboratory listening on 0\\.0\\.0\\.0:${new URL(baseUrl).port}`));
  assert.doesNotMatch(server.output(), new RegExp(adminPassword));

  const home = await rawRequest(baseUrl, '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Online Laboratory/);

  assert.equal((await jsonRequest(baseUrl, '/api/curriculum')).response.status, 401);
  const malformed = await rawRequest(baseUrl, '/api/auth/login', { method: 'POST', rawBody: '{' });
  assert.equal(malformed.status, 400);

  const adminLogin = await jsonRequest(baseUrl, '/api/auth/login', { method: 'POST', body: { username: adminUsername, password: adminPassword } });
  assert.equal(adminLogin.response.status, 200);
  const adminCookie = sessionCookie(adminLogin.response);
  assert.ok(adminCookie.startsWith('lab_session='));

  const initialCurriculum = await jsonRequest(baseUrl, '/api/curriculum', { cookie: adminCookie });
  assert.equal(initialCurriculum.response.status, 200);
  assert.ok(initialCurriculum.data.labs.length >= 2, 'restored labs are seeded on an empty Render disk');
  assert.ok(initialCurriculum.data.quizzes.length >= 1);

  const savedCurriculum = await jsonRequest(baseUrl, '/api/curriculum', {
    method: 'PUT', cookie: adminCookie,
    body: {
      labs: [{ id: 'render-lab-test', title: 'Render test lab', equipment: [{ id: 'scope', name: 'Microscope', correct: true }], steps: [{ id: 'step-one', text: 'Observe', correct: true, order: 1 }], safetyCriteria: [{ id: 'coat', text: 'Wear a lab coat' }], microscopeCriteria: [{ id: 'shape', label: 'Shape', answers: ['rod'] }] }],
      quizzes: [{ id: 'render-quiz-test', labId: 'render-lab-test', title: 'Render test quiz', questions: [{ id: 'render-question', prompt: 'What is used to observe the sample?', options: ['Microscope', 'Notebook'], correct: 0 }] }],
      assistantConfig: null
    }
  });
  assert.equal(savedCurriculum.response.status, 200);

  const createdStudent = await jsonRequest(baseUrl, '/api/admin/students', {
    method: 'POST', cookie: adminCookie,
    body: { displayName: 'Render Test Student', groupId: 'BIO-TEST', username: 'render_student', password: temporaryStudentPassword }
  });
  assert.equal(createdStudent.response.status, 201);
  assert.equal(createdStudent.data.student.mustChangePassword, true);

  const studentLogin = await jsonRequest(baseUrl, '/api/auth/login', { method: 'POST', body: { username: 'render_student', password: temporaryStudentPassword } });
  assert.equal(studentLogin.response.status, 200);
  const studentCookie = sessionCookie(studentLogin.response);
  assert.equal((await jsonRequest(baseUrl, '/api/admin/students', { cookie: studentCookie })).response.status, 428);

  const changed = await jsonRequest(baseUrl, '/api/auth/change-password', { method: 'POST', cookie: studentCookie, body: { password: newStudentPassword } });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.data.user.mustChangePassword, false);
  assert.equal((await jsonRequest(baseUrl, '/api/admin/students', { cookie: studentCookie })).response.status, 403);

  const studentCurriculum = await jsonRequest(baseUrl, '/api/curriculum', { cookie: studentCookie });
  assert.equal(studentCurriculum.response.status, 200);
  assert.doesNotMatch(JSON.stringify(studentCurriculum.data), /"correct"|"answers"/);

  const grade = await jsonRequest(baseUrl, '/api/learning/quiz-grade', {
    method: 'POST', cookie: studentCookie,
    body: { quizId: 'render-quiz-test', answers: { 'render-question': 0 } }
  });
  assert.equal(grade.response.status, 200);
  assert.equal(grade.data.result.score, 1);

  const event = { eventId: 'evt_render_score_0001', type: 'score_calculated', labId: 'render-lab-test', labTitle: 'Render test lab', sessionId: 'session_render_01', stage: 'result', data: { score: 100, scoreTotal: 100 } };
  const recorded = await jsonRequest(baseUrl, '/api/learning/events', { method: 'POST', cookie: studentCookie, body: event });
  assert.equal(recorded.response.status, 200);
  assert.equal(recorded.data.accepted, 1);

  await stopServer(child);
  server = await startServer(dataRoot);
  child = server.child;
  baseUrl = server.baseUrl;
  const relogin = await jsonRequest(baseUrl, '/api/auth/login', { method: 'POST', body: { username: 'render_student', password: newStudentPassword } });
  assert.equal(relogin.response.status, 200);
  const persisted = await jsonRequest(baseUrl, '/api/learning/me', { cookie: sessionCookie(relogin.response) });
  assert.equal(persisted.response.status, 200);
  assert.equal(persisted.data.summary.sampleSize, 1);
});
